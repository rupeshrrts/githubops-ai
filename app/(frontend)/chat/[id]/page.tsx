// /chat/:id: an existing conversation. Loads its messages and any action waiting for approval on the server
// (carrying out an admin's decision first, if one is waiting), then hands them to <ChatPanel> in the browser.
import { notFound } from "next/navigation";

import { ChatPanel } from "@/frontend/components/ChatPanel";
import { Shell } from "@/frontend/components/Shell";
import { snapshot } from "@/backend/api";
import { conversationState } from "@/backend/approvals";
import { loadWorkspace } from "@/backend/pages";
import { getConversation } from "@/backend/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, shell } = await loadWorkspace("chat.use");
  const conversation = await getConversation(user.id, id);
  if (!conversation) notFound();

  const state = await conversationState(user, id, shell.githubConnected);
  return (
    <Shell shell={shell}>
      {/* key: a fresh panel per conversation, so switching chats never mixes state */}
      <ChatPanel key={id} initial={await snapshot(id, state, user.access)} />
    </Shell>
  );
}
