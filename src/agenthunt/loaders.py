from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .paths import catalogs_dir, config_dir


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_runtime() -> dict[str, Any]:
    return _read_json(config_dir() / "runtime.json")


def load_agents_config() -> dict[str, Any]:
    return _read_json(config_dir() / "agents.json")


def load_category(category_id: str) -> dict[str, Any]:
    return _read_json(catalogs_dir() / "categories" / f"{category_id}.json")


def load_mcp_catalog(category_id: str) -> dict[str, Any]:
    return _read_json(catalogs_dir() / "mcps" / f"{category_id}.json")


def load_all_categories() -> list[dict[str, Any]]:
    paths = sorted((catalogs_dir() / "categories").glob("*.json"))
    return [_read_json(path) for path in paths]


def validate_catalogs() -> list[str]:
    errors: list[str] = []
    runtime = load_runtime()
    agents = load_agents_config()
    category_key = "working_categories" if "working_categories" in runtime else "active_categories"
    if category_key not in runtime:
        errors.append("config/runtime.json missing working_categories/active_categories")
    if "default_agent_count" not in agents:
        errors.append("config/agents.json missing default_agent_count")
    category_ids = []
    for category in load_all_categories():
        category_ids.append(category["id"])
        if "core_tasks" not in category or not category["core_tasks"]:
            errors.append(f"category {category['id']} has no core_tasks")
        mcp_path = catalogs_dir() / "mcps" / f"{category['id']}.json"
        if not mcp_path.exists():
            errors.append(f"missing MCP catalog for category {category['id']}")
            continue
        mcp_catalog = load_mcp_catalog(category["id"])
        candidates = mcp_catalog.get("candidates", [])
        min_tools = runtime.get("selection_policy", {}).get("minimum_fake_tools_per_category", 0)
        if len(candidates) < min_tools:
            errors.append(
                f"category {category['id']} has only {len(candidates)} candidates (< {min_tools})"
            )
    active_categories = runtime.get("working_categories", runtime.get("active_categories", []))
    unknown = [cid for cid in active_categories if cid not in category_ids]
    for cid in unknown:
        errors.append(f"runtime references unknown category {cid}")
    return errors
