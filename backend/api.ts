// Helpers shared by every API route: error handling, the same-origin (CSRF) check, the daily limit,
// saving the AI's answer, and building the conversation snapshot sent to the browser.
import "server-only";

import { type AgentResult, textOf, toolsUsed } from "@/backend/agent/graph";
import { type Access, AccessError, policyFor } from "@/backend/rbac";
import { HttpError } from "@/backend/session";
import { countUsage, getConversation, getOpenRequest, listMessages, saveMessage } from "@/backend/store";
import type { Snapshot } from "@/backend/types";

/**
 * Run a route body and turn failures into JSON errors with a sensible status.
 * Mutating requests must come from this site (defense in depth on top of SameSite cookies).
 */
export async function handle(request: Request, action: () => Promise<unknown>): Promise<Response> {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request);
    return Response.json(await action());
  } catch (error) {
    // A route can attach the conversation it already created, so the browser can open it and retry.
    const conversationId = (error as { conversationId?: string }).conversationId;
    const fail = (message: string, status: number) => Response.json({ error: message, conversationId }, { status });

    if (error instanceof HttpError) return fail(error.message, error.status);
    if (error instanceof AccessError) return fail(error.message, 403);
    const status = (error as { status?: number }).status;
    // Tool errors are handled inside the agent; a status here comes from the LLM provider.
    if (status === 401 || status === 403) return fail("The AI provider rejected the API key (check NVIDIA_API_KEY).", 502);
    if (status === 429) return fail("The AI provider is rate limiting requests. Try again shortly.", 503);
    console.error(error);
    return fail("Something went wrong. Please try again.", 500);
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    throw new HttpError(403, "Cross-site request blocked.");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}

export async function ownedConversation(userId: string, id: string) {
  const conversation = await getConversation(userId, id);
  if (!conversation) throw new HttpError(404, "Conversation not found.");
  return conversation;
}

/** Every LLM call counts toward the per-user daily limit, so a public deployment can't be drained. */
export async function enforceDailyLimit(userId: string): Promise<void> {
  const limit = Number(process.env.DAILY_MESSAGE_LIMIT || 50);
  if ((await countUsage(userId)) > limit) {
    throw new HttpError(429, `Daily limit of ${limit} requests reached. It resets at midnight UTC.`);
  }
}

/** Store the agent's final answer, unless it stopped to wait for an approval. */
export async function saveAnswer(conversationId: string, result: AgentResult): Promise<void> {
  if (result.pending) return;
  const last = result.messages.at(-1);
  if (last?.getType() === "ai" && textOf(last)) {
    await saveMessage(conversationId, "assistant", textOf(last), toolsUsed(result.messages));
  }
}

export async function snapshot(conversationId: string, result: AgentResult, access: Access): Promise<Snapshot> {
  const { pending } = result;
  const [messages, open] = await Promise.all([
    listMessages(conversationId),
    pending ? getOpenRequest(conversationId) : Promise.resolve(null),
  ]);
  return {
    conversationId,
    messages,
    pending,
    policy: pending ? policyFor(access, pending) : null,
    review: open && pending && open.toolCallId === pending.id ? open : null,
  };
}
