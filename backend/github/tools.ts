import type { Octokit } from "@octokit/rest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// GitHub actions exposed to the LLM. Read tools run automatically; every tool in
// WRITE_TOOL_NAMES changes GitHub and is held for human approval by the agent.
// Tools return JSON strings; failures come back as {"error": ...} so the LLM can explain them.

export const WRITE_TOOL_NAMES = new Set([
  "create_issue",
  "comment_on_issue",
  "create_branch",
  "create_pull_request",
  "merge_pull_request",
  "update_file",
  "create_repository",
  "update_repository_visibility",
  "delete_repository",
  "github_api_write",
]);

const MAX_FILE_CHARS = 20_000;
const MAX_API_CHARS = 15_000;

/**
 * Validate a REST path for the generic API tools. It must be relative to api.github.com,
 * so a prompt-injected path can never send the user's token to another host.
 */
export function apiPath(path: string, query: Record<string, string | number | boolean> = {}): string {
  const clean = path.trim();
  if (!/^\/[A-Za-z0-9\-._~%/:,+=]*$/.test(clean) || clean.includes("//")) {
    throw new Error('path must be a GitHub REST API path such as "/repos/owner/name/releases" (no host or query string)');
  }
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString();
  return search ? `${clean}?${search}` : clean;
}

function compact(data: unknown) {
  const text = JSON.stringify(data ?? null);
  return text.length > MAX_API_CHARS ? { truncated: true, preview: text.slice(0, MAX_API_CHARS) } : data;
}

type Repo = { owner: string; repo: string };

export function parseRepo(value: string, defaultOwner: string | null): Repo {
  const parts = value.trim().replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length === 1 && parts[0]) {
    if (!defaultOwner) throw new Error("Use owner/repository");
    return { owner: defaultOwner, repo: parts[0] };
  }
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Repository must look like owner/repository");
  return { owner: parts[0], repo: parts[1] };
}

export async function guard(action: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await action());
  } catch (error) {
    const status = (error as { status?: number }).status;
    const message = error instanceof Error ? error.message : String(error);
    if ((status === 403 || status === 429) && /rate limit/i.test(message)) {
      return JSON.stringify({ error: "GitHub rate limit exceeded" });
    }
    return JSON.stringify(status ? { error: `GitHub API ${status}: ${message}`, status } : { error: message });
  }
}

const repoArg = z.string().describe('Repository as "owner/name", or just "name" for the signed-in user\'s repo');
const stateArg = z.enum(["open", "closed", "all"]).default("open");

export function createTools(octokit: Octokit, login: string | null) {
  const target = (repo: string) => parseRepo(repo, login);
  const defaultBranch = async (repo: string) =>
    (await octokit.rest.repos.get(target(repo))).data.default_branch;

  const getRepositories = tool(
    () =>
      guard(async () => {
        const { data } = await octokit.rest.repos.listForAuthenticatedUser({ sort: "updated", per_page: 100 });
        return {
          repositories: data.map((item) => ({
            name: item.name,
            full_name: item.full_name,
            visibility: item.private ? "Private" : "Public",
            url: item.html_url,
          })),
        };
      }),
    {
      name: "get_repositories",
      description: "List repositories visible to the signed-in user (most recently updated first).",
      schema: z.object({}),
    },
  );

  const getIssues = tool(
    ({ repo, state }) =>
      guard(async () => {
        const { data } = await octokit.rest.issues.listForRepo({ ...target(repo), state, per_page: 30 });
        // The issues endpoint also returns pull requests; keep only real issues.
        return {
          issues: data
            .filter((item) => !item.pull_request)
            .map((item) => ({ number: item.number, title: item.title, state: item.state, url: item.html_url })),
        };
      }),
    { name: "get_issues", description: "List issues in a repository.", schema: z.object({ repo: repoArg, state: stateArg }) },
  );

  const getIssue = tool(
    ({ repo, issue_number }) =>
      guard(async () => {
        const { data } = await octokit.rest.issues.get({ ...target(repo), issue_number });
        return {
          number: data.number,
          title: data.title,
          state: data.state,
          body: data.body,
          author: data.user?.login,
          comments: data.comments,
          url: data.html_url,
        };
      }),
    {
      name: "get_issue",
      description: "Get one issue by number, including its body.",
      schema: z.object({ repo: repoArg, issue_number: z.number().int().positive() }),
    },
  );

  const getPullRequests = tool(
    ({ repo, state }) =>
      guard(async () => {
        const { data } = await octokit.rest.pulls.list({ ...target(repo), state, per_page: 30 });
        return {
          pull_requests: data.map((item) => ({
            number: item.number,
            title: item.title,
            state: item.state,
            author: item.user?.login,
            url: item.html_url,
          })),
        };
      }),
    {
      name: "get_pull_requests",
      description: "List pull requests in a repository.",
      schema: z.object({ repo: repoArg, state: stateArg }),
    },
  );

  const getBranches = tool(
    ({ repo }) =>
      guard(async () => {
        const { data } = await octokit.rest.repos.listBranches({ ...target(repo), per_page: 100 });
        return { branches: data.map((item) => item.name) };
      }),
    { name: "get_branches", description: "List branches in a repository.", schema: z.object({ repo: repoArg }) },
  );

  const getFile = tool(
    ({ repo, path, ref }) =>
      guard(async () => {
        const { data } = await octokit.rest.repos.getContent({
          ...target(repo),
          path: path.replace(/^\/+/, ""),
          ...(ref ? { ref } : {}),
        });
        if (Array.isArray(data)) {
          return { directory: path, entries: data.map((item) => ({ name: item.name, type: item.type })) };
        }
        if (data.type !== "file" || !("content" in data)) return { error: `${path} is a ${data.type}, not a file` };
        const content = Buffer.from(data.content, "base64").toString("utf8");
        return {
          path: data.path,
          url: data.html_url,
          content: content.slice(0, MAX_FILE_CHARS),
          truncated: content.length > MAX_FILE_CHARS,
        };
      }),
    {
      name: "get_file",
      description: "Read a text file (or list a directory) from a repository. Empty ref means the default branch.",
      schema: z.object({ repo: repoArg, path: z.string(), ref: z.string().default("") }),
    },
  );

  const getWorkflowRuns = tool(
    ({ repo }) =>
      guard(async () => {
        const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({ ...target(repo), per_page: 10 });
        return {
          workflow_runs: data.workflow_runs.map((run) => ({
            name: run.name,
            branch: run.head_branch,
            status: run.status,
            conclusion: run.conclusion,
            created_at: run.created_at,
            url: run.html_url,
          })),
        };
      }),
    {
      name: "get_workflow_runs",
      description: "List the latest GitHub Actions workflow runs with status and conclusion.",
      schema: z.object({ repo: repoArg }),
    },
  );

  const getLatestCommit = tool(
    ({ repo }) =>
      guard(async () => {
        const repos = repo
          ? [target(repo)]
          : (await octokit.rest.repos.listForAuthenticatedUser({ sort: "pushed", direction: "desc", per_page: 10 })).data.map(
              (item) => ({ owner: item.owner.login, repo: item.name }),
            );
        const latest = await Promise.all(
          repos.map(async (item) => {
            try {
              const { data } = await octokit.rest.repos.listCommits({ ...item, per_page: 1 });
              const commit = data[0];
              if (!commit) return null;
              return {
                repository: `${item.owner}/${item.repo}`,
                message: (commit.commit.message ?? "").split("\n")[0],
                author: commit.commit.author?.name,
                date: commit.commit.author?.date ?? "",
                sha: commit.sha.slice(0, 7),
                url: commit.html_url,
              };
            } catch {
              return null; // empty repositories return 409
            }
          }),
        );
        const found = latest.filter((item) => item !== null).sort((a, b) => b.date.localeCompare(a.date));
        return { latest_commit: found[0] ?? null, repositories_checked: repos.length };
      }),
    {
      name: "get_latest_commit",
      description:
        'Find the user\'s latest commit / last push ("last commit kya tha", "kis repo me push kiya"). ' +
        "Pass repo to check one repository; leave it empty to search recently pushed repositories.",
      schema: z.object({ repo: z.string().default("") }),
    },
  );

  const createIssue = tool(
    ({ repo, title, body }) =>
      guard(async () => {
        const { data } = await octokit.rest.issues.create({ ...target(repo), title, body });
        return { number: data.number, url: data.html_url };
      }),
    {
      name: "create_issue",
      description: "Create an issue. Requires human approval.",
      schema: z.object({ repo: repoArg, title: z.string().min(1), body: z.string().default("") }),
    },
  );

  const commentOnIssue = tool(
    ({ repo, issue_number, comment }) =>
      guard(async () => {
        const { data } = await octokit.rest.issues.createComment({ ...target(repo), issue_number, body: comment });
        return { url: data.html_url };
      }),
    {
      name: "comment_on_issue",
      description: "Comment on an issue or pull request. Requires human approval.",
      schema: z.object({ repo: repoArg, issue_number: z.number().int().positive(), comment: z.string().min(1) }),
    },
  );

  const createBranch = tool(
    ({ repo, branch, from_branch }) =>
      guard(async () => {
        const source = from_branch || (await defaultBranch(repo));
        const { data: base } = await octokit.rest.git.getRef({ ...target(repo), ref: `heads/${source}` });
        const { data } = await octokit.rest.git.createRef({
          ...target(repo),
          ref: `refs/heads/${branch}`,
          sha: base.object.sha,
        });
        return { ref: data.ref, from: source };
      }),
    {
      name: "create_branch",
      description: "Create a branch from from_branch (empty means the default branch). Requires human approval.",
      schema: z.object({ repo: repoArg, branch: z.string().min(1), from_branch: z.string().default("") }),
    },
  );

  const createPullRequest = tool(
    ({ repo, title, head, base, body }) =>
      guard(async () => {
        const { data } = await octokit.rest.pulls.create({
          ...target(repo),
          title,
          head,
          base: base || (await defaultBranch(repo)),
          body,
        });
        return { number: data.number, url: data.html_url };
      }),
    {
      name: "create_pull_request",
      description: "Open a pull request from head into base (empty base means the default branch). Requires approval.",
      schema: z.object({
        repo: repoArg,
        title: z.string().min(1),
        head: z.string().min(1),
        base: z.string().default(""),
        body: z.string().default(""),
      }),
    },
  );

  const mergePullRequest = tool(
    ({ repo, pull_number, merge_method }) =>
      guard(async () => {
        const { data } = await octokit.rest.pulls.merge({ ...target(repo), pull_number, merge_method });
        return { merged: data.merged, sha: data.sha, message: data.message };
      }),
    {
      name: "merge_pull_request",
      description: "Merge a pull request with merge, squash, or rebase. Requires human approval.",
      schema: z.object({
        repo: repoArg,
        pull_number: z.number().int().positive(),
        merge_method: z.enum(["merge", "squash", "rebase"]).default("merge"),
      }),
    },
  );

  const updateFile = tool(
    ({ repo, path, content, message, branch }) =>
      guard(async () => {
        const where = { ...target(repo), path: path.replace(/^\/+/, "") };
        const ref = branch || (await defaultBranch(repo));
        let sha: string | undefined;
        try {
          const { data } = await octokit.rest.repos.getContent({ ...where, ref });
          if (!Array.isArray(data) && "sha" in data) sha = data.sha;
        } catch (error) {
          // 404 means the file does not exist yet, so this request creates it.
          if ((error as { status?: number }).status !== 404) throw error;
        }
        const { data } = await octokit.rest.repos.createOrUpdateFileContents({
          ...where,
          message,
          branch: ref,
          content: Buffer.from(content, "utf8").toString("base64"),
          ...(sha ? { sha } : {}),
        });
        return { created: !sha, commit: data.commit.html_url };
      }),
    {
      name: "update_file",
      description:
        "Create or update a file with the given full content. Empty branch means the default branch. Requires approval.",
      schema: z.object({
        repo: repoArg,
        path: z.string().min(1),
        content: z.string(),
        message: z.string().min(1),
        branch: z.string().default(""),
      }),
    },
  );

  const createRepository = tool(
    ({ name, description, private: isPrivate }) =>
      guard(async () => {
        const { data } = await octokit.rest.repos.createForAuthenticatedUser({
          name,
          description,
          private: isPrivate,
        });
        return { full_name: data.full_name, url: data.html_url, visibility: data.private ? "Private" : "Public" };
      }),
    {
      name: "create_repository",
      description: "Create a repository in the signed-in user's account. Requires human approval.",
      schema: z.object({
        name: z.string().min(1).max(100).regex(/^[^/]+$/, "Repository name cannot contain '/'"),
        description: z.string().default(""),
        private: z.boolean().default(false),
      }),
    },
  );

  const updateRepositoryVisibility = tool(
    ({ repo, private: isPrivate }) =>
      guard(async () => {
        const { data } = await octokit.rest.repos.update({ ...target(repo), private: isPrivate });
        return { full_name: data.full_name, visibility: data.private ? "Private" : "Public" };
      }),
    {
      name: "update_repository_visibility",
      description: "Change a repository between public and private. Requires human approval.",
      schema: z.object({ repo: repoArg, private: z.boolean() }),
    },
  );

  const deleteRepository = tool(
    ({ repo }) =>
      guard(async () => {
        await octokit.rest.repos.delete(target(repo));
        return { deleted: `${target(repo).owner}/${target(repo).repo}` };
      }),
    {
      name: "delete_repository",
      description: "Permanently delete a repository. Requires human approval.",
      schema: z.object({ repo: repoArg }),
    },
  );

  // General-purpose access to the whole GitHub REST API, for anything the tools above don't cover.
  const githubApiRead = tool(
    ({ path, query }) =>
      guard(async () => {
        const response = await octokit.request(`GET ${apiPath(path, query)}`);
        return { status: response.status, data: compact(response.data) };
      }),
    {
      name: "github_api_read",
      description:
        "Call any GitHub REST API endpoint with GET when no specific tool fits. Examples: /user/starred, " +
        "/repos/OWNER/REPO/releases, /repos/OWNER/REPO/compare/main...dev, /search/repositories (query: {q}), " +
        "/notifications, /orgs/ORG/members. Use real values, not placeholders.",
      schema: z.object({
        path: z.string().describe("REST path starting with /, without host or query string"),
        query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      }),
    },
  );

  const githubApiWrite = tool(
    ({ method, path, body }) =>
      guard(async () => {
        // `data` sends the object as the JSON body and keeps it from overriding request options.
        const response = await octokit.request(`${method} ${apiPath(path)}`, Object.keys(body).length ? { data: body } : {});
        return { status: response.status, data: compact(response.data) };
      }),
    {
      name: "github_api_write",
      description:
        "Call any GitHub REST API endpoint that changes data (POST, PUT, PATCH, DELETE) when no specific tool fits. " +
        "Examples: POST /repos/OWNER/REPO/releases, PUT /user/starred/OWNER/REPO, POST /repos/OWNER/REPO/labels, " +
        "PATCH /repos/OWNER/REPO/issues/NUMBER (close an issue), PUT /repos/OWNER/REPO/collaborators/USER. " +
        "Requires human approval.",
      schema: z.object({
        method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().describe("REST path starting with /, without host or query string"),
        body: z.record(z.string(), z.unknown()).default({}),
      }),
    },
  );

  return [
    getRepositories,
    getIssues,
    getIssue,
    getPullRequests,
    getBranches,
    getFile,
    getWorkflowRuns,
    getLatestCommit,
    createIssue,
    commentOnIssue,
    createBranch,
    createPullRequest,
    mergePullRequest,
    updateFile,
    createRepository,
    updateRepositoryVisibility,
    deleteRepository,
    githubApiRead,
    githubApiWrite,
  ];
}
