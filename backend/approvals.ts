import "server-only";

import { agentFor } from "@/backend/agent";
import type { AgentResult } from "@/backend/agent/graph";
import { enforceDailyLimit } from "@/backend/api";
import { query } from "@/backend/db";
import { can, getAccess, policyFor } from "@/backend/rbac";
import { HttpError, type SessionUser } from "@/backend/session";
import {
  cancelOpenRequests,
  createApprovalRequest,
  getOpenRequest,
  getRequest,
  recordAction,
  resolveRequest,
} from "@/backend/store";

// The approval workflow:
//   read      -> runs automatically
//   write     -> runs when the user clicks Approve
//   sensitive -> runs when the user clicks Approve *if* they can review (maintainer/admin);
//                otherwise it becomes an approval request that another reviewer must approve,
//                and it then runs with the requester's own GitHub token.

/** The user clicked Approve on the pending action in their conversation. */
export async function approvePending(
  user: SessionUser,
  conversationId: string,
  edits: Record<string, unknown>,
): Promise<AgentResult> {
  const agent = await agentFor(user.id, user.access);
  const { pending } = await agent.state(conversationId);
  if (!pending) throw new HttpError(409, "There is no action waiting for approval.");

  // Reviewers may adjust the proposed arguments, but not add new ones.
  const safeEdits = Object.fromEntries(Object.entries(edits).filter(([key]) => key in pending.args));
  const args = { ...pending.args, ...safeEdits };
  const policy = policyFor(user.access, { name: pending.name, args });
  if (!policy.allowed) {
    throw new HttpError(403, `Your role (${user.access.role}) can't run ${policy.risk} actions. Reject it or ask an admin.`);
  }

  if (policy.needsReview) {
    if (!(await getOpenRequest(conversationId))) {
      await createApprovalRequest({
        requesterId: user.id,
        conversationId,
        toolCallId: pending.id,
        tool: pending.name,
        args,
        risk: policy.risk,
      });
      await recordAction({ userId: user.id, conversationId, tool: pending.name, args, decision: "review_requested" });
    }
    return agent.state(conversationId);
  }

  await enforceDailyLimit(user.id);
  return agent.approve(conversationId, safeEdits);
}

/** The user clicked Reject (or Cancel request) on their own pending action. */
export async function rejectPending(user: SessionUser, conversationId: string): Promise<AgentResult> {
  await cancelOpenRequests(conversationId);
  return (await agentFor(user.id, user.access)).reject(conversationId);
}

/** A reviewer approved or rejected someone else's sensitive action from the admin dashboard. */
export async function reviewRequest(
  reviewer: SessionUser,
  requestId: string,
  decision: "approve" | "reject",
  note: string,
): Promise<{ conversationId: string; requesterId: string; result: AgentResult }> {
  if (!can(reviewer.access, "approvals.review")) throw new HttpError(403, "You can't review approval requests.");
  const request = await getRequest(requestId);
  if (!request) throw new HttpError(404, "Approval request not found.");
  if (request.status !== "pending") throw new HttpError(409, `This request was already ${request.status}.`);
  if (request.requesterId === reviewer.id) throw new HttpError(403, "You can't review your own request.");

  const agent = await agentFor(request.requesterId, await getAccess(request.requesterId), reviewer.id);
  const { pending } = await agent.state(request.conversationId);
  if (!pending || pending.id !== request.toolCallId) {
    await resolveRequest(request.id, "cancelled", reviewer.id, "The conversation moved on before review.");
    throw new HttpError(409, "The requester has moved on; this request is no longer current.");
  }

  // Claim the request first so two reviewers can never both run it.
  const status = decision === "approve" ? "approved" : "rejected";
  if (!(await resolveRequest(request.id, status, reviewer.id, note))) {
    throw new HttpError(409, "Another reviewer just handled this request.");
  }

  if (decision === "reject") {
    const reason = `An admin rejected this action${note ? `: ${note}` : "."}`;
    return { conversationId: request.conversationId, requesterId: request.requesterId, result: await agent.reject(request.conversationId, reason) };
  }

  try {
    const result = await agent.approve(request.conversationId, request.args);
    await query("UPDATE approval_requests SET result_ok = $2, result_detail = $3 WHERE id = $1", [
      request.id,
      !result.toolError,
      result.toolError ?? "",
    ]);
    return { conversationId: request.conversationId, requesterId: request.requesterId, result };
  } catch (error) {
    await query("UPDATE approval_requests SET status = 'failed', result_ok = false, result_detail = $2 WHERE id = $1", [
      request.id,
      error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
    ]);
    throw error;
  }
}
