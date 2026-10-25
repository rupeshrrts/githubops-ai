// /repos: the user's GitHub repositories, mirrored in the database. The first visit syncs automatically;
// "Sync now" refreshes on demand.
import { ReposView, SyncButton } from "@/frontend/components/ReposView";
import { Shell } from "@/frontend/components/Shell";
import { Card, EmptyState, Page, PageHeader, Stat, timeAgo } from "@/frontend/components/ui";
import { githubClient } from "@/backend/agent";
import { lastSync, listRepositories, syncRepositories } from "@/backend/github/sync";
import { loadWorkspace } from "@/backend/pages";
import { can } from "@/backend/rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Repositories" };

export default async function ReposPage() {
  const { user, shell } = await loadWorkspace("github.read");
  const canSync = can(user.access, "repos.sync");

  let run = await lastSync(user.id);
  let syncError: string | null = null;
  // First visit: mirror the repositories right away so the page is never empty.
  if (!run && canSync) {
    try {
      await syncRepositories(user.id, await githubClient(user.id), "auto");
    } catch (error) {
      syncError = error instanceof Error ? error.message : "Sync failed.";
    }
    run = await lastSync(user.id);
  }
  const repos = await listRepositories(user.id);
  const privateCount = repos.filter((repo) => repo.private).length;

  return (
    <Shell shell={shell}>
      <Page wide>
        <PageHeader
          title="Repositories"
          description={
            run ? `Synced from GitHub ${timeAgo(run.finishedAt ?? run.startedAt)}${run.status === "error" ? " (last sync failed)" : ""}.` : "Not synced yet."
          }
          actions={canSync && <SyncButton />}
        />

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Repositories" value={repos.length} />
          <Stat label="Private" value={privateCount} />
          <Stat label="Open issues + PRs" value={repos.reduce((sum, repo) => sum + repo.openIssues, 0)} />
        </div>

        {(syncError || run?.status === "error") && (
          <Card className="mb-6 border-red-500/30">
            <p className="text-sm text-red-200">Sync problem: {syncError ?? run?.error}</p>
          </Card>
        )}

        {repos.length === 0 ? (
          <EmptyState title="No repositories yet">
            {canSync ? "Click Sync now to load your repositories from GitHub." : "Ask an admin for the repos.sync permission."}
          </EmptyState>
        ) : (
          <ReposView repos={repos.map((repo) => ({ ...repo, updated: timeAgo(repo.pushedAt) }))} />
        )}
      </Page>
    </Shell>
  );
}
