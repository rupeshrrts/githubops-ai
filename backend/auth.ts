// Authentication (Auth.js v5): "Sign in with GitHub", sessions stored in Postgres, and what happens on every
// sign-in (remember the GitHub login, assign a first role, and hand the GitHub access to the user's browser).
import PostgresAdapter from "@auth/pg-adapter";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { ensureSchema, getPool } from "@/backend/db";
import { saveGithubKey } from "@/backend/github/key";
import { requestedScopes } from "@/backend/github/scopes";
import { saveGithubSignIn } from "@/backend/store";

// One approval on GitHub's screen is all a user does. The access it grants is put in an encrypted cookie in
// that user's own browser (backend/github/key.ts); the database keeps only who they are.
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  await ensureSchema();
  return {
    adapter: PostgresAdapter(getPool()),
    session: { strategy: "database" },
    providers: [GitHub({ authorization: { params: { scope: requestedScopes().join(" ") } } })],
    // Sign-in problems land back on the home page with ?error=..., which explains them in plain words.
    pages: { signIn: "/", error: "/" },
    callbacks: {
      session({ session, user }) {
        session.user.id = String(user.id);
        return session;
      },
    },
    events: {
      async signIn({ user, account, profile }) {
        if (account?.provider !== "github" || !user.id) return;
        const login = typeof profile?.login === "string" ? profile.login : null;
        await saveGithubSignIn(String(user.id), login, account.providerAccountId);
        if (account.access_token) {
          await saveGithubKey({
            userId: String(user.id),
            token: account.access_token,
            login: login ?? "",
            scopes: account.scope ?? null,
            source: "sign-in",
            savedAt: new Date().toISOString(),
          });
        }
      },
    },
  };
});
