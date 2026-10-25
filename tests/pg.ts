// In-process Postgres (PGlite, WebAssembly) loaded with the real database/setup.sql.
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

export const SETUP_SQL = readFileSync(new URL("../database/setup.sql", import.meta.url), "utf8");

export async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SETUP_SQL);
  return db;
}

const DATA_TABLES = [
  "users", "accounts", "sessions", "verification_token", "user_profiles", "user_roles", "user_permission_overrides",
  "conversations", "messages", "approval_requests", "audit_log", "github_repositories", "sync_runs", "usage_daily",
  "demo_sessions",
];

/** Empty every data table but keep the seeded roles and permissions (much faster than a new database). */
export async function resetDatabase(db: PGlite): Promise<void> {
  await db.exec(`TRUNCATE ${DATA_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

/** Same contract as backend/db.ts `query`, backed by PGlite. */
export function queryVia(db: () => PGlite) {
  return async (text: string, params: unknown[] = []) => (await db().query(text, params)).rows;
}

export async function addUser(db: PGlite, login: string, role?: string): Promise<string> {
  const { rows } = await db.query<{ id: number }>("INSERT INTO users (name) VALUES ($1) RETURNING id", [login]);
  const id = String(rows[0].id);
  await db.query("INSERT INTO user_profiles (user_id, github_login, last_seen_at) VALUES ($1, $2, now())", [id, login]);
  if (role) await db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, $2)", [id, role]);
  return id;
}
