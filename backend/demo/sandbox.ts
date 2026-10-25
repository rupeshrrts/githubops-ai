// Demo mode's pretend GitHub: a sample account ("demo-user") with repositories, issues, pull requests,
// commits and CI runs, plus a fake Octokit that serves them. The real GitHub tools (backend/github/tools.ts)
// run unchanged on top of it, so the demo behaves exactly like the real app, without touching GitHub.
import type { Octokit } from "@octokit/rest";

import type { SandboxView } from "@/backend/types";

export const DEMO_OWNER = "demo-user";

type Issue = { number: number; title: string; state: "open" | "closed"; body: string; comments: number; created_at: string };
type Pull = { number: number; title: string; state: "open" | "closed"; head: string; base: string; draft: boolean; merged: boolean };
type Run = { id: number; name: string; head_branch: string; status: string; conclusion: string | null; created_at: string };
type Commit = { sha: string; message: string; date: string };

export type DemoRepo = {
  id: number;
  name: string;
  description: string;
  private: boolean;
  language: string | null;
  stars: number;
  default_branch: string;
  branches: string[];
  files: Record<string, string>;
  commits: Commit[];
  issues: Issue[];
  pulls: Pull[];
  runs: Run[];
};

export type Sandbox = { owner: string; nextId: number; repos: DemoRepo[] };

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const sha = (seed: number) => (seed * 2654435761).toString(16).padStart(8, "0").repeat(5).slice(0, 40);

export function seedSandbox(): Sandbox {
  return {
    owner: DEMO_OWNER,
    nextId: 1000,
    repos: [
      {
        id: 1,
        name: "portfolio-site",
        description: "Personal portfolio built with Next.js",
        private: false,
        language: "TypeScript",
        stars: 42,
        default_branch: "main",
        branches: ["main", "feature/dark-mode"],
        files: {
          "README.md": "# Portfolio site\n\nMy personal website, built with Next.js and deployed on Vercel.\n",
          "package.json": '{\n  "name": "portfolio-site",\n  "scripts": { "dev": "next dev", "build": "next build" }\n}\n',
        },
        commits: [
          { sha: sha(11), message: "Add projects section", date: hoursAgo(3) },
          { sha: sha(12), message: "Fix mobile navbar", date: hoursAgo(30) },
        ],
        issues: [
          { number: 7, title: "Contact form doesn't send on Safari", state: "open", body: "Clicking Send does nothing on Safari 18.", comments: 2, created_at: hoursAgo(20) },
          { number: 5, title: "Add a blog page", state: "open", body: "", comments: 0, created_at: hoursAgo(80) },
        ],
        pulls: [{ number: 8, title: "Dark mode", state: "open", head: "feature/dark-mode", base: "main", draft: false, merged: false }],
        runs: [
          { id: 101, name: "CI", head_branch: "main", status: "completed", conclusion: "success", created_at: hoursAgo(3) },
          { id: 100, name: "CI", head_branch: "feature/dark-mode", status: "completed", conclusion: "success", created_at: hoursAgo(26) },
        ],
      },
      {
        id: 2,
        name: "api-server",
        description: "REST API for the mobile app (Node.js + Postgres)",
        private: true,
        language: "JavaScript",
        stars: 3,
        default_branch: "main",
        branches: ["main", "fix/auth-timeout"],
        files: { "README.md": "# api-server\n\nBackend for the mobile app.\n" },
        commits: [
          { sha: sha(21), message: "Bump dependencies", date: hoursAgo(1) },
          { sha: sha(22), message: "Add rate limiting", date: hoursAgo(50) },
        ],
        issues: [
          { number: 14, title: "Login times out after 30 seconds", state: "open", body: "Users on slow networks can't log in.", comments: 4, created_at: hoursAgo(10) },
          { number: 12, title: "Add /health endpoint", state: "closed", body: "", comments: 1, created_at: hoursAgo(200) },
        ],
        pulls: [{ number: 15, title: "Fix auth timeout", state: "open", head: "fix/auth-timeout", base: "main", draft: false, merged: false }],
        runs: [
          { id: 201, name: "Tests", head_branch: "main", status: "completed", conclusion: "failure", created_at: hoursAgo(1) },
          { id: 200, name: "Tests", head_branch: "fix/auth-timeout", status: "completed", conclusion: "success", created_at: hoursAgo(9) },
        ],
      },
      {
        id: 3,
        name: "ml-notebooks",
        description: "Jupyter notebooks from my machine learning course",
        private: false,
        language: "Python",
        stars: 11,
        default_branch: "main",
        branches: ["main"],
        files: { "README.md": "# ML notebooks\n\nLinear regression, CNNs and transformers.\n" },
        commits: [{ sha: sha(31), message: "Add transformer notebook", date: hoursAgo(120) }],
        issues: [],
        pulls: [],
        runs: [],
      },
      {
        id: 4,
        name: "dotfiles",
        description: "My terminal and editor config",
        private: false,
        language: "Shell",
        stars: 1,
        default_branch: "main",
        branches: ["main"],
        files: { "README.md": "# dotfiles\n" },
        commits: [{ sha: sha(41), message: "Update zsh aliases", date: hoursAgo(400) }],
        issues: [],
        pulls: [],
        runs: [],
      },
    ],
  };
}

export function viewOf(sandbox: Sandbox): SandboxView {
  return {
    owner: sandbox.owner,
    repos: sandbox.repos.map((repo) => ({
      name: repo.name,
      private: repo.private,
      openIssues: repo.issues.filter((issue) => issue.state === "open").length,
      failingCi: repo.runs[0]?.conclusion === "failure",
    })),
  };
}

// ------------------------------------------------------------------ fake Octokit

/** Errors shaped like Octokit's, so the tools' error handling works unchanged. */
function githubError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * A stand-in for Octokit that reads and changes `sandbox` in place. Only the endpoints the tools use exist.
 * Nothing has an html_url: the repositories aren't real, so the tools leave `url` out and the AI shows no links.
 */
export function createFakeOctokit(sandbox: Sandbox): Octokit {
  const find = ({ owner, repo }: { owner: string; repo: string }) => {
    const found = owner === sandbox.owner ? sandbox.repos.find((item) => item.name === repo) : undefined;
    if (!found) throw githubError(404, "Not Found");
    return found;
  };
  const nextId = () => sandbox.nextId++;
  const repoData = (repo: DemoRepo) => ({
    id: repo.id,
    name: repo.name,
    full_name: `${sandbox.owner}/${repo.name}`,
    owner: { login: sandbox.owner },
    private: repo.private,
    description: repo.description,
    language: repo.language,
    stargazers_count: repo.stars,
    default_branch: repo.default_branch,
  });
  const nextNumber = (repo: DemoRepo) =>
    Math.max(0, ...repo.issues.map((issue) => issue.number), ...repo.pulls.map((pull) => pull.number)) + 1;

  const rest = {
    repos: {
      listForAuthenticatedUser: async () => {
        // Most recently pushed first, like the real call with sort: "pushed".
        const latest = (repo: DemoRepo) => repo.commits[0]?.date ?? "";
        const repos = [...sandbox.repos].sort((a, b) => latest(b).localeCompare(latest(a)));
        return { data: repos.map(repoData) };
      },
      get: async (where: { owner: string; repo: string }) => ({ data: repoData(find(where)) }),
      listBranches: async (where: { owner: string; repo: string }) => ({
        data: find(where).branches.map((name) => ({ name })),
      }),
      getContent: async (where: { owner: string; repo: string; path: string; ref?: string }) => {
        const repo = find(where);
        const path = where.path.replace(/^\/+/, "");
        if (!path) {
          return { data: Object.keys(repo.files).map((name) => ({ name, type: "file" })) };
        }
        const content = repo.files[path];
        if (content === undefined) throw githubError(404, "Not Found");
        return {
          data: {
            type: "file",
            path,
            sha: sha(path.length + repo.id),
            content: Buffer.from(content, "utf8").toString("base64"),
          },
        };
      },
      listCommits: async (where: { owner: string; repo: string; per_page?: number }) => {
        const repo = find(where);
        if (!repo.commits.length) throw githubError(409, "Git Repository is empty.");
        return {
          data: repo.commits.slice(0, where.per_page ?? 30).map((commit) => ({
            sha: commit.sha,
            commit: { message: commit.message, author: { name: "Demo User", date: commit.date } },
          })),
        };
      },
      createForAuthenticatedUser: async ({ name, description = "", private: isPrivate = false }: { name: string; description?: string; private?: boolean }) => {
        if (sandbox.repos.some((repo) => repo.name.toLowerCase() === name.toLowerCase())) {
          throw githubError(422, "Repository creation failed: name already exists on this account");
        }
        const repo: DemoRepo = {
          id: nextId(),
          name,
          description,
          private: isPrivate,
          language: null,
          stars: 0,
          default_branch: "main",
          branches: ["main"],
          files: { "README.md": `# ${name}\n\n${description}\n` },
          commits: [{ sha: sha(nextId()), message: "Initial commit", date: new Date().toISOString() }],
          issues: [],
          pulls: [],
          runs: [],
        };
        sandbox.repos.unshift(repo);
        return { data: repoData(repo) };
      },
      update: async (where: { owner: string; repo: string; private?: boolean }) => {
        const repo = find(where);
        if (where.private !== undefined) repo.private = where.private;
        return { data: repoData(repo) };
      },
      delete: async (where: { owner: string; repo: string }) => {
        const repo = find(where);
        sandbox.repos = sandbox.repos.filter((item) => item !== repo);
        return { data: undefined };
      },
      createOrUpdateFileContents: async (where: { owner: string; repo: string; path: string; content: string; message: string; branch?: string }) => {
        const repo = find(where);
        repo.files[where.path] = Buffer.from(where.content, "base64").toString("utf8");
        const commit = { sha: sha(nextId()), message: where.message, date: new Date().toISOString() };
        repo.commits.unshift(commit);
        return { data: { commit: { sha: commit.sha } } };
      },
    },
    issues: {
      listForRepo: async (where: { owner: string; repo: string; state?: string }) => {
        const repo = find(where);
        const state = where.state ?? "open";
        return { data: repo.issues.filter((issue) => state === "all" || issue.state === state) };
      },
      get: async (where: { owner: string; repo: string; issue_number: number }) => {
        const repo = find(where);
        const issue = repo.issues.find((item) => item.number === where.issue_number);
        if (!issue) throw githubError(404, "Not Found");
        return { data: { ...issue, user: { login: sandbox.owner } } };
      },
      create: async (where: { owner: string; repo: string; title: string; body?: string }) => {
        const repo = find(where);
        const issue: Issue = {
          number: nextNumber(repo),
          title: where.title,
          state: "open",
          body: where.body ?? "",
          comments: 0,
          created_at: new Date().toISOString(),
        };
        repo.issues.unshift(issue);
        return { data: { number: issue.number } };
      },
      createComment: async (where: { owner: string; repo: string; issue_number: number }) => {
        const repo = find(where);
        const issue = repo.issues.find((item) => item.number === where.issue_number);
        if (!issue) throw githubError(404, "Not Found");
        issue.comments++;
        return { data: {} };
      },
    },
    pulls: {
      list: async (where: { owner: string; repo: string; state?: string }) => {
        const repo = find(where);
        const state = where.state ?? "open";
        return {
          data: repo.pulls
            .filter((pull) => state === "all" || pull.state === state)
            .map((pull) => ({ ...pull, user: { login: sandbox.owner } })),
        };
      },
      create: async (where: { owner: string; repo: string; title: string; head: string; base: string }) => {
        const repo = find(where);
        if (!repo.branches.includes(where.head)) throw githubError(422, `Validation Failed: no branch named ${where.head}`);
        const pull: Pull = { number: nextNumber(repo), title: where.title, state: "open", head: where.head, base: where.base, draft: false, merged: false };
        repo.pulls.unshift(pull);
        return { data: { number: pull.number } };
      },
      merge: async (where: { owner: string; repo: string; pull_number: number }) => {
        const repo = find(where);
        const pull = repo.pulls.find((item) => item.number === where.pull_number);
        if (!pull) throw githubError(404, "Not Found");
        if (pull.merged) throw githubError(405, "Pull Request is not mergeable");
        Object.assign(pull, { merged: true, state: "closed" });
        const commit = { sha: sha(nextId()), message: `Merge pull request #${pull.number} from ${pull.head}`, date: new Date().toISOString() };
        repo.commits.unshift(commit);
        return { data: { merged: true, sha: commit.sha, message: "Pull Request successfully merged" } };
      },
    },
    git: {
      getRef: async (where: { owner: string; repo: string; ref: string }) => {
        const repo = find(where);
        const branch = where.ref.replace(/^heads\//, "");
        if (!repo.branches.includes(branch)) throw githubError(404, "Not Found");
        return { data: { object: { sha: repo.commits[0]?.sha ?? sha(repo.id) } } };
      },
      createRef: async (where: { owner: string; repo: string; ref: string }) => {
        const repo = find(where);
        const branch = where.ref.replace(/^refs\/heads\//, "");
        if (repo.branches.includes(branch)) throw githubError(422, "Reference already exists");
        repo.branches.push(branch);
        return { data: { ref: where.ref } };
      },
    },
    actions: {
      listWorkflowRunsForRepo: async (where: { owner: string; repo: string }) => {
        const repo = find(where);
        return { data: { workflow_runs: repo.runs } };
      },
    },
  };

  const request = async () => {
    throw githubError(501, "This action isn't available in demo mode. Sign in with GitHub to use it on your real account.");
  };

  return { rest, request } as unknown as Octokit;
}
