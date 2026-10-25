// POST /api/account/disconnect: the "Disconnect GitHub" button on Settings.
import { handle } from "@/backend/api";
import { readGithubKey, removeGithubKey, revokeGithubGrant } from "@/backend/github/key";
import { requireUser } from "@/backend/session";
import { recordAction } from "@/backend/store";

/**
 * Withdraw the app's access at GitHub (for access from signing in) and forget it in this browser. A key the
 * user created themselves can only be deleted by them on GitHub; Settings links there.
 */
export function POST(request: Request) {
  return handle(request, async () => {
    const user = await requireUser();
    const key = await readGithubKey(user.id);
    const revokedAtGitHub = key?.source === "sign-in" ? await revokeGithubGrant(key.token).catch(() => false) : false;
    await removeGithubKey();
    await recordAction({
      userId: user.id,
      tool: "github.disconnected",
      args: {},
      decision: "approved",
      ok: true,
      detail: revokedAtGitHub ? "" : "Removed from this browser; delete or revoke it on GitHub too.",
      category: "security",
    });
    return { ok: true, revokedAtGitHub };
  });
}
