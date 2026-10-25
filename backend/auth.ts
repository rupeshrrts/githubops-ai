// Authentication (Auth.js v5): "Sign in with GitHub", sessions stored in Postgres, and what happens on every
// sign-in (encrypt the token, remember the GitHub login, assign a first role).
import PostgresAdapter from "@auth/pg-adapter";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { ensureSchema, getPool } from "@/backend/db";
import { requestedScopes } from "@/backend/github/scopes";
import { saveGithubSignIn } from "@/backend/store";

// Database sessions keep the GitHub access token in Postgres only; it is never sent to the browser.
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  await ensureSchema();
  return {
    adapter: PostgresAdapter(getPool()),
    session: { strategy: "database" },
    providers: [
      GitHub({
        // One consent screen at sign-in grants everything the agent may need; users configure nothing.
        authorization: { params: { scope: requestedScopes().join(" ") } },
      }),
    ],
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
        await saveGithubSignIn(String(user.id), login, account.providerAccountId, account.access_token, account.scope);
      },
    },
  };
});
