-- =============================================================================
-- GitHubOps AI - complete database setup
--
-- One idempotent script that creates or upgrades every table, seeds roles and
-- permissions, and locks tables away from Supabase's public REST API.
-- Safe to run any number of times, on any Postgres 14+ (Supabase, Neon, local).
--
--   npm run db:setup                 # runs this file + LangGraph checkpoint tables
--   or paste it into the Supabase / Neon SQL editor
--
-- The app also applies it automatically on the first request after a deploy.
-- LangGraph checkpoint tables (checkpoints, checkpoint_blobs, checkpoint_writes,
-- checkpoint_migrations) are created by PostgresSaver.setup(); section 10 locks
-- them down once they exist.
-- =============================================================================


-- 1. Authentication (Auth.js @auth/pg-adapter schema) ----------------------------

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255),
  "emailVerified" TIMESTAMPTZ,
  image TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,            -- always NULL: the app keeps no GitHub token (see below)
  expires_at BIGINT,
  id_token TEXT,
  scope TEXT,
  session_state TEXT,
  token_type TEXT
);
CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts ("userId");
-- The GitHub access a user grants at sign-in is kept in their own browser (backend/github/key.ts), so no
-- token belongs in the database. This also removes tokens saved by versions before 5.
UPDATE accounts SET access_token = NULL, refresh_token = NULL, id_token = NULL
WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR id_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions ("sessionToken");

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);


-- 2. User profiles ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS token_updated_at TIMESTAMPTZ;


-- 3. Role-based access control ---------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  rank INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL REFERENCES roles (name) ON DELETE CASCADE,
  permission TEXT NOT NULL REFERENCES permissions (name) ON DELETE CASCADE,
  PRIMARY KEY (role, permission)
);

-- One role per user; users without a row get the default role ("member").
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL REFERENCES roles (name),
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user exceptions on top of the role: grant (allowed = true) or revoke (false).
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL REFERENCES permissions (name) ON DELETE CASCADE,
  allowed BOOLEAN NOT NULL,
  set_by TEXT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

INSERT INTO roles (name, description, rank) VALUES
  ('viewer',     'Read-only: ask questions and browse repositories.', 10),
  ('member',     'Can make changes; sensitive actions go to an admin for review.', 20),
  ('maintainer', 'Member who can also review sensitive actions and see everyone''s audit log.', 50),
  ('admin',      'Full control, including users, roles and permissions.', 100)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, rank = EXCLUDED.rank;

INSERT INTO permissions (name, description) VALUES
  ('chat.use',         'Use the AI assistant'),
  ('github.read',      'Read GitHub data (repos, issues, PRs, files, runs)'),
  ('github.write',     'Propose changes: issues, branches, PRs, files, repositories, API writes'),
  ('github.sensitive', 'Propose sensitive actions: merge, change visibility, delete'),
  ('workflows.run',    'Trigger GitHub Actions workflows from the portal'),
  ('repos.sync',       'Sync the repository list from GitHub'),
  ('audit.view',       'See your own audit log'),
  ('audit.view_all',   'See every user''s audit log'),
  ('approvals.review', 'Approve or reject other users'' sensitive actions, and run your own without review'),
  ('admin.access',     'Open the admin dashboard'),
  ('admin.users',      'Change roles, permissions and account status')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, permission) VALUES
  ('viewer', 'chat.use'), ('viewer', 'github.read'), ('viewer', 'repos.sync'), ('viewer', 'audit.view'),

  ('member', 'chat.use'), ('member', 'github.read'), ('member', 'repos.sync'), ('member', 'audit.view'),
  ('member', 'github.write'), ('member', 'github.sensitive'), ('member', 'workflows.run'),

  ('maintainer', 'chat.use'), ('maintainer', 'github.read'), ('maintainer', 'repos.sync'), ('maintainer', 'audit.view'),
  ('maintainer', 'github.write'), ('maintainer', 'github.sensitive'), ('maintainer', 'workflows.run'),
  ('maintainer', 'approvals.review'), ('maintainer', 'audit.view_all'), ('maintainer', 'admin.access'),

  ('admin', 'chat.use'), ('admin', 'github.read'), ('admin', 'repos.sync'), ('admin', 'audit.view'),
  ('admin', 'github.write'), ('admin', 'github.sensitive'), ('admin', 'workflows.run'),
  ('admin', 'approvals.review'), ('admin', 'audit.view_all'), ('admin', 'admin.access'), ('admin', 'admin.users')
ON CONFLICT DO NOTHING;


-- 4. Conversations ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tools JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id);


-- 5. Approval workflow for sensitive actions -------------------------------------

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args JSONB NOT NULL,
  risk TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'failed')),
  reviewer_id TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  result_ok BOOLEAN,
  result_detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
-- Decided by a reviewer, not carried out yet: it runs from the requester's side, with their own GitHub access.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS awaiting_requester BOOLEAN NOT NULL DEFAULT false;
-- At most one open request per conversation.
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_one_pending
  ON approval_requests (conversation_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS approval_requests_status_idx ON approval_requests (status, created_at DESC);


-- 6. Audit log ---------------------------------------------------------------------
-- No foreign keys on purpose: audit entries outlive deleted conversations and users.

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,              -- whose GitHub account / data the action concerns
  conversation_id UUID,
  tool TEXT NOT NULL,                 -- tool name or event, e.g. delete_repository, role.changed
  args JSONB NOT NULL,
  decision TEXT NOT NULL,             -- approved, rejected, superseded, review_requested, ...
  ok BOOLEAN,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_id TEXT;    -- who made the decision
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'github';
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_log (user_id, id DESC);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at DESC);


-- 7. GitHub synchronization --------------------------------------------------------

CREATE TABLE IF NOT EXISTS github_repositories (
  user_id TEXT NOT NULL,
  github_id BIGINT NOT NULL,
  full_name TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  private BOOLEAN NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  fork BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  language TEXT,
  default_branch TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  open_issues INTEGER NOT NULL DEFAULT 0,
  html_url TEXT NOT NULL,
  pushed_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, github_id)
);
CREATE INDEX IF NOT EXISTS github_repositories_user_idx ON github_repositories (user_id, pushed_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  trigger TEXT NOT NULL,              -- manual, auto, cron
  status TEXT NOT NULL,               -- running, success, error
  repositories INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sync_runs_user_idx ON sync_runs (user_id, id DESC);


-- 8. Usage limits ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id TEXT NOT NULL,
  day DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);


-- 8b. Demo mode --------------------------------------------------------------------
-- One row per visitor trying the demo: their pretend GitHub account and chat. Deleted after 24 hours.

CREATE TABLE IF NOT EXISTS demo_sessions (
  id UUID PRIMARY KEY,
  visitor TEXT NOT NULL,              -- hashed IP, used only for the daily demo limit
  sandbox JSONB NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_sessions_created_idx ON demo_sessions (created_at);


-- 9. Schema version ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_info (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_info (id, version) VALUES (1, 5)
ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = now();


-- 10. Lock down every table --------------------------------------------------------
-- Supabase exposes the public schema through its REST API with the anon key.
-- Row Level Security with no policies denies those roles everything, while the
-- app's own database user (the table owner) is unaffected. Harmless elsewhere.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'accounts', 'sessions', 'verification_token', 'user_profiles',
    'roles', 'permissions', 'role_permissions', 'user_roles', 'user_permission_overrides',
    'conversations', 'messages', 'approval_requests', 'audit_log',
    'github_repositories', 'sync_runs', 'usage_daily', 'schema_info', 'demo_sessions',
    'checkpoints', 'checkpoint_blobs', 'checkpoint_writes', 'checkpoint_migrations'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
      END IF;
    END IF;
  END LOOP;
END $$;
