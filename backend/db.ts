import { readFileSync } from "node:fs";
import path from "node:path";

import { Pool, type PoolConfig } from "pg";

// database/setup.sql is the single source of truth for the schema. It is idempotent, so it is
// applied lazily on the first query after every cold start (and by `npm run db:setup`).
export function setupSql(): string {
  return readFileSync(path.join(process.cwd(), "database", "setup.sql"), "utf8");
}

/** Pool settings. DATABASE_SSL_CA pins the server certificate (e.g. Supabase's CA) instead of the system store. */
export function poolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const ca = env.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  if (!ca) return { connectionString, max: 5 };
  // sslmode in the URL would override the ssl object, so drop it when a CA is given.
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), max: 5, ssl: { ca, rejectUnauthorized: true } };
}

// Reuse one pool per server instance (and across hot reloads in development).
const globalForDb = globalThis as unknown as { pool?: Pool; schemaReady?: Promise<void> };

export function getPool(): Pool {
  globalForDb.pool ??= new Pool(poolConfig());
  return globalForDb.pool;
}

/** Apply database/setup.sql once per server instance, serialized across instances with an advisory lock. */
export function ensureSchema(): Promise<void> {
  globalForDb.schemaReady ??= (async () => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(727274001)");
      await client.query(setupSql());
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    globalForDb.schemaReady = undefined; // let the next request retry
    throw error;
  });
  return globalForDb.schemaReady;
}

export async function query<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  const result = await getPool().query<T>(text, params);
  return result.rows;
}
