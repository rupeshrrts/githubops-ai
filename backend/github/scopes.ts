// GitHub permissions asked for in the one "Sign in with GitHub" approval. The default grants broad control so
// the agent can do almost anything the user can do on GitHub; the approval cards still guard every write, and
// the access stays in the user's own browser (backend/github/key.ts). Override with GITHUB_SCOPES
// (space-separated). The same list is suggested to users who prefer to create their own key.
export const FULL_ACCESS_SCOPES = [
  "repo", // full control of public and private repositories
  "delete_repo",
  "workflow", // edit GitHub Actions workflow files
  "admin:repo_hook", // repository webhooks
  "admin:org", // organizations, teams and members
  "gist",
  "notifications",
  "user", // profile, emails, follows
  "project", // GitHub Projects
  "write:packages",
  "delete:packages",
];

// A granted scope also covers the narrower scopes listed under it.
const IMPLIES: Record<string, string[]> = {
  repo: ["public_repo", "repo:status", "repo_deployment", "repo:invite", "security_events"],
  "admin:org": ["write:org", "read:org"],
  "write:org": ["read:org"],
  "admin:repo_hook": ["write:repo_hook", "read:repo_hook"],
  "write:repo_hook": ["read:repo_hook"],
  user: ["read:user", "user:email", "user:follow"],
  project: ["read:project"],
  "write:packages": ["read:packages"],
};

export function requestedScopes(): string[] {
  const configured = process.env.GITHUB_SCOPES?.split(/[\s,]+/).filter(Boolean);
  return configured?.length ? configured : FULL_ACCESS_SCOPES;
}

/** GitHub's "new classic key" page with the suggested permissions ticked. */
export function newKeyUrl(scopes: string[] = requestedScopes()): string {
  return `https://github.com/settings/tokens/new?description=GitHubOps%20AI&scopes=${scopes.join(",")}`;
}

/** GitHub's "new fine-grained key" page: the user picks exactly which repositories and permissions. */
export const FINE_GRAINED_KEY_URL = "https://github.com/settings/personal-access-tokens/new";

/** Permissions the deployment asks for that this user's access does not have yet. */
export function missingScopes(granted: string | null, requested: string[] = requestedScopes()): string[] {
  const have = new Set<string>();
  for (const scope of (granted ?? "").split(/[\s,]+/).filter(Boolean)) {
    have.add(scope);
    for (const implied of IMPLIES[scope] ?? []) have.add(implied);
  }
  return requested.filter((scope) => !have.has(scope));
}
