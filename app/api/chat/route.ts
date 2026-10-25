// POST /api/chat — the main endpoint: the user sends a message, the AI agent works on it.
//
// Flow: check permission → check daily limit → find or create the conversation → save the
// user's message → run the agent → save its answer → return the conversation "snapshot"
// (messages + any action waiting for approval) to the browser.
import { z } from "zod";

import { agentFor } from "@/backend/agent";
import { enforceDailyLimit, handle, ownedConversation, readJson, saveAnswer, snapshot } from "@/backend/api";
import { HttpError, requireUser } from "@/backend/session";
import { cancelOpenRequests, createConversation, saveMessage, titleFrom, touchLastSeen } from "@/backend/store";

// The agent may call GitHub several times before answering; allow up to a minute.
export const maxDuration = 60;

const Body = z.object({
  conversationId: z.uuid().nullish(), // missing on the first message of a new chat
  message: z.string().trim().min(1).max(4000),
});

export function POST(request: Request) {
  return handle(request, async () => {
    const user = await requireUser("chat.use");
    const body = Body.safeParse(await readJson(request));
    if (!body.success) throw new HttpError(400, "Message must be 1 to 4000 characters.");
    const { conversationId, message } = body.data;

    await enforceDailyLimit(user.id);
    const id = conversationId
      ? (await ownedConversation(user.id, conversationId)).id
      : await createConversation(user.id, titleFrom(message));
    await saveMessage(id, "user", message);
    // A new message declines whatever was waiting, including an open admin review.
    await cancelOpenRequests(id);
    await touchLastSeen(user.id);

    try {
      const result = await (await agentFor(user.id, user.access)).ask(id, message);
      await saveAnswer(id, result);
      return snapshot(id, result, user.access);
    } catch (error) {
      // Tell the browser which conversation the message landed in, so a retry continues it.
      throw Object.assign(error as object, { conversationId: id });
    }
  });
}
