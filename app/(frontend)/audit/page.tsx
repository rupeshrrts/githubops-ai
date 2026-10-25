// /audit: the audit log. Everyone sees their own entries; maintainers and admins can switch to everyone's.
import Link from "next/link";

import { Shell } from "@/frontend/components/Shell";
import { Badge, EmptyState, Page, PageHeader, timeAgo } from "@/frontend/components/ui";
import { ACTION_LABELS, targetOf } from "@/frontend/lib/labels";
import { loadWorkspace } from "@/backend/pages";
import { can } from "@/backend/rbac";
import { listAudit } from "@/backend/store";
import type { AuditEntry } from "@/backend/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

const DECISION_TONE: Record<string, "green" | "neutral" | "amber" | "rose" | "red"> = {
  approved: "green",
  rejected: "neutral",
  superseded: "amber",
  review_requested: "rose",
};

const EVENT_LABELS: Record<string, string> = {
  workflow_dispatch: "Run workflow",
  "role.changed": "Role changed",
  "permission.changed": "Permission changed",
  "user.disabled": "User disabled",
  "user.enabled": "User enabled",
  "token.revoked": "GitHub token revoked",
  "github.disconnected": "GitHub disconnected",
};

function Result({ entry }: { entry: AuditEntry }) {
  if (entry.ok === null) return <span className="text-zinc-500">Not run</span>;
  if (entry.ok) return <span className="text-emerald-300">Success</span>;
  return (
    <span className="text-red-300" title={entry.detail}>
      Failed{entry.detail ? `: ${entry.detail.slice(0, 70)}` : ""}
    </span>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { user, shell } = await loadWorkspace("audit.view");
  const everyone = (await searchParams).scope === "all" && can(user.access, "audit.view_all");
  const entries = await listAudit(everyone ? null : user.id);

  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm ${active ? "bg-accent-soft text-white" : "text-zinc-400 hover:text-white"}`;

  return (
    <Shell shell={shell}>
      <Page wide>
        <PageHeader
          title="Audit log"
          description="Every write action, review decision and admin change, with who decided and what happened."
          actions={
            can(user.access, "audit.view_all") && (
              <div className="flex rounded-xl border border-line p-1">
                <Link href="/audit" className={tab(!everyone)}>
                  Mine
                </Link>
                <Link href="/audit?scope=all" className={tab(everyone)}>
                  Everyone
                </Link>
              </div>
            )
          }
        />

        {entries.length === 0 ? (
          <EmptyState title="Nothing logged yet">Approved, rejected and reviewed actions will appear here.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-850 text-xs tracking-wide text-zinc-400 uppercase">
                <tr>
                  {["When", ...(everyone ? ["User"] : []), "Action", "Target", "Decision", "By", "Result"].map((heading) => (
                    <th key={heading} className="px-4 py-3 font-medium whitespace-nowrap">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {entries.map((entry) => {
                  const label = ACTION_LABELS[entry.tool] ?? EVENT_LABELS[entry.tool] ?? entry.tool;
                  return (
                    <tr key={entry.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-400" title={entry.createdAt}>
                        {timeAgo(entry.createdAt)}
                      </td>
                      {everyone && <td className="px-4 py-3 text-zinc-300">@{entry.userLogin ?? "unknown"}</td>}
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                        {entry.conversationId && !everyone ? (
                          <Link href={`/chat/${entry.conversationId}`} className="hover:underline">
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                        {entry.category !== "github" && (
                          <span className="ml-2">
                            <Badge tone="blue">{entry.category}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-zinc-300">{targetOf(entry.args)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={DECISION_TONE[entry.decision] ?? "neutral"}>{entry.decision.replace("_", " ")}</Badge>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{entry.actorLogin ? `@${entry.actorLogin}` : "-"}</td>
                      <td className="px-4 py-3">
                        <Result entry={entry} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Page>
    </Shell>
  );
}
