// Server-side loader shared by all signed-in pages (sidebar data, permissions, missing GitHub access).
import "server-only";

import { notFound, redirect } from "next/navigation";

import { missingScopes } from "@/backend/github/scopes";
import { can, type Permission } from "@/backend/rbac";
import { currentUser } from "@/backend/session";
import { getGithubScopes, listConversations, listRequests } from "@/backend/store";

export type ShellData = Awaited<ReturnType<typeof loadWorkspace>>["shell"];

/**
 * Shared loader for signed-in pages: the user, sidebar data, and any missing GitHub access.
 * Signed-out visitors go home; a missing permission is a 404 so pages don't reveal themselves.
 */
export async function loadWorkspace(permission?: Permission) {
  const user = await currentUser();
  if (!user) redirect("/");
  if (permission && !can(user.access, permission)) notFound();

  const reviewer = can(user.access, "approvals.review");
  const [conversations, scopes, pendingReviews] = await Promise.all([
    listConversations(user.id),
    getGithubScopes(user.id),
    reviewer ? listRequests("pending") : Promise.resolve([]),
  ]);
  return {
    user,
    shell: {
      user: { name: user.name, image: user.image, login: user.login, role: user.access.role },
      conversations,
      missingScopes: missingScopes(scopes),
      nav: {
        admin: can(user.access, "admin.access"),
        pendingReviews: pendingReviews.filter((request) => request.requesterId !== user.id).length,
      },
    },
  };
}
