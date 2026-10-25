# Code guide

A walkthrough of how GitHubOps AI works inside, written so you can explain any part of it. Every source file starts with a comment saying what it does.

## The big picture

```text
Browser (frontend/)              Server (backend/)                              Outside
──────────────────               ─────────────────                              ───────
ChatPanel  ── POST /api/chat ──▶ session.ts   who is this? what may they do?
                                 agent/index  build an agent for this user ───▶ LLM (NVIDIA)
                                 agent/graph  LangGraph: think → use tools ───▶ GitHub API (Octokit)
                                 store.ts     save messages, audit log    ───▶ Postgres (database/setup.sql)
ApprovalCard ◀── snapshot ───── api.ts       messages + pending action + policy
```

There are three layers, one folder each:

| Folder | What lives there | Runs where |
|---|---|---|
| `frontend/` | Screens and buttons (React components, styles) | Browser |
| `backend/` | Login, permissions, the AI agent, GitHub tools, database queries | Server only |
| `database/` | `setup.sql`, the complete database schema | Postgres |

`app/` is required by Next.js. Each file there is one URL and only connects a URL to `frontend/` and `backend/` code.

## Read the code in this order

1. **[`database/setup.sql`](../database/setup.sql):** every table, with comments. Shows what the app remembers.
2. **[`backend/agent/graph.ts`](../backend/agent/graph.ts):** the heart of the project, the LangGraph agent with its approval gate.
3. **[`backend/github/tools.ts`](../backend/github/tools.ts):** the 19 things the AI can do on GitHub.
4. **[`backend/rbac.ts`](../backend/rbac.ts) and [`backend/approvals.ts`](../backend/approvals.ts):** who may do what, and the admin review flow.
5. **[`app/api/chat/route.ts`](../app/api/chat/route.ts):** how one message flows through all of the above.
6. **[`frontend/components/ChatPanel.tsx`](../frontend/components/ChatPanel.tsx) and [`ApprovalCard.tsx`](../frontend/components/ApprovalCard.tsx):** what the user sees.

## What happens when someone sends a message

Example: *"Which of my repos have failing CI?"*

| Step | Where | What happens |
|---|---|---|
| 1 | `ChatPanel.tsx` → `send()` | The message appears right away; the browser POSTs it to `/api/chat` |
| 2 | `app/api/chat/route.ts` | Checks the same-origin request, `requireUser("chat.use")`, and that this browser has the user's GitHub access (`requireGithubKey`) |
| 3 | `backend/api.ts` → `enforceDailyLimit` | Counts the request against the user's daily AI limit |
| 4 | `backend/store.ts` | Creates the conversation (first message) and saves the user's message |
| 5 | `backend/agent/index.ts` → `agentFor` | Decrypts the user's GitHub access from their browser cookie, creates an Octokit client, keeps only the tools the user's role allows, and binds them to the LLM |
| 6 | `backend/agent/graph.ts` → `agent` node | The LLM reads the conversation and decides to call `get_repositories` |
| 7 | `route()` → `tools` node | It's a read, so it runs immediately; the result goes back to the LLM |
| 8 | `agent` node again | The LLM calls `get_workflow_runs`, gets results, and writes the final answer (a table) |
| 9 | `backend/api.ts` → `saveAnswer`, `snapshot` | Saves the answer plus the names of the tools used, and returns `{messages, pending, policy, review}` |
| 10 | `ChatPanel.tsx` → `apply()` | Shows the answer, with tool "chips" under it |

LangGraph saves the conversation state in Postgres after every step (the **checkpointer**). That's why a pending approval survives a refresh, a redeploy or a serverless cold start.

## Where each user's GitHub access lives

The user gives **one approval**: GitHub's Authorize screen when they click **Sign in with GitHub**.

1. `backend/auth.ts` → `events.signIn` receives the GitHub token from that approval.
2. `store.ts` → `saveGithubSignIn` records who the user is and **clears** the token Auth.js wrote to the `accounts` table.
3. `github/key.ts` → `saveGithubKey` puts the token in the user's browser instead: an `HttpOnly` cookie (`githubops_key`), AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY`, tied to that user's id.
4. On every request, `readGithubKey` opens the cookie from that same browser. No request from that user means no access: an admin, the cron job or anyone else can't act with it.

**Disconnect** (`/api/account/disconnect`) withdraws the grant at GitHub and deletes the cookie; **Sign out** deletes the cookie. Settings also accepts a key the user created on GitHub themselves (`/api/account/connect`), kept the same way.

## What happens when the AI wants to change something

Example: *"Delete octo/old-demo"*, sent by a **member**.

1. The LLM proposes `delete_repository`. In `graph.ts`, `route()` sees a **write tool** and goes to the `approval` node instead of `tools`.
2. The `approval` node stores the call as `pendingToolCall` and **stops the graph**. Nothing has touched GitHub.
3. `snapshot()` adds a **policy** from `rbac.ts` → `policyFor`: `{risk: "sensitive", allowed: true, needsReview: true}`.
4. `ApprovalCard` shows a red "Sensitive" card that names the repository and warns that deleting is permanent, with the button **Request admin approval**.
5. The click goes to `/api/conversations/:id/approve` → `approvals.ts` → `approvePending`. Because `needsReview` is true, this creates an `approval_requests` row and an audit entry, and **still runs nothing**.
6. The admin sees it in `/admin` → `ReviewQueue` and clicks **Approve**, which calls `/api/admin/approvals/:id` → `reviewRequest`. That function:
   - checks the reviewer may review and isn't the requester
   - records the decision **atomically**, so two admins can't both decide
   - **runs nothing**: the admin has no access to the member's GitHub. The request is marked `awaiting_requester`.
7. The member's chat polls `/api/conversations/:id` every 10 seconds while a review is open. That request comes from the member's browser, which has their access, so `approvals.ts` → `conversationState` → `applyReviewDecision` claims the decision (exactly once) and calls `agent.approve()` as the member. The audit log credits the admin. If the member is away, it happens the next time they open the chat.

For a normal write (e.g. `create_issue`), steps 5 and 6 are replaced by "the user's own Approve click runs it". For an admin, sensitive actions also run on their own click.

## How demo mode works (`/demo`, no sign-in)

Demo mode reuses the **real agent, real tools and real approval cards**. Only GitHub is swapped out:

| Piece | File | What it does |
|---|---|---|
| Pretend GitHub | `backend/demo/sandbox.ts` | `seedSandbox()` makes 4 sample repos. `createFakeOctokit()` answers the same calls the tools make (`rest.repos.*`, `rest.issues.*` ...) by reading and changing that data |
| Visitor sessions | `backend/demo/store.ts` | One `demo_sessions` row per visitor: their sandbox (JSON) and chat. Expires after 24 hours |
| Glue | `backend/demo/session.ts` | Finds the visitor's session from the `githubops_demo` cookie, applies the demo daily limit, and builds `new Agent(...)` with `createTools(createFakeOctokit(sandbox))` |
| Endpoints | `app/api/demo/[action]/route.ts` | `state`, `chat`, `approve`, `reject`, `reset`. After each step the changed sandbox is saved |
| Screen | `app/(frontend)/demo/page.tsx`, `frontend/components/DemoWorkspace.tsx` | `ChatPanel` with `mode="demo"`, plus the live repository panel |

There is no user and no GitHub token in demo mode, so nothing can reach real GitHub. The daily cron (`/api/cron/sync`) deletes expired demo sessions and their checkpoints.

## Safety rules, and where each is enforced

| Rule | Where |
|---|---|
| The AI can't run a write by itself | `graph.ts` → `route()` sends every write tool to `approval`, which ends the graph |
| Only one write waits at a time | `graph.ts` → `approvalNode` declines extra writes in the same turn |
| Users only get tools their role allows | `rbac.ts` → `allowedTools`, used in `agent/index.ts` |
| A viewer can't approve a write the AI proposed anyway | `approvals.ts` → `approvePending` checks `policy.allowed` |
| Deletes are marked sensitive and say plainly what will be lost | `ApprovalCard.tsx` (UI); risk level in `rbac.ts` → `riskOf` |
| The AI never asks for confirmation in chat; the card is the only confirmation | `backend/agent/prompt.ts` |
| Users can't read each other's chats | Every query in `store.ts` filters by `user_id` |
| The database never holds anyone's GitHub access | `github/key.ts` keeps it in an encrypted cookie (`crypto.ts`); `setup.sql` clears the token columns |
| Access works only for its owner, from their browser | `key.ts` → `openGithubKey` checks the user id sealed inside the cookie |
| The API tools can't send a token elsewhere | `tools.ts` → `apiPath()` only allows paths on `api.github.com` |
| Supabase's public API can't read tables | `setup.sql` section 10, Row Level Security |
| Requests from other websites are refused | `api.ts` → `assertSameOrigin` |

## How to change common things

| I want to... | Change |
|---|---|
| Add a new GitHub action for the AI | Add a `tool(...)` in `backend/github/tools.ts`. If it changes GitHub, add its name to `WRITE_TOOL_NAMES`. For merge/delete-level risk, add it to `SENSITIVE_TOOLS` in `backend/rbac.ts` |
| Change what each role can do | The `INSERT INTO role_permissions` block in `database/setup.sql`, then `npm run db:setup` |
| Use another AI model or provider | `LLM_MODEL` and `LLM_BASE_URL` environment variables (any OpenAI-compatible API) |
| Change the AI's behaviour or tone | `backend/agent/prompt.ts` |
| Change colors | The `@theme` block at the top of `frontend/styles/globals.css` |
| Change the landing page text | `app/(frontend)/page.tsx` (`FEATURES`, `SAFETY`, `STEPS`) |
| Change the daily limit | `DAILY_MESSAGE_LIMIT` environment variable (`DEMO_DAILY_LIMIT` for demo visitors) |
| Change the demo's sample repositories | `seedSandbox()` in `backend/demo/sandbox.ts` |
| Add a database column | Add an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` line to `database/setup.sql` and bump the version in section 9 |

## Glossary

| Term | Meaning here |
|---|---|
| **Agent** | An LLM that can decide to call tools in a loop until it can answer |
| **LangGraph** | The library that defines the agent as a graph of steps (`agent`, `tools`, `approval`) and saves its state |
| **Tool** | A function the AI may call, e.g. `create_issue`. Defined with LangChain's `tool()` |
| **Checkpoint** | LangGraph's saved state of a conversation, stored in Postgres |
| **Snapshot** | What the server sends the browser: messages, pending action, policy, open review |
| **Policy** | For one pending action and one user: risk level, allowed or not, review needed or not |
| **Scope** | A GitHub OAuth permission, e.g. `repo`, `delete_repo` |
| **RLS** | Row Level Security, a Postgres feature; here it blocks Supabase's public API |
| **Server action** | A server function a form can post to directly (the sign-in and sign-out buttons) |

## Tests

`npm test` runs 72 tests with no network or keys:

| File | Covers |
|---|---|
| `tests/agent.test.ts` | The LangGraph agent and approval gate with a scripted AI |
| `tests/tools.test.ts` | Every GitHub tool against a fake Octokit, plus API path safety |
| `tests/workflow.test.ts` | The full approve / admin-review / reject workflow, end to end |
| `tests/demo.test.ts` | Demo mode: the real tools and agent on the pretend GitHub, and demo sessions in Postgres |
| `tests/db.test.ts` | `database/setup.sql` and every query on real Postgres (PGlite) |
| `tests/crypto-rbac.test.ts` | Encryption, risk levels, permission policy |
| `tests/key.test.ts` | The GitHub access cookie: encrypted, tamper-proof, opens only for its owner |
| `tests/scopes.test.ts` | GitHub permissions asked for at sign-in |
