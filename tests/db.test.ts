// Store, RBAC and sync queries against real Postgres (PGlite) with the real database/setup.sql.
import { randomBytes } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import type { Octokit } from "@octokit/rest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { addUser, freshDatabase, resetDatabase, SETUP_SQL } from "./pg";

const h = vi.hoisted(() => ({ db: null as unknown as PGlite }));
vi.mock("@/backend/db", async () => {
  const { queryVia } = await import("./pg");
  return { query: queryVia(() => h.db), ensureSchema: async () => undefined };
});

const store = await import("@/backend/store");
const rbac = await import("@/backend/rbac");
const sync = await import("@/backend/github/sync");

beforeAll(async () => {
  h.db = await freshDatabase();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("ADMIN_GITHUB_LOGINS", "");
  vi.stubEnv("DEFAULT_ROLE", "");
});

describe("database/setup.sql", () => {
  it("is idempotent and locks every table with Row Level Security", async () => {
    await h.db.exec(SETUP_SQL);
    const { rows } = await h.db.query<{ total: number; locked: number }>(
      "SELECT count(*)::int AS total, count(*) FILTER (WHERE rowsecurity)::int AS locked FROM pg_tables WHERE schemaname = 'public'",
    );
    expect(rows[0].total).toBeGreaterThanOrEqual(18);
    expect(rows[0].locked).toBe(rows[0].total);
    expect((await h.db.query<{ version: number }>("SELECT version FROM schema_info")).rows[0].version).toBe(5);
  });
});

describe("roles and permissions", () => {
  it("makes the first user admin and later users members", async () => {
    const first = await addUser(h.db, "alice");
    const second = await addUser(h.db, "bob");
    await store.assignInitialRole(first, "alice");
    await store.assignInitialRole(second, "bob");
    expect((await rbac.getAccess(first)).role).toBe("admin");
    expect((await rbac.getAccess(second)).role).toBe("member");
  });

  it("honours ADMIN_GITHUB_LOGINS and DEFAULT_ROLE instead of first-user bootstrap", async () => {
    const env = { ADMIN_GITHUB_LOGINS: "Carol", DEFAULT_ROLE: "viewer" };
    const dave = await addUser(h.db, "dave");
    const carol = await addUser(h.db, "carol");
    await store.assignInitialRole(dave, "dave", env);
    await store.assignInitialRole(carol, "carol", env);
    expect((await rbac.getAccess(dave)).role).toBe("viewer");
    expect((await rbac.getAccess(carol)).role).toBe("admin");
  });

  it("applies per-user grants and revocations on top of the role", async () => {
    const admin = await addUser(h.db, "admin", "admin");
    const user = await addUser(h.db, "viewer", "viewer");
    expect(rbac.can(await rbac.getAccess(user), "github.write")).toBe(false);
    await rbac.setOverride(user, "github.write", true, admin);
    await rbac.setOverride(user, "chat.use", false, admin);
    let access = await rbac.getAccess(user);
    expect(rbac.can(access, "github.write")).toBe(true);
    expect(rbac.can(access, "chat.use")).toBe(false);
    await rbac.setOverride(user, "chat.use", null, admin);
    access = await rbac.getAccess(user);
    expect(rbac.can(access, "chat.use")).toBe(true);
  });

  it("protects the last admin and the acting admin", async () => {
    const admin = await addUser(h.db, "admin", "admin");
    const member = await addUser(h.db, "member", "member");
    await expect(rbac.setRole(admin, "member", admin)).rejects.toThrow("last admin");
    await expect(rbac.setDisabled(admin, true, member)).rejects.toThrow("last admin");
    await expect(rbac.setDisabled(admin, true, admin)).rejects.toThrow("your own account");
    await expect(rbac.setOverride(admin, "admin.users", false, admin)).rejects.toThrow("your own admin");
    await expect(rbac.setRole(member, "superuser", admin)).rejects.toThrow("Unknown role");

    await rbac.setRole(member, "admin", admin);
    await rbac.setRole(admin, "member", member); // fine now: another admin exists
    expect((await rbac.getAccess(admin)).role).toBe("member");
  });

  it("disabling a user ends their sessions", async () => {
    const admin = await addUser(h.db, "admin", "admin");
    const user = await addUser(h.db, "user", "member");
    await h.db.query(`INSERT INTO sessions ("userId", expires, "sessionToken") VALUES ($1, now() + interval '1 day', 'tok')`, [user]);
    await rbac.setDisabled(user, true, admin);
    expect(await store.isDisabled(user)).toBe(true);
    expect((await h.db.query("SELECT * FROM sessions")).rows).toHaveLength(0);
  });
});

describe("GitHub sign-in keeps no token in the database", () => {
  async function linkAccount(userId: string, token: string) {
    await h.db.query(
      `INSERT INTO accounts ("userId", type, provider, "providerAccountId", access_token, scope)
       VALUES ($1, 'oauth', 'github', $3, $2, 'repo')`,
      [userId, token, `${userId}000`],
    );
  }
  const storedTokens = async () =>
    (await h.db.query<{ access_token: string | null }>("SELECT access_token FROM accounts")).rows.map((row) => row.access_token);

  it("drops the token Auth.js saved and records who signed in", async () => {
    const user = await addUser(h.db, "alice");
    await linkAccount(user, "gho_from_adapter");
    await store.saveGithubSignIn(user, "alice", `${user}000`);

    expect(await storedTokens()).toEqual([null]);
    expect(await store.getGithubLogin(user)).toBe("alice");
    expect(await store.getGithubAccountId(user)).toBe(`${user}000`);
  });

  it("removes tokens saved by older versions when the schema is applied", async () => {
    const user = await addUser(h.db, "bob");
    await linkAccount(user, "enc:v1:old-full-access-token");
    await h.db.exec(SETUP_SQL);
    expect(await storedTokens()).toEqual([null]);
  });

  it("counts today's usage for the Settings page", async () => {
    const user = await addUser(h.db, "dana");
    expect(await store.usageToday(user)).toBe(0);
    await store.countUsage(user);
    await store.countUsage(user);
    expect(await store.usageToday(user)).toBe(2);
  });
});

describe("conversations, approvals and audit", () => {
  it("keeps conversations private to their owner", async () => {
    const alice = await addUser(h.db, "alice");
    const bob = await addUser(h.db, "bob");
    const id = await store.createConversation(alice, "Hello");
    await store.saveMessage(id, "user", "hi");
    await store.saveMessage(id, "assistant", "hello", ["get_repositories"]);
    expect(await store.getConversation(bob, id)).toBeNull();
    expect(await store.deleteConversation(bob, id)).toBe(false);
    expect((await store.listMessages(id))[1]).toEqual({ role: "assistant", content: "hello", tools: ["get_repositories"] });
    expect(await store.listConversations(alice)).toHaveLength(1);
    expect(await store.getConversation(alice, "not-a-uuid")).toBeNull();
  });

  it("allows one open review per conversation and resolves it exactly once", async () => {
    const alice = await addUser(h.db, "alice", "member");
    const admin = await addUser(h.db, "root", "admin");
    const conversationId = await store.createConversation(alice, "Danger");
    const input = { requesterId: alice, conversationId, toolCallId: "c1", tool: "delete_repository", args: { repo: "a/b" }, risk: "sensitive" };
    const id = await store.createApprovalRequest(input);
    await expect(store.createApprovalRequest({ ...input, toolCallId: "c2" })).rejects.toThrow();

    const open = await store.getOpenRequest(conversationId);
    expect(open).toMatchObject({ id, requesterLogin: "alice", tool: "delete_repository", args: { repo: "a/b" }, status: "pending" });
    expect(await store.listRequests("pending")).toHaveLength(1);

    expect(await store.resolveRequest(id, "approved", admin, "ok")).toBe(true);
    expect(await store.resolveRequest(id, "rejected", admin)).toBe(false); // already decided
    expect(await store.getRequest(id)).toMatchObject({ status: "approved", reviewerLogin: "root", reviewNote: "ok", awaitingRequester: true });

    // The decision stays open until the requester takes it, exactly once.
    expect(await store.getOpenRequest(conversationId)).toMatchObject({ id, status: "approved" });
    expect(await store.claimDecidedRequest(admin, conversationId)).toBeNull(); // only the requester can
    expect(await store.claimDecidedRequest(alice, conversationId)).toMatchObject({ id, awaitingRequester: false });
    expect(await store.claimDecidedRequest(alice, conversationId)).toBeNull();
    expect(await store.getOpenRequest(conversationId)).toBeNull();

    await store.createApprovalRequest({ ...input, toolCallId: "c3" });
    await store.cancelOpenRequests(conversationId);
    expect(await store.getOpenRequest(conversationId)).toBeNull();
    expect(await store.listRequests("all")).toHaveLength(2);
  });

  it("records who did what, per user or for everyone", async () => {
    const alice = await addUser(h.db, "alice");
    const admin = await addUser(h.db, "root", "admin");
    await store.recordAction({ userId: alice, tool: "create_issue", args: { repo: "a/b" }, decision: "approved", ok: true });
    await store.recordAction({ userId: alice, actorId: admin, tool: "role.changed", args: { role: "viewer" }, decision: "approved", category: "admin" });
    const mine = await store.listAudit(alice);
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ tool: "role.changed", userLogin: "alice", actorLogin: "root", category: "admin" });
    expect(await store.listAudit(admin)).toHaveLength(0);
    expect(await store.listAudit(null)).toHaveLength(2);
  });

  it("counts daily usage and builds admin views", async () => {
    const alice = await addUser(h.db, "alice", "member");
    expect(await store.countUsage(alice)).toBe(1);
    expect(await store.countUsage(alice)).toBe(2);
    await rbac.setOverride(alice, "workflows.run", false, alice);
    const [user] = await store.listUsers();
    expect(user).toMatchObject({ login: "alice", role: "member", usageToday: 2, disabled: false });
    expect(user.overrides).toEqual({ "workflows.run": false });
    expect(await store.adminStats()).toMatchObject({ users: 1, activeWeek: 1, pendingReviews: 0 });
  });
});

describe("repository sync", () => {
  function octokitWith(pages: Record<string, unknown>[][], fail = false) {
    return {
      rest: { repos: { listForAuthenticatedUser: {} } },
      paginate: {
        iterator: async function* () {
          if (fail) throw Object.assign(new Error("Bad credentials"), { status: 401 });
          for (const page of pages) yield { data: page };
        },
      },
    } as unknown as Octokit;
  }
  const repo = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    full_name: `octo/${name}`,
    owner: { login: "octo" },
    private: false,
    html_url: `https://github.com/octo/${name}`,
    pushed_at: `2026-0${id}-01T00:00:00Z`,
    stargazers_count: id,
    ...extra,
  });

  it("mirrors repositories, updates them, and drops ones that disappeared", async () => {
    const alice = await addUser(h.db, "alice");
    await sync.syncRepositories(alice, octokitWith([[repo(1, "api"), repo(2, "web")], [repo(3, "old")]]), "manual");
    expect((await sync.listRepositories(alice)).map((item) => item.name)).toEqual(["old", "web", "api"]);

    await sync.syncRepositories(alice, octokitWith([[repo(1, "api", { private: true }), repo(2, "web")]]), "auto");
    const repos = await sync.listRepositories(alice);
    expect(repos.map((item) => item.name)).toEqual(["web", "api"]);
    expect(repos.find((item) => item.name === "api")).toMatchObject({ private: true, fullName: "octo/api", stars: 1 });
    expect(await sync.lastSync(alice)).toMatchObject({ status: "success", repositories: 2 });
  });

  it("records failed syncs", async () => {
    const alice = await addUser(h.db, "alice");
    await expect(sync.syncRepositories(alice, octokitWith([], true), "manual")).rejects.toThrow("Bad credentials");
    expect(await sync.lastSync(alice)).toMatchObject({ status: "error", error: "Bad credentials" });
    await sync.syncRepositories(alice, octokitWith([[repo(1, "api")]]), "manual");
    expect(await sync.lastSync(alice)).toMatchObject({ status: "success", repositories: 1 });
  });
});
