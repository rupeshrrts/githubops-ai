// Repositories list with search and filters, plus the "Sync now" button.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { LockIcon, RefreshIcon, StarIcon } from "@/frontend/components/icons";
import { Badge, buttonStyles, inputStyles } from "@/frontend/components/ui";
import type { SyncedRepo } from "@/backend/types";

const FILTERS = ["all", "public", "private", "archived"] as const;

export function SyncButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/repos/sync", { method: "POST" });
    if (!response.ok) setError((await response.json().catch(() => ({}))).error ?? "Sync failed.");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-red-300">{error}</span>}
      <button type="button" onClick={sync} disabled={busy || disabled} className={buttonStyles.secondary}>
        <RefreshIcon className={`size-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Syncing..." : "Sync now"}
      </button>
    </div>
  );
}

export function ReposView({ repos }: { repos: (SyncedRepo & { updated: string })[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return repos.filter((repo) => {
      if (filter === "public" && (repo.private || repo.archived)) return false;
      if (filter === "private" && (!repo.private || repo.archived)) return false;
      if (filter === "archived" && !repo.archived) return false;
      if (filter === "all" && repo.archived) return false;
      return !needle || repo.fullName.toLowerCase().includes(needle) || repo.description?.toLowerCase().includes(needle);
    });
  }, [repos, search, filter]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search repositories..."
          className={`${inputStyles} max-w-sm`}
        />
        <div className="flex rounded-xl border border-line p-1">
          {FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setFilter(name)}
              className={`rounded-lg px-3 py-1 text-sm capitalize ${filter === name ? "bg-accent-soft text-white" : "text-zinc-400 hover:text-white"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm text-zinc-500">{shown.length} shown</span>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-ink-850/40">
        {shown.map((repo) => (
          <li key={repo.githubId}>
            <Link
              href={`/repos/${repo.owner}/${repo.name}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 transition hover:bg-white/[0.03]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{repo.fullName}</span>
                  {repo.private ? (
                    <Badge tone="amber">
                      <LockIcon className="size-3" /> Private
                    </Badge>
                  ) : (
                    <Badge>Public</Badge>
                  )}
                  {repo.archived && <Badge tone="red">Archived</Badge>}
                  {repo.fork && <Badge tone="blue">Fork</Badge>}
                </div>
                {repo.description && <p className="mt-1 truncate text-sm text-zinc-400">{repo.description}</p>}
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-400">
                {repo.language && <span>{repo.language}</span>}
                <span className="flex items-center gap-1">
                  <StarIcon className="size-3.5" /> {repo.stars}
                </span>
                <span>{repo.openIssues} open</span>
                <span className="w-20 text-right">{repo.updated}</span>
              </div>
            </Link>
          </li>
        ))}
        {shown.length === 0 && <li className="px-5 py-10 text-center text-sm text-zinc-500">No repositories match.</li>}
      </ul>
    </>
  );
}
