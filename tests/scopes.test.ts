import { afterEach, describe, expect, it, vi } from "vitest";

import { FULL_ACCESS_SCOPES, missingScopes, newKeyUrl, requestedScopes } from "@/backend/github/scopes";

afterEach(() => vi.unstubAllEnvs());

describe("GitHub permissions", () => {
  it("asks for full access in the one sign-in approval, and suggests the same for a user's own key", () => {
    expect(requestedScopes()).toEqual(FULL_ACCESS_SCOPES);
    expect(requestedScopes()).toEqual(expect.arrayContaining(["repo", "delete_repo", "workflow", "admin:org"]));
    expect(newKeyUrl(["repo", "workflow"])).toBe(
      "https://github.com/settings/tokens/new?description=GitHubOps%20AI&scopes=repo,workflow",
    );
  });

  it("lets a deployment narrow the suggestion", () => {
    vi.stubEnv("GITHUB_SCOPES", "read:user repo");
    expect(requestedScopes()).toEqual(["read:user", "repo"]);
  });

  it("reports what someone's access is missing (GitHub returns comma-separated scopes)", () => {
    expect(missingScopes("repo, read:user", ["repo", "delete_repo", "workflow"])).toEqual(["delete_repo", "workflow"]);
    expect(missingScopes(null, ["repo"])).toEqual(["repo"]);
  });

  it("treats broader scopes as covering narrower ones", () => {
    expect(missingScopes("user,admin:org,repo", ["read:user", "read:org", "public_repo"])).toEqual([]);
    expect(missingScopes(FULL_ACCESS_SCOPES.join(","))).toEqual([]);
  });
});
