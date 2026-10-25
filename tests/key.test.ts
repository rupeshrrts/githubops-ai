// The user's GitHub access, as it is sealed into (and opened from) their browser cookie.
import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/backend/session", () => ({ HttpError: class extends Error {} }));

const { looksLikeGithubKey, openGithubKey, sealGithubKey } = await import("@/backend/github/key");

const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
const key = {
  userId: "7",
  token: `gho_${"a".repeat(36)}`,
  login: "mia",
  scopes: "repo,workflow",
  source: "sign-in" as const,
  savedAt: "2026-10-25T00:00:00Z",
};

describe("GitHub key cookie", () => {
  it("is encrypted and opens only for the user it belongs to", () => {
    const sealed = sealGithubKey(key, env);
    expect(sealed).not.toContain(key.token);
    expect(openGithubKey(sealed, "7", env)).toEqual(key);
    expect(openGithubKey(sealed, "8", env)).toBeNull(); // someone else signed in on this browser
  });

  it("ignores missing, tampered or foreign cookies", () => {
    const sealed = sealGithubKey(key, env);
    const at = sealed.lastIndexOf(".") + 1;
    const tampered = sealed.slice(0, at) + (sealed[at] === "A" ? "B" : "A") + sealed.slice(at + 1);
    expect(openGithubKey(undefined, "7", env)).toBeNull();
    expect(openGithubKey(tampered, "7", env)).toBeNull();
    expect(openGithubKey(sealed, "7", { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") })).toBeNull();
    expect(openGithubKey("not-a-cookie", "7", env)).toBeNull();
  });

  it("accepts the two kinds of keys a user can create and paste, and nothing else", () => {
    expect(looksLikeGithubKey(`ghp_${"A1".repeat(18)}`)).toBe(true);
    expect(looksLikeGithubKey(`github_pat_${"11ABC_".repeat(14)}`)).toBe(true);
    expect(looksLikeGithubKey("gho_oauth_token_from_somewhere")).toBe(false);
    expect(looksLikeGithubKey("my password")).toBe(false);
    expect(looksLikeGithubKey("")).toBe(false);
  });
});
