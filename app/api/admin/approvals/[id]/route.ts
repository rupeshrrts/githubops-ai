// POST /api/admin/approvals/:id: a reviewer approves or rejects someone else's sensitive action.
import { z } from "zod";

import { handle, readJson } from "@/backend/api";
import { reviewRequest } from "@/backend/approvals";
import { HttpError, requireUser } from "@/backend/session";

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).default(""),
});

/** Record the decision. It is carried out from the requester's side, with their own GitHub key. */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const reviewer = await requireUser("approvals.review");
    const body = Body.safeParse(await readJson(request));
    if (!body.success) throw new HttpError(400, "Decision must be approve or reject.");
    await reviewRequest(reviewer, (await params).id, body.data.decision, body.data.note);
    return { ok: true };
  });
}
