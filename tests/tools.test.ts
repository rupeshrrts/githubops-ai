import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";

import { createTools, guard, parseRepo, WRITE_TOOL_NAMES } from "@/backend/github/tools";

function notFound() {
  return Object.assign(new Error("Not Found"), { status: 404 });
}

function fakeOctokit() {
  const rest = {
    repos: {
      listForAuthenticatedUser: vi.fn(),
      get: vi.fn(async () => ({ data: { default_branch: "master" } })),
      getContent: vi.fn(),
      createOrUpdateFileContents: vi.fn(async (_params: Record<string, unknown>) => ({
        data: { commit: { html_url: "https://github.com/c/1" } },
      })),
      listCommits: vi.fn(),
      delete: vi.fn(),
    },
    issues: { listForRepo: vi.fn() },
    git: {
      getRef: vi.fn(async () => ({ data: { object: { sha: "abc" } } })),
      createRef: vi.fn(async () => ({ data: { ref: "refs/heads/feature" } })),
    },
  };
  const request = vi.fn();
  return { rest, request, octokit: { rest, request } as unknown as Octokit };
}

function toolsFor(octokit: Octokit): Record<string, StructuredToolInterface> {
  return Object.fromEntries(createTools(octokit, "octo").map((item) => [item.name, item as StructuredToolInterface]));
}

const run = async (tools: Record<string, StructuredToolInterface>, name: string, args: Record<string, unknown>) =>
  JSON.parse(String(await tools[name].invoke(args)));

describe("parseRepo", () => {
  it("accepts owner/name and bare names", () => {
    expect(parseRepo("me/app", "octo")).toEqual({ owner: "me", repo: "app" });
    expect(parseRepo(" /app/ ", "octo")).toEqual({ owner: "octo", repo: "app" });
  });

  it("rejects malformed repositories", () => {
    expect(() => parseRepo("a/b/c", "octo")).toThrow();
    expect(() => parseRepo("app", null)).toThrow("owner/repository");
  });
});

describe("guard", () => {
  it("turns GitHub errors into an error payload", async () => {
    expect(JSON.parse(await guard(async () => Promise.reject(notFound())))).toEqual({
      error: "GitHub API 404: Not Found",
      status: 404,
    });
  });

  it("recognises rate limiting", async () => {
    const limited = Object.assign(new Error("API rate limit exceeded"), { status: 403 });
    expect(JSON.parse(await guard(async () => Promise.reject(limited)))).toEqual({ error: "GitHub rate limit exceeded" });
  });
});

describe("GitHub tools", () => {
  it("classifies every write tool and only write tools", () => {
    const names = createTools(fakeOctokit().octokit, "octo").map((item) => item.name);
    expect(names).toHaveLength(19);
    const reads = new Set(["github_api_read", ...names.filter((name) => name.startsWith("get_"))]);
    for (const name of names) expect(WRITE_TOOL_NAMES.has(name)).toBe(!reads.has(name));
  });

  it("calls any read endpoint with a query string", async () => {
    const { octokit, request } = fakeOctokit();
    request.mockResolvedValue({ status: 200, data: [{ tag_name: "v1" }] });
    const result = await run(toolsFor(octokit), "github_api_read", {
      path: "/search/repositories",
      query: { q: "langgraph", per_page: 5 },
    });
    expect(request).toHaveBeenCalledWith("GET /search/repositories?q=langgraph&per_page=5");
    expect(result).toEqual({ status: 200, data: [{ tag_name: "v1" }] });
  });

  it("sends write bodies as data so they cannot override request options", async () => {
    const { octokit, request } = fakeOctokit();
    request.mockResolvedValue({ status: 201, data: { id: 1 } });
    const body = { tag_name: "v1.0.0", baseUrl: "https://evil.example" };
    await run(toolsFor(octokit), "github_api_write", { method: "POST", path: "/repos/octo/app/releases", body });
    expect(request).toHaveBeenCalledWith("POST /repos/octo/app/releases", { data: body });
  });

  it.each(["https://evil.example/x", "//evil.example/x", "repos/octo/app", "/repos/{owner}/app", "/x?y=1"])(
    "rejects unsafe API path %s",
    async (path) => {
      const { octokit, request } = fakeOctokit();
      const result = await run(toolsFor(octokit), "github_api_read", { path });
      expect(result.error).toMatch(/GitHub REST API path/);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("truncates very large API responses", async () => {
    const { octokit, request } = fakeOctokit();
    request.mockResolvedValue({ status: 200, data: { blob: "x".repeat(50_000) } });
    const result = await run(toolsFor(octokit), "github_api_read", { path: "/user" });
    expect(result.data.truncated).toBe(true);
    expect(result.data.preview.length).toBe(15_000);
  });

  it("lists repositories with visibility", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.listForAuthenticatedUser.mockResolvedValue({
      data: [
        { name: "a", full_name: "octo/a", private: true, html_url: "u1" },
        { name: "b", full_name: "octo/b", private: false, html_url: "u2" },
      ],
    });
    const result = await run(toolsFor(octokit), "get_repositories", {});
    expect(result.repositories.map((repo: { visibility: string }) => repo.visibility)).toEqual(["Private", "Public"]);
  });

  it("filters pull requests out of the issue list", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.issues.listForRepo.mockResolvedValue({
      data: [
        { number: 1, title: "Bug", state: "open", html_url: "i1" },
        { number: 2, title: "PR", state: "open", html_url: "i2", pull_request: {} },
      ],
    });
    const result = await run(toolsFor(octokit), "get_issues", { repo: "app" });
    expect(result.issues).toEqual([{ number: 1, title: "Bug", state: "open", url: "i1" }]);
    expect(rest.issues.listForRepo).toHaveBeenCalledWith(expect.objectContaining({ owner: "octo", repo: "app" }));
  });

  it("finds the newest commit across repositories and skips empty ones", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.listForAuthenticatedUser.mockResolvedValue({
      data: [
        { name: "old", owner: { login: "octo" } },
        { name: "new", owner: { login: "octo" } },
        { name: "empty", owner: { login: "octo" } },
      ],
    });
    rest.repos.listCommits.mockImplementation(async ({ repo }: { repo: string }) => {
      if (repo === "empty") throw Object.assign(new Error("Git Repository is empty."), { status: 409 });
      const date = repo === "new" ? "2026-05-01T00:00:00Z" : "2026-01-01T00:00:00Z";
      return {
        data: [{ sha: `${repo}1234567`, html_url: repo, commit: { message: `${repo} work\n\nbody`, author: { date } } }],
      };
    });
    const result = await run(toolsFor(octokit), "get_latest_commit", {});
    expect(result.latest_commit).toMatchObject({ repository: "octo/new", message: "new work", sha: "new1234" });
    expect(result.repositories_checked).toBe(3);
  });

  it("creates branches from the repository's real default branch", async () => {
    const { rest, octokit } = fakeOctokit();
    await run(toolsFor(octokit), "create_branch", { repo: "app", branch: "feature" });
    expect(rest.git.getRef).toHaveBeenCalledWith({ owner: "octo", repo: "app", ref: "heads/master" });
    expect(rest.git.createRef).toHaveBeenCalledWith({
      owner: "octo",
      repo: "app",
      ref: "refs/heads/feature",
      sha: "abc",
    });
  });

  it("creates a file that does not exist yet", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.getContent.mockRejectedValue(notFound());
    const result = await run(toolsFor(octokit), "update_file", {
      repo: "app",
      path: "docs/new.md",
      content: "hi",
      message: "add",
    });
    expect(result.created).toBe(true);
    const request = rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    expect(request).not.toHaveProperty("sha");
    expect(Buffer.from(String(request.content), "base64").toString()).toBe("hi");
    expect(request.branch).toBe("master");
  });

  it("updates an existing file with its sha", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.getContent.mockResolvedValue({ data: { type: "file", sha: "s1" } });
    await run(toolsFor(octokit), "update_file", { repo: "app", path: "a.txt", content: "x", message: "m", branch: "dev" });
    expect(rest.repos.createOrUpdateFileContents.mock.calls[0][0]).toMatchObject({ sha: "s1", branch: "dev" });
  });
});
