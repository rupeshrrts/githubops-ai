import { randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret, isEncrypted } from "@/backend/crypto";
import { query } from "@/backend/db";
import type {
  AdminStats,
  ApprovalRequest,
  AuditEntry,
  ChatMessage,
  Conversation,
  ManagedUser,
} from "@/backend/types";

// Every user-facing read and write is scoped to a user id, so one user can never open
// another user's conversation by guessing its id. Admin queries are explicit and separate.

type Env = Record<string, string | undefined>;

export function titleFrom(message: string): string {
  const words = message.trim().split(/\s+/);
  return words.slice(0, 6).join(" ") + (words.length > 6 ? "..." : "");
}

// ------------------------------------------------------------------ GitHub identity and tokens

/** The user's GitHub token, decrypted. Legacy plaintext tokens are encrypted on first read. */
export async function getGithubToken(userId: string): Promise<string | null> {
  const rows = await query<{ id: number; access_token: string | null }>(
    `SELECT id, access_token FROM accounts WHERE "userId" = $1 AND provider = 'github' ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  const stored = rows[0]?.access_token;
  if (!stored) return null;
  if (isEncrypted(stored)) return decryptSecret(stored);
  await query("UPDATE accounts SET access_token = $1 WHERE id = $2", [encryptSecret(stored), rows[0].id]);
  return stored;
}

export async function getGithubScopes(userId: string): Promise<string | null> {
  const rows = await query<{ scope: string | null }>(
    `SELECT scope FROM accounts WHERE "userId" = $1 AND provider = 'github' ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  return rows[0]?.scope ?? null;
}

/** What the Settings page shows about the user's GitHub connection and today's usage. */
export async function getAccountSummary(userId: string): Promise<{
  scope: string | null;
  connected: boolean;
  tokenUpdatedAt: string | null;
  usage: number;
} | null> {
  // accounts."userId" is an integer and the other tables store ids as text, so compare as text everywhere.
  const rows = await query<{ scope: string | null; connected: boolean; tokenUpdatedAt: string | null; usage: number }>(
    `SELECT a.scope, (a.access_token IS NOT NULL) AS connected, p.token_updated_at::text AS "tokenUpdatedAt",
            COALESCE((SELECT u.count FROM usage_daily u WHERE u.user_id = $1::text AND u.day = CURRENT_DATE), 0) AS usage
     FROM accounts a LEFT JOIN user_profiles p ON p.user_id = a."userId"::text
     WHERE a."userId"::text = $1::text AND a.provider = 'github' ORDER BY a.id DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function getGithubLogin(userId: string): Promise<string | null> {
  const rows = await query<{ github_login: string }>("SELECT github_login FROM user_profiles WHERE user_id = $1", [
    userId,
  ]);
  return rows[0]?.github_login ?? null;
}

/** Called on every sign-in: encrypt the fresh token, record the profile, and assign a first role. */
export async function saveGithubSignIn(
  userId: string,
  login: string | null,
  providerAccountId: string,
  accessToken: string | undefined,
  scope: string | undefined,
): Promise<void> {
  if (login) {
    await query(
      `INSERT INTO user_profiles (user_id, github_login, last_seen_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET github_login = EXCLUDED.github_login, updated_at = now(), last_seen_at = now()`,
      [userId, login],
    );
  }
  // Auth.js writes the token in plaintext on first sign-in only; replace it with ciphertext every time.
  if (accessToken) {
    await query(
      `UPDATE accounts SET access_token = $1, scope = $2 WHERE provider = 'github' AND "providerAccountId" = $3`,
      [encryptSecret(accessToken), scope ?? null, providerAccountId],
    );
    await query("UPDATE user_profiles SET token_updated_at = now() WHERE user_id = $1", [userId]);
  }
  await assignInitialRole(userId, login);
}

/**
 * Bootstrap: logins listed in ADMIN_GITHUB_LOGINS become admins. Without that list, the very first
 * user becomes admin so a fresh deployment is manageable. Everyone else gets DEFAULT_ROLE (member).
 */
export async function assignInitialRole(
  userId: string,
  login: string | null,
  env: Env = process.env,
): Promise<void> {
  const admins = (env.ADMIN_GITHUB_LOGINS ?? "")
    .split(/[\s,]+/)
    .map((name) => name.toLowerCase())
    .filter(Boolean);
  if (login && admins.includes(login.toLowerCase())) {
    await query(
      `INSERT INTO user_roles (user_id, role, assigned_by) VALUES ($1, 'admin', 'bootstrap')
       ON CONFLICT (user_id) DO UPDATE SET role = 'admin'`,
      [userId],
    );
    return;
  }
  const noAdminYet = admins.length === 0 && (await query("SELECT 1 FROM user_roles WHERE role = 'admin' LIMIT 1")).length === 0;
  const role = noAdminYet ? "admin" : env.DEFAULT_ROLE || "member";
  await query(
    `INSERT INTO user_roles (user_id, role, assigned_by) VALUES ($1, $2, 'bootstrap') ON CONFLICT (user_id) DO NOTHING`,
    [userId, role],
  );
}

/** Forget the stored token (after revoking it at GitHub, or when an admin cuts access). */
export async function clearGithubToken(userId: string): Promise<void> {
  await query(`UPDATE accounts SET access_token = NULL WHERE "userId" = $1 AND provider = 'github'`, [userId]);
  await query("DELETE FROM sessions WHERE \"userId\" = $1", [userId]);
}

export async function touchLastSeen(userId: string): Promise<void> {
  await query("UPDATE user_profiles SET last_seen_at = now() WHERE user_id = $1", [userId]);
}

export async function isDisabled(userId: string): Promise<boolean> {
  const rows = await query<{ disabled: boolean }>("SELECT disabled FROM user_profiles WHERE user_id = $1", [userId]);
  return rows[0]?.disabled ?? false;
}

// ------------------------------------------------------------------ conversations

export async function listConversations(userId: string): Promise<Conversation[]> {
  return query<Conversation>(
    `SELECT id, title, updated_at::text AS "updatedAt" FROM conversations
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId],
  );
}

export async function getConversation(userId: string, id: string): Promise<Conversation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await query<Conversation>(
    `SELECT id, title, updated_at::text AS "updatedAt" FROM conversations WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  return rows[0] ?? null;
}

export async function createConversation(userId: string, title: string): Promise<string> {
  const id = randomUUID();
  await query("INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3)", [id, userId, title]);
  return id;
}

export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>("DELETE FROM conversations WHERE user_id = $1 AND id = $2 RETURNING id", [
    userId,
    id,
  ]);
  return rows.length > 0;
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  return query<ChatMessage>("SELECT role, content, tools FROM messages WHERE conversation_id = $1 ORDER BY id", [
    conversationId,
  ]);
}

export async function saveMessage(
  conversationId: string,
  role: ChatMessage["role"],
  content: string,
  tools: string[] = [],
): Promise<void> {
  await query("INSERT INTO messages (conversation_id, role, content, tools) VALUES ($1, $2, $3, $4)", [
    conversationId,
    role,
    content,
    JSON.stringify(tools),
  ]);
  await query("UPDATE conversations SET updated_at = now() WHERE id = $1", [conversationId]);
}

// ------------------------------------------------------------------ approval requests

const REQUEST_COLUMNS = `
  r.id::text, r.requester_id AS "requesterId", p.github_login AS "requesterLogin",
  r.conversation_id::text AS "conversationId", r.tool_call_id AS "toolCallId", r.tool, r.args, r.risk, r.status,
  r.reviewer_id AS "reviewerId", rp.github_login AS "reviewerLogin", r.review_note AS "reviewNote",
  r.result_ok AS "resultOk", r.result_detail AS "resultDetail",
  r.created_at::text AS "createdAt", r.reviewed_at::text AS "reviewedAt"`;
const REQUEST_FROM = `approval_requests r
  LEFT JOIN user_profiles p ON p.user_id = r.requester_id
  LEFT JOIN user_profiles rp ON rp.user_id = r.reviewer_id`;

export async function createApprovalRequest(input: {
  requesterId: string;
  conversationId: string;
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO approval_requests (requester_id, conversation_id, tool_call_id, tool, args, risk)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
    [input.requesterId, input.conversationId, input.toolCallId, input.tool, JSON.stringify(input.args), input.risk],
  );
  return rows[0].id;
}

export async function getOpenRequest(conversationId: string): Promise<ApprovalRequest | null> {
  const rows = await query<ApprovalRequest>(
    `SELECT ${REQUEST_COLUMNS} FROM ${REQUEST_FROM} WHERE r.conversation_id = $1 AND r.status = 'pending'`,
    [conversationId],
  );
  return rows[0] ?? null;
}

export async function getRequest(id: string): Promise<ApprovalRequest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await query<ApprovalRequest>(`SELECT ${REQUEST_COLUMNS} FROM ${REQUEST_FROM} WHERE r.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listRequests(status: ApprovalRequest["status"] | "all" = "pending", limit = 100) {
  return query<ApprovalRequest>(
    `SELECT ${REQUEST_COLUMNS} FROM ${REQUEST_FROM}
     WHERE ($1 = 'all' OR r.status = $1) ORDER BY r.created_at DESC LIMIT $2`,
    [status, limit],
  );
}

/** Atomically move a pending request to a final state; returns false if someone else already did. */
export async function resolveRequest(
  id: string,
  status: Exclude<ApprovalRequest["status"], "pending">,
  reviewerId: string | null,
  note = "",
  result: { ok: boolean | null; detail: string } = { ok: null, detail: "" },
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE approval_requests
     SET status = $2, reviewer_id = $3, review_note = $4, result_ok = $5, result_detail = $6, reviewed_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING id::text`,
    [id, status, reviewerId, note.slice(0, 500), result.ok, result.detail.slice(0, 500)],
  );
  return rows.length > 0;
}

export async function cancelOpenRequests(conversationId: string): Promise<void> {
  await query(
    `UPDATE approval_requests SET status = 'cancelled', reviewed_at = now()
     WHERE conversation_id = $1 AND status = 'pending'`,
    [conversationId],
  );
}

// ------------------------------------------------------------------ audit log

export async function recordAction(entry: {
  userId: string;
  actorId?: string | null;
  conversationId?: string | null;
  tool: string;
  args?: Record<string, unknown>;
  decision: string;
  ok?: boolean | null;
  detail?: string;
  category?: "github" | "admin" | "security";
}): Promise<void> {
  await query(
    `INSERT INTO audit_log (user_id, actor_id, conversation_id, tool, args, decision, ok, detail, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.userId,
      entry.actorId ?? entry.userId,
      entry.conversationId ?? null,
      entry.tool,
      JSON.stringify(entry.args ?? {}),
      entry.decision,
      entry.ok ?? null,
      (entry.detail ?? "").slice(0, 500),
      entry.category ?? "github",
    ],
  );
}

/** One user's audit trail, or everyone's when userId is null (requires audit.view_all). */
export async function listAudit(userId: string | null, limit = 200): Promise<AuditEntry[]> {
  return query<AuditEntry>(
    `SELECT a.id::text, a.conversation_id::text AS "conversationId", a.tool, a.args, a.decision, a.ok, a.detail,
            a.category, a.created_at::text AS "createdAt",
            subject.github_login AS "userLogin", actor.github_login AS "actorLogin"
     FROM audit_log a
     LEFT JOIN user_profiles subject ON subject.user_id = a.user_id
     LEFT JOIN user_profiles actor ON actor.user_id = a.actor_id
     WHERE ($1::text IS NULL OR a.user_id = $1)
     ORDER BY a.id DESC LIMIT $2`,
    [userId, limit],
  );
}

// ------------------------------------------------------------------ usage limits

/** Count one LLM-backed request for today and return the new total. */
export async function countUsage(userId: string): Promise<number> {
  const rows = await query<{ count: number }>(
    `INSERT INTO usage_daily (user_id, day, count) VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET count = usage_daily.count + 1
     RETURNING count`,
    [userId],
  );
  return rows[0].count;
}

// ------------------------------------------------------------------ admin

export async function listUsers(): Promise<ManagedUser[]> {
  return query<ManagedUser>(
    `SELECT u.id::text AS id, u.name, u.image, p.github_login AS login,
            COALESCE(r.role, 'member') AS role, COALESCE(p.disabled, false) AS disabled,
            p.last_seen_at::text AS "lastSeenAt", p.created_at::text AS "createdAt",
            (a.access_token IS NOT NULL) AS "hasToken", a.scope,
            COALESCE(ud.count, 0) AS "usageToday",
            COALESCE((SELECT json_object_agg(o.permission, o.allowed) FROM user_permission_overrides o
                      WHERE o.user_id = u.id::text), '{}'::json) AS overrides
     FROM users u
     LEFT JOIN user_profiles p ON p.user_id = u.id::text
     LEFT JOIN user_roles r ON r.user_id = u.id::text
     LEFT JOIN LATERAL (SELECT access_token, scope FROM accounts
                        WHERE "userId" = u.id AND provider = 'github' ORDER BY id DESC LIMIT 1) a ON true
     LEFT JOIN usage_daily ud ON ud.user_id = u.id::text AND ud.day = CURRENT_DATE
     ORDER BY p.last_seen_at DESC NULLS LAST, u.id`,
  );
}

export async function adminStats(): Promise<AdminStats> {
  const rows = await query<AdminStats>(
    `SELECT (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM user_profiles WHERE last_seen_at > now() - interval '7 days') AS "activeWeek",
            (SELECT count(*)::int FROM conversations) AS conversations,
            (SELECT count(*)::int FROM approval_requests WHERE status = 'pending') AS "pendingReviews",
            (SELECT count(*)::int FROM audit_log WHERE created_at > now() - interval '1 day') AS "actionsToday",
            (SELECT count(*)::int FROM audit_log WHERE ok = false AND created_at > now() - interval '7 days') AS "failuresWeek"`,
  );
  return rows[0];
}
