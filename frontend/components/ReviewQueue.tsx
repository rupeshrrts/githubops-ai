// Admin review queue: one card per sensitive action waiting for a decision.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, buttonStyles, inputStyles } from "@/frontend/components/ui";
import { ACTION_LABELS, targetOf } from "@/frontend/lib/labels";
import type { ApprovalRequest } from "@/backend/types";

function RequestCard({ request, selfId }: { request: ApprovalRequest & { age: string }; selfId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = request.requesterId === selfId;

  async function decide(decision: "approve" | "reject") {
    const verb = decision === "approve" ? "Approve and run" : "Reject";
    if (!confirm(`${verb} "${ACTION_LABELS[request.tool] ?? request.tool}" on ${targetOf(request.args)} for @${request.requesterLogin}?`)) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/approvals/${request.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error ?? "Could not record the decision.");
    else if (data.toolError) setError(`Approved, but GitHub refused: ${data.toolError}`);
    setBusy(false);
    router.refresh();
  }

  return (
    <li className="rounded-2xl border border-red-500/30 bg-red-500/[0.03] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-white">{ACTION_LABELS[request.tool] ?? request.tool}</p>
        <Badge tone="red">{request.risk}</Badge>
        <span className="ml-auto text-xs text-zinc-500">
          @{request.requesterLogin ?? "unknown"} · {request.age}
        </span>
      </div>
      <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-line bg-ink-950 p-3 font-mono text-xs text-zinc-200">
        {JSON.stringify(request.args, null, 2)}
      </pre>
      {own ? (
        <p className="mt-3 text-sm text-zinc-400">This is your own request; another reviewer has to decide.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className={`${inputStyles} max-w-sm flex-1`}
            placeholder="Note for the requester (optional)"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
          <button type="button" disabled={busy} onClick={() => decide("approve")} className={buttonStyles.danger}>
            Approve & run
          </button>
          <button type="button" disabled={busy} onClick={() => decide("reject")} className={buttonStyles.secondary}>
            Reject
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </li>
  );
}

export function ReviewQueue({ requests, selfId }: { requests: (ApprovalRequest & { age: string })[]; selfId: string }) {
  return (
    <ul className="space-y-4">
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} selfId={selfId} />
      ))}
    </ul>
  );
}
