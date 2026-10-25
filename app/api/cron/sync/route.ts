// GET /api/cron/sync: called once a day by Vercel Cron (or any scheduler with the CRON_SECRET) to clear out
// demo sessions older than 24 hours. Repository lists refresh when each user opens Repositories with their
// own key (the server holds no GitHub keys to sync with in the background).
import { timingSafeEqual } from "node:crypto";

import { deleteThread } from "@/backend/agent";
import { deleteExpiredDemoSessions } from "@/backend/demo/store";

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Daily Vercel Cron (see vercel.json): remove expired demos. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let demosRemoved = 0;
  // Each demo's chat memory lives in the agent's checkpoints under the demo session id.
  for (const demoId of await deleteExpiredDemoSessions()) {
    await deleteThread(demoId).catch(() => undefined);
    demosRemoved++;
  }
  return Response.json({ demosRemoved });
}
