// Each user's GitHub access: the token from their one-click "Sign in with GitHub" approval (or, optionally,
// a key they created on GitHub themselves). It is kept only in that user's browser, in an encrypted HttpOnly
// cookie. The database never stores it, so the portal can use it only while that person is using the site,
// and only for them.
import "server-only";

import { Octokit } from "@octokit/rest";
import { cookies } from "next/headers";

import { decryptSecret, encryptSecret } from "@/backend/crypto";
import { HttpError } from "@/backend/session";

export const KEY_COOKIE = "githubops_key";
const KEY_MAX_AGE = 365 * 24 * 60 * 60; // signing out removes it sooner

export const NO_GITHUB_KEY = "Connect GitHub first: click Connect GitHub (one approval). Your access stays in your browser.";

export type GithubKey = {
  userId: string; // the portal user it belongs to: access saved by someone else on this browser is ignored
  token: string;
  login: string;
  scopes: string | null; // sign-in and classic keys list their permissions; fine-grained keys don't (null)
  source: "sign-in" | "own-key";
  savedAt: string;
};

type Env = Record<string, string | undefined>;

/** Encrypt a key for the cookie. */
export function sealGithubKey(key: GithubKey, env?: Env): string {
  return encryptSecret(JSON.stringify(key), env);
}

/** Decrypt a cookie value; null if it's missing, tampered with, or belongs to another user. */
export function openGithubKey(sealed: string | undefined, userId: string, env?: Env): GithubKey | null {
  if (!sealed) return null;
  try {
    const key = JSON.parse(decryptSecret(sealed, env)) as GithubKey;
    return key.userId === userId && typeof key.token === "string" ? key : null;
  } catch {
    return null; // tampered, or sealed with an older TOKEN_ENCRYPTION_KEY
  }
}

/** The signed-in user's key from this browser's cookie, or null. */
export async function readGithubKey(userId: string): Promise<GithubKey | null> {
  return openGithubKey((await cookies()).get(KEY_COOKIE)?.value, userId);
}

export async function requireGithubKey(userId: string): Promise<GithubKey> {
  const key = await readGithubKey(userId);
  if (!key) throw new HttpError(428, NO_GITHUB_KEY);
  return key;
}

export async function saveGithubKey(key: GithubKey): Promise<void> {
  (await cookies()).set(KEY_COOKIE, sealGithubKey(key), {
    httpOnly: true, // page scripts can't read it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: KEY_MAX_AGE,
  });
}

export async function removeGithubKey(): Promise<void> {
  (await cookies()).delete(KEY_COOKIE);
}

/** Withdraw this app's sign-in access at GitHub (all its tokens for that user). Returns false if GitHub refused. */
export async function revokeGithubGrant(token: string): Promise<boolean> {
  const credentials = Buffer.from(`${process.env.AUTH_GITHUB_ID}:${process.env.AUTH_GITHUB_SECRET}`).toString("base64");
  const response = await fetch(`https://api.github.com/applications/${process.env.AUTH_GITHUB_ID}/grant`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${credentials}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  });
  return response.status === 204 || response.status === 404;
}

/** Keys GitHub issues start like this (classic, fine-grained). */
export function looksLikeGithubKey(value: string): boolean {
  return /^(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})$/.test(value);
}

/**
 * Ask GitHub who a key belongs to. It must be the account the user signed in with, so every action
 * in the audit log really is theirs.
 */
export async function checkGithubKey(
  token: string,
  githubAccountId: string | null,
): Promise<{ login: string; scopes: string | null }> {
  const octokit = new Octokit({ auth: token, userAgent: "githubops-ai" });
  const response = await octokit.rest.users.getAuthenticated().catch((error: { status?: number; message?: string }) => {
    throw new HttpError(
      400,
      error.status === 401
        ? "GitHub didn't accept this key. It may be expired or copied incompletely."
        : `GitHub couldn't check this key: ${error.message ?? "unknown error"}`,
    );
  });
  if (githubAccountId && String(response.data.id) !== githubAccountId) {
    throw new HttpError(400, `This key belongs to @${response.data.login}. Use a key from the account you signed in with.`);
  }
  return { login: response.data.login, scopes: response.headers["x-oauth-scopes"] ?? null };
}
