import type { Octokit } from "@octokit/rest";

import { query } from "@/backend/db";
import type { SyncedRepo } from "@/backend/types";

// Repositories are mirrored into Postgres so the portal can list and search them instantly.
// Sync runs on demand, automatically on first visit, and from the daily Vercel cron.

const MAX_REPOS = 1000;

export type SyncRun = { status: "running" | "success" | "error"; repositories: number; error: string; finishedAt: string | null; startedAt: string };

export async function syncRepositories(
  userId: string,
  octokit: Octokit,
  trigger: "manual" | "auto" | "cron",
): Promise<{ repositories: number }> {
  const [run] = await query<{ id: string }>(
    "INSERT INTO sync_runs (user_id, trigger, status) VALUES ($1, $2, 'running') RETURNING id::text",
    [userId, trigger],
  );
  try {
    const repos: Record<string, unknown>[] = [];
    for await (const page of octokit.paginate.iterator(octokit.rest.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort: "pushed",
    })) {
      repos.push(...page.data);
      if (repos.length >= MAX_REPOS) break;
    }
    const rows = repos.slice(0, MAX_REPOS).map((repo) => {
      const owner = repo.owner as { login: string };
      return {
        github_id: repo.id,
        full_name: repo.full_name,
        owner: owner.login,
        name: repo.name,
        private: repo.private,
        archived: repo.archived ?? false,
        fork: repo.fork ?? false,
        description: repo.description ?? null,
        language: repo.language ?? null,
        default_branch: repo.default_branch ?? null,
        stars: repo.stargazers_count ?? 0,
        open_issues: repo.open_issues_count ?? 0,
        html_url: repo.html_url,
        pushed_at: repo.pushed_at ?? null,
      };
    });

    // One round trip for the whole list instead of one INSERT per repository.
    await query(
      `INSERT INTO github_repositories (user_id, github_id, full_name, owner, name, private, archived, fork,
         description, language, default_branch, stars, open_issues, html_url, pushed_at, synced_at)
       SELECT $1, x.github_id, x.full_name, x.owner, x.name, x.private, x.archived, x.fork, x.description,
              x.language, x.default_branch, x.stars, x.open_issues, x.html_url, x.pushed_at, now()
       FROM json_to_recordset($2::json) AS x(github_id BIGINT, full_name TEXT, owner TEXT, name TEXT, private BOOLEAN,
         archived BOOLEAN, fork BOOLEAN, description TEXT, language TEXT, default_branch TEXT, stars INTEGER,
         open_issues INTEGER, html_url TEXT, pushed_at TIMESTAMPTZ)
       ON CONFLICT (user_id, github_id) DO UPDATE SET full_name = EXCLUDED.full_name, owner = EXCLUDED.owner,
         name = EXCLUDED.name, private = EXCLUDED.private, archived = EXCLUDED.archived, fork = EXCLUDED.fork,
         description = EXCLUDED.description, language = EXCLUDED.language, default_branch = EXCLUDED.default_branch,
         stars = EXCLUDED.stars, open_issues = EXCLUDED.open_issues, html_url = EXCLUDED.html_url,
         pushed_at = EXCLUDED.pushed_at, synced_at = now()`,
      [userId, JSON.stringify(rows)],
    );
    // Repositories the user deleted or lost access to disappear from the mirror.
    await query("DELETE FROM github_repositories WHERE user_id = $1 AND NOT (github_id = ANY($2::bigint[]))", [
      userId,
      rows.map((row) => String(row.github_id)),
    ]);
    await query("UPDATE sync_runs SET status = 'success', repositories = $2, finished_at = now() WHERE id = $1", [
      run.id,
      rows.length,
    ]);
    return { repositories: rows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query("UPDATE sync_runs SET status = 'error', error = $2, finished_at = now() WHERE id = $1", [
      run.id,
      message.slice(0, 500),
    ]);
    throw error;
  }
}

export async function listRepositories(userId: string): Promise<SyncedRepo[]> {
  return query<SyncedRepo>(
    `SELECT github_id::text AS "githubId", full_name AS "fullName", owner, name, private, archived, fork, description,
            language, default_branch AS "defaultBranch", stars, open_issues AS "openIssues", html_url AS "htmlUrl",
            pushed_at::text AS "pushedAt"
     FROM github_repositories WHERE user_id = $1 ORDER BY pushed_at DESC NULLS LAST`,
    [userId],
  );
}

export async function lastSync(userId: string): Promise<SyncRun | null> {
  const rows = await query<SyncRun>(
    `SELECT status, repositories, error, started_at::text AS "startedAt", finished_at::text AS "finishedAt"
     FROM sync_runs WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** Users the cron job should refresh: connected, enabled, not synced successfully in `hours`. */
export async function usersDueForSync(limit: number, hours = 20): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    `SELECT p.user_id FROM user_profiles p
     WHERE NOT p.disabled
       AND EXISTS (SELECT 1 FROM accounts a WHERE a."userId"::text = p.user_id AND a.provider = 'github'
                   AND a.access_token IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM sync_runs s WHERE s.user_id = p.user_id AND s.status = 'success'
                       AND s.started_at > now() - make_interval(hours => $2))
     ORDER BY p.last_seen_at DESC NULLS LAST LIMIT $1`,
    [limit, hours],
  );
  return rows.map((row) => row.user_id);
}
