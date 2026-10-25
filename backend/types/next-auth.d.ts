// Tells TypeScript that session.user has an id (it is added in backend/auth.ts).
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
