# pyrefly: ignore [missing-import]
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import streamlit as st

from backend import approve_request, delete_thread, get_state, reject_request, run_request
from database import create_tables, conversations, delete_conversation, messages, new_conversation, save_message, title_from, update_title

st.set_page_config(page_title="GitHubOps AI", page_icon="GH", layout="wide")

st.markdown(
    """
    <style>
        :root {
            --bg: #0b1220;
            --panel: #111827;
            --panel-soft: #0f172a;
            --surface: #1f2937;
            --surface-alt: #111827;
            --border: rgba(148, 163, 184, 0.18);
            --text: #e5e7eb;
            --muted: #a1a1aa;
            --primary: #7c3aed;
            --primary-soft: rgba(124, 58, 237, 0.12);
            --success: #22c55e;
            --warning: #f59e0b;
            --danger: #ef4444;
        }

        html, body, [data-testid="stAppViewContainer"] {
            background: linear-gradient(180deg, #0b1220 0%, #101828 100%);
            color: var(--text);
        }

        [data-testid="stSidebar"] {
            background: rgba(15, 23, 42, 0.94);
            border-right: 1px solid var(--border);
        }

        .stApp {
            background: transparent;
        }

        .block-container {
            padding-top: 2rem;
            padding-bottom: 2rem;
            max-width: 1280px;
        }

        h1, h2, h3, h4 {
            color: #f8fafc !important;
            letter-spacing: -0.03em;
        }

        .main-header {
            margin-bottom: 0.35rem;
            font-size: 2.2rem;
            font-weight: 700;
            letter-spacing: -0.04em;
        }

        .subtle-label {
            color: var(--muted);
            font-size: 0.96rem;
            margin-bottom: 1rem;
        }

        div[data-testid="stChatMessage"] {
            border: 1px solid var(--border);
            background: rgba(15, 23, 42, 0.55);
            border-radius: 14px;
            padding: 0.75rem 0.9rem;
            margin: 0.25rem 0;
        }

        [data-testid="stSidebarUserContent"] > div:first-child {
            padding-top: 1rem;
        }

        .stButton > button {
            border-radius: 10px;
            border: 1px solid rgba(148, 163, 184, 0.2);
            background: #111827;
            color: var(--text);
            font-weight: 600;
            transition: all 0.2s ease;
        }

        .stButton > button:hover {
            border-color: rgba(124, 58, 237, 0.5);
            background: #1b2333;
            box-shadow: 0 8px 18px rgba(124, 58, 237, 0.12);
        }

        .stButton > button[kind="primary"] {
            background: linear-gradient(135deg, #7c3aed, #5b21b6);
            border: none;
            color: white;
        }

        .stWarning, .stError, .stSuccess {
            border-radius: 12px;
            border: 1px solid var(--border);
            box-shadow: none;
        }

        .stTextInput > div > div > input,
        .stSelectbox > div > div,
        .stRadio > div {
            border-radius: 10px;
            border: 1px solid rgba(148, 163, 184, 0.25);
            background: rgba(15, 23, 42, 0.65);
        }
    </style>
    """,
    unsafe_allow_html=True,
)

create_tables()

st.markdown('<div class="main-header">GitHubOps AI</div>', unsafe_allow_html=True)
st.markdown('<div class="subtle-label">Natural-language GitHub assistant with safe tool approval</div>', unsafe_allow_html=True)

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
    st.markdown('<div class="main-header" style="font-size:1.5rem; margin-bottom:0.75rem;">GitHubOps AI</div>', unsafe_allow_html=True)
    if st.button("New chat", use_container_width=True):
        new_chat()
        st.rerun()
    st.markdown("<div class='subtle-label'>Recent conversations</div>", unsafe_allow_html=True)
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
