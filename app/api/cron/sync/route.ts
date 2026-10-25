// GET /api/cron/sync: called once a day by Vercel Cron (or any scheduler with the CRON_SECRET) to refresh
// repository lists.
import { timingSafeEqual } from "node:crypto";

import { githubClient } from "@/backend/agent";
import { syncRepositories, usersDueForSync } from "@/backend/github/sync";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Daily Vercel Cron (see vercel.json): refresh repository mirrors for recently active users. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const users = await usersDueForSync(Number(process.env.CRON_SYNC_BATCH || 25));
  const results = { synced: 0, failed: 0 };
  for (const userId of users) {
    try {
      await syncRepositories(userId, await githubClient(userId), "cron");
      results.synced++;
    } catch {
      results.failed++; // recorded in sync_runs; one bad token must not stop the batch
    }
  }
  return Response.json({ users: users.length, ...results });
}
