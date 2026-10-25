import { query } from "@/backend/db";
import type { PendingCall, PendingPolicy, Risk } from "@/backend/types";

// Roles and their default permissions are seeded by database/setup.sql; admins add per-user
// grants or revocations on top. Every check below runs on the server.

export const PERMISSIONS = [
  "chat.use",
  "github.read",
  "github.write",
  "github.sensitive",
  "workflows.run",
  "repos.sync",
  "audit.view",
  "audit.view_all",
  "approvals.review",
  "admin.access",
  "admin.users",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["viewer", "member", "maintainer", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type Access = { role: string; permissions: Set<Permission> };

export class AccessError extends Error {}

export function can(access: Access, permission: Permission): boolean {
  return access.permissions.has(permission);
}

export async function getAccess(userId: string): Promise<Access> {
  const roleRows = await query<{ role: string }>("SELECT role FROM user_roles WHERE user_id = $1", [userId]);
  const role = roleRows[0]?.role ?? (process.env.DEFAULT_ROLE || "member");
  const [granted, overrides] = await Promise.all([
    query<{ permission: string }>("SELECT permission FROM role_permissions WHERE role = $1", [role]),
    query<{ permission: string; allowed: boolean }>(
      "SELECT permission, allowed FROM user_permission_overrides WHERE user_id = $1",
      [userId],
    ),
  ]);
  const permissions = new Set(granted.map((row) => row.permission as Permission));
  for (const { permission, allowed } of overrides) {
    if (allowed) permissions.add(permission as Permission);
    else permissions.delete(permission as Permission);
  }
  return { role, permissions };
}

// ------------------------------------------------------------------ tool risk

const SENSITIVE_TOOLS = new Set(["merge_pull_request", "update_repository_visibility", "delete_repository"]);

export function riskOf(tool: string, args: Record<string, unknown> = {}): Risk {
  if (tool.startsWith("get_") || tool === "github_api_read") return "read";
  if (SENSITIVE_TOOLS.has(tool)) return "sensitive";
  if (tool === "github_api_write" && String(args.method).toUpperCase() === "DELETE") return "sensitive";
  return "write";
}

const RISK_PERMISSION: Record<Risk, Permission> = {
  read: "github.read",
  write: "github.write",
  sensitive: "github.sensitive",
};

/** How the approval card should behave for this user and this pending call. */
export function policyFor(access: Access, call: Pick<PendingCall, "name" | "args">): PendingPolicy {
  const risk = riskOf(call.name, call.args);
  return {
    risk,
    allowed: can(access, RISK_PERMISSION[risk]),
    // Sensitive actions need a second person unless this user is a reviewer.
    needsReview: risk === "sensitive" && !can(access, "approvals.review"),
  };
}

/** Only bind tools the user may use, so the LLM never proposes something they can't run. */
export function allowedTools<T extends { name: string }>(tools: T[], access: Access): T[] {
  return tools.filter((item) => {
    if (item.name === "github_api_write") return can(access, "github.write");
    return can(access, RISK_PERMISSION[riskOf(item.name)]);
  });
}

// ------------------------------------------------------------------ admin changes

async function adminCount(): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM user_roles r
     LEFT JOIN user_profiles p ON p.user_id = r.user_id
     WHERE r.role = 'admin' AND NOT COALESCE(p.disabled, false)`,
  );
  return rows[0].n;
}

async function isActiveAdmin(userId: string): Promise<boolean> {
  const rows = await query<{ role: string; disabled: boolean | null }>(
    `SELECT r.role, p.disabled FROM user_roles r LEFT JOIN user_profiles p ON p.user_id = r.user_id
     WHERE r.user_id = $1`,
    [userId],
  );
  return rows[0]?.role === "admin" && !rows[0]?.disabled;
}

export async function setRole(userId: string, role: string, actorId: string): Promise<void> {
  if (!(ROLES as readonly string[]).includes(role)) throw new AccessError(`Unknown role "${role}".`);
  if (role !== "admin" && (await isActiveAdmin(userId)) && (await adminCount()) <= 1) {
    throw new AccessError("You can't remove the last admin. Promote someone else first.");
  }
  await query(
    `INSERT INTO user_roles (user_id, role, assigned_by) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
    [userId, role, actorId],
  );
}

/** allowed: true grants, false revokes, null removes the override (back to the role default). */
export async function setOverride(userId: string, permission: string, allowed: boolean | null, actorId: string) {
  if (!(PERMISSIONS as readonly string[]).includes(permission)) {
    throw new AccessError(`Unknown permission "${permission}".`);
  }
  if (userId === actorId && permission.startsWith("admin.") && allowed === false) {
    throw new AccessError("You can't revoke your own admin permissions.");
  }
  if (allowed === null) {
    await query("DELETE FROM user_permission_overrides WHERE user_id = $1 AND permission = $2", [userId, permission]);
    return;
  }
  await query(
    `INSERT INTO user_permission_overrides (user_id, permission, allowed, set_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, permission) DO UPDATE SET allowed = EXCLUDED.allowed, set_by = EXCLUDED.set_by, set_at = now()`,
    [userId, permission, allowed, actorId],
  );
}

export async function setDisabled(userId: string, disabled: boolean, actorId: string): Promise<void> {
  if (disabled && userId === actorId) throw new AccessError("You can't disable your own account.");
  if (disabled && (await isActiveAdmin(userId)) && (await adminCount()) <= 1) {
    throw new AccessError("You can't disable the last admin.");
  }
  await query(
    `INSERT INTO user_profiles (user_id, github_login, disabled) VALUES ($1, '', $2)
     ON CONFLICT (user_id) DO UPDATE SET disabled = EXCLUDED.disabled`,
    [userId, disabled],
  );
  // Disabling also ends every active session immediately.
  if (disabled) await query('DELETE FROM sessions WHERE "userId" = $1', [userId]);
}
