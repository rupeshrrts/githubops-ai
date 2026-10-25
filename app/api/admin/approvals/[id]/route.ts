// POST /api/admin/approvals/:id: a reviewer approves or rejects someone else's sensitive action.
import { z } from "zod";

import { handle, readJson, saveAnswer } from "@/backend/api";
import { reviewRequest } from "@/backend/approvals";
import { HttpError, requireUser } from "@/backend/session";

export const maxDuration = 60;

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).default(""),
});

/** A reviewer decides on someone else's sensitive action; approved actions run with the requester's token. */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const reviewer = await requireUser("approvals.review");
    const body = Body.safeParse(await readJson(request));
    if (!body.success) throw new HttpError(400, "Decision must be approve or reject.");
    const { conversationId, result } = await reviewRequest(reviewer, (await params).id, body.data.decision, body.data.note);
    await saveAnswer(conversationId, result);
    return { ok: true, toolError: result.toolError ?? null };
  });
}
