// The public demo screen: the real chat (in demo mode) next to a live view of the visitor's pretend
// GitHub account, so they can see repositories appear and disappear as they approve changes.
"use client";

import Link from "next/link";
import { useState } from "react";

import { signInWithGitHub } from "@/backend/actions";
import type { SandboxView, Snapshot } from "@/backend/types";
import { ChatPanel } from "@/frontend/components/ChatPanel";
import { GitHubIcon, LockIcon, LogoMark, RefreshIcon } from "@/frontend/components/icons";
import { Badge, buttonStyles } from "@/frontend/components/ui";

function RepoPanel({ sandbox }: { sandbox: SandboxView }) {
  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-line bg-ink-950/60 lg:flex">
      <div className="border-b border-line px-5 py-4">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Pretend GitHub account</p>
        <p className="mt-1 font-semibold text-white">@{sandbox.owner}</p>
        <p className="mt-1 text-xs text-zinc-500">Updates live as you approve changes.</p>
      </div>
      <ul className="flex-1 space-y-2 overflow-y-auto p-4">
        {sandbox.repos.map((repo) => (
          <li key={repo.name} className="demo-pop rounded-xl border border-line bg-ink-850/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-100">{repo.name}</span>
              {repo.private ? (
                <Badge tone="amber">
                  <LockIcon className="size-3" /> Private
                </Badge>
              ) : (
                <Badge>Public</Badge>
              )}
            </div>
            <p className="mt-1.5 flex gap-3 text-xs text-zinc-500">
              <span>
                {repo.openIssues} open {repo.openIssues === 1 ? "issue" : "issues"}
              </span>
              {repo.failingCi && <span className="text-red-300">✕ CI failing</span>}
            </p>
          </li>
        ))}
        {sandbox.repos.length === 0 && <li className="px-1 text-sm text-zinc-500">No repositories left. Reset to start over.</li>}
      </ul>
    </aside>
  );
}

export function DemoWorkspace({ initial, initialSandbox }: { initial: Snapshot | null; initialSandbox: SandboxView }) {
  const [sandbox, setSandbox] = useState(initialSandbox);
  const [chat, setChat] = useState<{ key: number; snapshot: Snapshot | null }>({ key: 0, snapshot: initial });
  const [resetting, setResetting] = useState(false);

  async function reset() {
    setResetting(true);
    const response = await fetch("/api/demo/reset", { method: "POST" });
    if (response.ok) {
      const snapshot = (await response.json()) as Snapshot;
      if (snapshot.sandbox) setSandbox(snapshot.sandbox);
      setChat((current) => ({ key: current.key + 1, snapshot })); // a fresh chat panel
    }
    setResetting(false);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-ink-950 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-white">
          <LogoMark className="size-7" /> GitHubOps AI
        </Link>
        <Badge tone="rose">Demo</Badge>
        <p className="hidden text-sm text-zinc-400 md:block">
          A pretend GitHub account just for you. No sign-in, nothing touches real GitHub.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={reset} disabled={resetting} className={`${buttonStyles.secondary} px-3 py-1.5`}>
            <RefreshIcon className={`size-4 ${resetting ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Reset demo</span>
          </button>
          <form action={signInWithGitHub}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-ink-900 hover:bg-zinc-100"
            >
              <GitHubIcon className="size-4" />
              <span className="hidden sm:inline">Use my real GitHub</span>
              <span className="sm:hidden">Sign in</span>
            </button>
          </form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatPanel
            key={chat.key}
            mode="demo"
            initial={chat.snapshot}
            onSnapshot={(snapshot) => snapshot.sandbox && setSandbox(snapshot.sandbox)}
          />
        </div>
        <RepoPanel sandbox={sandbox} />
      </div>
    </div>
  );
}
