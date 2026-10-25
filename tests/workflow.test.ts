// End-to-end approval workflow: real Postgres (PGlite), real LangGraph graph, real store/RBAC,
// a scripted LLM and fake GitHub tools. Covers who can run what, and admin review of sensitive actions.
import { randomBytes } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { AIMessage } from "@langchain/core/messages";
import type { MemorySaver } from "@langchain/langgraph";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { addUser, freshDatabase, resetDatabase } from "./pg";

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  saver: null as unknown as MemorySaver,
  replies: [] as AIMessage[],
  executed: [] as string[],
}));

vi.mock("@/backend/db", async () => {
  const { queryVia } = await import("./pg");
  return { query: queryVia(() => h.db), ensureSchema: async () => undefined };
});

vi.mock("@/backend/session", () => {
  class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { HttpError };
});

// The production agentFor, minus GitHub key/LLM/Postgres-checkpointer wiring.
vi.mock("@/backend/agent", async () => {
  const { tool } = await import("@langchain/core/tools");
  const { z } = await import("zod");
  const { Agent } = await import("@/backend/agent/graph");
  const { allowedTools } = await import("@/backend/rbac");
  const { recordAction } = await import("@/backend/store");
  const fake = (name: string) =>
    tool(
      async ({ repo }: { repo: string }) => {
        h.executed.push(`${name}:${repo}`);
        return JSON.stringify({ ok: true });
      },
      { name, description: name, schema: z.object({ repo: z.string() }) },
    );
  const tools = [fake("get_repositories"), fake("create_issue"), fake("delete_repository")];
  return {
    agentFor: async (userId: string, access: Parameters<typeof allowedTools>[1], actorId = userId) =>
      new Agent(
        { invoke: async () => h.replies.shift() ?? new AIMessage("(no scripted reply)") },
        allowedTools(tools, access),
        new Set(["create_issue", "delete_repository"]),
        h.saver,
        (threadId, call, decision, ok, detail) =>
          recordAction({ userId, actorId, conversationId: threadId, tool: call.name, args: call.args, decision, ok, detail }),
      ),
  };
});

const { MemorySaver: Saver } = await import("@langchain/langgraph");
const { agentFor } = await import("@/backend/agent");
const { approvePending, conversationState, rejectPending, reviewRequest } = await import("@/backend/approvals");
const { snapshot } = await import("@/backend/api");
const { getAccess } = await import("@/backend/rbac");
const store = await import("@/backend/store");

const propose = (name: string, id: string) =>
  new AIMessage({ content: "", tool_calls: [{ name, id, args: { repo: "octo/demo" }, type: "tool_call" }] });

async function user(login: string, role: string) {
  const id = await addUser(h.db, login, role);
  return { id, name: login, image: null, login, access: await getAccess(id) };
}

/** User asks for something; the scripted LLM proposes `tool`. */
async function ask(who: Awaited<ReturnType<typeof user>>, tool: string) {
  const conversationId = await store.createConversation(who.id, "test");
  h.replies.push(propose(tool, `call-${tool}`));
  const result = await (await agentFor(who.id, who.access)).ask(conversationId, `please ${tool}`);
  return { conversationId, result };
}

beforeAll(async () => {
  h.db = await freshDatabase();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.saver = new Saver();
  h.replies.length = 0;
  h.executed.length = 0;
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("approval workflow", () => {
  it("runs a member's normal write as soon as they approve", async () => {
    const member = await user("mia", "member");
    const { conversationId, result } = await ask(member, "create_issue");
    expect(result.pending?.name).toBe("create_issue");
    expect((await snapshot(conversationId, result, member.access)).policy).toEqual({ risk: "write", allowed: true, needsReview: false });

    h.replies.push(new AIMessage("Issue created."));
    const done = await approvePending(member, conversationId, {});
    expect(done.pending).toBeNull();
    expect(h.executed).toEqual(["create_issue:octo/demo"]);
    expect((await store.listAudit(member.id))[0]).toMatchObject({ tool: "create_issue", decision: "approved", ok: true });
  });

  it("sends a member's sensitive action to admin review, then runs it from the member's own account", async () => {
    const member = await user("mia", "member");
    const admin = await user("root", "admin");
    const { conversationId } = await ask(member, "delete_repository");

    const waiting = await approvePending(member, conversationId, {});
    expect(waiting.pending?.name).toBe("delete_repository"); // still waiting, nothing ran
    expect(h.executed).toEqual([]);
    const view = await snapshot(conversationId, waiting, member.access);
    expect(view.policy?.needsReview).toBe(true);
    expect(view.review).toMatchObject({ status: "pending", requesterLogin: "mia", tool: "delete_repository" });

    // Clicking again does not create a duplicate request.
    await approvePending(member, conversationId, {});
    expect(await store.listRequests("pending")).toHaveLength(1);

    // The admin decides, but has no access to the member's GitHub: nothing runs yet.
    await reviewRequest(admin, view.review!.id, "approve", "ok, old demo");
    expect(h.executed).toEqual([]);
    expect(await store.getRequest(view.review!.id)).toMatchObject({ status: "approved", reviewerLogin: "root", awaitingRequester: true });

    // Without the member's key in the browser it keeps waiting, and their chat says so.
    const later = await conversationState(member, conversationId, false);
    expect((await snapshot(conversationId, later, member.access)).review).toMatchObject({ status: "approved" });
    expect(h.executed).toEqual([]);

    // With their key, the member's next check-in carries it out, exactly once.
    h.replies.push(new AIMessage("Deleted octo/demo."));
    const done = await conversationState(member, conversationId, true);
    expect(done.pending).toBeNull();
    await conversationState(member, conversationId, true);
    expect(h.executed).toEqual(["delete_repository:octo/demo"]);
    expect(await store.getRequest(view.review!.id)).toMatchObject({ resultOk: true, awaitingRequester: false });
    expect((await store.listMessages(conversationId)).at(-1)).toMatchObject({ role: "assistant", content: "Deleted octo/demo." });

    const audit = await store.listAudit(member.id);
    expect(audit.map((entry) => [entry.decision, entry.actorLogin])).toEqual([
      ["approved", "root"],
      ["review_requested", "mia"],
    ]);
  });

  it("lets an admin reject with a note the AI can relay", async () => {
    const member = await user("mia", "member");
    const admin = await user("root", "admin");
    const { conversationId } = await ask(member, "delete_repository");
    await approvePending(member, conversationId, {});
    const request = (await store.getOpenRequest(conversationId))!;

    await reviewRequest(admin, request.id, "reject", "keep it for the audit");
    expect((await store.getRequest(request.id))?.status).toBe("rejected");

    h.replies.push(new AIMessage("An admin declined."));
    const result = await conversationState(member, conversationId, true);
    expect(h.executed).toEqual([]);
    expect(result.pending).toBeNull();
    const toolReply = result.messages.find((message) => message.getType() === "tool");
    expect(String(toolReply?.content)).toContain("keep it for the audit");
  });

  it("blocks self-review, non-reviewers, and double decisions", async () => {
    const member = await user("mia", "member");
    const other = await user("max", "member");
    const admin = await user("root", "admin");
    const { conversationId } = await ask(member, "delete_repository");
    await approvePending(member, conversationId, {});
    const request = (await store.getOpenRequest(conversationId))!;

    await expect(reviewRequest(other, request.id, "approve", "")).rejects.toMatchObject({ status: 403 });
    await expect(reviewRequest({ ...member, access: await getAccess(admin.id) }, request.id, "approve", "")).rejects.toThrow(
      "your own request",
    );

    await reviewRequest(admin, request.id, "approve", "");
    await expect(reviewRequest(admin, request.id, "approve", "")).rejects.toMatchObject({ status: 409 });
    h.replies.push(new AIMessage("Done."));
    await conversationState(member, conversationId, true);
    expect(h.executed).toEqual(["delete_repository:octo/demo"]); // ran exactly once
  });

  it("cancels the review when the requester moves on", async () => {
    const member = await user("mia", "member");
    const admin = await user("root", "admin");
    const { conversationId } = await ask(member, "delete_repository");
    await approvePending(member, conversationId, {});
    const request = (await store.getOpenRequest(conversationId))!;

    h.replies.push(new AIMessage("Cancelled."));
    await rejectPending(member, conversationId);
    expect((await store.getRequest(request.id))?.status).toBe("cancelled");
    await expect(reviewRequest(admin, request.id, "approve", "")).rejects.toMatchObject({ status: 409 });
    expect(h.executed).toEqual([]);
  });

  it("lets admins run their own sensitive actions without review", async () => {
    const admin = await user("root", "admin");
    const { conversationId } = await ask(admin, "delete_repository");
    h.replies.push(new AIMessage("Deleted."));
    await approvePending(admin, conversationId, {});
    expect(h.executed).toEqual(["delete_repository:octo/demo"]);
    expect(await store.listRequests("all")).toHaveLength(0);
  });

  it("refuses writes from a viewer even if the AI proposes one", async () => {
    const viewer = await user("val", "viewer");
    const { conversationId, result } = await ask(viewer, "create_issue");
    expect((await snapshot(conversationId, result, viewer.access)).policy).toMatchObject({ allowed: false });
    await expect(approvePending(viewer, conversationId, {})).rejects.toMatchObject({ status: 403 });
    expect(h.executed).toEqual([]);
  });

  it("only lets reviewers edit arguments that already exist", async () => {
    const member = await user("mia", "member");
    const { conversationId } = await ask(member, "create_issue");
    h.replies.push(new AIMessage("Created."));
    await approvePending(member, conversationId, { repo: "octo/other", sneaky: "value" });
    expect(h.executed).toEqual(["create_issue:octo/other"]);
    expect((await store.listAudit(member.id))[0].args).toEqual({ repo: "octo/other" });
  });
});
