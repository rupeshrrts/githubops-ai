// GET /api/conversations/:id reads a conversation (the chat polls it while an admin review is open, which is
// also when an admin's decision gets carried out with the user's key). DELETE removes it; audit entries stay.
import { deleteThread } from "@/backend/agent";
import { handle, ownedConversation, snapshot } from "@/backend/api";
import { conversationState } from "@/backend/approvals";
import { readGithubKey } from "@/backend/github/key";
import { requireUser } from "@/backend/session";
import { cancelOpenRequests, deleteConversation } from "@/backend/store";

type Context = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export function GET(request: Request, { params }: Context) {
  return handle(request, async () => {
    const user = await requireUser("chat.use");
    const { id } = await ownedConversation(user.id, (await params).id);
    const state = await conversationState(user, id, Boolean(await readGithubKey(user.id)));
    return snapshot(id, state, user.access);
  });
}

export function DELETE(request: Request, { params }: Context) {
  return handle(request, async () => {
    const user = await requireUser();
    const { id } = await ownedConversation(user.id, (await params).id);
    await cancelOpenRequests(id);
    await deleteConversation(user.id, id);
    await deleteThread(id);
    return { deleted: id };
  });
}
