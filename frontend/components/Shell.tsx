// App frame for signed-in pages: sidebar (navigation, conversations, user card) and the
// "connect GitHub" banner.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { signInWithGitHub, signOutAction } from "@/backend/actions";
import {
  ChatIcon,
  GearIcon,
  GitHubIcon,
  ListIcon,
  LogoMark,
  MenuIcon,
  PlusIcon,
  RepoIcon,
  ShieldIcon,
  TrashIcon,
} from "@/frontend/components/icons";
import type { ShellData } from "@/backend/pages";
import type { Conversation } from "@/backend/types";

/** Shown when this browser has no GitHub access for the user (e.g. they disconnected). One click fixes it. */
function ConnectBanner() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-100">
      <span className="flex-1">
        Connect GitHub so the assistant can work on your repositories. One approval; the access stays in your browser.
      </span>
      <form action={signInWithGitHub}>
        <button
          type="submit"
          className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-zinc-100"
        >
          <GitHubIcon className="size-4" /> Connect GitHub
        </button>
      </form>
    </div>
  );
}

export function Shell({ shell, children }: { shell: ShellData; children: React.ReactNode }) {
  const { user, conversations, githubConnected, nav } = shell;
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function remove(conversation: Conversation) {
    if (!confirm(`Delete "${conversation.title}"? The audit log keeps its entries.`)) return;
    const response = await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
    if (!response.ok) return alert("Could not delete the conversation.");
    if (pathname === `/chat/${conversation.id}`) router.push("/chat");
    router.refresh();
  }

  const link = (active: boolean) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
      active ? "bg-accent-soft font-medium text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"
    }`;
  const close = () => setOpen(false);

  const sections = [
    { href: "/chat", label: "Assistant", icon: ChatIcon, active: pathname.startsWith("/chat") },
    { href: "/repos", label: "Repositories", icon: RepoIcon, active: pathname.startsWith("/repos") },
    { href: "/audit", label: "Audit log", icon: ListIcon, active: pathname === "/audit" },
    { href: "/settings", label: "Settings", icon: GearIcon, active: pathname === "/settings" },
  ];

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-line bg-ink-950 transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 py-5 font-semibold tracking-tight">
          <LogoMark /> GitHubOps AI
        </div>

        <nav className="space-y-0.5 px-3">
          {sections.map(({ href, label, icon: Icon, active }) => (
            <Link key={href} href={href} onClick={close} className={link(active)}>
              <Icon className="size-4" /> {label}
            </Link>
          ))}
          {nav.admin && (
            <Link href="/admin" onClick={close} className={link(pathname.startsWith("/admin"))}>
              <ShieldIcon className="size-4" /> Admin
              {nav.pendingReviews > 0 && (
                <span className="ml-auto rounded-full bg-accent px-1.5 text-xs font-semibold text-white">
                  {nav.pendingReviews}
                </span>
              )}
            </Link>
          )}
        </nav>

        <div className="mt-6 flex items-center justify-between px-6 pb-2">
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Conversations</p>
          <Link href="/chat" onClick={close} aria-label="New chat" className="rounded p-1 text-zinc-400 hover:bg-white/5 hover:text-white">
            <PlusIcon />
          </Link>
        </div>
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {conversations.length === 0 && <li className="px-3 text-sm text-zinc-500">No conversations yet.</li>}
          {conversations.map((conversation) => (
            <li key={conversation.id} className="group relative">
              <Link
                href={`/chat/${conversation.id}`}
                onClick={close}
                className={`${link(pathname === `/chat/${conversation.id}`)} pr-9`}
              >
                <span className="truncate">{conversation.title}</span>
              </Link>
              <button
                type="button"
                onClick={() => remove(conversation)}
                aria-label={`Delete ${conversation.title}`}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-red-400 focus:opacity-100"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>

        <div className="m-3 flex items-center gap-3 rounded-xl border border-line bg-ink-850/70 p-3">
          {user.image ? (
            <img src={user.image} alt="" className="size-9 rounded-full" />
          ) : (
            <div className="size-9 rounded-full bg-ink-700" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user.login ? `@${user.login}` : (user.name ?? "Signed in")}</p>
            <p className="text-xs text-zinc-500 capitalize">{user.role}</p>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="text-xs text-zinc-400 hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-20 bg-black/60 md:hidden" onClick={close} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="text-zinc-300">
            <MenuIcon />
          </button>
          <LogoMark className="size-6" />
          <span className="font-semibold">GitHubOps AI</span>
        </header>
        {!githubConnected && pathname !== "/settings" && <ConnectBanner />}
        {children}
      </div>
    </div>
  );
}
