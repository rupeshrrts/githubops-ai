// GET /api/conversations/:id reads a conversation (the chat polls it while an admin review is open).
// DELETE removes it; its audit entries are kept.
import { agentFor, deleteThread } from "@/backend/agent";
import { handle, ownedConversation, snapshot } from "@/backend/api";
import { requireUser } from "@/backend/session";
import { cancelOpenRequests, deleteConversation } from "@/backend/store";

type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, { params }: Context) {
  return handle(request, async () => {
    const user = await requireUser("chat.use");
    const { id } = await ownedConversation(user.id, (await params).id);
    return snapshot(id, await (await agentFor(user.id, user.access)).state(id), user.access);
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
