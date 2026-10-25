// Who is signed in, and what may they do? Every page and API route starts by calling currentUser() or
// requireUser(permission) from here.
import "server-only";

import { cache } from "react";

import { auth } from "@/backend/auth";
import { type Access, can, getAccess, type Permission } from "@/backend/rbac";
import { getGithubLogin, isDisabled } from "@/backend/store";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const REQUIRED_ENV = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "NVIDIA_API_KEY",
];

/** Environment variables the deployment still needs; shown on the landing page instead of a crash. */
export function missingConfig(): string[] {
  return REQUIRED_ENV.filter((name) => !process.env[name]);
}

export type SessionUser = {
  id: string;
  name: string | null;
  image: string | null;
  login: string | null;
  access: Access;
};

/** The signed-in, enabled user with their role and permissions (memoized per request). */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  if (missingConfig().length) return null;
  const session = await auth();
  const id = session?.user?.id;
  if (!id || (await isDisabled(id))) return null;
  const [access, login] = await Promise.all([getAccess(id), getGithubLogin(id)]);
  return { id, name: session.user.name ?? null, image: session.user.image ?? null, login, access };
});

export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in with GitHub first.");
  if (permission && !can(user.access, permission)) {
    throw new HttpError(403, `Your role (${user.access.role}) doesn't allow this. Ask an admin for access.`);
  }
  return user;
}
