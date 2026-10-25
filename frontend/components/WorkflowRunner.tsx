// A repository's GitHub Actions workflows with Run buttons. Running always asks for confirmation.
"use client";

import { useState } from "react";

import { PlayIcon } from "@/frontend/components/icons";
import { Badge, buttonStyles, inputStyles } from "@/frontend/components/ui";

type Workflow = { id: number; name: string; path: string; state: string };

export function WorkflowRunner({
  owner,
  repo,
  defaultBranch,
  workflows,
  canRun,
}: {
  owner: string;
  repo: string;
  defaultBranch: string;
  workflows: Workflow[];
  canRun: boolean;
}) {
  const [ref, setRef] = useState(defaultBranch);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(workflow: Workflow) {
    // Running a workflow can deploy or publish, so it always needs an explicit confirmation.
    if (!confirm(`Run "${workflow.name}" on ${owner}/${repo} at "${ref}"?`)) return;
    setBusy(workflow.id);
    setMessage(null);
    const response = await fetch("/api/repos/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, repo, workflowId: workflow.id, ref }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? { ok: true, text: `Started "${workflow.name}". It appears under recent runs within a few seconds.` }
        : { ok: false, text: data.error ?? "GitHub refused to start the workflow." },
    );
    setBusy(null);
  }

  if (workflows.length === 0) return <p className="text-sm text-zinc-500">No GitHub Actions workflows in this repository.</p>;

  return (
    <div className="space-y-3">
      {canRun && (
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Branch
          <input className={`${inputStyles} max-w-48 py-1.5`} value={ref} onChange={(event) => setRef(event.target.value)} />
        </label>
      )}
      <ul className="divide-y divide-line">
        {workflows.map((workflow) => (
          <li key={workflow.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-100">{workflow.name}</p>
              <p className="truncate font-mono text-xs text-zinc-500">{workflow.path}</p>
            </div>
            {workflow.state !== "active" && <Badge tone="amber">{workflow.state.replaceAll("_", " ")}</Badge>}
            {canRun && (
              <button
                type="button"
                onClick={() => run(workflow)}
                disabled={busy !== null || workflow.state !== "active"}
                className={`${buttonStyles.secondary} px-3 py-1.5`}
              >
                <PlayIcon className="size-3.5" /> {busy === workflow.id ? "Starting..." : "Run"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && <p className={`text-sm ${message.ok ? "text-emerald-300" : "text-red-300"}`}>{message.text}</p>}
      {canRun && <p className="text-xs text-zinc-500">Only workflows with a workflow_dispatch trigger can be started.</p>}
    </div>
  );
}
