// POST /api/account/connect: the optional "use a key you created yourself" box on Settings.
import { z } from "zod";

import { handle, readJson } from "@/backend/api";
import { checkGithubKey, looksLikeGithubKey, saveGithubKey } from "@/backend/github/key";
import { HttpError, requireUser } from "@/backend/session";
import { getGithubAccountId, recordAction } from "@/backend/store";

const Body = z.object({ key: z.string().trim().max(300) });

/** Check the key with GitHub, then keep it only in this browser (an encrypted cookie), never in the database. */
export function POST(request: Request) {
  return handle(request, async () => {
    const user = await requireUser();
    const body = Body.safeParse(await readJson(request));
    const token = body.success ? body.data.key : "";
    if (!looksLikeGithubKey(token)) {
      throw new HttpError(400, "That doesn't look like a GitHub key. Keys start with ghp_ or github_pat_.");
    }
    const { login, scopes } = await checkGithubKey(token, await getGithubAccountId(user.id));
    await saveGithubKey({ userId: user.id, token, login, scopes, source: "own-key", savedAt: new Date().toISOString() });
    await recordAction({
      userId: user.id,
      tool: "github.key_connected",
      args: { type: scopes === null ? "fine-grained" : "classic", permissions: scopes ?? "" },
      decision: "approved",
      ok: true,
      category: "security",
    });
    return { ok: true, login };
  });
}
