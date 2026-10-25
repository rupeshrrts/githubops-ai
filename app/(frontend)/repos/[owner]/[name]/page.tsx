// /repos/:owner/:name: live dashboard for one repository: workflows (with Run buttons), recent CI runs,
// open pull requests and issues. Data comes straight from GitHub with the user's own token.
import Link from "next/link";
import { notFound } from "next/navigation";

import { BoltIcon, ExternalIcon, LockIcon, StarIcon } from "@/frontend/components/icons";
import { Shell } from "@/frontend/components/Shell";
import { Badge, buttonStyles, Card, Page, PageHeader, timeAgo } from "@/frontend/components/ui";
import { WorkflowRunner } from "@/frontend/components/WorkflowRunner";
import { githubClient } from "@/backend/agent";
import { loadWorkspace } from "@/backend/pages";
import { can } from "@/backend/rbac";

export const dynamic = "force-dynamic";

const RUN_TONE: Record<string, "green" | "red" | "amber" | "neutral"> = {
  success: "green",
  failure: "red",
  cancelled: "neutral",
  timed_out: "red",
};

function value<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

export default async function RepoPage({ params }: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await params;
  const { user, shell } = await loadWorkspace("github.read");
  const octokit = await githubClient(user.id);
  const where = { owner, repo: name };

  // GitHub enforces access: a repo this user can't see is a 404 here too.
  const repo = await octokit.rest.repos.get(where).then((response) => response.data).catch(() => null);
  if (!repo) notFound();

  const [workflows, runs, pulls, issues] = await Promise.allSettled([
    octokit.rest.actions.listRepoWorkflows({ ...where, per_page: 50 }),
    octokit.rest.actions.listWorkflowRunsForRepo({ ...where, per_page: 8 }),
    octokit.rest.pulls.list({ ...where, state: "open", per_page: 8 }),
    octokit.rest.issues.listForRepo({ ...where, state: "open", per_page: 15 }),
  ]);
  const workflowList = value(workflows)?.data.workflows ?? [];
  const runList = value(runs)?.data.workflow_runs ?? [];
  const pullList = value(pulls)?.data ?? [];
  const issueList = (value(issues)?.data ?? []).filter((issue) => !issue.pull_request).slice(0, 8);
  const askAi = `/chat?prompt=${encodeURIComponent(`Give me a status report for ${repo.full_name}: open PRs, failing CI, and stale issues.`)}`;

  return (
    <Shell shell={shell}>
      <Page wide>
        <Link href="/repos" className="mb-4 inline-block text-sm text-zinc-400 hover:text-white">
          ← Repositories
        </Link>
        <PageHeader
          eyebrow={repo.owner.login}
          title={
            <span className="flex flex-wrap items-center gap-3">
              {repo.name}
              {repo.private ? (
                <Badge tone="amber">
                  <LockIcon className="size-3" /> Private
                </Badge>
              ) : (
                <Badge>Public</Badge>
              )}
              {repo.archived && <Badge tone="red">Archived</Badge>}
            </span>
          }
          description={repo.description ?? undefined}
          actions={
            <>
              {can(user.access, "chat.use") && (
                <Link href={askAi} className={buttonStyles.primary}>
                  <BoltIcon className="size-4" /> Ask AI about this repo
                </Link>
              )}
              <a href={repo.html_url} target="_blank" rel="noreferrer" className={buttonStyles.secondary}>
                <ExternalIcon className="size-4" /> GitHub
              </a>
            </>
          }
        />

        <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-400">
          {repo.language && <span>{repo.language}</span>}
          <span className="flex items-center gap-1">
            <StarIcon className="size-4" /> {repo.stargazers_count}
          </span>
          <span>{repo.forks_count} forks</span>
          <span>Default branch: <code className="text-zinc-300">{repo.default_branch}</code></span>
          <span>Last push {timeAgo(repo.pushed_at)}</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Workflows">
            <WorkflowRunner
              owner={owner}
              repo={name}
              defaultBranch={repo.default_branch}
              workflows={workflowList.map((workflow) => ({
                id: workflow.id,
                name: workflow.name,
                path: workflow.path,
                state: workflow.state,
              }))}
              canRun={can(user.access, "workflows.run") && !repo.archived}
            />
          </Card>

          <Card title="Recent runs">
            {runList.length === 0 ? (
              <p className="text-sm text-zinc-500">No workflow runs yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {runList.map((run) => (
                  <li key={run.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <Badge tone={RUN_TONE[run.conclusion ?? ""] ?? "amber"}>{run.conclusion ?? run.status}</Badge>
                    <a href={run.html_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-zinc-200 hover:underline">
                      {run.name} · {run.head_branch}
                    </a>
                    <span className="text-xs text-zinc-500">{timeAgo(run.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Open pull requests (${pullList.length}${pullList.length === 8 ? "+" : ""})`}>
            {pullList.length === 0 ? (
              <p className="text-sm text-zinc-500">No open pull requests.</p>
            ) : (
              <ul className="divide-y divide-line">
                {pullList.map((pull) => (
                  <li key={pull.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="font-mono text-xs text-zinc-500">#{pull.number}</span>
                    <a href={pull.html_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-zinc-200 hover:underline">
                      {pull.title}
                    </a>
                    {pull.draft && <Badge>Draft</Badge>}
                    <span className="text-xs text-zinc-500">@{pull.user?.login}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Open issues">
            {issueList.length === 0 ? (
              <p className="text-sm text-zinc-500">No open issues.</p>
            ) : (
              <ul className="divide-y divide-line">
                {issueList.map((issue) => (
                  <li key={issue.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="font-mono text-xs text-zinc-500">#{issue.number}</span>
                    <a href={issue.html_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-zinc-200 hover:underline">
                      {issue.title}
                    </a>
                    <span className="text-xs text-zinc-500">{timeAgo(issue.updated_at)}</span>
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
