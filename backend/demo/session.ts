// Demo mode on the server: who the visitor is (a cookie), their daily limit, and the agent that works
// on their pretend GitHub. No GitHub sign-in and no real token are involved anywhere in this file.
import "server-only";

import { createHash } from "node:crypto";

import { createLlm, getCheckpointer } from "@/backend/agent";
import { Agent, type AgentResult, textOf, toolsUsed } from "@/backend/agent/graph";
import { createFakeOctokit, DEMO_OWNER, viewOf } from "@/backend/demo/sandbox";
import { createDemoSession, type DemoSession, getDemoSession } from "@/backend/demo/store";
import { createTools, WRITE_TOOL_NAMES } from "@/backend/github/tools";
import { type Access, PERMISSIONS, policyFor } from "@/backend/rbac";
import { HttpError } from "@/backend/session";
import { countUsage } from "@/backend/store";
import type { Snapshot } from "@/backend/types";

export const DEMO_COOKIE = "githubops_demo";

/** Demo visitors can do everything on their own pretend account, including sensitive actions. */
const DEMO_ACCESS: Access = { role: "demo", permissions: new Set(PERMISSIONS) };

export function demoEnabled(): boolean {
  return process.env.DEMO_ENABLED !== "false";
}

/** A stable, anonymous id for the daily limit: a salted hash of the visitor's IP, never the IP itself. */
export function visitorId(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(`${ip}:${process.env.AUTH_SECRET ?? ""}`).digest("hex").slice(0, 24);
}

function cookieValue(request: Request): string | undefined {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.match(new RegExp(`(?:^|;\\s*)${DEMO_COOKIE}=([^;]+)`))?.[1];
}

/** The visitor's demo session, creating one (with fresh sample data) when asked and none exists. */
export async function loadDemoSession(request: Request, create: boolean) {
  const existing = await getDemoSession(cookieValue(request));
  if (existing || !create) return { session: existing, isNew: false };
  return { session: await createDemoSession(visitorId(request)), isNew: true };
}

export async function enforceDemoLimit(session: DemoSession): Promise<void> {
  const limit = Number(process.env.DEMO_DAILY_LIMIT || 30);
  if ((await countUsage(`demo:${session.visitor}`)) > limit) {
    throw new HttpError(
      429,
      `The demo allows ${limit} AI requests per day. Sign in with GitHub to keep going, or come back tomorrow.`,
    );
  }
}

/** The real agent and the real GitHub tools, pointed at this visitor's pretend GitHub. */
export async function demoAgent(session: DemoSession): Promise<Agent> {
  // The general-purpose API tools can't be faked meaningfully, so the demo leaves them out.
  const tools = createTools(createFakeOctokit(session.sandbox), DEMO_OWNER).filter(
    (tool) => !tool.name.startsWith("github_api_"),
  );
  return new Agent(createLlm(tools), tools, WRITE_TOOL_NAMES, await getCheckpointer());
}

/** Add the agent's final answer to the demo chat, unless it stopped for an approval. */
export function recordAnswer(session: DemoSession, result: AgentResult): void {
  if (result.pending) return;
  const last = result.messages.at(-1);
  if (last?.getType() === "ai" && textOf(last)) {
    session.messages.push({ role: "assistant", content: textOf(last), tools: toolsUsed(result.messages) });
  }
}

export function demoSnapshot(session: DemoSession, result: AgentResult | null): Snapshot {
  const pending = result?.pending ?? null;
  return {
    conversationId: session.id,
    messages: session.messages,
    pending,
    policy: pending ? policyFor(DEMO_ACCESS, pending) : null,
    review: null,
    sandbox: viewOf(session.sandbox),
  };
}

/** Return JSON and, for a brand-new session, the cookie that identifies it for the next 24 hours. */
export function demoResponse(request: Request, body: unknown, newSessionId?: string): Response {
  const response = Response.json(body);
  if (newSessionId) {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    response.headers.append(
      "Set-Cookie",
      `${DEMO_COOKIE}=${newSessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`,
    );
  }
  return response;
}
