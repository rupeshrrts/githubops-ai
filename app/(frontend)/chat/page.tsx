// /chat: a new, empty conversation with the AI assistant. ?prompt=... pre-fills the message box
// (used by "Ask AI about this repo").
import { ChatPanel } from "@/frontend/components/ChatPanel";
import { Shell } from "@/frontend/components/Shell";
import { loadWorkspace } from "@/backend/pages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assistant" };

export default async function NewChatPage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const { shell } = await loadWorkspace("chat.use");
  const { prompt } = await searchParams;
  return (
    <Shell shell={shell}>
      <ChatPanel initial={null} draft={prompt?.slice(0, 4000) ?? ""} />
    </Shell>
  );
}
