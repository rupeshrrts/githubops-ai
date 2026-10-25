// Human-readable names for write actions, shared by the approval card and the audit log.
export const ACTION_LABELS: Record<string, string> = {
  create_issue: "Create issue",
  comment_on_issue: "Comment on issue",
  create_branch: "Create branch",
  create_pull_request: "Open pull request",
  merge_pull_request: "Merge pull request",
  update_file: "Commit file change",
  create_repository: "Create repository",
  update_repository_visibility: "Change repository visibility",
  delete_repository: "Delete repository",
  github_api_write: "GitHub API request",
};

export const WRITE_ACTIONS = new Set(Object.keys(ACTION_LABELS));

export function targetOf(args: Record<string, unknown>): string {
  if (args.method && args.path) return `${args.method} ${args.path}`;
  return String(args.repo ?? args.name ?? "");
}
