from __future__ import annotations

import hashlib
import json
import random
import statistics
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .backend_replay import maybe_sync_pending_batches
from .backend_sync import queue_run_for_later_sync
from .catalogs import (
    load_agents_config,
    load_category,
    load_fixture_bundle,
    load_mcp_catalog,
    load_runtime_config,
    repo_root,
)
from .llm_clients import load_dotenv_if_present, provider_for_model
from .real_evaluator import evaluate_with_llm


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_seed(*parts: str) -> int:
    joined = '::'.join(parts)
    return int(hashlib.sha256(joined.encode()).hexdigest()[:16], 16)


@dataclass
class Agent:
    agent_id: str
    persona: str
    model: str
    style_bias: str


MODEL_CYCLE = [
    'gpt-5.4-nano',
    'gpt-5.4-mini',
    'claude-haiku-4-5-20251001',
    'gpt-5.4-nano',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
]

STYLE_BIAS = {
    'speed-first': 'prefers fast/concise tools',
    'careful-verifier': 'prefers reliable/evidence-rich tools',
    'power-user': 'prefers deeper capability surfaces',
    'novice-discoverability': 'prefers easy-to-understand tools',
    'workflow-optimizer': 'prefers structured actionability',
    'executive-briefing': 'prefers concise summaries',
    'search-first': 'prefers strong retrieval',
    'ops-minded': 'prefers operational predictability',
    'detail-oriented': 'prefers completeness',
    'quality-sensitive': 'prefers polished output',
    'concise-reviewer': 'prefers brevity',
    'risk-aware': 'prefers lower-error tools',
}


def build_agents(max_agents: int | None = None, provider_filter: str | None = None) -> list[Agent]:
    config = load_agents_config()
    personas = config.get('persona_pool', [])
    count = int(config.get('default_agent_count', len(personas) or 12))
    agents: list[Agent] = []
    for i in range(count):
        persona = personas[i % len(personas)] if personas else f'persona-{i+1}'
        model = MODEL_CYCLE[i % len(MODEL_CYCLE)]
        provider = provider_for_model(model)
        if provider_filter and provider != provider_filter:
            continue
        agents.append(Agent(f'agent-{i+1:02d}', persona, model, STYLE_BIAS.get(persona, 'balanced')))
        if max_agents is not None and len(agents) >= max_agents:
            break
    return agents


def task_profile(task_title: str) -> str:
    title = task_title.lower()
    if 'summary' in title or 'recap' in title:
        return 'summary'
    if 'transcript' in title or 'evidence' in title or 'search' in title or 'find' in title:
        return 'search'
    if 'action' in title or 'owner' in title:
        return 'action'
    if 'create' in title or 'write' in title or 'append' in title:
        return 'write'
    if 'update' in title or 'move' in title or 'change' in title:
        return 'update'
    if 'compare' in title or 'deduplicate' in title:
        return 'compare'
    if 'schedule' in title or 'event' in title or 'calendar' in title or 'slot' in title:
        return 'schedule'
    return 'general'


def base_score(tool: dict[str, Any], task: dict[str, Any], agent: Agent) -> tuple[float, dict[str, Any]]:
    seed = stable_seed(tool['id'], task['id'], agent.agent_id)
    rng = random.Random(seed)
    task_kind = task_profile(task['title'])
    strength = tool['fake_profile']['primary_strength']
    weakness = tool['fake_profile']['primary_weakness']
    reliability = tool['fake_profile']['reliability']
    speed = tool['fake_profile']['speed']
    verbosity = tool['fake_profile']['verbosity']

    score = 0.62 + rng.uniform(-0.08, 0.08)
    if any(k in strength for k in ['summary', 'recap']) and task_kind == 'summary':
        score += 0.18
    if any(k in strength for k in ['search', 'retrieval', 'transcript']) and task_kind == 'search':
        score += 0.18
    if any(k in strength for k in ['action', 'owner']) and task_kind == 'action':
        score += 0.18
    if any(k in strength for k in ['crud', 'write', 'record', 'task']) and task_kind in {'write', 'update'}:
        score += 0.14
    if any(k in weakness for k in ['search', 'retrieval']) and task_kind == 'search':
        score -= 0.14
    if any(k in weakness for k in ['summary', 'recap']) and task_kind == 'summary':
        score -= 0.14
    if any(k in weakness for k in ['action']) and task_kind == 'action':
        score -= 0.14
    if agent.persona == 'search-first' and ('search' in strength or 'retrieval' in strength):
        score += 0.05
    if agent.persona == 'executive-briefing' and ('summary' in strength or 'recap' in strength):
        score += 0.05
    if agent.persona == 'careful-verifier' and reliability in {'very-high', 'high'}:
        score += 0.04
    if agent.persona == 'speed-first' and speed == 'fast':
        score += 0.05
    if agent.persona == 'quality-sensitive' and verbosity == 'balanced':
        score += 0.03
    score = max(0.0, min(0.98, score))
    return score, {'task_kind': task_kind, 'reliability': reliability, 'speed': speed, 'verbosity': verbosity}


def vote_from_score(score: float) -> str:
    if score >= 0.78:
        return 'upvote'
    if score >= 0.58:
        return 'neutral'
    return 'downvote'


def short_review(tool: dict[str, Any], task: dict[str, Any], score: float) -> str:
    tone = 'felt strong' if score >= 0.78 else 'felt okay' if score >= 0.58 else 'felt weak'
    return (
        f"{tool['display_name']} {tone} for '{task['title']}'. "
        f"Strength leaned toward {tool['fake_profile']['primary_strength']}; "
        f"main weakness was {tool['fake_profile']['primary_weakness']}."
    )


def usage_for(score: float, meta: dict[str, Any], seed: int) -> tuple[int, int, int, int]:
    rng = random.Random(seed ^ 0xABCDEF)
    base_in = 900 if meta['speed'] == 'fast' else 1250 if meta['speed'] == 'medium' else 1650
    base_out = 180 if meta['verbosity'] == 'concise' else 260 if meta['verbosity'] == 'balanced' else 360
    input_tokens = base_in + rng.randint(0, 250)
    output_tokens = base_out + rng.randint(0, 120)
    latency_ms = 350 + (220 if meta['speed'] == 'medium' else 650 if meta['speed'] == 'slow' else 0) + rng.randint(0, 150)
    retry_count = 0 if score >= 0.55 else 1 if score >= 0.35 else 2
    return input_tokens, output_tokens, latency_ms, retry_count


def usage_from_llm_result(result: dict[str, Any], fallback_meta: dict[str, Any], seed: int) -> tuple[int, int, int, int]:
    usage = result.get("_usage", {})
    input_tokens = usage.get("prompt_tokens") or usage.get("input_tokens")
    output_tokens = usage.get("completion_tokens") or usage.get("output_tokens")
    if input_tokens is None or output_tokens is None:
        return usage_for(float(result.get("score", 0.5)), fallback_meta, seed)
    rng = random.Random(seed ^ 0x123456)
    latency_ms = 900 + rng.randint(0, 900)
    retry_count = 0
    return int(input_tokens), int(output_tokens), latency_ms, retry_count


def category_summary(category_id: str, tool: dict[str, Any], agent: Agent, records: list[dict[str, Any]]) -> dict[str, Any]:
    avg = statistics.mean(r['score'] for r in records)
    positives = sum(1 for r in records if r['vote'] == 'upvote')
    negatives = sum(1 for r in records if r['vote'] == 'downvote')
    verdict = 'favorite' if avg >= 0.78 else 'usable' if avg >= 0.58 else 'weak fit'
    return {
        'category_id': category_id,
        'tool_id': tool['id'],
        'tool_name': tool['display_name'],
        'agent_id': agent.agent_id,
        'agent_persona': agent.persona,
        'average_score': round(avg, 4),
        'upvotes': positives,
        'downvotes': negatives,
        'summary_review': (
            f"Across {len(records)} tasks, {tool['display_name']} was a {verdict} for {agent.persona}. "
            f"Best at {tool['fake_profile']['primary_strength']}; weakest at {tool['fake_profile']['primary_weakness']}."
        ),
    }


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    with path.open('w', encoding='utf-8') as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')


def _run_demo_once(
    category_ids: list[str] | None = None,
    tasks_per_category: int | None = None,
    tools_per_category: int | None = None,
    repeat_index: int = 1,
    evaluation_mode: str = "simulated",
    insecure_ssl: bool = False,
    max_agents: int | None = None,
    provider_filter: str | None = None,
) -> Path:
    load_dotenv_if_present()
    runtime = load_runtime_config()
    selected = category_ids or runtime.get('active_categories') or [runtime.get('primary_comparison_category')]
    agents = build_agents(max_agents=max_agents, provider_filter=provider_filter)
    run_id = datetime.now(timezone.utc).strftime('run-%Y%m%dT%H%M%SZ')
    if repeat_index > 1:
        run_id = f"{run_id}-r{repeat_index}"
    out_dir = repo_root() / 'results' / 'runs' / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    evaluations: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    invocations: list[dict[str, Any]] = []

    for category_id in selected:
        category = load_category(category_id)
        mcp_catalog = load_mcp_catalog(category_id)
        fixture_bundle = load_fixture_bundle(category_id)
        tasks = category['core_tasks'][: tasks_per_category or len(category['core_tasks'])]
        tools = mcp_catalog['candidates'][: tools_per_category or len(mcp_catalog['candidates'])]
        by_agent_tool: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

        for task in tasks:
            for tool in tools:
                for agent in agents:
                    seed = stable_seed(category_id, task['id'], tool['id'], agent.agent_id)
                    fixture_focus = category.get('task_fixture_focus', {}).get(task['id'])
                    if evaluation_mode == "llm":
                        llm_result = evaluate_with_llm(
                            category_id=category_id,
                            task=task,
                            tool=tool,
                            agent=agent,
                            fixture_bundle=fixture_bundle,
                            fixture_focus=fixture_focus,
                            insecure_ssl=insecure_ssl,
                        )
                        score = float(llm_result.get("score", 0.5))
                        vote = llm_result.get("vote", vote_from_score(score))
                        fallback_score, meta = base_score(tool, task, agent)
                        input_tokens, output_tokens, latency_ms, retry_count = usage_from_llm_result(llm_result, meta, seed)
                        review_text = llm_result.get("short_review", short_review(tool, task, score))
                        rationale_tags = llm_result.get("rationale_tags", [])
                    else:
                        score, meta = base_score(tool, task, agent)
                        vote = vote_from_score(score)
                        input_tokens, output_tokens, latency_ms, retry_count = usage_for(score, meta, seed)
                        review_text = short_review(tool, task, score)
                        rationale_tags = []
                    created_at = utc_now()
                    verified_invocation_id = f"vi-{uuid.uuid4().hex[:12]}"
                    record = {
                        'run_id': run_id,
                        'category_id': category_id,
                        'fixture_bundle_id': fixture_bundle.get('bundle_id'),
                        'task_fixture_focus': category.get('task_fixture_focus', {}).get(task['id']),
                        'task_id': task['id'],
                        'task_title': task['title'],
                        'tool_id': tool['id'],
                        'tool_name': tool['display_name'],
                        'agent_id': agent.agent_id,
                        'agent_model': agent.model,
                        'agent_provider': provider_for_model(agent.model),
                        'agent_persona': agent.persona,
                        'score': round(score, 4),
                        'vote': vote,
                        'short_review': review_text,
                        'rationale_tags': rationale_tags,
                        'input_tokens': input_tokens,
                        'output_tokens': output_tokens,
                        'latency_ms': latency_ms,
                        'retry_count': retry_count,
                        'execution_status': 'ok',
                        'verified_invocation_id': verified_invocation_id,
                        'created_at': created_at,
                    }
                    evaluations.append(record)
                    by_agent_tool[(agent.agent_id, tool['id'])].append(record)
                    invocations.append({
                        'run_id': run_id,
                        'invocation_id': verified_invocation_id,
                        'category_id': category_id,
                        'fixture_bundle_id': fixture_bundle.get('bundle_id'),
                        'task_id': task['id'],
                        'tool_id': tool['id'],
                        'agent_id': agent.agent_id,
                        'status': 'verified-local-fake',
                        'created_at': created_at,
                    })

        tool_map = {tool['id']: tool for tool in tools}
        agent_map = {agent.agent_id: agent for agent in agents}
        for (agent_id, tool_id), records in by_agent_tool.items():
            summaries.append(category_summary(category_id, tool_map[tool_id], agent_map[agent_id], records))

    manifest = {
        'run_id': run_id,
        'generated_at': utc_now(),
        'mode': f'local-fake-tool-simulation+{evaluation_mode}-evaluator',
        'repeat_index': repeat_index,
        'categories': selected,
        'agent_count': len(agents),
        'counts': {
            'evaluations': len(evaluations),
            'category_summaries': len(summaries),
            'verified_invocations': len(invocations),
            'categories': len(selected),
        },
        'primary_comparison_category': runtime.get('primary_comparison_category'),
        'reliable_fallback_category': runtime.get('reliable_fallback_category'),
    }

    _write_jsonl(out_dir / 'evaluations.jsonl', evaluations)
    _write_jsonl(out_dir / 'category_summaries.jsonl', summaries)
    _write_jsonl(out_dir / 'verified_invocations.jsonl', invocations)
    (out_dir / 'excluded_mcps.jsonl').write_text('', encoding='utf-8')
    (out_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    queue_run_for_later_sync(out_dir)
    sync_attempt = maybe_sync_pending_batches()
    (out_dir / 'sync_attempt.json').write_text(json.dumps(sync_attempt, indent=2) + '\n', encoding='utf-8')
    return out_dir


def run_demo(
    category_ids: list[str] | None = None,
    tasks_per_category: int | None = None,
    tools_per_category: int | None = None,
    repeat: int = 1,
    evaluation_mode: str = "simulated",
    insecure_ssl: bool = False,
    max_agents: int | None = None,
    provider_filter: str | None = None,
) -> list[Path]:
    return [
        _run_demo_once(
            category_ids=category_ids,
            tasks_per_category=tasks_per_category,
            tools_per_category=tools_per_category,
            repeat_index=i,
            evaluation_mode=evaluation_mode,
            insecure_ssl=insecure_ssl,
            max_agents=max_agents,
            provider_filter=provider_filter,
        )
        for i in range(1, repeat + 1)
    ]


def verify_results(path: Path) -> dict[str, Any]:
    required = ['evaluations.jsonl', 'category_summaries.jsonl', 'verified_invocations.jsonl', 'manifest.json']
    missing = [name for name in required if not (path / name).exists()]
    manifest = json.loads((path / 'manifest.json').read_text()) if (path / 'manifest.json').exists() else {}
    return {
        'status': 'ok' if not missing else 'missing-files',
        'missing': missing,
        'manifest': manifest,
    }
