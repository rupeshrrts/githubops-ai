// Server actions behind the "Sign in with GitHub" and "Sign out" buttons (their forms post here).
"use server";

import { signIn, signOut } from "@/backend/auth";

export async function signInWithGitHub() {
  await signIn("github", { redirectTo: "/chat" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
