/**
 * The agent graph: agent -> tools (reads) or approval (writes) -> agent.
 *
 *   START -> agent --(no tool calls)----> END
 *                  --(only read tools)--> tools -> agent
 *                  --(any write tool)---> approval -> END   (waits for the user)
 *
 * A write action resumes only through Agent.approve() or Agent.reject(), which add the
 * matching ToolMessage and continue the graph from its checkpoint.
 */
import {
  type AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { Annotation, type BaseCheckpointSaver, END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import { SYSTEM_PROMPT } from "@/backend/agent/prompt";
import type { PendingCall } from "@/backend/types";

export type ChatModel = { invoke(messages: BaseMessage[]): Promise<BaseMessage> };
export type Decision = "approved" | "rejected" | "superseded";
export type AuditHook = (
  threadId: string,
  call: PendingCall,
  decision: Decision,
  ok: boolean | null,
  detail: string,
) => Promise<void>;

const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  // Checkpointed, so a pending approval survives refreshes, restarts, and serverless cold starts.
  pendingToolCall: Annotation<PendingCall | null>({ reducer: (_old, next) => next, default: () => null }),
  approvalStatus: Annotation<string>({ reducer: (_old, next) => next, default: () => "" }),
});
type State = typeof AgentState.State;

type ToolCall = { name: string; args: Record<string, unknown>; id?: string };

const toolCallsOf = (message: BaseMessage | undefined): ToolCall[] =>
  message?.getType() === "ai" ? ((message as AIMessage).tool_calls ?? []) : [];

export function textOf(message: BaseMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) => (typeof block === "object" && "text" in block && typeof block.text === "string" ? block.text : ""))
    .join("");
}

/** Names of the tools called since the user's last message, for the UI trace. */
export function toolsUsed(messages: BaseMessage[]): string[] {
  const names: string[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.getType() === "human") break;
    names.unshift(...toolCallsOf(message).map((call) => call.name));
  }
  return names;
}

/** Run one tool; exceptions become an error payload the LLM can explain. */
async function runTool(
  toolMap: Map<string, StructuredToolInterface>,
  call: PendingCall,
): Promise<{ message: ToolMessage; error: string | null }> {
  let content: string;
  try {
    const tool = toolMap.get(call.name);
    if (!tool) throw new Error(`Unknown tool ${call.name}`);
    const output = await tool.invoke(call.args);
    content = typeof output === "string" ? output : JSON.stringify(output);
  } catch (error) {
    content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
  let error: string | null = null;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && "error" in parsed) error = String(parsed.error);
  } catch {
    // Plain-text tool output is fine.
  }
  return { message: new ToolMessage({ content, tool_call_id: call.id }), error };
}

export function buildGraph(
  llm: ChatModel,
  tools: StructuredToolInterface[],
  writeTools: Set<string>,
  checkpointer: BaseCheckpointSaver,
) {
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const system = new SystemMessage(SYSTEM_PROMPT);

  const agentNode = async (state: State) => ({ messages: [await llm.invoke([system, ...state.messages])] });

  const approvalNode = async (state: State) => {
    const calls = toolCallsOf(state.messages.at(-1));
    const pending = calls.find((call) => writeTools.has(call.name))!;
    // Every tool call needs a ToolMessage, or the next LLM request is rejected.
    // Reads in the same turn run now; extra writes are declined so only one waits.
    const answered: ToolMessage[] = [];
    for (const call of calls) {
      if (call === pending) continue;
      if (writeTools.has(call.name)) {
        answered.push(
          new ToolMessage({
            content: "Not executed: only one write action can be approved at a time. Propose it again after this one.",
            tool_call_id: call.id ?? "",
          }),
        );
      } else {
        answered.push((await runTool(toolMap, { name: call.name, args: call.args, id: call.id ?? "" })).message);
      }
    }
    return {
      messages: answered,
      pendingToolCall: { name: pending.name, args: pending.args, id: pending.id ?? "" },
      approvalStatus: "pending",
    };
  };

  const route = (state: State) => {
    const calls = toolCallsOf(state.messages.at(-1));
    if (!calls.length) return END;
    return calls.some((call) => writeTools.has(call.name)) ? "approval" : "tools";
  };

  const graph = new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", new ToolNode(tools))
    .addNode("approval", approvalNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", route, ["tools", "approval", END])
    .addEdge("tools", "agent")
    .addEdge("approval", END)
    .compile({ checkpointer });

  return { graph, toolMap };
}

export type AgentResult = {
  messages: BaseMessage[];
  pending: PendingCall | null;
  /** Set by approve(): the GitHub error from the approved tool, or null when it succeeded. */
  toolError?: string | null;
};

/** Conversation-level API used by the routes: ask, approve, reject, inspect. */
export class Agent {
  private graph: ReturnType<typeof buildGraph>["graph"];
  private toolMap: Map<string, StructuredToolInterface>;

  constructor(
    llm: ChatModel,
    tools: StructuredToolInterface[],
    writeTools: Set<string>,
    checkpointer: BaseCheckpointSaver,
    private onAudit?: AuditHook,
  ) {
    ({ graph: this.graph, toolMap: this.toolMap } = buildGraph(llm, tools, writeTools, checkpointer));
  }

  private config(threadId: string) {
    return { configurable: { thread_id: threadId } };
  }

  private result(state: State): AgentResult {
    return { messages: state.messages ?? [], pending: state.pendingToolCall ?? null };
  }

  async state(threadId: string): Promise<AgentResult> {
    const snapshot = await this.graph.getState(this.config(threadId));
    return this.result(snapshot.values as State);
  }

  async ask(threadId: string, prompt: string): Promise<AgentResult> {
    const { pending } = await this.state(threadId);
    const messages: BaseMessage[] = [];
    if (pending) {
      // A new message while an approval is open declines it; otherwise the unanswered
      // tool call would break every later LLM request in this thread.
      await this.onAudit?.(threadId, pending, "superseded", null, "");
      messages.push(
        new ToolMessage({
          content: "Not executed: the user sent a new message instead of approving this action.",
          tool_call_id: pending.id,
        }),
      );
    }
    messages.push(new HumanMessage(prompt));
    const update = pending ? { messages, pendingToolCall: null, approvalStatus: "superseded" } : { messages };
    return this.result(await this.graph.invoke(update, this.config(threadId)));
  }

  /** Run the pending write tool (with any reviewer edits) and resume the agent. */
  async approve(threadId: string, editedArgs: Record<string, unknown> = {}): Promise<AgentResult> {
    const current = await this.state(threadId);
    if (!current.pending) return current;
    const call = { ...current.pending, args: { ...current.pending.args, ...editedArgs } };
    const { message, error } = await runTool(this.toolMap, call);
    await this.onAudit?.(threadId, call, "approved", error === null, error ?? "");
    const update = { messages: [message], pendingToolCall: null, approvalStatus: "approved" };
    return { ...this.result(await this.graph.invoke(update, this.config(threadId))), toolError: error };
  }

  /** Decline the pending write tool without calling GitHub. */
  async reject(threadId: string, reason = "User rejected this action."): Promise<AgentResult> {
    const current = await this.state(threadId);
    if (!current.pending) return current;
    await this.onAudit?.(threadId, current.pending, "rejected", null, reason === "User rejected this action." ? "" : reason);
    const message = new ToolMessage({ content: reason, tool_call_id: current.pending.id });
    const update = { messages: [message], pendingToolCall: null, approvalStatus: "rejected" };
    return this.result(await this.graph.invoke(update, this.config(threadId)));
  }
}
