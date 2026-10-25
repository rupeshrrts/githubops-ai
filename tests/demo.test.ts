// Demo mode: the real GitHub tools and the real agent running on the pretend GitHub account,
// and demo sessions stored in real Postgres (PGlite).
import type { PGlite } from "@electric-sql/pglite";
import { AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Agent } from "@/backend/agent/graph";
import { createFakeOctokit, DEMO_OWNER, type Sandbox, seedSandbox, viewOf } from "@/backend/demo/sandbox";
import { createTools, WRITE_TOOL_NAMES } from "@/backend/github/tools";

import { freshDatabase } from "./pg";

const h = vi.hoisted(() => ({ db: null as unknown as PGlite }));
vi.mock("@/backend/db", async () => {
  const { queryVia } = await import("./pg");
  return { query: queryVia(() => h.db), ensureSchema: async () => undefined };
});
const demoStore = await import("@/backend/demo/store");

function demoTools(sandbox: Sandbox): Record<string, StructuredToolInterface> {
  const tools = createTools(createFakeOctokit(sandbox), DEMO_OWNER);
  return Object.fromEntries(tools.map((tool) => [tool.name, tool as StructuredToolInterface]));
}
const run = async (sandbox: Sandbox, name: string, args: Record<string, unknown> = {}) =>
  JSON.parse(String(await demoTools(sandbox)[name].invoke(args)));

describe("pretend GitHub with the real tools", () => {
  it("lists the sample repositories, most recently pushed first", async () => {
    const result = await run(seedSandbox(), "get_repositories");
    expect(result.repositories.map((repo: { name: string }) => repo.name)).toEqual([
      "api-server",
      "portfolio-site",
      "ml-notebooks",
      "dotfiles",
    ]);
    expect(result.repositories[0]).toMatchObject({ full_name: "demo-user/api-server", visibility: "Private" });
  });

  it("answers read questions from the sample data", async () => {
    const sandbox = seedSandbox();
    expect((await run(sandbox, "get_workflow_runs", { repo: "api-server" })).workflow_runs[0].conclusion).toBe("failure");
    expect((await run(sandbox, "get_issues", { repo: "portfolio-site" })).issues).toHaveLength(2);
    expect((await run(sandbox, "get_file", { repo: "portfolio-site", path: "README.md" })).content).toContain("Portfolio site");
    expect((await run(sandbox, "get_latest_commit")).latest_commit).toMatchObject({
      repository: "demo-user/api-server",
      message: "Bump dependencies",
    });
  });

  it("creates and deletes repositories in the visitor's sandbox only", async () => {
    const sandbox = seedSandbox();
    expect(await run(sandbox, "create_repository", { name: "my-new-app", private: true })).toMatchObject({
      full_name: "demo-user/my-new-app",
      visibility: "Private",
    });
    expect((await run(sandbox, "create_repository", { name: "my-new-app" })).error).toMatch(/already exists/);
    await run(sandbox, "delete_repository", { repo: "dotfiles" });
    expect(viewOf(sandbox).repos.map((repo) => repo.name)).toEqual(["my-new-app", "portfolio-site", "api-server", "ml-notebooks"]);
    expect(seedSandbox().repos).toHaveLength(4); // a fresh sandbox is untouched
  });

  it("supports issues, branches and pull requests", async () => {
    const sandbox = seedSandbox();
    expect(await run(sandbox, "create_issue", { repo: "portfolio-site", title: "Add a footer" })).toMatchObject({ number: 9 });
    expect(await run(sandbox, "create_branch", { repo: "portfolio-site", branch: "feature/footer" })).toMatchObject({
      ref: "refs/heads/feature/footer",
      from: "main",
    });
    expect(await run(sandbox, "merge_pull_request", { repo: "api-server", pull_number: 15 })).toMatchObject({ merged: true });
    expect((await run(sandbox, "get_pull_requests", { repo: "api-server" })).pull_requests).toEqual([]);
  });

  it("explains unknown repositories and unavailable actions instead of crashing", async () => {
    const sandbox = seedSandbox();
    expect((await run(sandbox, "get_issues", { repo: "nope" })).error).toMatch(/404/);
    expect((await run(sandbox, "github_api_read", { path: "/user/starred" })).error).toMatch(/demo mode/);
  });
});

describe("demo agent", () => {
  it("creates a repository only after approval", async () => {
    const sandbox = seedSandbox();
    const tools = Object.values(demoTools(sandbox)).filter((tool) => !tool.name.startsWith("github_api_"));
    const replies = [
      new AIMessage({
        content: "",
        tool_calls: [{ name: "create_repository", id: "c1", args: { name: "demo-app" }, type: "tool_call" }],
      }),
      new AIMessage("Created demo-user/demo-app."),
    ];
    const agent = new Agent({ invoke: async () => replies.shift()! }, tools, WRITE_TOOL_NAMES, new MemorySaver());

    const paused = await agent.ask("demo-1", "create a repo called demo-app");
    expect(paused.pending?.name).toBe("create_repository");
    expect(sandbox.repos.some((repo) => repo.name === "demo-app")).toBe(false);

    await agent.approve("demo-1", { private: true });
    expect(sandbox.repos[0]).toMatchObject({ name: "demo-app", private: true });
  });
});

describe("demo sessions", () => {
  beforeAll(async () => {
    h.db = await freshDatabase();
  });
  beforeEach(async () => {
    await h.db.exec("TRUNCATE demo_sessions");
  });

  it("stores each visitor's sandbox and chat", async () => {
    const session = await demoStore.createDemoSession("visitor-1");
    session.sandbox.repos.pop();
    session.messages.push({ role: "user", content: "hi", tools: [] });
    await demoStore.saveDemoSession(session);

    const loaded = await demoStore.getDemoSession(session.id);
    expect(loaded?.sandbox.repos).toHaveLength(3);
    expect(loaded?.messages).toEqual([{ role: "user", content: "hi", tools: [] }]);
    expect(await demoStore.getDemoSession("not-a-session")).toBeNull();
  });

  it("expires sessions after 24 hours and cleans them up", async () => {
    const old = await demoStore.createDemoSession("visitor-1");
    const fresh = await demoStore.createDemoSession("visitor-2");
    await h.db.query("UPDATE demo_sessions SET created_at = now() - interval '25 hours' WHERE id = $1", [old.id]);

    expect(await demoStore.getDemoSession(old.id)).toBeNull();
    expect(await demoStore.deleteExpiredDemoSessions()).toEqual([old.id]);
    expect(await demoStore.getDemoSession(fresh.id)).not.toBeNull();
  });
});
