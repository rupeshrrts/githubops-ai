# GitHubOps AI

**GitHubOps AI** is an intelligent, natural-language GitHub assistant built with **LangGraph**, **Streamlit**, and **NVIDIA AI LLMs** (`openai/gpt-oss-20b`). It allows developers and managers to interact with GitHub repositories, issues, pull requests, branches, and code files using plain natural language (English or Hinglish) — with a built-in **Human-in-the-Loop approval gate** for safe write operations.

---

## 1. Project Definition & Concept

Managing GitHub via traditional web interfaces or CLI commands often requires navigating multiple pages or memorizing syntax. **GitHubOps AI** bridges this gap by acting as an AI co-pilot for GitHub operations:

- **Natural Language Control:** Ask the assistant to list repositories, view open issues, inspect recent commits, create pull requests, or generate branches.
- **Safety First (Human-in-the-Loop):** Read-only operations execute automatically. Any action that modifies state (creating repositories, merging PRs, deleting branches) pauses execution and requests explicit human approval via interactive UI buttons before executing.
- **Persistent State & Checkpointing:** Uses SQLite to store conversation history and agent checkpoints, allowing users to pause, inspect, and approve pending actions seamlessly across browser refreshes.

---

### Application Interface & Workflow Screenshots

#### 1. Read-Only Action (Fetching Repositories)
The assistant automatically retrieves and displays your GitHub repositories in markdown tables without requiring approval.
![Repository Listing](githubops_ai/assets/repo_list_demo.png)

#### 2. Human-in-the-Loop Approval Gate (Risky Action Pause)
When a destructive or write action is requested (e.g., deleting a repository), the agent pauses execution, presents a prominent alert banner, and waits for explicit user confirmation via interactive **Approve / Reject** buttons.
![Approval Gate Banner](githubops_ai/assets/approval_gate_demo.png)

**Approval detail panel example:** Before a risky change is executed, the app shows the exact repository, the requested action, and the new target state. For example, when changing repository visibility, the approval screen clearly displays the repository name and the new visibility setting (`Public` vs `Private`) so the user can confirm or reject with full awareness.

![Visibility approval screen](githubops_ai/assets/approval_visibility_demo.svg)

#### 3. Execution & Confirmation
Upon clicking **Approve**, the agent resumes the LangGraph workflow, calls the GitHub REST API, and confirms the deletion.
![Deletion Confirmation](githubops_ai/assets/deletion_success_demo.png)

---

## 2. System Architecture & Workflow

### Handwritten Architecture & Notes Diagram
![Handwritten Workflow Notes](githubops_ai/assets/handwritten_notes_workflow.png)

---

### Easy 5-Step Execution Walkthrough

Here is how **GitHubOps AI** handles any request in 5 simple steps:

1. **Step 1: User Sends Prompt (`app.py`)**  
   The user types a plain English or Hinglish message in the Streamlit Web Chat UI (e.g., *"list all my repos"* or *"delete my-repo"*).

2. **Step 2: State Machine Processing (`backend.py`)**  
   `app.py` passes the user message to the **LangGraph Agent** in `backend.py`, which formats the conversation state and sends it to the **NVIDIA LLM** (`openai/gpt-oss-20b`).

3. **Step 3: Tool Selection by LLM**  
   The LLM analyzes the user prompt and selects the appropriate tool from `github_tools.py` (e.g., `get_repositories` or `delete_repository`).

4. **Step 4: Security Check (Safe vs. Risky Tools)**  
   - **Safe Tools (Read-Only):** Automatically executed immediately.  
   - **Risky Tools (Write/Delete):** LangGraph **pauses execution**, saves the graph state to SQLite (`githubops_checkpoints.db`), and displays interactive **Approve / Reject** buttons in Streamlit.

5. **Step 5: API Execution & UI Response (`github_tools.py`)**  
   Once approved (or auto-executed for safe tools), `github_tools.py` makes a HTTP request to `https://api.github.com`, returns the result to the LLM, and displays the final formatted response in Streamlit.

---

### System Execution Flowchart (Mermaid)

```mermaid
flowchart TD
    A[User Input via Streamlit UI] --> B[app.py Streamlit Handler]
    B --> C[backend.py - LangGraph Agent]
    C --> D[LLM: NVIDIA gpt-oss-20b]
    D --> E{LLM Decides Action}
    
    E -- Direct Answer --> F[Return Response to User]
    E -- Tool Call Proposed --> G{Is Tool Risky?}
    
    G -- No (Read-Only Tool) --> H[Execute Tool via github_tools.py]
    H --> C
    
    G -- Yes (Write/Delete Tool) --> I[Pause Graph State & Save Checkpoint]
    I --> J[Display Approval Widget in Streamlit UI]
    J -- User Clicks Approve --> H
    J -- User Clicks Reject --> K[Cancel Action & Inform LLM]
    K --> C
    
    H --> L[GitHub REST API]
    L --> F
```

### 📁 Component Structure

| File | Module | Responsibility |
|---|---|---|
| [`app.py`](file:///e:/Godrej_koerber/LANGGRAPH-CHATBOT/LANGGRAPH-CHATBOT/githubops_ai/app.py) | **Frontend UI** | Streamlit web application. Renders chat messages, conversation history sidebar, and interactive Human-in-the-Loop approval/rejection widgets. |
| [`backend.py`](file:///e:/Godrej_koerber/LANGGRAPH-CHATBOT/LANGGRAPH-CHATBOT/githubops_ai/backend.py) | **Agent Core** | Manages the LangGraph `StateGraph`, agent nodes, LLM binding (`openai/gpt-oss-20b`), tool routing, and SQLite graph state checkpointing. |
| [`github_tools.py`](file:///e:/Godrej_koerber/LANGGRAPH-CHATBOT/LANGGRAPH-CHATBOT/githubops_ai/github_tools.py) | **GitHub Tools** | Defines LangChain `@tool` functions wrapping GitHub REST API endpoints. Categorizes actions into Safe vs. Risky tools and dynamically reloads credentials. |
| [`database.py`](file:///e:/Godrej_koerber/LANGGRAPH-CHATBOT/LANGGRAPH-CHATBOT/githubops_ai/database.py) | **Database Layer** | Manages local SQLite storage (`githubops.db`) for chat sessions, conversation titles, and message logs. |
| [`simple_chat.py`](file:///e:/Godrej_koerber/LANGGRAPH-CHATBOT/LANGGRAPH-CHATBOT/githubops_ai/simple_chat.py) | **CLI / Simple UI** | Light-weight alternative Streamlit app for direct OpenAI-style API testing without tool graph workflows. |

---

## 3. Prerequisites

Before installing, ensure you have the following installed and available:

- **Python:** 3.10 or higher
- **pip:** 23.0 or higher
- **GitHub Personal Access Token (PAT):** with `repo` and `delete_repo` scopes.
- **NVIDIA API Key:** from [NVIDIA API Catalog](https://integrate.api.nvidia.com).

---

## 4. Installation & Setup Guide

### Step 1 — Clone / Download Project
Navigate to the project root directory:
```bash
cd e:\Godrej_koerber\LANGGRAPH-CHATBOT\LANGGRAPH-CHATBOT\githubops_ai
```

### Step 2 — Create & Activate Virtual Environment

**Windows (PowerShell):**
```powershell
python -m venv venv
.\venv\Scripts\activate
```

**Linux / macOS:**
```bash
python3 -m venv venv
source venv/bin/activate
```

### Step 3 — Install Dependencies

Install all required Python packages from `requirements.txt`:
```bash
pip install -r requirements.txt
```

*Key packages installed:*
- `streamlit` - Web UI framework
- `langgraph` & `langgraph-checkpoint-sqlite` - Agent state machine & persistent checkpointing
- `langchain-openai` & `langchain-core` - LLM interaction layer
- `python-dotenv` - Secrets management
- `requests` - GitHub REST API client

### Step 4 — Configure Environment Secrets (`.env`)

Copy `.env.example` to create your active `.env` file:

```powershell
# Windows
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

Open `.env` and fill in your keys:

```env
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your-github-username
GITHUB_SSL_VERIFY=false
```

#### How to Obtain Required Keys:

1. **NVIDIA API Key:**
   - Visit [integrate.api.nvidia.com](https://integrate.api.nvidia.com).
   - Sign in and select **API Keys** -> **Generate New Key**.
   - Copy the string starting with `nvapi-`.

2. **GitHub Personal Access Token:**
   - Visit [GitHub Token Settings](https://github.com/settings/tokens).
   - Click **Generate new token (classic)**.
   - Grant scopes: ✅ `repo` (Full control of private repositories) and ✅ `delete_repo`.
   - Copy the token starting with `ghp_`.

---

## 5. Running the Application

### Option A: Standard Full Agent Web UI (Recommended)
Run the Streamlit application:
```bash
streamlit run app.py
```
Open your browser and navigate to: **http://localhost:8501**

### Option B: Light-weight Chat UI
Run the standalone chat client:
```bash
streamlit run simple_chat.py
```

---

## 6. Tool Safety & Action Matrix

| Tool Category | Actions | Execution Workflow |
|---|---|---|
| **Safe (Read-Only)** | `get_repositories`, `list_issues`, `get_issue`, `list_pull_requests`, `list_branches`, `read_file_content`, `get_workflow_runs`, `get_latest_commit` | Executed automatically by the agent. |
| **Risky (Write/Delete)** | `create_repository`, `create_issue`, `add_issue_comment`, `create_branch`, `create_pull_request`, `merge_pull_request`, `update_file_content`, `delete_repository`, `change_repo_visibility` | Agent pauses execution, displays prompt with parameters in UI, and waits for user **Approve** / **Reject** click. |

---

## 7. Example Prompts

Try asking the assistant:

```text
"List all my repositories"
"Show open issues in repository my-project"
"What was the latest commit on main branch?"
"Create a new public repository called demo-ai-repo"
"Create a branch named feature/auth from main in owner/my-repo"
"Delete the repository owner/test-repo"
```

*Note: Hinglish and multilingual queries are also supported (e.g., `mera last commit kya tha?`).*

---

## 🗄️ 8. Database & State Persistence

The application automatically creates and manages two SQLite databases:

- `githubops.db`: Stores UI conversation history, titles, and timestamp logs.
- `githubops_checkpoints.db`: Stores exact state machine checkpoints for LangGraph, preserving pending tool execution states across browser reloads.

---

## ❓ 9. Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `GITHUB_TOKEN is missing from .env` | Missing token in `.env` | Ensure `.env` exists in `githubops_ai/` with `GITHUB_TOKEN=ghp_...`. |
| `LLM authentication failed` | Invalid NVIDIA API Key | Verify `NVIDIA_API_KEY` in `.env`. |
| `SSL verification error` | Proxy inspection blocking HTTPS | Set `GITHUB_SSL_VERIFY=false` in `.env`. |
| Pending approval buttons missing | Session state reset | Click **+ New Chat** in sidebar to start a fresh thread. |
