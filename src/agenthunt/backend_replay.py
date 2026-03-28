from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from statistics import mean
from pathlib import Path
from typing import Any
from concurrent.futures import ThreadPoolExecutor, as_completed

from .backend_sync import pending_sync_dir
from .launch_watch import launch_watch_state_path


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


def backend_connection_config_path(root: Path | None = None) -> Path:
    base = pending_sync_dir(root)
    return base / "backend-connection.json"


def vote_replay_state_path(root: Path | None = None) -> Path:
    base = pending_sync_dir(root)
    return base / "vote-replay-state.json"


def _load_launch_state() -> dict[str, Any]:
    path = launch_watch_state_path()
    return _read_json(path) if path.exists() else {}


def _load_backend_config() -> dict[str, Any]:
    path = backend_connection_config_path()
    return _read_json(path) if path.exists() else {}


def _load_vote_replay_state() -> dict[str, Any]:
    path = vote_replay_state_path()
    if not path.exists():
        return {"processed_vote_ids": []}
    return _read_json(path)


def _write_vote_replay_state(payload: dict[str, Any]) -> None:
    vote_replay_state_path().write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _json_rpc_call(config: dict[str, Any], method: str, params: dict[str, Any]) -> dict[str, Any]:
    endpoint = config["endpoint"]
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(endpoint, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for key, value in config.get("headers", {}).items():
        req.add_header(key, value)
    context = ssl._create_unverified_context() if config.get("insecure_ssl") else None
    with urllib.request.urlopen(req, timeout=config.get("timeout_seconds", 20), context=context) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body) if body else {"ok": True, "status": resp.status}


def _mcp_streamable_http_tool_call(config: dict[str, Any], tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    endpoint = config["endpoint"]
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(endpoint, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json, text/event-stream")
    for key, value in config.get("headers", {}).items():
        req.add_header(key, value)
    context = ssl._create_unverified_context() if config.get("insecure_ssl") else None
    with urllib.request.urlopen(req, timeout=config.get("timeout_seconds", 30), context=context) as resp:
        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            parts: list[str] = []
            for _ in range(200):
                line = resp.readline().decode("utf-8", "ignore")
                if not line:
                    break
                if line.startswith("data:"):
                    chunk = line[len("data:"):].strip()
                    if chunk:
                        parts.append(chunk)
                        try:
                            return _normalize_mcp_result(json.loads(chunk))
                        except json.JSONDecodeError:
                            continue
            return {"raw": "\n".join(parts), "error": "no_parseable_sse_payload"}
        raw = resp.read().decode("utf-8", "ignore")
        return _normalize_mcp_result(json.loads(raw)) if raw.strip().startswith("{") else {"raw": raw}


def _normalize_mcp_result(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("result", payload)
    if isinstance(result, dict):
        content = result.get("content")
        if isinstance(content, list) and content:
            first = content[0]
            if isinstance(first, dict) and first.get("type") == "text":
                text = first.get("text", "").strip()
                if text.startswith("{") or text.startswith("["):
                    try:
                        parsed = json.loads(text)
                        return parsed if isinstance(parsed, dict) else {"data": parsed}
                    except json.JSONDecodeError:
                        pass
        return result
    return {"data": result}


def _sync_service(config: dict[str, Any], service: dict[str, Any]) -> dict[str, Any]:
    caller = _mcp_streamable_http_tool_call if config.get("transport") == "mcp_streamable_http" else _json_rpc_call
    search = caller(
        config,
        "search_services",
        {
            "query": service["service_name"],
        },
    )
    results = search.get("result") or search.get("data") or []
    if isinstance(results, dict):
        results = results.get("services", [])
    if results:
        first = results[0]
        service_id = first.get("id") or first.get("serviceId") or first.get("service_id") or service["service_id"]
        details = caller(config, "get_service_details", {"serviceId": service_id})
        trust = caller(config, "get_service_trust_signals", {"serviceId": service_id})
        return {
            "status": "existing",
            "service_id": service_id,
            "details": details,
            "trust": trust,
        }
    created = caller(
        config,
        "submit_service",
        {
            "name": service["service_name"],
            "tagline": f"{service['service_name']} in category {service['category_display_name']}",
            "description": f"Auto-submitted from AgentHunt simulation for category {service['category_display_name']}. Provider={service.get('provider')}, family={service.get('product_family')}.",
            "mcpEndpoint": service.get("endpoint") or f"fake://{service['category_id']}/{service['service_id']}",
            "category": service["category_display_name"],
            "capabilities": [service.get("product_family", service["category_id"])],
            "providerAgentName": "AgentHunt Simulation",
            "providerAgentType": "simulation",
            "authMode": "none",
            "pricingModel": "unknown",
            "usageExample": f"Simulated use of {service['service_name']} for {service['category_display_name']} tasks.",
        },
    )
    created_result = created
    return {
        "status": "created",
        "service_id": created_result.get("id") or created_result.get("serviceId") or created_result.get("service_id") or service["service_id"],
        "details": created_result,
    }


def _sync_review(config: dict[str, Any], review: dict[str, Any], resolved_services: dict[tuple[str, str], str]) -> dict[str, Any]:
    service_id = resolved_services[(review["category_id"], review["tool_id"])]
    caller = _mcp_streamable_http_tool_call if config.get("transport") == "mcp_streamable_http" else _json_rpc_call
    response = caller(
        config,
        "submit_review",
        {
            "serviceId": service_id,
            "agent": f"{review['agent_id']}:{review['agent_persona']}",
            "score": max(0, min(5, round(float(review["average_score"]) * 5, 2))),
            "tested": f"{review['category_id']} simulated tasks in run {review['run_id']}",
            "summary": review["summary_review"],
        },
    )
    return response


def _sync_invocation(config: dict[str, Any], invocation: dict[str, Any], resolved_services: dict[tuple[str, str], str]) -> dict[str, Any]:
    service_id = resolved_services[(invocation["category_id"], invocation["tool_id"])]
    caller = _mcp_streamable_http_tool_call if config.get("transport") == "mcp_streamable_http" else _json_rpc_call
    response = caller(
        config,
        "record_verified_invocation",
        {
            "serviceId": service_id,
            "agent": invocation["agent_id"],
            "success": invocation["status"].startswith("verified"),
            "latencyMs": 0,
        },
    )
    return response


def _sync_vote(config: dict[str, Any], evaluation: dict[str, Any]) -> dict[str, Any]:
    vote = evaluation.get("vote")
    if vote not in {"upvote", "downvote"}:
        return {"status": "skipped", "reason": "neutral-or-missing-vote"}
    caller = _mcp_streamable_http_tool_call if config.get("transport") == "mcp_streamable_http" else _json_rpc_call
    tool_name = "upvote_service" if vote == "upvote" else "downvote_service"
    response = caller(
        config,
        tool_name,
        {
            "serviceId": evaluation["tool_id"],
            "agent": f"{evaluation.get('agent_id')}:{evaluation.get('agent_persona')}",
        },
    )
    return {"status": "sent", "tool_name": tool_name, "response": response}


def sync_pending_batches() -> dict[str, Any]:
    launch_state = _load_launch_state()
    config = _load_backend_config()
    if not config:
        return {
            "status": "waiting_for_backend_connection_config",
            "launch_state": launch_state,
            "config_path": str(backend_connection_config_path()),
        }
    if config.get("transport") == "mock":
        runs_dir = pending_sync_dir() / "runs"
        batch_files = sorted(path for path in runs_dir.glob("*.json") if not path.name.endswith(".done.json"))
        report = {"status": "ok", "processed_batches": 0, "batch_reports": [], "transport": "mock"}
        for batch_path in batch_files:
            batch = _read_json(batch_path)
            done_path = batch_path.with_suffix(".done.json")
            batch["sync_status"] = "synced"
            batch["synced_via"] = "mock"
            done_path.write_text(json.dumps(batch, indent=2) + "\n", encoding="utf-8")
            batch_path.unlink()
            report["processed_batches"] += 1
            report["batch_reports"].append({"run_id": batch["run_id"], "done_path": str(done_path)})
        return report
    if config.get("transport") not in {"http_jsonrpc", "mcp_streamable_http"}:
        return {
            "status": "unsupported_transport",
            "transport": config.get("transport"),
            "config_path": str(backend_connection_config_path()),
        }

    runs_dir = pending_sync_dir() / "runs"
    batch_files = sorted(path for path in runs_dir.glob("*.json") if not path.name.endswith(".done.json"))
    report = {
        "status": "ok",
        "processed_batches": 0,
        "batch_reports": [],
    }
    for batch_path in batch_files:
        batch = _read_json(batch_path)
        resolved_services: dict[tuple[str, str], str] = {}
        service_reports = []
        for service in batch.get("services", []):
            result = _sync_service(config, service)
            resolved_services[(service["category_id"], service["service_id"])] = result["service_id"]
            service_reports.append({"service_name": service["service_name"], **result})
        review_reports = []
        for review in batch.get("reviews", []):
            review_reports.append(_sync_review(config, review, resolved_services))
        invocation_reports = []
        for invocation in batch.get("verified_invocations", []):
            invocation_reports.append(_sync_invocation(config, invocation, resolved_services))

        done_path = batch_path.with_suffix(".done.json")
        batch["sync_status"] = "synced"
        batch["synced_via"] = config.get("transport")
        batch["synced_reports"] = {
            "services": service_reports,
            "reviews": review_reports,
            "verified_invocations": invocation_reports,
        }
        done_path.write_text(json.dumps(batch, indent=2) + "\n", encoding="utf-8")
        if batch_path.exists():
            batch_path.unlink()
        report["processed_batches"] += 1
        report["batch_reports"].append(
            {
                "run_id": batch["run_id"],
                "done_path": str(done_path),
                "service_events": len(service_reports),
                "review_events": len(review_reports),
                "invocation_events": len(invocation_reports),
            }
        )
    return report


def maybe_sync_pending_batches() -> dict[str, Any]:
    config = _load_backend_config()
    if not config:
        return {
            "status": "skipped_no_backend_config",
            "config_path": str(backend_connection_config_path()),
        }
    try:
        return sync_pending_batches()
    except Exception as exc:  # pragma: no cover - best effort for unattended runs
        return {
            "status": "sync_failed",
            "error": type(exc).__name__,
            "detail": str(exc),
        }


def replay_all_local_votes() -> dict[str, Any]:
    config = _load_backend_config()
    if not config:
        return {
            "status": "waiting_for_backend_connection_config",
            "config_path": str(backend_connection_config_path()),
        }
    if config.get("transport") not in {"http_jsonrpc", "mcp_streamable_http"}:
        return {
            "status": "unsupported_transport",
            "transport": config.get("transport"),
            "config_path": str(backend_connection_config_path()),
        }

    state = _load_vote_replay_state()
    processed = set(state.get("processed_vote_ids", []))
    root = pending_sync_dir().parent.parent
    runs_dir = root / "results" / "runs"
    report = {
        "status": "ok",
        "sent": 0,
        "skipped": 0,
        "errors": [],
    }

    for run_dir in sorted(runs_dir.glob("run-*")):
        evaluations_path = run_dir / "evaluations.jsonl"
        if not evaluations_path.exists():
            continue
        for evaluation in _read_jsonl(evaluations_path):
            vote_id = "|".join(
                [
                    evaluation.get("run_id", ""),
                    evaluation.get("category_id", ""),
                    evaluation.get("task_id", ""),
                    evaluation.get("tool_id", ""),
                    evaluation.get("agent_id", ""),
                    evaluation.get("vote", ""),
                ]
            )
            if vote_id in processed:
                report["skipped"] += 1
                continue
            result = _sync_vote(config, evaluation)
            if result.get("status") == "sent":
                processed.add(vote_id)
                report["sent"] += 1
            else:
                report["skipped"] += 1

    _write_vote_replay_state({"processed_vote_ids": sorted(processed)})
    report["processed_vote_ids"] = len(processed)
    return report


def replay_local_votes_chunk(limit: int = 50) -> dict[str, Any]:
    config = _load_backend_config()
    if not config:
        return {
            "status": "waiting_for_backend_connection_config",
            "config_path": str(backend_connection_config_path()),
        }
    if config.get("transport") not in {"http_jsonrpc", "mcp_streamable_http"}:
        return {
            "status": "unsupported_transport",
            "transport": config.get("transport"),
            "config_path": str(backend_connection_config_path()),
        }

    state = _load_vote_replay_state()
    processed = set(state.get("processed_vote_ids", []))
    root = pending_sync_dir().parent.parent
    runs_dir = root / "results" / "runs"
    report = {
        "status": "ok",
        "sent": 0,
        "skipped": 0,
        "limit": limit,
        "errors": [],
    }

    for run_dir in sorted(runs_dir.glob("run-*")):
        evaluations_path = run_dir / "evaluations.jsonl"
        if not evaluations_path.exists():
            continue
        for evaluation in _read_jsonl(evaluations_path):
            if report["sent"] >= limit:
                _write_vote_replay_state({"processed_vote_ids": sorted(processed)})
                report["processed_vote_ids"] = len(processed)
                return report
            vote_id = "|".join(
                [
                    evaluation.get("run_id", ""),
                    evaluation.get("category_id", ""),
                    evaluation.get("task_id", ""),
                    evaluation.get("tool_id", ""),
                    evaluation.get("agent_id", ""),
                    evaluation.get("vote", ""),
                ]
            )
            if vote_id in processed:
                report["skipped"] += 1
                continue
            try:
                result = _sync_vote(config, evaluation)
            except Exception as exc:  # pragma: no cover - defensive network guard
                report["errors"].append(
                    {
                        "vote_id": vote_id,
                        "error": type(exc).__name__,
                        "detail": str(exc),
                    }
                )
                _write_vote_replay_state({"processed_vote_ids": sorted(processed)})
                report["processed_vote_ids"] = len(processed)
                return report
            if result.get("status") == "sent":
                processed.add(vote_id)
                report["sent"] += 1
            else:
                report["skipped"] += 1

    _write_vote_replay_state({"processed_vote_ids": sorted(processed)})
    report["processed_vote_ids"] = len(processed)
    return report


def replay_local_votes_parallel_chunk(limit: int = 200, workers: int = 8) -> dict[str, Any]:
    config = _load_backend_config()
    if not config:
        return {
            "status": "waiting_for_backend_connection_config",
            "config_path": str(backend_connection_config_path()),
        }
    if config.get("transport") not in {"http_jsonrpc", "mcp_streamable_http"}:
        return {
            "status": "unsupported_transport",
            "transport": config.get("transport"),
            "config_path": str(backend_connection_config_path()),
        }

    state = _load_vote_replay_state()
    processed = set(state.get("processed_vote_ids", []))
    root = pending_sync_dir().parent.parent
    runs_dir = root / "results" / "runs"
    pending: list[tuple[str, dict[str, Any]]] = []

    for run_dir in sorted(runs_dir.glob("run-*")):
        evaluations_path = run_dir / "evaluations.jsonl"
        if not evaluations_path.exists():
            continue
        for evaluation in _read_jsonl(evaluations_path):
            vote_id = "|".join(
                [
                    evaluation.get("run_id", ""),
                    evaluation.get("category_id", ""),
                    evaluation.get("task_id", ""),
                    evaluation.get("tool_id", ""),
                    evaluation.get("agent_id", ""),
                    evaluation.get("vote", ""),
                ]
            )
            if evaluation.get("vote") not in {"upvote", "downvote"}:
                continue
            if vote_id in processed:
                continue
            pending.append((vote_id, evaluation))
            if len(pending) >= limit:
                break
        if len(pending) >= limit:
            break

    report = {
        "status": "ok",
        "limit": limit,
        "workers": workers,
        "queued_for_attempt": len(pending),
        "sent": 0,
        "skipped": 0,
        "errors": [],
    }

    def _send_one(vote_id: str, evaluation: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        return vote_id, _sync_vote(config, evaluation)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(_send_one, vote_id, evaluation) for vote_id, evaluation in pending]
        for future in as_completed(futures):
            try:
                vote_id, result = future.result()
            except Exception as exc:  # pragma: no cover
                report["errors"].append({"error": type(exc).__name__, "detail": str(exc)})
                continue
            if result.get("status") == "sent":
                processed.add(vote_id)
                report["sent"] += 1
            else:
                report["skipped"] += 1

    _write_vote_replay_state({"processed_vote_ids": sorted(processed)})
    report["processed_vote_ids"] = len(processed)
    return report
