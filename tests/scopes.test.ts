import { afterEach, describe, expect, it, vi } from "vitest";

import { FULL_ACCESS_SCOPES, missingScopes, requestedScopes } from "@/backend/github/scopes";

afterEach(() => vi.unstubAllEnvs());

describe("GitHub scopes", () => {
  it("requests full access by default", () => {
    expect(requestedScopes()).toEqual(FULL_ACCESS_SCOPES);
    expect(requestedScopes()).toEqual(expect.arrayContaining(["repo", "delete_repo", "workflow", "admin:org"]));
  });

  it("lets a deployment narrow the scopes", () => {
    vi.stubEnv("GITHUB_SCOPES", "read:user repo");
    expect(requestedScopes()).toEqual(["read:user", "repo"]);
  });

  it("reports what an older sign-in is missing (GitHub returns comma-separated scopes)", () => {
    expect(missingScopes("repo,read:user", ["repo", "delete_repo", "workflow"])).toEqual(["delete_repo", "workflow"]);
    expect(missingScopes(null, ["repo"])).toEqual(["repo"]);
  });

  it("treats broader scopes as covering narrower ones", () => {
    expect(missingScopes("user,admin:org,repo", ["read:user", "read:org", "public_repo"])).toEqual([]);
    expect(missingScopes(FULL_ACCESS_SCOPES.join(","))).toEqual([]);
  });
});
