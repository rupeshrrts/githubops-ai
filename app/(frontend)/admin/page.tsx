// /admin: admin overview: stats, the review queue for sensitive actions, and recent review decisions.
import { AdminNav } from "@/frontend/components/AdminNav";
import { ReviewQueue } from "@/frontend/components/ReviewQueue";
import { Shell } from "@/frontend/components/Shell";
import { Badge, Card, EmptyState, Page, PageHeader, Stat, timeAgo } from "@/frontend/components/ui";
import { ACTION_LABELS, targetOf } from "@/frontend/lib/labels";
import { loadWorkspace } from "@/backend/pages";
import { can } from "@/backend/rbac";
import { adminStats, listRequests } from "@/backend/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

const STATUS_TONE = { approved: "green", rejected: "neutral", cancelled: "neutral", failed: "red", pending: "amber" } as const;

export default async function AdminPage() {
  const { user, shell } = await loadWorkspace("admin.access");
  const reviewer = can(user.access, "approvals.review");
  const [stats, pending, history] = await Promise.all([
    adminStats(),
    reviewer ? listRequests("pending") : Promise.resolve([]),
    listRequests("all", 15),
  ]);
  const decided = history.filter((request) => request.status !== "pending");

  return (
    <Shell shell={shell}>
      <Page wide>
        <PageHeader
          eyebrow="Admin"
          title="Overview"
          description="Users, sensitive-action reviews and activity across the portal."
          actions={<AdminNav active="overview" canManageUsers={can(user.access, "admin.users")} />}
        />

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Users" value={stats.users} />
          <Stat label="Active (7 days)" value={stats.activeWeek} />
          <Stat label="Conversations" value={stats.conversations} />
          <Stat label="Pending reviews" value={stats.pendingReviews} />
          <Stat label="Actions (24h)" value={stats.actionsToday} />
          <Stat label="Failures (7 days)" value={stats.failuresWeek} tone={stats.failuresWeek ? "red" : undefined} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-white">Waiting for review</h2>
            {!reviewer ? (
              <EmptyState title="You can't review requests">Ask an admin for the approvals.review permission.</EmptyState>
            ) : pending.length === 0 ? (
              <EmptyState title="Nothing to review">Sensitive actions from members will appear here.</EmptyState>
            ) : (
              <ReviewQueue requests={pending.map((request) => ({ ...request, age: timeAgo(request.createdAt) }))} selfId={user.id} />
            )}
          </div>

          <Card title="Recent decisions">
            {decided.length === 0 ? (
              <p className="text-sm text-zinc-500">No reviews yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {decided.map((request) => (
                  <li key={request.id} className="py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-zinc-200">
                        {ACTION_LABELS[request.tool] ?? request.tool} · <span className="font-mono text-xs">{targetOf(request.args)}</span>
                      </span>
                      <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      @{request.requesterLogin} → {request.reviewerLogin ? `@${request.reviewerLogin}` : "-"} ·{" "}
                      {timeAgo(request.reviewedAt)}
                      {request.reviewNote && ` · "${request.reviewNote}"`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Page>
    </Shell>
  );
}
