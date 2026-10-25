// The chat screen: messages, example prompts, the approval card and the input box.
// All AI work happens on the server: this component posts to /api/chat (or approve/reject) and shows
// the conversation snapshot that comes back.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApprovalCard } from "@/frontend/components/ApprovalCard";
import { LogoMark, SendIcon } from "@/frontend/components/icons";
import { Markdown } from "@/frontend/components/Markdown";
import { WRITE_ACTIONS } from "@/frontend/lib/labels";
import type { ChatMessage, Snapshot } from "@/backend/types";

const EXAMPLES = [
  "List all my repositories",
  "What was my latest commit?",
  "Show open pull requests in my most recently updated repo",
  "mera last push kis repo me tha?",
];

type Busy = null | "thinking" | "approving" | "rejecting";

function ToolChips({ tools }: { tools: string[] }) {
  if (!tools.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {tools.map((tool, index) => (
        <span
          key={`${tool}-${index}`}
          className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${
            WRITE_ACTIONS.has(tool) ? "border-amber-400/50 text-amber-200" : "border-line text-zinc-400"
          }`}
        >
          {tool}
        </span>
      ))}
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 whitespace-pre-wrap text-white">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <LogoMark className="mt-0.5 size-7 shrink-0" />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-line bg-ink-850/70 px-4 py-3">
        <Markdown>{message.content}</Markdown>
        <ToolChips tools={message.tools} />
      </div>
    </div>
  );
}

export function ChatPanel({ initial, draft: initialDraft = "" }: { initial: Snapshot | null; draft?: string }) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initial?.conversationId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(initial?.messages ?? []);
  const [pending, setPending] = useState(initial?.pending ?? null);
  const [policy, setPolicy] = useState(initial?.policy ?? null);
  const [review, setReview] = useState(initial?.review ?? null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(initialDraft);
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the newest message in view. Block body on purpose: newer browsers make scrollIntoView return
  // a Promise, and an effect must not return anything except a cleanup function.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, busy, error]);

  function apply(snapshot: Snapshot) {
    setMessages(snapshot.messages);
    setPending(snapshot.pending);
    setPolicy(snapshot.policy);
    setReview(snapshot.review);
  }

  // While an admin review is open, check every 10 seconds so the result appears without a reload.
  useEffect(() => {
    if (!review || !conversationId) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/conversations/${conversationId}`);
      if (response.ok) apply((await response.json()) as Snapshot);
    }, 10_000);
    return () => clearInterval(timer);
  }, [review, conversationId]);

  /** Call one of the chat endpoints and show the conversation it sends back. */
  async function post(url: string, body: unknown, mode: Exclude<Busy, null>) {
    setBusy(mode);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({ error: "Unexpected response from the server." }));
      if (!response.ok) {
        // The first message of a new chat may have been saved even though the AI failed:
        // switch to that conversation so the user can simply try again.
        if (data.conversationId && !conversationId) {
          setConversationId(data.conversationId);
          window.history.replaceState(null, "", `/chat/${data.conversationId}`);
          router.refresh();
        }
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }
      const snapshot = data as Snapshot;
      apply(snapshot);
      if (!conversationId) {
        setConversationId(snapshot.conversationId);
        router.replace(`/chat/${snapshot.conversationId}`);
      }
      router.refresh(); // keep the sidebar order and titles current
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  /** Show the user's message right away, then let the server run the agent. */
  function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setMessages((current) => [...current, { role: "user", content: message, tools: [] }]);
    void post("/api/chat", { conversationId, message }, "thinking");
  }

  const empty = messages.length === 0 && !pending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
          {empty && (
            <div className="pt-10 text-center sm:pt-20">
              <LogoMark className="mx-auto size-12" />
              <h1 className="mt-5 text-2xl font-semibold text-white">What should we do on GitHub?</h1>
              <p className="mt-2 text-zinc-400">Reads run instantly. Anything that writes waits for your approval.</p>
              <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => send(example)}
                    className="rounded-xl border border-line bg-ink-850/60 px-4 py-3 text-left text-sm text-zinc-200 transition hover:border-rose-400/60 hover:bg-ink-800"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <Message key={index} message={message} />
          ))}

          {busy === "thinking" && (
            <div className="flex items-center gap-3 text-sm text-zinc-400">
              <LogoMark className="size-7" />
              <span className="flex gap-1">
                <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
                <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
                <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
              </span>
              Working on GitHub...
            </div>
          )}

          {pending && conversationId && (
            <ApprovalCard
              key={pending.id}
              pending={pending}
              policy={policy}
              review={review}
              busy={busy !== null}
              onApprove={(args) => post(`/api/conversations/${conversationId}/approve`, { args }, "approving")}
              onReject={() => post(`/api/conversations/${conversationId}/reject`, {}, "rejecting")}
            />
          )}

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
        className="border-t border-line bg-ink-900/90 px-4 py-4 backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-line bg-ink-850 p-2 focus-within:border-rose-400/70">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={pending ? "Reply to decline the pending action, or ask something new..." : "Ask about your GitHub..."}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy !== null}
            aria-label="Send"
            className="flex size-10 items-center justify-center rounded-xl bg-accent text-white hover:bg-rose-500 disabled:opacity-40"
          >
            <SendIcon />
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-zinc-500">
          The agent acts with your GitHub permissions. Review every approval card carefully.
        </p>
      </form>
    </div>
  );
}
