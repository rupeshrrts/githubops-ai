#!/usr/bin/env node
// One-command setup.
//
//   npm run setup        create .env.local (with generated secrets), check config, set up the database
//   npm run db:setup     only set up / migrate the database (database/setup.sql + LangGraph checkpoint tables)
//
// Flags: --db-only, --if-configured (skip quietly when DATABASE_URL is missing; used by vercel-build).
// Secret values are never printed.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_FILE = ".env.local";
const args = new Set(process.argv.slice(2));
const dbOnly = args.has("--db-only");
const ifConfigured = args.has("--if-configured");

const REQUIRED = ["DATABASE_URL", "AUTH_SECRET", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "TOKEN_ENCRYPTION_KEY", "NVIDIA_API_KEY"];
const GENERATED = {
  AUTH_SECRET: () => randomBytes(33).toString("base64"),
  TOKEN_ENCRYPTION_KEY: () => randomBytes(32).toString("base64"),
  CRON_SECRET: () => randomBytes(24).toString("hex"),
};

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

function setEnvValue(text, key, value) {
  const line = new RegExp(`^${key}=.*$`, "m");
  return line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
}

// ---------------------------------------------------------------- 1. environment file
if (!dbOnly) {
  if (!existsSync(ENV_FILE)) {
    copyFileSync(".env.example", ENV_FILE);
    console.log(`✓ Created ${ENV_FILE} from .env.example`);
  }
  let text = readFileSync(ENV_FILE, "utf8");
  const current = parseEnv(text);
  for (const [key, make] of Object.entries(GENERATED)) {
    if (!current[key]) {
      text = setEnvValue(text, key, make());
      console.log(`✓ Generated ${key}`);
    }
  }
  writeFileSync(ENV_FILE, text);
}

// Values from .env.local fill in anything not already set in the real environment.
if (existsSync(ENV_FILE)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(ENV_FILE, "utf8")))) {
    if (value && !process.env[key]) process.env[key] = value;
  }
}

if (!dbOnly) {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  console.log("\nConfiguration:");
  for (const key of REQUIRED) console.log(`  ${missing.includes(key) ? "✗ missing " : "✓ set     "} ${key}`);
  if (missing.length) {
    console.log(`\nFill in the missing values in ${ENV_FILE} (see README → Setup), then run npm run setup again.`);
  }
}

// ---------------------------------------------------------------- 2. database
if (!process.env.DATABASE_URL) {
  if (ifConfigured) {
    console.log("DATABASE_URL not set; skipping database setup (it also runs automatically on first request).");
    process.exit(0);
  }
  console.log("\nSkipping database setup: DATABASE_URL is not set.");
  process.exit(dbOnly ? 1 : 0);
}

const { default: pg } = await import("pg");
// If this package can't be loaded, skip it: the app creates the checkpoint tables itself on first use.
const { PostgresSaver } = await import("@langchain/langgraph-checkpoint-postgres").catch(() => ({ PostgresSaver: null }));

function poolConfig() {
  const connectionString = process.env.DATABASE_URL;
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  if (!ca) return { connectionString, max: 2 };
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), max: 2, ssl: { ca, rejectUnauthorized: true } };
}

const pool = new pg.Pool(poolConfig());
const sql = readFileSync("database/setup.sql", "utf8");

async function applySchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727274001)");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

try {
  console.log("\nSetting up the database...");
  await applySchema();
  if (PostgresSaver) {
    await new PostgresSaver(pool).setup(); // LangGraph checkpoint tables
    await applySchema(); // second pass locks down the checkpoint tables too
  } else {
    console.log("  (LangGraph checkpoint tables will be created by the app on first use)");
  }
  const { rows } = await pool.query("SELECT version FROM schema_info WHERE id = 1");
  const tables = await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
  console.log(`✓ Database ready: schema v${rows[0].version}, ${tables.rows[0].n} tables, Row Level Security on.`);
} catch (error) {
  console.error(`✗ Database setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
