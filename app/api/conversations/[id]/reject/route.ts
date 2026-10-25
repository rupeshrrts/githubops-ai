// POST /api/conversations/:id/reject: the user clicked Reject (or Cancel request). Nothing is sent to GitHub.
import { handle, ownedConversation, saveAnswer, snapshot } from "@/backend/api";
import { rejectPending } from "@/backend/approvals";
import { requireUser } from "@/backend/session";

export const maxDuration = 60;

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const user = await requireUser("chat.use");
    const { id } = await ownedConversation(user.id, (await params).id);
    const result = await rejectPending(user, id);
    await saveAnswer(id, result);
    return snapshot(id, result, user.access);
  });
}
