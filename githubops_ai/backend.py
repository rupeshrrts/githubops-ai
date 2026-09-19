import json
import os  # pyrefly: ignore [missing-import]
import sqlite3
import uuid
import warnings  # pyrefly: ignore [missing-import]
from pathlib import Path

import httpx  # pyrefly: ignore [missing-import]

from dotenv import load_dotenv
# pyrefly: ignore [missing-import]
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
# pyrefly: ignore [missing-import]
from langchain_openai import ChatOpenAI
# pyrefly: ignore [missing-import]
from langgraph.checkpoint.sqlite import SqliteSaver
# pyrefly: ignore [missing-import]
from langgraph.graph import END, START, MessagesState, StateGraph, add_messages
# pyrefly: ignore [missing-import]
from langgraph.prebuilt import ToolNode

from github_tools import ALL_TOOLS, RISKY_TOOLS, TOOL_MAP

# Load secrets from this project first, then fall back to the workspace .env.
load_dotenv(Path(__file__).with_name(".env"))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def get_nvidia_key():
    """Read the key and tolerate an accidental duplicated variable prefix."""
    key = os.getenv("NVIDIA_API_KEY", "").strip()
    prefix = "NVIDIA_API_KEY="
    return key[len(prefix):] if key.startswith(prefix) else key


class AgentState(MessagesState):
    # These fields make approval state visible to the UI and resumable by thread.
    pending_tool_call: dict
    requires_approval: bool
    approval_status: str


# SSL verification disabled to bypass corporate proxy inspection.
warnings.filterwarnings("ignore", category=Warning)  # pyrefly: ignore
_http_client = httpx.Client(verify=False, timeout=120.0)  # pyrefly: ignore

llm = ChatOpenAI(
    model="openai/gpt-oss-20b",
    api_key=get_nvidia_key(),  # pyrefly: ignore
    base_url="https://integrate.api.nvidia.com/v1",
    http_client=_http_client,  # pyrefly: ignore
    temperature=1,
    top_p=1,
    max_tokens=4096,
    timeout=120,
)
# Tool descriptions and typed parameters help the LLM choose the correct function.
llm_with_tools = llm.bind_tools(ALL_TOOLS)


def agent_node(state: AgentState):
    """Ask the LLM to answer or select a GitHub tool."""
    # The system message sets safety rules and explains when tools must be used.
    instructions = SystemMessage(
        content=(
            "You are GitHubOps AI. Use the explicitly provided GitHub tools for GitHub actions. "
            "For repository creation, if the user has not provided a repository name, ask for "
            "the name, description, and public/private choice instead of claiming a permission error. "
            "When a valid name is provided, call create_repository. For delete_repository, "
            "update_repository_visibility, and other GitHub actions, call the matching tool "
            "when the user gives the required repository and action details. Never invent API "
            "errors or token scopes. Do not ask the user to type yes for approval; the UI handles approval."
            " When listing repositories, show every repository name, visibility (Public or Private), "
            "and URL as a Markdown link. For a question about the user's latest commit, "
            "call get_latest_commit and show the repository, commit message, date, and link."
        )
    )
    # Handle common latest-commit wording reliably before asking the LLM to interpret it.
    latest_user_text = state["messages"][-1].content.lower()
    latest_commit_request = any(
        phrase in latest_user_text
        for phrase in (
            "latest commit", "last commit", "aakhri commit", "pichla commit",
            "last commit kiya", "last push", "pushed last", "last pushed",
            "which repo i have push", "kis repo me push", "sabse last push",
        )
    )
    if latest_commit_request:
        # This deterministic shortcut handles the common Hindi/English intent reliably.
        return {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "get_latest_commit",
                            "args": {},
                            "id": f"call_{uuid.uuid4().hex}",
                            "type": "tool_call",
                        }
                    ],
                )
            ]
        }
    return {"messages": [llm_with_tools.invoke([instructions] + state["messages"])]}


def approval_node(state: AgentState):
    """Pause before a risky GitHub write operation."""
    # Store the proposed tool call; the UI will approve or reject it later.
    call = state["messages"][-1].tool_calls[0]
    return {
        "pending_tool_call": {"name": call["name"], "args": call["args"], "id": call["id"]},
        "requires_approval": True,
        "approval_status": "pending",
    }


def route_after_agent(state: AgentState):
    # Route normal answers to END, safe reads to tools, and writes to approval.
    last = state["messages"][-1]
    if not isinstance(last, AIMessage) or not last.tool_calls:
        return END
    if any(call["name"] in RISKY_TOOLS for call in last.tool_calls):
        return "approval"
    return "tools"


builder = StateGraph(AgentState)
# The graph supports repeated agent -> tool -> agent steps for multi-step tasks.
builder.add_node("agent", agent_node)
builder.add_node("tools", ToolNode(ALL_TOOLS))
builder.add_node("approval", approval_node)
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", route_after_agent, {"tools": "tools", "approval": "approval", END: END})
builder.add_edge("tools", "agent")
builder.add_edge("approval", END)

# SQLite checkpointing lets the pending approval survive a rerun or restart.
checkpoint_db = Path(__file__).with_name("githubops_checkpoints.db")
checkpoint_connection = sqlite3.connect(checkpoint_db, check_same_thread=False)
checkpointer = SqliteSaver(checkpoint_connection)
checkpointer.setup()
graph = builder.compile(checkpointer=checkpointer)


def run_request(thread_id: str, prompt: str) -> dict:
    """Run one user request and return the latest graph state."""
    # The thread ID connects this request to its saved LangGraph checkpoint.
    config = {"configurable": {"thread_id": thread_id}}
    return graph.invoke({"messages": [HumanMessage(content=prompt)]}, config=config)


def get_state(thread_id: str) -> dict:
    """Load the latest checkpoint for a conversation."""
    return graph.get_state({"configurable": {"thread_id": thread_id}}).values


def approve_request(thread_id: str, approved_args: dict | None = None) -> dict:
    """Execute the pending approved tool, then resume the agent."""
    config = {"configurable": {"thread_id": thread_id}}
    state = graph.get_state(config).values
    pending = state.get("pending_tool_call")
    if not pending:
        return state

    # Execute only the tool that the graph proposed and the user approved.
    tool = TOOL_MAP[pending["name"]]
    # The UI can replace risky arguments after the user reviews them.
    tool_args = pending["args"].copy()
    if approved_args:
        tool_args.update(approved_args)
    result = tool.invoke(tool_args)
    tool_message = ToolMessage(
        content=json.dumps(result, default=str),
        tool_call_id=pending["id"],
    )
    return graph.invoke(
        {"messages": [tool_message], "pending_tool_call": {}, "requires_approval": False, "approval_status": "approved"},
        config=config,
    )


def reject_request(thread_id: str) -> dict:
    """Clear a pending action without calling GitHub."""
    config = {"configurable": {"thread_id": thread_id}}
    return graph.invoke(
        {"messages": [ToolMessage(content="User rejected this action.", tool_call_id=graph.get_state(config).values["pending_tool_call"]["id"])], "pending_tool_call": {}, "requires_approval": False, "approval_status": "rejected"},
        config=config,
    )


def delete_thread(thread_id: str):
    # Remove workflow checkpoints when the user deletes a conversation.
    checkpointer.delete_thread(thread_id)
