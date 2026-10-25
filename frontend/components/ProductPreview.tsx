// Animated demo on the landing page: a scripted chat that shows the real flow on a loop:
// read (instant answer) → create a repository (approval card) → delete it (one-click red card).
// People who prefer reduced motion see the finished conversation instead of the animation.
"use client";

import { type ReactNode, useEffect, useState } from "react";

import { LogoMark, SendIcon, ShieldIcon } from "@/frontend/components/icons";

// ------------------------------------------------------------------ the script

type CardKind = "create" | "delete";
type Message =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "thinking" }
  | { id: number; kind: "ai"; body: ReactNode; tool: string }
  | { id: number; kind: CardKind; state: "waiting" | "pressing" | "approved" };

// A message before it gets an id (Omit applied to each kind separately, so their own fields stay).
type NewMessage = Message extends infer M ? (M extends Message ? Omit<M, "id"> : never) : never;

type DemoState = { messages: Message[]; draft: string; nextId: number };
type Step = { wait: number; run: (state: DemoState) => DemoState };

const EMPTY: DemoState = { messages: [], draft: "", nextId: 1 };

const add = (state: DemoState, message: NewMessage): DemoState => ({
  ...state,
  messages: [...state.messages, { ...message, id: state.nextId } as Message],
  nextId: state.nextId + 1,
});
const withoutThinking = (state: DemoState): DemoState => ({
  ...state,
  messages: state.messages.filter((message) => message.kind !== "thinking"),
});
const setCard = (kind: CardKind, cardState: "pressing" | "approved") => (state: DemoState): DemoState => ({
  ...state,
  messages: state.messages.map((message) => (message.kind === kind ? { ...message, state: cardState } : message)),
});

/** Type `text` into the input one character at a time, then send it. */
function typeAndSend(text: string, pauseBefore: number): Step[] {
  const typing = Array.from(text, (_, index) => ({
    wait: index === 0 ? pauseBefore : 38,
    run: (state: DemoState) => ({ ...state, draft: text.slice(0, index + 1) }),
  }));
  return [
    ...typing,
    { wait: 450, run: (state) => add({ ...state, draft: "" }, { kind: "user", text }) },
    { wait: 350, run: (state) => add(state, { kind: "thinking" }) },
  ];
}

const REPO_TABLE = (
  <div className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 font-mono text-[11px]">
    <span>octo/api</span>
    <span className="text-amber-200">Private</span>
    <span>octo/web</span>
    <span className="text-zinc-400">Public</span>
    <span>octo/docs</span>
    <span className="text-zinc-400">Public</span>
  </div>
);

const STEPS: Step[] = [
  // 1. A read runs instantly.
  ...typeAndSend("List my repositories", 700),
  {
    wait: 900,
    run: (state) =>
      add(withoutThinking(state), {
        kind: "ai",
        tool: "get_repositories",
        body: (
          <>
            You have 3 repositories:
            {REPO_TABLE}
          </>
        ),
      }),
  },
  // 2. Creating a repository shows the approval card.
  ...typeAndSend("Create a private repo called demo-app", 1600),
  { wait: 900, run: (state) => add(withoutThinking(state), { kind: "create", state: "waiting" }) },
  { wait: 2300, run: setCard("create", "pressing") },
  { wait: 300, run: setCard("create", "approved") },
  { wait: 250, run: (state) => add(state, { kind: "thinking" }) },
  {
    wait: 900,
    run: (state) =>
      add(withoutThinking(state), {
        kind: "ai",
        tool: "create_repository",
        body: (
          <>
            Done. Created <span className="font-mono text-white">octo/demo-app</span> as a private repository.
          </>
        ),
      }),
  },
  // 3. Deleting is one click on the red card.
  ...typeAndSend("Delete demo-app", 1600),
  { wait: 900, run: (state) => add(withoutThinking(state), { kind: "delete", state: "waiting" }) },
  { wait: 2300, run: setCard("delete", "pressing") },
  { wait: 300, run: setCard("delete", "approved") },
  { wait: 250, run: (state) => add(state, { kind: "thinking" }) },
  {
    wait: 900,
    run: (state) =>
      add(withoutThinking(state), {
        kind: "ai",
        tool: "delete_repository",
        body: (
          <>
            Deleted <span className="font-mono text-white">octo/demo-app</span>.
          </>
        ),
      }),
  },
  // Hold the finished conversation, then start over.
  { wait: 4500, run: () => EMPTY },
];

// The finished conversation: shown to reduced-motion users and in the very first render.
const FINISHED = STEPS.slice(0, -1).reduce((state, step) => step.run(state), EMPTY);

// ------------------------------------------------------------------ pieces of the fake UI

function Thinking() {
  return (
    <div className="flex items-center gap-2">
      <LogoMark className="size-6 shrink-0" />
      <span className="flex gap-1">
        <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
        <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
        <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
      </span>
    </div>
  );
}

function Approved({ label }: { label: string }) {
  return <p className="text-[11px] font-medium text-emerald-300">✓ Approved: {label}</p>;
}

function CreateCard({ state }: { state: "waiting" | "pressing" | "approved" }) {
  return (
    <div className="demo-pop rounded-xl border border-amber-400/40 bg-amber-400/[0.05] p-3">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-4 text-amber-200" />
        <span className="font-semibold text-white">Create repository</span>
        <span className="rounded-full bg-amber-400/15 px-1.5 text-[10px] text-amber-200 ring-1 ring-amber-400/25">Write</span>
      </div>
      <div className="mt-2 space-y-1.5 text-[11px]">
        <div>
          <p className="mb-0.5 text-zinc-400">Repository name</p>
          <div className="rounded-md border border-white/10 bg-ink-950 px-2 py-1 font-mono text-zinc-100">demo-app</div>
        </div>
        <div>
          <p className="mb-0.5 text-zinc-400">Visibility</p>
          <div className="flex gap-1.5">
            <span className="rounded-md border border-white/10 px-2 py-0.5 text-zinc-400">Public</span>
            <span className="rounded-md border border-rose-400 bg-accent-soft px-2 py-0.5 text-white">Private</span>
          </div>
        </div>
        <div>
          <p className="mb-0.5 text-zinc-400">
            Description <span className="text-zinc-600">(optional)</span>
          </p>
          <div className="rounded-md border border-white/10 bg-ink-950 px-2 py-1 text-zinc-600">What is this repository for?</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {state === "approved" ? (
          <Approved label="creating on GitHub" />
        ) : (
          <>
            <span
              className={`rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition ${
                state === "pressing" ? "scale-95 ring-2 ring-rose-300/70" : ""
              }`}
            >
              Create repository
            </span>
            <span className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300">Reject</span>
          </>
        )}
      </div>
    </div>
  );
}

function DeleteCard({ state }: { state: "waiting" | "pressing" | "approved" }) {
  return (
    <div className="demo-pop rounded-xl border border-red-500/45 bg-red-500/[0.06] p-3">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-4 text-red-300" />
        <span className="font-semibold text-white">Delete repository</span>
        <span className="rounded-full bg-red-500/15 px-1.5 text-[10px] text-red-300 ring-1 ring-red-500/25">Sensitive</span>
      </div>
      <p className="mt-2 text-[11px] text-red-200/90">
        Permanently deletes <span className="font-semibold">octo/demo-app</span>, including its issues and history. This
        can&apos;t be undone.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        {state === "approved" ? (
          <Approved label="deleting on GitHub" />
        ) : (
          <>
            <span
              className={`rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white transition ${
                state === "pressing" ? "scale-95 ring-2 ring-red-300/70" : ""
              }`}
            >
              Delete repository
            </span>
            <span className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300">Reject</span>
          </>
        )}
      </div>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  switch (message.kind) {
    case "user":
      return (
        <div className="demo-pop flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-white">{message.text}</div>
        </div>
      );
    case "thinking":
      return <Thinking />;
    case "ai":
      return (
        <div className="demo-pop flex gap-2">
          <LogoMark className="size-6 shrink-0" />
          <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-white/5 bg-ink-850 p-3 text-zinc-300">
            {message.body}
            <div className="mt-2">
              <span
                className={`rounded-full border px-1.5 font-mono text-[10px] ${
                  message.tool.startsWith("get_") ? "border-white/10 text-zinc-500" : "border-amber-400/50 text-amber-200"
                }`}
              >
                {message.tool}
              </span>
            </div>
          </div>
        </div>
      );
    case "create":
      return <CreateCard state={message.state} />;
    case "delete":
      return <DeleteCard state={message.state} />;
  }
}

// ------------------------------------------------------------------ the demo window

export function ProductPreview() {
  const [state, setState] = useState<DemoState>(FINISHED);
  const [step, setStep] = useState(-1); // -1 = not started (server render and reduced motion)

  // Start the loop only in the browser, and only if the visitor hasn't asked for reduced motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setState(EMPTY);
    setStep(0);
  }, []);

  useEffect(() => {
    if (step < 0) return;
    const current = STEPS[step];
    const timer = setTimeout(() => {
      setState((previous) => current.run(previous));
      setStep((index) => (index + 1) % STEPS.length);
    }, current.wait);
    return () => clearTimeout(timer);
  }, [step]);

  return (
    <div className="relative min-w-0" role="img" aria-label="Animated demo: listing repositories, then creating and deleting a repository with one approval click each">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-rose-600/25 via-transparent to-orange-400/10 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-ink-950/90 shadow-2xl shadow-black/60" aria-hidden="true">
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <span className="size-2.5 rounded-full bg-red-400/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-3 truncate rounded-md bg-white/5 px-3 py-1 font-mono text-[11px] text-zinc-400">
            githubops-ai.vercel.app/chat
          </span>
        </div>

        <div className="flex">
          <div className="hidden w-36 shrink-0 space-y-1 border-r border-white/5 p-3 text-xs sm:block">
            {["Assistant", "Repositories", "Audit log", "Admin"].map((item, index) => (
              <div key={item} className={`rounded-md px-2 py-1.5 ${index === 0 ? "bg-accent-soft text-white" : "text-zinc-500"}`}>
                {item}
              </div>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Newest messages sit at the bottom; older ones scroll up and fade out. */}
            <div className="relative h-[360px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_18%)]">
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-4 text-[13px]">
                {state.messages.map((message) => (
                  <Bubble key={message.id} message={message} />
                ))}
              </div>
            </div>

            <div className="border-t border-white/5 p-3">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-850 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-white">
                  {state.draft || <span className="text-zinc-500">Ask about your GitHub...</span>}
                  {state.draft && <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-white" />}
                </span>
                <span
                  className={`flex size-7 items-center justify-center rounded-lg text-white transition ${
                    state.draft ? "bg-accent" : "bg-accent/40"
                  }`}
                >
                  <SendIcon className="size-3.5" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
