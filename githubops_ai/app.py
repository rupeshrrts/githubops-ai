# pyrefly: ignore [missing-import]
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import streamlit as st

from backend import approve_request, delete_thread, get_state, reject_request, run_request
from database import create_tables, conversations, delete_conversation, messages, new_conversation, save_message, title_from, update_title

create_tables()
st.set_page_config(page_title="GitHubOps AI", page_icon="🐙", layout="wide")
st.title("GitHubOps AI")
st.caption("Natural-language GitHub assistant with safe tool approval")

if "thread_id" not in st.session_state:
    # Start every fresh Streamlit session with a clean conversation.
    st.session_state.thread_id = new_conversation()


def new_chat():
    # Session state only remembers which persistent SQLite thread is selected.
    st.session_state.thread_id = new_conversation()


def delete_chat(thread_id):
    delete_conversation(thread_id)
    delete_thread(thread_id)
    chats = conversations()
    st.session_state.thread_id = chats[0]["thread_id"] if chats else new_conversation()


with st.sidebar:
    st.header("GitHubOps AI")
    if st.button("+ New Chat", use_container_width=True):
        new_chat()
        st.rerun()
    st.subheader("Recent conversations")
    for chat in conversations():
        cols = st.columns([5, 1])
        with cols[0]:
            if st.button(chat["title"], key=chat["thread_id"], use_container_width=True):
                st.session_state.thread_id = chat["thread_id"]
                st.rerun()
        with cols[1]:
            if st.button("X", key=f"delete-{chat['thread_id']}"):
                delete_chat(chat["thread_id"])
                st.rerun()

thread_id = st.session_state.thread_id
history = messages(thread_id)
for item in history:
    with st.chat_message(item["role"]):
        st.markdown(item["content"])

state = st.session_state.get("last_state") or get_state(thread_id)
# Checkpoint state lets an approval request reappear after a browser refresh.
pending = state.get("pending_tool_call")
if state.get("requires_approval") and pending:
    st.warning(
        f"Approval required for `{pending['name']}`. Review the details below, "
        "then click Approve or Reject."
    )
    approved_args = pending["args"].copy()
    if pending["name"] == "create_repository":
        st.subheader("Repository details")
        approved_args["name"] = st.text_input("Repository name", value=approved_args.get("name", ""))
        approved_args["description"] = st.text_input(
            "Description", value=approved_args.get("description", "")
        )
        approved_args["private"] = st.checkbox("Private repository", value=approved_args.get("private", False))
    elif pending["name"] == "update_repository_visibility":
        st.subheader("Visibility details")
        approved_args["repo"] = st.text_input(
            "Repository (owner/name)", value=approved_args.get("repo", "")
        )
        visibility = st.radio(
            "New visibility",
            options=["Public", "Private"],
            index=1 if approved_args.get("private", False) else 0,
            horizontal=True,
        )
        approved_args["private"] = visibility == "Private"
    elif pending["name"] == "delete_repository":
        st.error(f"Permanent deletion: {pending['args'].get('repo', 'repository not provided')}")
        st.caption("No text confirmation is required. Use the buttons below.")
    approve, reject = st.columns(2)
    with approve:
        if st.button("Approve", type="primary"):
            result = approve_request(thread_id, approved_args)
            answer = result["messages"][-1].content
            save_message(thread_id, "assistant", answer)
            st.session_state.last_state = result
            st.rerun()
    with reject:
        if st.button("Reject"):
            result = reject_request(thread_id)
            answer = result["messages"][-1].content
            save_message(thread_id, "assistant", answer)
            st.session_state.last_state = result
            st.rerun()

prompt = st.chat_input("Type a GitHub command...")
if prompt:
    previous = messages(thread_id)
    save_message(thread_id, "user", prompt)
    if not previous:
        update_title(thread_id, title_from(prompt))
    try:
        with st.spinner("Agent is working..."):
            result = run_request(thread_id, prompt)
    except Exception as error:
        st.error(
            "LLM authentication failed. Check NVIDIA_API_KEY in githubops_ai/.env "
            "and generate a new key if the old one was exposed."
        )
        st.stop()
    st.session_state.last_state = result
    if result.get("requires_approval"):
        st.rerun()
    answer = result["messages"][-1].content
    save_message(thread_id, "assistant", answer)
    st.rerun()
