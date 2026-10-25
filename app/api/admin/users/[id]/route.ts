// PATCH /api/admin/users/:id: one admin change to a user: role, disabled, a permission exception, or token revocation.
import { z } from "zod";

import { handle, readJson } from "@/backend/api";
import { setDisabled, setOverride, setRole } from "@/backend/rbac";
import { HttpError, requireUser } from "@/backend/session";
import { clearGithubToken, recordAction } from "@/backend/store";

const Body = z
  .object({
    role: z.string().optional(),
    disabled: z.boolean().optional(),
    override: z.object({ permission: z.string(), allowed: z.boolean().nullable() }).optional(),
    revokeToken: z.literal(true).optional(),
  })
  .refine((body) => Object.keys(body).length === 1, "Send exactly one change per request.");

/** Admin changes to one user. Each change is a separate, audited request. */
export function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const admin = await requireUser("admin.users");
    const userId = (await params).id;
    if (!/^\d+$/.test(userId)) throw new HttpError(404, "User not found.");
    const body = Body.safeParse(await readJson(request));
    if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "Invalid change.");
    const change = body.data;
    const audit = (tool: string, args: Record<string, unknown>) =>
      recordAction({ userId, actorId: admin.id, tool, args, decision: "approved", ok: true, category: "admin" });

    if (change.role !== undefined) {
      await setRole(userId, change.role, admin.id);
      await audit("role.changed", { role: change.role });
    } else if (change.disabled !== undefined) {
      await setDisabled(userId, change.disabled, admin.id);
      await audit(change.disabled ? "user.disabled" : "user.enabled", {});
    } else if (change.override) {
      await setOverride(userId, change.override.permission, change.override.allowed, admin.id);
      await audit("permission.changed", change.override);
    } else if (change.revokeToken) {
      if (userId === admin.id) throw new HttpError(400, "Use Settings → Disconnect GitHub for your own account.");
      await clearGithubToken(userId);
      await audit("token.revoked", {});
    }
    return { ok: true };
  });
}
