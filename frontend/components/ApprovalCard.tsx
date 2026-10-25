// The card shown when the AI wants to change something on GitHub. It shows exactly what will happen,
// lets the user edit key fields, and offers Approve / Reject. It also covers: risk badge, a clear warning
// for deletes, "waiting for admin review", and "your role can't do this".
"use client";

import { useState } from "react";

import { ShieldIcon } from "@/frontend/components/icons";
import { Badge, buttonStyles, inputStyles } from "@/frontend/components/ui";
import { ACTION_LABELS, targetOf } from "@/frontend/lib/labels";
import type { ApprovalRequest, PendingCall, PendingPolicy } from "@/backend/types";

const RISK_BADGE = {
  read: <Badge>Read</Badge>,
  write: <Badge tone="amber">Write</Badge>,
  sensitive: <Badge tone="red">Sensitive</Badge>,
};

/** Public / Private choice, used when creating a repository and when changing its visibility. */
function VisibilityChoice({
  isPrivate,
  disabled,
  onChange,
}: {
  isPrivate: boolean;
  disabled: boolean;
  onChange: (isPrivate: boolean) => void;
}) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Visibility">
      {[false, true].map((option) => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={isPrivate === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={`rounded-lg border px-4 py-1.5 ${
            isPrivate === option ? "border-rose-400 bg-accent-soft text-white" : "border-line text-zinc-300 hover:bg-white/5"
          }`}
        >
          {option ? "Private" : "Public"}
        </button>
      ))}
    </div>
  );
}

export function ApprovalCard({
  pending,
  policy,
  review,
  busy,
  onApprove,
  onReject,
}: {
  pending: PendingCall;
  policy: PendingPolicy | null;
  review: ApprovalRequest | null;
  busy: boolean;
  onApprove: (args: Record<string, unknown>) => void;
  onReject: () => void;
}) {
  const { name, args } = pending;
  const [edited, setEdited] = useState<Record<string, unknown>>(args);
  const set = (key: string, value: unknown) => setEdited((current) => ({ ...current, [key]: value }));

  const risk = policy?.risk ?? "write";
  const target = targetOf(args);
  const isApiCall = name === "github_api_write";
  const isDelete = name === "delete_repository" || (isApiCall && args.method === "DELETE");
  const allowed = policy?.allowed ?? true;
  const needsReview = policy?.needsReview ?? false;
  // A new repository needs a name; everything else is ready to approve as proposed.
  const missingName = name === "create_repository" && String(edited.name ?? "").trim() === "";
  const canApprove = !busy && allowed && !review && !missingName;
  const editable = !review && allowed;

  const frame =
    risk === "sensitive" ? "border-red-500/45 bg-red-500/[0.04]" : "border-amber-400/40 bg-amber-400/[0.04]";

  return (
    <div className={`overflow-hidden rounded-2xl border ${frame}`}>
      <div className="flex items-start gap-3 p-5 pb-0">
        <div className={`rounded-lg p-2 ${risk === "sensitive" ? "bg-red-500/15 text-red-300" : "bg-amber-400/15 text-amber-200"}`}>
          <ShieldIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-white">{ACTION_LABELS[name] ?? name}</p>
            {RISK_BADGE[risk]}
          </div>
          <p className="mt-0.5 text-sm text-zinc-400">
            The agent wants to call <code className="text-zinc-300">{name}</code>. Nothing has been sent to GitHub yet.
          </p>
        </div>
      </div>

      <div className="space-y-3 p-5 text-sm">
        {name === "create_repository" ? (
          <>
            <label className="block">
              <span className="mb-1 block text-zinc-400">Repository name</span>
              <input
                id={`repo-name-${pending.id}`}
                className={inputStyles}
                value={String(edited.name ?? "")}
                disabled={!editable}
                placeholder="my-new-repo"
                onChange={(e) => set("name", e.target.value)}
              />
            </label>
            <div>
              <span className="mb-1 block text-zinc-400">Visibility</span>
              <VisibilityChoice
                isPrivate={Boolean(edited.private)}
                disabled={!editable}
                onChange={(isPrivate) => set("private", isPrivate)}
              />
            </div>
            <label className="block">
              <span className="mb-1 block text-zinc-400">
                Description <span className="text-zinc-500">(optional)</span>
              </span>
              <input
                id={`repo-description-${pending.id}`}
                className={inputStyles}
                value={String(edited.description ?? "")}
                disabled={!editable}
                placeholder="What is this repository for?"
                onChange={(e) => set("description", e.target.value)}
              />
            </label>
          </>
        ) : name === "update_repository_visibility" ? (
          <>
            <p className="text-zinc-300">
              Repository: <span className="font-semibold text-white">{target}</span>
            </p>
            <VisibilityChoice
              isPrivate={Boolean(edited.private)}
              disabled={!editable}
              onChange={(isPrivate) => set("private", isPrivate)}
            />
          </>
        ) : name === "update_file" ? (
          <>
            <p className="text-zinc-300">
              <code>{String(args.path ?? "")}</code> on branch <code>{String(args.branch || "default")}</code> in{" "}
              <span className="font-semibold text-white">{target}</span>
            </p>
            <p className="text-zinc-400">
              Commit message: <span className="text-zinc-200 italic">{String(args.message ?? "")}</span>
            </p>
            <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-ink-950 p-3 font-mono text-xs text-zinc-200">
              {String(args.content ?? "")}
            </pre>
          </>
        ) : isApiCall ? (
          <>
            <p className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <span className={`rounded px-1.5 py-0.5 font-semibold ${isDelete ? "bg-red-500/20 text-red-200" : "bg-amber-400/20 text-amber-100"}`}>
                {String(args.method)}
              </span>
              <span className="break-all text-zinc-200">api.github.com{String(args.path)}</span>
            </p>
            {Boolean(args.body) && Object.keys(args.body as object).length > 0 && (
              <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-ink-950 p-3 font-mono text-xs text-zinc-200">
                {JSON.stringify(args.body, null, 2)}
              </pre>
            )}
          </>
        ) : name === "delete_repository" ? (
          <p className="text-red-200">
            This permanently deletes <span className="font-semibold">{target || "an unspecified repository"}</span>,
            including its issues, pull requests and history. It cannot be undone.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-line bg-ink-950 p-3">
            {Object.entries(args).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-mono text-xs text-zinc-400">{key}</dt>
                <dd className="break-words text-zinc-200">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="border-t border-line bg-black/20 px-5 py-4">
        {review ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-amber-400" />
            </span>
            <p className="flex-1 text-sm text-amber-100">
              {review.status === "pending"
                ? "Waiting for an admin to review this sensitive action. Once approved, it runs from your account automatically."
                : `@${review.reviewerLogin ?? "An admin"} ${review.status} this. Carrying it out from your account...`}
            </p>
            {review.status === "pending" && (
              <button type="button" onClick={onReject} disabled={busy} className={buttonStyles.secondary}>
                Cancel request
              </button>
            )}
          </div>
        ) : !allowed ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-zinc-300">
              Your role can&apos;t run {risk} actions. Reject it, or ask an admin for the <code>github.{risk}</code> permission.
            </p>
            <button type="button" onClick={onReject} disabled={busy} className={buttonStyles.secondary}>
              Reject
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onApprove(edited)}
              disabled={!canApprove}
              className={isDelete ? buttonStyles.danger : buttonStyles.primary}
            >
              {busy
                ? "Working..."
                : needsReview
                  ? "Request admin approval"
                  : name === "delete_repository"
                    ? "Delete repository"
                    : isDelete
                      ? "Delete"
                      : name === "create_repository"
                        ? "Create repository"
                        : "Approve"}
            </button>
            <button type="button" onClick={onReject} disabled={busy} className={buttonStyles.secondary}>
              Reject
            </button>
            {needsReview && (
              <p className="ml-auto text-xs text-zinc-400">Sensitive action: an admin must approve it before it runs.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
