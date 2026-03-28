from __future__ import annotations

import json
from typing import Any

from .llm_clients import call_llm_json


SYSTEM_PROMPT = """You are an evaluator agent inside AgentHunt.
You are comparing a fake MCP tool profile against a task and fixture context.
Return strict JSON with keys:
- score (float 0.0 to 1.0)
- vote ("upvote" | "neutral" | "downvote")
- short_review (string, <= 40 words)
- rationale_tags (array of short strings)
Be decisive and grounded in the provided tool strengths/weaknesses, the task, and the persona."""


def build_user_prompt(
    category_id: str,
    task: dict[str, Any],
    tool: dict[str, Any],
    agent: Any,
    fixture_bundle: dict[str, Any],
    fixture_focus: str | None,
) -> str:
    fixture_preview = json.dumps(fixture_bundle, ensure_ascii=False)[:1800]
    return json.dumps(
        {
            "category_id": category_id,
            "task": {
                "id": task["id"],
                "title": task["title"],
                "goal": task["goal"],
                "fixture_focus": fixture_focus,
            },
            "tool": {
                "id": tool["id"],
                "name": tool["display_name"],
                "profile": tool["fake_profile"],
            },
            "agent": {
                "agent_id": agent.agent_id,
                "persona": agent.persona,
                "model": agent.model,
                "style_bias": agent.style_bias,
            },
            "fixture_preview": fixture_preview,
            "instructions": {
                "review_style": "short-structured",
                "vote_mode": "per-task",
                "named_mcp_visibility": True,
            },
        },
        ensure_ascii=False,
    )


def evaluate_with_llm(
    category_id: str,
    task: dict[str, Any],
    tool: dict[str, Any],
    agent: Any,
    fixture_bundle: dict[str, Any],
    fixture_focus: str | None,
    insecure_ssl: bool = False,
) -> dict[str, Any]:
    user_prompt = build_user_prompt(
        category_id=category_id,
        task=task,
        tool=tool,
        agent=agent,
        fixture_bundle=fixture_bundle,
        fixture_focus=fixture_focus,
    )
    result = call_llm_json(
        model=agent.model,
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        insecure_ssl=insecure_ssl,
    )
    result.setdefault("score", 0.5)
    result.setdefault("vote", "neutral")
    result.setdefault("short_review", "No review generated.")
    result.setdefault("rationale_tags", [])
    return result
