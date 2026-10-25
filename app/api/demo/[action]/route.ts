// Demo mode API: anyone can try the assistant on a pretend GitHub account, without signing in.
//   GET  /api/demo/state    the visitor's demo chat and pretend repositories (if any)
//   POST /api/demo/chat     send a message            { message }
//   POST /api/demo/approve  approve the pending action { args? }
//   POST /api/demo/reject   reject the pending action
//   POST /api/demo/reset    start over with fresh sample data
// The same agent, tools and approval rules as the real app run here; only GitHub is pretend.
import { z } from "zod";

import { deleteThread } from "@/backend/agent";
import { handle, readJson } from "@/backend/api";
import { seedSandbox } from "@/backend/demo/sandbox";
import {
  demoAgent,
  demoEnabled,
  demoResponse,
  demoSnapshot,
  enforceDemoLimit,
  loadDemoSession,
  recordAnswer,
} from "@/backend/demo/session";
import { saveDemoSession } from "@/backend/demo/store";
import { HttpError } from "@/backend/session";

export const maxDuration = 60;

type Context = { params: Promise<{ action: string }> };

const ChatBody = z.object({ message: z.string().trim().min(1).max(2000) });
const ApproveBody = z.object({ args: z.record(z.string(), z.unknown()).default({}) });

export function GET(request: Request, { params }: Context) {
  return handle(request, async () => {
    if ((await params).action !== "state") throw new HttpError(404, "Not found.");
    if (!demoEnabled()) throw new HttpError(404, "The demo is turned off.");
    const { session } = await loadDemoSession(request, false);
    if (!session) return { conversationId: null, messages: [], pending: null, policy: null, review: null };
    const state = await (await demoAgent(session)).state(session.id);
    return demoSnapshot(session, state);
  });
}

export function POST(request: Request, { params }: Context) {
  return handle(request, async () => {
    if (!demoEnabled()) throw new HttpError(404, "The demo is turned off.");
    const action = (await params).action;
    const { session, isNew } = await loadDemoSession(request, action === "chat" || action === "reset");
    if (!session) throw new HttpError(409, "Your demo has expired. Send a message to start a new one.");
    const newCookie = isNew ? session.id : undefined;

    if (action === "reset") {
      await deleteThread(session.id);
      session.sandbox = seedSandbox();
      session.messages = [];
      await saveDemoSession(session);
      return demoResponse(request, demoSnapshot(session, null), newCookie);
    }

    const agent = await demoAgent(session);

    if (action === "chat") {
      const body = ChatBody.safeParse(await readJson(request));
      if (!body.success) throw new HttpError(400, "Message must be 1 to 2000 characters.");
      await enforceDemoLimit(session);
      session.messages.push({ role: "user", content: body.data.message, tools: [] });
      await saveDemoSession(session);
      const result = await agent.ask(session.id, body.data.message);
      recordAnswer(session, result);
      await saveDemoSession(session);
      return demoResponse(request, demoSnapshot(session, result), newCookie);
    }

    if (action === "approve") {
      const body = ApproveBody.safeParse((await readJson(request)) ?? {});
      if (!body.success) throw new HttpError(400, "Invalid arguments.");
      const { pending } = await agent.state(session.id);
      if (!pending) throw new HttpError(409, "There is no action waiting for approval.");
      await enforceDemoLimit(session);
      // Like the real app: the visitor may adjust proposed arguments, but not add new ones.
      const edits = Object.fromEntries(Object.entries(body.data.args).filter(([key]) => key in pending.args));
      const result = await agent.approve(session.id, edits);
      recordAnswer(session, result);
      await saveDemoSession(session);
      return demoResponse(request, demoSnapshot(session, result));
    }

    if (action === "reject") {
      const result = await agent.reject(session.id);
      recordAnswer(session, result);
      await saveDemoSession(session);
      return demoResponse(request, demoSnapshot(session, result));
    }

    throw new HttpError(404, "Not found.");
  });
}
