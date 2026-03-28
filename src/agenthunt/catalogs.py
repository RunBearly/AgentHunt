from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .paths import repo_root


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def load_runtime(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    return load_json(root / "config" / "runtime.json")


def load_runtime_config(root: Path | None = None) -> dict[str, Any]:
    return load_runtime(root)


def load_agents(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    return load_json(root / "config" / "agents.json")


def load_agents_config(root: Path | None = None) -> dict[str, Any]:
    return load_agents(root)


def list_category_ids(root: Path | None = None) -> list[str]:
    root = repo_root(root)
    categories_dir = root / "catalogs" / "categories"
    return sorted(path.stem for path in categories_dir.glob("*.json"))


def load_category(category_id: str, root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    return load_json(root / "catalogs" / "categories" / f"{category_id}.json")


def load_mcp_catalog(category_id: str, root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    return load_json(root / "catalogs" / "mcps" / f"{category_id}.json")


def load_fixture_bundle(category_id: str, root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    category = load_category(category_id, root)
    bundle_path = category.get("fixture_bundle")
    if not bundle_path:
        raise ValueError(f"Category {category_id} is missing fixture_bundle")
    return load_json(root / bundle_path)


def validate_catalogs(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    runtime = load_runtime(root)
    agents = load_agents(root)
    category_ids = list_category_ids(root)

    if not category_ids:
        raise ValueError("No category catalogs found.")

    active_categories = runtime.get("working_categories", runtime.get("active_categories", []))
    if not active_categories:
        raise ValueError("Runtime config must define working_categories or active_categories.")

    min_candidates = (
        runtime.get("selection_policy", {}).get("minimum_candidates_per_category")
        or runtime.get("selection_policy", {}).get("minimum_fake_tools_per_category")
        or 0
    )

    for category_id in active_categories:
        if category_id not in category_ids:
            raise ValueError(f"Runtime references missing category: {category_id}")

    summary: dict[str, Any] = {
        "repo_root": str(root),
        "category_count": len(category_ids),
        "categories": [],
        "default_agent_count": agents["default_agent_count"],
        "tool_mode": runtime.get("execution", {}).get("tool_mode", runtime.get("execution", {}).get("mode", "unknown")),
    }

    for category_id in category_ids:
        category = load_category(category_id, root)
        mcp_catalog = load_mcp_catalog(category_id, root)
        fixture_bundle = load_fixture_bundle(category_id, root)
        if category["id"] != category_id:
            raise ValueError(f"Category id mismatch for {category_id}")
        if mcp_catalog["category_id"] != category_id:
            raise ValueError(f"MCP catalog id mismatch for {category_id}")
        if len(mcp_catalog["candidates"]) < min_candidates:
            raise ValueError(f"Category {category_id} has fewer than minimum candidates.")
        if fixture_bundle.get("category_id") != category_id:
            raise ValueError(f"Fixture bundle category mismatch for {category_id}")
        if "task_fixture_focus" not in category:
            raise ValueError(f"Category {category_id} missing task_fixture_focus")
        summary["categories"].append(
            {
                "id": category_id,
                "tasks": len(category.get("core_tasks", [])),
                "reserve_tasks": len(category.get("reserve_tasks", [])),
                "candidates": len(mcp_catalog.get("candidates", [])),
                "fixture_bundle": category.get("fixture_bundle"),
            }
        )

    return summary
