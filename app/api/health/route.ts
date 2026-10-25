// GET /api/health: deployment check: is everything configured and is the database reachable?
import { query } from "@/backend/db";
import { missingConfig } from "@/backend/session";

export const dynamic = "force-dynamic";

/** Deployment check: configuration present, database reachable, schema applied. No secrets are returned. */
export async function GET() {
  const missing = missingConfig();
  let database: "ok" | "unconfigured" | "error" = "unconfigured";
  let schemaVersion: number | null = null;
  if (process.env.DATABASE_URL) {
    try {
      schemaVersion = (await query<{ version: number }>("SELECT version FROM schema_info WHERE id = 1"))[0]?.version ?? null;
      database = "ok";
    } catch {
      database = "error";
    }
  }
  const ok = missing.length === 0 && database === "ok";
  return Response.json({ ok, database, schemaVersion, missingConfig: missing }, { status: ok ? 200 : 503 });
}
