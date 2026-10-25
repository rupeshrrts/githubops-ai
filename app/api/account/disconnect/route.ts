// POST /api/account/disconnect: the "Disconnect GitHub" button on Settings.
import { handle } from "@/backend/api";
import { requireUser } from "@/backend/session";
import { clearGithubToken, getGithubToken, recordAction } from "@/backend/store";

/**
 * Revoke this app's access at GitHub (so the token is dead everywhere), then forget it and end
 * all sessions. The user can reconnect any time by signing in again.
 */
export function POST(request: Request) {
  return handle(request, async () => {
    const user = await requireUser();
    const token = await getGithubToken(user.id);
    let revokedAtGitHub = false;
    if (token) {
      const credentials = Buffer.from(`${process.env.AUTH_GITHUB_ID}:${process.env.AUTH_GITHUB_SECRET}`).toString("base64");
      const response = await fetch(`https://api.github.com/applications/${process.env.AUTH_GITHUB_ID}/grant`, {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: token }),
      });
      revokedAtGitHub = response.status === 204 || response.status === 404;
    }
    await clearGithubToken(user.id);
    await recordAction({
      userId: user.id,
      tool: "github.disconnected",
      args: {},
      decision: "approved",
      ok: true,
      detail: revokedAtGitHub ? "" : "Token removed here; revoke it at github.com/settings/applications too.",
      category: "security",
    });
    return { ok: true, revokedAtGitHub };
  });
}
