// Demo sessions in Postgres: each visitor's pretend GitHub account and chat, kept for 24 hours.
import { randomUUID } from "node:crypto";

import { query } from "@/backend/db";
import { type Sandbox, seedSandbox } from "@/backend/demo/sandbox";
import type { ChatMessage } from "@/backend/types";

export const DEMO_TTL_HOURS = 24;

export type DemoSession = { id: string; visitor: string; sandbox: Sandbox; messages: ChatMessage[] };

export async function createDemoSession(visitor: string): Promise<DemoSession> {
  const session: DemoSession = { id: randomUUID(), visitor, sandbox: seedSandbox(), messages: [] };
  await query("INSERT INTO demo_sessions (id, visitor, sandbox) VALUES ($1, $2, $3)", [
    session.id,
    visitor,
    JSON.stringify(session.sandbox),
  ]);
  return session;
}

/** A live (not expired) demo session, or null. */
export async function getDemoSession(id: string | undefined): Promise<DemoSession | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await query<DemoSession>(
    `SELECT id::text, visitor, sandbox, messages FROM demo_sessions
     WHERE id = $1 AND created_at > now() - make_interval(hours => $2)`,
    [id, DEMO_TTL_HOURS],
  );
  return rows[0] ?? null;
}

export async function saveDemoSession(session: DemoSession): Promise<void> {
  await query("UPDATE demo_sessions SET sandbox = $2, messages = $3, updated_at = now() WHERE id = $1", [
    session.id,
    JSON.stringify(session.sandbox),
    JSON.stringify(session.messages),
  ]);
}

/** Remove demo sessions older than the time limit; returns their ids so their agent memory can go too. */
export async function deleteExpiredDemoSessions(limit = 500): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `DELETE FROM demo_sessions WHERE id IN (
       SELECT id FROM demo_sessions WHERE created_at < now() - make_interval(hours => $1) LIMIT $2
     ) RETURNING id::text`,
    [DEMO_TTL_HOURS, limit],
  );
  return rows.map((row) => row.id);
}
