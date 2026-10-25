// POST /api/conversations/:id/approve: the user clicked Approve on the approval card.
// Normal writes run now; sensitive ones may become an admin review request (see backend/approvals.ts).
import { z } from "zod";

import { handle, ownedConversation, readJson, saveAnswer, snapshot } from "@/backend/api";
import { approvePending } from "@/backend/approvals";
import { HttpError, requireUser } from "@/backend/session";

export const maxDuration = 60;

const Body = z.object({ args: z.record(z.string(), z.unknown()).default({}) });

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const user = await requireUser("chat.use");
    const { id } = await ownedConversation(user.id, (await params).id);
    const body = Body.safeParse((await readJson(request)) ?? {});
    if (!body.success) throw new HttpError(400, "Invalid arguments.");

    const result = await approvePending(user, id, body.data.args);
    await saveAnswer(id, result);
    return snapshot(id, result, user.access);
  });
}
