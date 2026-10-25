// End-to-end agent tests: real LangGraph.js graph and checkpointer, scripted LLM, fake tools.
import { AIMessage, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent, type AuditHook, toolsUsed } from "@/backend/agent/graph";

const executed: string[] = [];
const repoSchema = z.object({ repo: z.string() });

const readRepo = tool(async ({ repo }) => JSON.stringify({ repo, stars: 3 }), {
  name: "read_repo",
  description: "Read a repository.",
  schema: repoSchema,
});
const deleteRepo = tool(
  async ({ repo }) => {
    executed.push(`delete:${repo}`);
    return JSON.stringify({ ok: true });
  },
  { name: "delete_repo", description: "Delete a repository.", schema: repoSchema },
);
const archiveRepo = tool(
  async ({ repo }) => {
    executed.push(`archive:${repo}`);
    return JSON.stringify({ ok: true });
  },
  { name: "archive_repo", description: "Archive a repository.", schema: repoSchema },
);
const brokenRepo = tool(
  async () => {
    throw new Error("bad repo");
  },
  { name: "broken_repo", description: "Always fails.", schema: repoSchema },
);
const failingWrite = tool(async () => JSON.stringify({ error: "GitHub API 403: Forbidden", status: 403 }), {
  name: "failing_write",
  description: "A write GitHub refuses.",
  schema: repoSchema,
});

const call = (name: string, id: string, args: Record<string, unknown> = { repo: "app" }) => ({
  name,
  id,
  args,
  type: "tool_call" as const,
});
const toolCalls = (...calls: ReturnType<typeof call>[]) => new AIMessage({ content: "", tool_calls: calls });

/** Returns queued replies and, like the real API, rejects unanswered tool calls. */
class ScriptedLLM {
  requests: BaseMessage[][] = [];
  constructor(private replies: AIMessage[]) {}

  async invoke(messages: BaseMessage[]) {
    const answered = new Set(messages.filter(ToolMessage.isInstance).map((message) => message.tool_call_id));
    for (const message of messages) {
      for (const pendingCall of (message as AIMessage).tool_calls ?? []) {
        if (!answered.has(pendingCall.id!)) throw new Error(`tool call ${pendingCall.id} has no ToolMessage`);
      }
    }
    this.requests.push(messages);
    const reply = this.replies.shift();
    if (!reply) throw new Error("ScriptedLLM ran out of replies");
    return reply;
  }
}

type AuditRow = Parameters<AuditHook>;
let audit: AuditRow[];

function makeAgent(...replies: AIMessage[]) {
  const llm = new ScriptedLLM(replies);
  const agent = new Agent(
    llm,
    [readRepo, deleteRepo, archiveRepo, brokenRepo, failingWrite],
    new Set(["delete_repo", "archive_repo", "failing_write"]),
    new MemorySaver(),
    async (...row) => {
      audit.push(row);
    },
  );
  return { agent, llm };
}

const lastText = (messages: BaseMessage[]) => messages.at(-1)?.content;

beforeEach(() => {
  executed.length = 0;
  audit = [];
});

describe("Agent", () => {
  it("runs read tools without approval", async () => {
    const { agent } = makeAgent(toolCalls(call("read_repo", "c1")), new AIMessage("3 stars"));
    const result = await agent.ask("t1", "how many stars?");
    expect(lastText(result.messages)).toBe("3 stars");
    expect(result.pending).toBeNull();
    expect(toolsUsed(result.messages)).toEqual(["read_repo"]);
  });

  it("holds a write tool until approved, then runs it with the reviewed arguments", async () => {
    const { agent } = makeAgent(toolCalls(call("delete_repo", "c1")), new AIMessage("Deleted."));

    const paused = await agent.ask("t1", "delete app");
    expect(paused.pending?.name).toBe("delete_repo");
    expect(executed).toEqual([]);

    const done = await agent.approve("t1", { repo: "app-renamed" });
    expect(executed).toEqual(["delete:app-renamed"]);
    expect(lastText(done.messages)).toBe("Deleted.");
    expect(done.pending).toBeNull();
    expect(audit).toEqual([["t1", expect.objectContaining({ args: { repo: "app-renamed" } }), "approved", true, ""]]);
  });

  it("never calls the tool when the action is rejected", async () => {
    const { agent } = makeAgent(toolCalls(call("delete_repo", "c1")), new AIMessage("OK, cancelled."));
    await agent.ask("t1", "delete app");

    const result = await agent.reject("t1");
    expect(executed).toEqual([]);
    expect(lastText(result.messages)).toBe("OK, cancelled.");
    expect(audit[0][2]).toBe("rejected");
  });

  it("runs reads in a mixed batch and holds only the first write", async () => {
    const { agent } = makeAgent(
      toolCalls(call("read_repo", "r1"), call("delete_repo", "w1"), call("archive_repo", "w2")),
      new AIMessage("Done."),
    );

    const paused = await agent.ask("t1", "read, delete and archive app");
    const replies = Object.fromEntries(
      paused.messages.filter(ToolMessage.isInstance).map((message) => [message.tool_call_id, String(message.content)]),
    );
    expect(JSON.parse(replies.r1)).toEqual({ repo: "app", stars: 3 });
    expect(replies.w2).toContain("one write action");
    expect(paused.pending?.id).toBe("w1");

    await agent.approve("t1"); // ScriptedLLM throws if any tool call is unanswered
    expect(executed).toEqual(["delete:app"]);
  });

  it("treats a new message as declining the pending approval", async () => {
    const { agent } = makeAgent(toolCalls(call("delete_repo", "c1")), new AIMessage("Sure, something else."));
    await agent.ask("t1", "delete app");

    const result = await agent.ask("t1", "actually, never mind");
    expect(lastText(result.messages)).toBe("Sure, something else.");
    expect(executed).toEqual([]);
    expect(result.pending).toBeNull();
    expect(audit[0][2]).toBe("superseded");
  });

  it("reports tool exceptions to the LLM instead of crashing", async () => {
    const { agent } = makeAgent(toolCalls(call("broken_repo", "c1")), new AIMessage("It failed."));
    const result = await agent.ask("t1", "break it");
    const reply = result.messages.find(ToolMessage.isInstance);
    expect(String(reply?.content)).toContain("bad repo");
    expect(lastText(result.messages)).toBe("It failed.");
  });

  it("records failed GitHub writes in the audit log", async () => {
    const { agent } = makeAgent(toolCalls(call("failing_write", "c1")), new AIMessage("GitHub refused."));
    await agent.ask("t1", "do it");
    await agent.approve("t1");
    expect(audit[0].slice(2)).toEqual(["approved", false, "GitHub API 403: Forbidden"]);
  });

  it("keeps conversations separate", async () => {
    const { agent } = makeAgent(toolCalls(call("delete_repo", "c1")));
    await agent.ask("thread-a", "delete app");
    expect((await agent.state("thread-a")).pending).not.toBeNull();
    expect((await agent.state("thread-b")).pending).toBeNull();
  });

  it("does nothing when approving with no pending action", async () => {
    const { agent } = makeAgent(new AIMessage("hi"));
    await agent.ask("t1", "hello");
    const result = await agent.approve("t1");
    expect(lastText(result.messages)).toBe("hi");
    expect(audit).toEqual([]);
  });
});
