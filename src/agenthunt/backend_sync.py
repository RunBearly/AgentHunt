from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .catalogs import load_category, load_mcp_catalog, repo_root


def pending_sync_dir(root: Path | None = None) -> Path:
    root = repo_root(root)
    path = root / ".omx" / "pending_sync"
    path.mkdir(parents=True, exist_ok=True)
    (path / "runs").mkdir(parents=True, exist_ok=True)
    return path


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _tool_lookup(category_ids: list[str]) -> dict[tuple[str, str], dict[str, Any]]:
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for category_id in category_ids:
        mcp_catalog = load_mcp_catalog(category_id)
        for candidate in mcp_catalog.get("candidates", []):
            out[(category_id, candidate["id"])] = candidate
    return out


def build_sync_batch(run_dir: Path) -> dict[str, Any]:
    manifest = _read_json(run_dir / "manifest.json")
    evaluations = _read_jsonl(run_dir / "evaluations.jsonl")
    summaries = _read_jsonl(run_dir / "category_summaries.jsonl")
    invocations = _read_jsonl(run_dir / "verified_invocations.jsonl")

    categories = manifest.get("categories", [])
    tool_map = _tool_lookup(categories)

    services: dict[str, dict[str, Any]] = {}
    for category_id in categories:
        category = load_category(category_id)
        mcp_catalog = load_mcp_catalog(category_id)
        for candidate in mcp_catalog.get("candidates", []):
            key = f"{category_id}:{candidate['id']}"
            services[key] = {
                "event_type": "service_registration",
                "local_service_key": key,
                "category_id": category_id,
                "service_id": candidate["id"],
                "service_name": candidate["display_name"],
                "provider": candidate.get("provider"),
                "product_family": candidate.get("product_family"),
                "endpoint": candidate.get("endpoint"),
                "status": candidate.get("status"),
                "category_display_name": category.get("display_name"),
            }

    review_events: list[dict[str, Any]] = []
    for summary in summaries:
        review_events.append(
            {
                "event_type": "review_submission",
                "run_id": manifest["run_id"],
                "category_id": summary["category_id"],
                "tool_id": summary["tool_id"],
                "tool_name": summary["tool_name"],
                "agent_id": summary["agent_id"],
                "agent_persona": summary["agent_persona"],
                "average_score": summary["average_score"],
                "upvotes": summary["upvotes"],
                "downvotes": summary["downvotes"],
                "summary_review": summary["summary_review"],
            }
        )

    invocation_events: list[dict[str, Any]] = []
    for invocation in invocations:
        candidate = tool_map.get((invocation["category_id"], invocation["tool_id"]), {})
        invocation_events.append(
            {
                "event_type": "verified_invocation",
                "run_id": invocation["run_id"],
                "invocation_id": invocation["invocation_id"],
                "category_id": invocation["category_id"],
                "tool_id": invocation["tool_id"],
                "tool_name": candidate.get("display_name", invocation["tool_id"]),
                "agent_id": invocation["agent_id"],
                "status": invocation["status"],
                "fixture_bundle_id": invocation.get("fixture_bundle_id"),
                "created_at": invocation["created_at"],
            }
        )

    payload = {
        "run_id": manifest["run_id"],
        "mode": manifest.get("mode"),
        "generated_at": manifest.get("generated_at"),
        "categories": categories,
        "counts": {
            "service_registration_events": len(services),
            "review_submission_events": len(review_events),
            "verified_invocation_events": len(invocation_events),
            "evaluation_records": len(evaluations),
        },
        "services": list(services.values()),
        "reviews": review_events,
        "verified_invocations": invocation_events,
        "sync_status": "pending_backend_connection",
    }
    return payload


def queue_run_for_later_sync(run_dir: Path) -> Path:
    payload = build_sync_batch(run_dir)
    target = pending_sync_dir() / "runs" / f"{payload['run_id']}.json"
    _write_json(target, payload)
    # convenience copy in run dir
    _write_json(run_dir / "sync_batch.json", payload)
    return target


def pending_sync_status() -> dict[str, Any]:
    runs_dir = pending_sync_dir() / "runs"
    files = sorted(path for path in runs_dir.glob("*.json") if not path.name.endswith(".done.json"))
    payloads = [_read_json(path) for path in files]
    return {
        "pending_run_count": len(files),
        "pending_runs": [
            {
                "run_id": payload["run_id"],
                "categories": payload["categories"],
                "counts": payload["counts"],
                "path": str(files[i]),
            }
            for i, payload in enumerate(payloads)
        ],
    }


def backend_sync_plan(launch_state: dict[str, Any] | None = None) -> dict[str, Any]:
    status = pending_sync_status()
    pending_files = sorted(
        path for path in (pending_sync_dir() / "runs").glob("*.json") if not path.name.endswith(".done.json")
    )
    payloads = [_read_json(path) for path in pending_files]
    total_services = sum(p["counts"]["service_registration_events"] for p in payloads)
    total_reviews = sum(p["counts"]["review_submission_events"] for p in payloads)
    total_invocations = sum(p["counts"]["verified_invocation_events"] for p in payloads)
    ready = bool(launch_state and launch_state.get("ready_for_connection_attempt"))
    return {
        "status": "ready_for_backend_replay" if ready else "waiting_for_launch_commit",
        "launch_ready": ready,
        "launch_commit": None if not launch_state else launch_state.get("launch_commit"),
        "pending_run_count": status["pending_run_count"],
        "queued_events": {
            "service_search_or_register": total_services,
            "review_submit": total_reviews,
            "verified_invocation_record": total_invocations,
        },
        "next_actions": (
            [
                "search_services / get_service_details / get_service_trust_signals per local service",
                "submit_service for missing services",
                "submit_review for queued reviews",
                "record_verified_invocation for queued invocations",
            ]
            if ready
            else [
                "wait for Launch AgentHunt commit on main",
                "parse README MCP server details",
                "then replay queued local artifacts through backend MCP tools",
            ]
        ),
    }
