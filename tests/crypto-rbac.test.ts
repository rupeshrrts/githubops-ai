import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, isEncrypted } from "@/backend/crypto";
import { type Access, allowedTools, type Permission, policyFor, riskOf } from "@/backend/rbac";

const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") };

describe("token encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const stored = encryptSecret("gho_secret", env);
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain("gho_secret");
    expect(decryptSecret(stored, env)).toBe("gho_secret");
    expect(encryptSecret("gho_secret", env)).not.toBe(stored); // random IV
  });

  it("detects tampering and wrong keys", () => {
    const stored = encryptSecret("gho_secret", env);
    const tampered = stored.slice(0, -2) + (stored.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(tampered, env)).toThrow();
    expect(() => decryptSecret(stored, { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") })).toThrow();
  });

  it("refuses a missing or short key", () => {
    expect(() => encryptSecret("x", {})).toThrow("TOKEN_ENCRYPTION_KEY is not set");
    expect(() => encryptSecret("x", { TOKEN_ENCRYPTION_KEY: "c2hvcnQ=" })).toThrow("32 bytes");
  });
});

const access = (...permissions: Permission[]): Access => ({ role: "test", permissions: new Set(permissions) });

describe("risk and policy", () => {
  it("classifies tools by risk", () => {
    expect(riskOf("get_issues")).toBe("read");
    expect(riskOf("github_api_read")).toBe("read");
    expect(riskOf("create_issue")).toBe("write");
    expect(riskOf("github_api_write", { method: "POST" })).toBe("write");
    expect(riskOf("github_api_write", { method: "DELETE" })).toBe("sensitive");
    expect(riskOf("merge_pull_request")).toBe("sensitive");
    expect(riskOf("delete_repository")).toBe("sensitive");
  });

  it("sends sensitive actions to review unless the user is a reviewer", () => {
    const member = access("github.read", "github.write", "github.sensitive");
    expect(policyFor(member, { name: "delete_repository", args: {} })).toEqual({ risk: "sensitive", allowed: true, needsReview: true });
    expect(policyFor(member, { name: "create_issue", args: {} })).toEqual({ risk: "write", allowed: true, needsReview: false });
    const admin = access("github.read", "github.write", "github.sensitive", "approvals.review");
    expect(policyFor(admin, { name: "delete_repository", args: {} }).needsReview).toBe(false);
    expect(policyFor(access("github.read"), { name: "create_issue", args: {} }).allowed).toBe(false);
  });

  it("only binds tools the user may use", () => {
    const tools = ["get_issues", "create_issue", "delete_repository", "github_api_read", "github_api_write"].map((name) => ({ name }));
    const names = (a: Access) => allowedTools(tools, a).map((item) => item.name);
    expect(names(access("github.read"))).toEqual(["get_issues", "github_api_read"]);
    expect(names(access("github.read", "github.write"))).toEqual(["get_issues", "create_issue", "github_api_read", "github_api_write"]);
    expect(names(access("github.read", "github.write", "github.sensitive"))).toHaveLength(5);
  });
});
