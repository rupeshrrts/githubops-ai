// POST /api/repos/sync: the "Sync now" button on the Repositories page.
import { githubClient } from "@/backend/agent";
import { handle } from "@/backend/api";
import { requireGithubKey } from "@/backend/github/key";
import { lastSync, syncRepositories } from "@/backend/github/sync";
import { HttpError, requireUser } from "@/backend/session";

export const maxDuration = 60;

export function POST(request: Request) {
  return handle(request, async () => {
    const user = await requireUser("repos.sync");
    await requireGithubKey(user.id);
    const previous = await lastSync(user.id);
    if (previous && Date.now() - new Date(previous.startedAt).getTime() < 30_000) {
      throw new HttpError(429, "A sync just ran. Try again in a few seconds.");
    }
    return syncRepositories(user.id, await githubClient(user.id), "manual");
  });
}
