// Server actions behind the "Sign in with GitHub" / "Connect GitHub" and "Sign out" buttons (their forms post here).
"use server";

import { signIn, signOut } from "@/backend/auth";
import { removeGithubKey } from "@/backend/github/key";

export async function signInWithGitHub() {
  await signIn("github", { redirectTo: "/chat" });
}

/** Signing out also removes the user's GitHub access from this browser; signing in again restores it. */
export async function signOutAction() {
  await removeGithubKey();
  await signOut({ redirectTo: "/" });
}
