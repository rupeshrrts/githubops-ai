// POST /api/repos/dispatch: the "Run" button next to a workflow on a repository page.
import { z } from "zod";

import { githubClient } from "@/backend/agent";
import { handle, readJson } from "@/backend/api";
import { requireGithubKey } from "@/backend/github/key";
import { HttpError, requireUser } from "@/backend/session";
import { recordAction } from "@/backend/store";

const Body = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  workflowId: z.union([z.number().int().positive(), z.string().min(1).max(200)]),
  ref: z.string().min(1).max(250),
});

/** Run a workflow_dispatch workflow. The user's explicit confirmation in the UI is the approval. */
export function POST(request: Request) {
  return handle(request, async () => {
    const user = await requireUser("workflows.run");
    const body = Body.safeParse(await readJson(request));
    if (!body.success) throw new HttpError(400, "Invalid workflow request.");
    const { owner, repo, workflowId, ref } = body.data;
    const args = { repo: `${owner}/${repo}`, workflow_id: workflowId, ref };

    await requireGithubKey(user.id);
    const octokit = await githubClient(user.id);
    try {
      await octokit.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: workflowId, ref });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await recordAction({ userId: user.id, tool: "workflow_dispatch", args, decision: "approved", ok: false, detail });
      throw new HttpError((error as { status?: number }).status === 404 ? 404 : 422, `GitHub refused: ${detail}`);
    }
    await recordAction({ userId: user.id, tool: "workflow_dispatch", args, decision: "approved", ok: true });
    return { dispatched: true };
  });
}
