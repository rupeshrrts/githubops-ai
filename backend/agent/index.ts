// Builds the AI agent for one user: their GitHub token -> Octokit -> only the tools their role allows ->
// LLM with those tools bound -> LangGraph graph that saves its state in Postgres.
import "server-only";

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ChatOpenAI } from "@langchain/openai";
import { Octokit } from "@octokit/rest";

import { Agent } from "@/backend/agent/graph";
import { getPool, query } from "@/backend/db";
import { createTools, WRITE_TOOL_NAMES } from "@/backend/github/tools";
import { type Access, allowedTools } from "@/backend/rbac";
import { HttpError } from "@/backend/session";
import { getGithubLogin, getGithubToken, recordAction } from "@/backend/store";

const CHECKPOINT_TABLES = ["checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"];
const globalForAgent = globalThis as unknown as { checkpointer?: Promise<PostgresSaver> };

function getCheckpointer(): Promise<PostgresSaver> {
  globalForAgent.checkpointer ??= (async () => {
    const saver = new PostgresSaver(getPool());
    await saver.setup();
    // Same lockdown as database/setup.sql section 10, for tables LangGraph just created.
    for (const table of CHECKPOINT_TABLES) await query(`ALTER TABLE IF EXISTS ${table} ENABLE ROW LEVEL SECURITY`);
    return saver;
  })().catch((error) => {
    globalForAgent.checkpointer = undefined;
    throw error;
  });
  return globalForAgent.checkpointer;
}

export async function githubClient(userId: string): Promise<Octokit> {
  const token = await getGithubToken(userId);
  if (!token) throw new HttpError(401, "Your GitHub account is not connected. Sign out and sign in again.");
  return new Octokit({ auth: token, userAgent: "githubops-ai" });
}

/**
 * An agent that acts on GitHub as `userId`, with their own OAuth token and only the tools
 * their permissions allow. `actorId` is who is driving it (the user, or an admin reviewer).
 */
export async function agentFor(userId: string, access: Access, actorId: string = userId): Promise<Agent> {
  const [octokit, login, checkpointer] = await Promise.all([
    githubClient(userId),
    getGithubLogin(userId),
    getCheckpointer(),
  ]);
  const tools = allowedTools(createTools(octokit, login), access);
  const llm = new ChatOpenAI({
    // Fast tool-calling model (~1-2 s per step on NVIDIA's API); override with LLM_MODEL.
    model: process.env.LLM_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
    apiKey: process.env.NVIDIA_API_KEY,
    temperature: 0, // tool selection should be repeatable, not creative
    maxTokens: 4096,
    timeout: 50_000,
    configuration: { baseURL: process.env.LLM_BASE_URL || "https://integrate.api.nvidia.com/v1" },
  }).bindTools(tools);

  return new Agent(llm, tools, WRITE_TOOL_NAMES, checkpointer, (threadId, call, decision, ok, detail) =>
    recordAction({ userId, actorId, conversationId: threadId, tool: call.name, args: call.args, decision, ok, detail }),
  );
}

/** Thread ids are conversation ids; deleting a conversation also drops its checkpoints. */
export async function deleteThread(threadId: string): Promise<void> {
  await (await getCheckpointer()).deleteThread(threadId);
}
