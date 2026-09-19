import base64
import os
import warnings
from pathlib import Path

import requests
from dotenv import load_dotenv
from langchain_core.tools import tool

load_dotenv(Path(__file__).with_name(".env"))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

API = "https://api.github.com"


def _headers():
    # Dynamically reload .env in case keys were updated while app is running.
    load_dotenv(Path(__file__).with_name(".env"), override=True)
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is missing from .env")
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}


def _repo(repo: str) -> str:
    # Accept either "owner/repository" or just "repository".
    repo = repo.strip().strip("/")
    if "/" not in repo:
        owner = os.getenv("GITHUB_OWNER")
        if not owner:
            raise ValueError("Use owner/repository or set GITHUB_OWNER in .env")
        repo = f"{owner}/{repo}"
    if len(repo.split("/")) != 2:
        raise ValueError("Repository must look like owner/repository")
    return repo


def _request(method: str, path: str, **kwargs):
    # Keep all HTTP communication in one helper so tools share auth and error handling.
    try:
        verify_tls = os.getenv("GITHUB_SSL_VERIFY", "true").lower() != "false"
        if not verify_tls:
            warnings.warn("GITHUB_SSL_VERIFY=false disables TLS verification for local demo use.")
        response = requests.request(
            method,
            API + path,
            headers=_headers(),
            timeout=20,
            verify=verify_tls,
            **kwargs,
        )
    except RuntimeError as error:
        return {"error": str(error)}
    except requests.RequestException as error:
        return {"error": f"GitHub network error: {error}"}
    if response.status_code == 403 and "rate limit" in response.text.lower():
        return {"error": "GitHub rate limit exceeded"}
    if not response.ok:
        return {"error": f"GitHub API {response.status_code}: {response.text[:300]}"}
    return response.json() if response.content else {"ok": True}


def _summarize(items):
    # Return only useful fields instead of sending large GitHub responses to the LLM.
    return [{key: item.get(key) for key in ("number", "title", "state", "html_url", "name", "full_name")} for item in items]


@tool
def get_repositories() -> dict:
    """List repositories visible to the configured GitHub token."""
    # This is a read-only tool, so the agent can run it without approval.
    result = _request("GET", "/user/repos?sort=updated&per_page=20")
    if not isinstance(result, list):
        return result
    return {
        "repositories": [
            {
                "name": item.get("name"),
                "full_name": item.get("full_name"),
                "visibility": "Private" if item.get("private") else "Public",
                "url": item.get("html_url"),
            }
            for item in result
        ]
    }


@tool
def get_issues(repo: str, state: str = "open") -> dict:
    """List issues in owner/repository. State must be open, closed, or all."""
    if state not in {"open", "closed", "all"}:
        return {"error": "state must be open, closed, or all"}
    result = _request("GET", f"/repos/{_repo(repo)}/issues?state={state}&per_page=30")
    return {"issues": _summarize(result)} if isinstance(result, list) else result


@tool
def get_issue(repo: str, issue_number: int) -> dict:
    """Get one issue by number."""
    if issue_number < 1:
        return {"error": "issue_number must be positive"}
    return _request("GET", f"/repos/{_repo(repo)}/issues/{issue_number}")


@tool
def get_pull_requests(repo: str, state: str = "open") -> dict:
    """List pull requests in owner/repository."""
    if state not in {"open", "closed", "all"}:
        return {"error": "state must be open, closed, or all"}
    result = _request("GET", f"/repos/{_repo(repo)}/pulls?state={state}&per_page=30")
    return {"pull_requests": _summarize(result)} if isinstance(result, list) else result


@tool
def get_branches(repo: str) -> dict:
    """List branches in owner/repository."""
    result = _request("GET", f"/repos/{_repo(repo)}/branches?per_page=50")
    return {"branches": [item.get("name") for item in result]} if isinstance(result, list) else result


@tool
def get_file(repo: str, path: str, ref: str = "main") -> dict:
    """Read a text file from a repository at a branch or commit."""
    result = _request("GET", f"/repos/{_repo(repo)}/contents/{path.lstrip('/')}?ref={ref}")
    if isinstance(result, dict) and result.get("content"):
        result["decoded_content"] = base64.b64decode(result["content"]).decode("utf-8", errors="replace")
    return result


@tool
def get_workflow_runs(repo: str) -> dict:
    """List the latest GitHub Actions workflow runs."""
    result = _request("GET", f"/repos/{_repo(repo)}/actions/runs?per_page=10")
    if isinstance(result, dict) and "workflow_runs" in result:
        return {"workflow_runs": _summarize(result["workflow_runs"])}
    return result


@tool
def get_latest_commit() -> dict:
    """Find the latest commit across the authenticated user's recently pushed repositories."""
    # Check the latest commit in each recently pushed repository, then compare dates.
    repositories = _request("GET", "/user/repos?sort=pushed&direction=desc&per_page=20")
    if not isinstance(repositories, list):
        return repositories

    latest = []
    for repository in repositories:
        full_name = repository.get("full_name")
        if not full_name:
            continue
        commits = _request("GET", f"/repos/{full_name}/commits?per_page=1")
        if isinstance(commits, list) and commits:
            commit = commits[0]
            details = commit.get("commit", {})
            latest.append(
                {
                    "repository": full_name,
                    "message": details.get("message", "").splitlines()[0],
                    "author": (details.get("author") or {}).get("name"),
                    "date": (details.get("author") or {}).get("date"),
                    "sha": commit.get("sha", "")[:7],
                    "url": commit.get("html_url"),
                }
            )

    latest.sort(key=lambda item: item.get("date") or "", reverse=True)
    return {"latest_commit": latest[0] if latest else None, "repositories_checked": len(latest)}


@tool
def create_issue(repo: str, title: str, body: str = "") -> dict:
    """Create a GitHub issue. Requires human approval in the agent."""
    # Write tools are protected by the approval workflow in backend.py.
    if not title.strip():
        return {"error": "title is required"}
    return _request("POST", f"/repos/{_repo(repo)}/issues", json={"title": title, "body": body})


@tool
def comment_on_issue(repo: str, issue_number: int, comment: str) -> dict:
    """Add a comment to an issue. Requires human approval in the agent."""
    if issue_number < 1 or not comment.strip():
        return {"error": "issue_number and comment are required"}
    return _request("POST", f"/repos/{_repo(repo)}/issues/{issue_number}/comments", json={"body": comment})


@tool
def create_branch(repo: str, branch: str, from_branch: str = "main") -> dict:
    """Create a branch. Requires human approval in the agent."""
    if not branch.strip():
        return {"error": "branch is required"}
    base = _request("GET", f"/repos/{_repo(repo)}/git/ref/heads/{from_branch}")
    if "object" not in base:
        return base
    return _request("POST", f"/repos/{_repo(repo)}/git/refs", json={"ref": f"refs/heads/{branch}", "sha": base["object"]["sha"]})


@tool
def create_pull_request(repo: str, title: str, head: str, base: str = "main", body: str = "") -> dict:
    """Create a pull request. Requires human approval in the agent."""
    if not title.strip() or not head.strip():
        return {"error": "title and head are required"}
    return _request("POST", f"/repos/{_repo(repo)}/pulls", json={"title": title, "head": head, "base": base, "body": body})


@tool
def merge_pull_request(repo: str, pull_number: int, merge_method: str = "merge") -> dict:
    """Merge a pull request. Requires explicit human approval in the agent."""
    if pull_number < 1 or merge_method not in {"merge", "squash", "rebase"}:
        return {"error": "invalid pull number or merge method"}
    return _request("PUT", f"/repos/{_repo(repo)}/pulls/{pull_number}/merge", json={"merge_method": merge_method})


@tool
def update_file(repo: str, path: str, content: str, message: str, branch: str = "main") -> dict:
    """Update a repository file. Requires human approval in the agent."""
    existing = _request("GET", f"/repos/{_repo(repo)}/contents/{path.lstrip('/')}?ref={branch}")
    if not isinstance(existing, dict) or "sha" not in existing:
        return existing
    encoded = base64.b64encode(content.encode()).decode()
    return _request("PUT", f"/repos/{_repo(repo)}/contents/{path.lstrip('/')}", json={"message": message, "content": encoded, "sha": existing["sha"], "branch": branch})


@tool
def create_repository(name: str, description: str = "", private: bool = False) -> dict:
    """Create a repository in the authenticated user's GitHub account. Requires approval."""
    name = name.strip()
    if not name or "/" in name or len(name) > 100:
        return {"error": "Repository name must be 1-100 characters and cannot contain '/'."}
    return _request(
        "POST",
        "/user/repos",
        json={"name": name, "description": description, "private": private},
    )


@tool
def update_repository_visibility(repo: str, private: bool) -> dict:
    """Change a repository between public and private. Requires approval."""
    return _request("PATCH", f"/repos/{_repo(repo)}", json={"private": private})


@tool
def delete_repository(repo: str) -> dict:
    """Permanently delete a repository. Requires explicit human approval."""
    return _request("DELETE", f"/repos/{_repo(repo)}")


# Binding this list to the LLM exposes only these approved GitHub capabilities.
ALL_TOOLS = [
    get_repositories, get_issues, get_issue, get_pull_requests, get_branches,
    get_file, get_workflow_runs, get_latest_commit, create_issue, comment_on_issue, create_branch,
    create_pull_request, merge_pull_request, update_file, create_repository,
    update_repository_visibility, delete_repository,
]
# These tools can change or delete GitHub data and require human approval.
RISKY_TOOLS = {
    "create_issue", "comment_on_issue", "create_branch", "create_pull_request",
    "merge_pull_request", "update_file", "create_repository",
    "update_repository_visibility", "delete_repository",
}
TOOL_MAP = {item.name: item for item in ALL_TOOLS}
