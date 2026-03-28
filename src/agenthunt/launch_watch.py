from __future__ import annotations

import json
import re
import ssl
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .catalogs import repo_root


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _github_repo_slug() -> str | None:
    config_path = repo_root() / ".git" / "config"
    if not config_path.exists():
        return None
    text = config_path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"url = https://github\.com/(.+?)(?:\.git)?\n", text)
    if not match:
        return None
    url = f"https://github.com/{match.group(1)}"
    match = re.search(r"github\.com[:/](.+?)(?:\.git)?$", url)
    return match.group(1) if match else None


def _run_git(args: list[str]) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=repo_root(),
        capture_output=True,
        text=True,
        check=True,
    )
    return proc.stdout


def _github_json(url: str) -> Any:
    ctx = ssl._create_unverified_context()
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "agenthunt-launch-watch")
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _github_text(url: str) -> str:
    ctx = ssl._create_unverified_context()
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "agenthunt-launch-watch")
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        return resp.read().decode("utf-8", "ignore")


def _probe_endpoint(url: str) -> dict[str, Any]:
    ctx = ssl._create_unverified_context()
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "agenthunt-launch-watch")
    try:
        with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
            return {
                "ok": True,
                "status": resp.status,
                "content_type": resp.headers.get("content-type"),
            }
    except Exception as exc:
        return {
            "ok": False,
            "error": type(exc).__name__,
            "detail": str(exc),
        }


def launch_watch_state_path(root: Path | None = None) -> Path:
    root = repo_root(root)
    path = root / ".omx" / "state" / "launch-watch-state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _backend_connection_config_path(root: Path | None = None) -> Path:
    root = repo_root(root)
    path = root / ".omx" / "pending_sync" / "backend-connection.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _read_state() -> dict[str, Any]:
    path = launch_watch_state_path()
    if not path.exists():
        return {"created_at": utc_now(), "checks": 0}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_state(payload: dict[str, Any]) -> None:
    launch_watch_state_path().write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _extract_mcp_hints(readme_text: str) -> list[str]:
    hints: list[str] = []
    patterns = [
        r".*mcp.*",
        r".*server.*",
        r".*http[s]?://.*",
        r".*stdio.*",
        r".*sse.*",
        r".*command.*",
        r".*search_services.*",
        r".*submit_review.*",
        r".*record_verified_invocation.*",
    ]
    for line in readme_text.splitlines():
        stripped = line.strip()
        low = stripped.lower()
        if any(re.match(pat, low) for pat in patterns):
            hints.append(stripped)
    # dedupe preserving order
    seen = set()
    ordered: list[str] = []
    for hint in hints:
        if hint not in seen:
            seen.add(hint)
            ordered.append(hint)
    return ordered[:80]


def _extract_urls(text: str) -> list[str]:
    urls = re.findall(r"https?://[^\s)>'\"]+", text)
    seen: set[str] = set()
    ordered: list[str] = []
    for url in urls:
        url = url.rstrip("`.,")
        if url not in seen:
            seen.add(url)
            ordered.append(url)
    return ordered


def _guess_transport(hints: list[str], urls: list[str]) -> str | None:
    blob = "\n".join(hints).lower()
    if "streamable http" in blob and any("/mcp" in url for url in urls):
        return "mcp_streamable_http"
    if "stdio" in blob or "command" in blob:
        return "stdio"
    if "sse" in blob:
        return "sse"
    if urls:
        return "http_jsonrpc"
    return None


def _write_backend_config_draft(state: dict[str, Any]) -> None:
    urls = state.get("candidate_endpoints", [])
    transport = state.get("candidate_transport")
    if not urls or not transport:
        return
    endpoint = None
    if transport == "mcp_streamable_http":
        endpoint = next((u for u in urls if "/mcp" in u and "localhost" not in u), None) or next((u for u in urls if "/mcp" in u), None)
    elif transport == "http_jsonrpc":
        endpoint = next((u for u in urls if "localhost" not in u), None) or urls[0]
    else:
        endpoint = next((u for u in urls if "localhost" not in u), None) or urls[0]
    if not endpoint:
        return
    path = _backend_connection_config_path()
    payload = {
        "source": "launch-watch-readme-draft",
        "transport": transport,
        "endpoint": endpoint,
        "headers": {},
        "timeout_seconds": 20,
        "insecure_ssl": True,
        "notes": [
            "Auto-drafted from Launch AgentHunt README hints.",
            "Review transport/headers once the backend MCP README lands.",
        ],
    }
    if transport == "mcp_streamable_http":
        payload["headers"]["Accept"] = "application/json, text/event-stream"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def check_for_launch_commit(fetch: bool = False) -> dict[str, Any]:
    state = _read_state()
    slug = _github_repo_slug()
    state["repo_slug"] = slug
    commit = ""
    if fetch:
        try:
            _run_git(["fetch", "origin"])
            state["last_fetch_at"] = utc_now()
        except Exception as exc:
            state["last_fetch_error"] = str(exc)
    try:
        commit = _run_git(["log", "origin/main", "--grep=^Launch AgentHunt", "-n", "1", "--format=%H"]).strip()
    except Exception:
        commit = ""

    attempted_github_fallback = False
    if slug:
        try:
            if not commit and not fetch:
                attempted_github_fallback = True
                commits = _github_json(f"https://api.github.com/repos/{slug}/commits?sha=main&per_page=50")
                for entry in commits:
                    msg = entry.get("commit", {}).get("message", "")
                    if msg.startswith("Launch AgentHunt"):
                        commit = entry.get("sha", "")
                        break
        except Exception as exc:
            state["last_fetch_error"] = str(exc)
    else:
        state["last_fetch_error"] = "Could not determine GitHub origin slug"
    if fetch and not attempted_github_fallback:
        state.pop("last_fetch_error", None)

    state["checks"] = int(state.get("checks", 0)) + 1
    state["last_checked_at"] = utc_now()
    state["launch_commit_found"] = bool(commit)

    if not commit:
        _write_state(state)
        return state

    state["launch_commit"] = commit
    subject = ""
    try:
        subject = _run_git(["log", "-n", "1", "--format=%s", commit]).strip()
    except Exception:
        subject = ""
    if slug and not subject:
        try:
            commit_obj = _github_json(f"https://api.github.com/repos/{slug}/commits/{commit}")
            subject = commit_obj.get("commit", {}).get("message", "").splitlines()[0]
        except Exception:
            subject = ""
    state["launch_subject"] = subject

    readme_text = ""
    targets: list[str] = []
    try:
        targets.append(f"git:{commit}:README.md")
    except Exception:
        pass
    if slug:
        targets.extend(
            [
                f"https://raw.githubusercontent.com/{slug}/{commit}/README.md",
                f"https://raw.githubusercontent.com/{slug}/main/README.md",
            ]
        )
    targets.append(str(repo_root() / "README.md"))
    for target in targets:
        try:
            if target.startswith("git:"):
                _, git_commit, git_path = target.split(":", 2)
                readme_text = _run_git(["show", f"{git_commit}:{git_path}"])
            elif target.startswith("http"):
                readme_text = _github_text(target)
            else:
                readme_text = Path(target).read_text(encoding="utf-8")
            if readme_text:
                break
        except Exception:
            continue

    state["readme_excerpt"] = readme_text[:4000]
    state["mcp_hints"] = _extract_mcp_hints(readme_text)
    state["candidate_endpoints"] = _extract_urls(readme_text)
    state["candidate_transport"] = _guess_transport(state["mcp_hints"], state["candidate_endpoints"])
    probe_target = None
    if state["candidate_transport"] == "mcp_streamable_http":
        probe_target = next((u for u in state["candidate_endpoints"] if "/mcp" in u and "localhost" not in u), None)
    if not probe_target:
        probe_target = next((u for u in state["candidate_endpoints"] if "localhost" not in u), None)
    state["endpoint_probe"] = _probe_endpoint(probe_target) if probe_target else {"ok": False, "error": "no_probe_target"}
    state["ready_for_connection_attempt"] = bool(state["mcp_hints"]) and bool(state["endpoint_probe"].get("ok"))
    _write_backend_config_draft(state)
    _write_state(state)
    return state


def watch_for_launch(interval_seconds: int = 900, fetch: bool = False, max_checks: int | None = None) -> dict[str, Any]:
    last = {}
    checks = 0
    while True:
        last = check_for_launch_commit(fetch=fetch)
        checks += 1
        if last.get("ready_for_connection_attempt"):
            return last
        if max_checks is not None and checks >= max_checks:
            return last
        time.sleep(interval_seconds)
