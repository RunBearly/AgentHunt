from __future__ import annotations

import argparse
import json
from pathlib import Path

from .catalogs import validate_catalogs
from .backend_sync import backend_sync_plan, pending_sync_status, queue_run_for_later_sync
from .backend_replay import replay_all_local_votes, replay_local_votes_chunk, replay_local_votes_parallel_chunk, sync_pending_batches
from .launch_watch import check_for_launch_commit, launch_watch_state_path, watch_for_launch
from .simulator import run_demo, verify_results


def cmd_validate_catalogs(_: argparse.Namespace) -> int:
    summary = validate_catalogs()
    print(json.dumps({"ok": True, **summary}, indent=2))
    return 0


def cmd_run_demo(args: argparse.Namespace) -> int:
    categories = args.categories.split(",") if args.categories else None
    out_dirs = run_demo(
        category_ids=categories,
        tasks_per_category=args.max_tasks,
        tools_per_category=args.max_tools,
        repeat=args.repeat,
        evaluation_mode=args.evaluation_mode,
        insecure_ssl=args.insecure_ssl,
        max_agents=args.max_agents,
        provider_filter=args.provider,
    )
    payload = {
        "ok": True,
        "run_dir": str(out_dirs[0]) if len(out_dirs) == 1 else None,
        "run_dirs": [str(path) for path in out_dirs],
        "repeat": len(out_dirs),
    }
    print(json.dumps(payload, indent=2))
    return 0


def cmd_verify_results(args: argparse.Namespace) -> int:
    path = Path(args.path)
    result = verify_results(path)
    ok = result.get("status") == "ok"
    print(json.dumps({"ok": ok, **result}, indent=2))
    return 0 if ok else 1


def cmd_queue_status(_: argparse.Namespace) -> int:
    print(json.dumps({"ok": True, **pending_sync_status()}, indent=2))
    return 0


def cmd_queue_run(args: argparse.Namespace) -> int:
    path = Path(args.path)
    queued = queue_run_for_later_sync(path)
    print(json.dumps({"ok": True, "queued_batch": str(queued)}, indent=2))
    return 0


def cmd_check_launch(args: argparse.Namespace) -> int:
    payload = check_for_launch_commit(fetch=args.fetch)
    print(json.dumps({"ok": True, **payload}, indent=2))
    return 0


def cmd_watch_launch(args: argparse.Namespace) -> int:
    payload = watch_for_launch(
        interval_seconds=args.interval_seconds,
        fetch=args.fetch,
        max_checks=args.max_checks,
    )
    print(json.dumps({"ok": True, **payload}, indent=2))
    return 0


def cmd_sync_backend(args: argparse.Namespace) -> int:
    state_path = launch_watch_state_path()
    launch_state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if args.apply:
        print(json.dumps({"ok": True, **sync_pending_batches()}, indent=2))
        return 0
    print(json.dumps({"ok": True, **backend_sync_plan(launch_state)}, indent=2))
    return 0


def cmd_sync_votes(_: argparse.Namespace) -> int:
    print(json.dumps({"ok": True, **replay_all_local_votes()}, indent=2))
    return 0


def cmd_sync_votes_chunk(args: argparse.Namespace) -> int:
    print(json.dumps({"ok": True, **replay_local_votes_chunk(limit=args.limit)}, indent=2))
    return 0


def cmd_sync_votes_parallel_chunk(args: argparse.Namespace) -> int:
    print(
        json.dumps(
            {"ok": True, **replay_local_votes_parallel_chunk(limit=args.limit, workers=args.workers)},
            indent=2,
        )
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agenthunt")
    sub = parser.add_subparsers(dest="command", required=True)

    validate = sub.add_parser("validate-catalogs")
    validate.set_defaults(func=cmd_validate_catalogs)

    run = sub.add_parser("run-demo")
    run.add_argument("--categories", help="Comma-separated category ids", default=None)
    run.add_argument("--max-tasks", type=int, default=None)
    run.add_argument("--max-tools", type=int, default=None)
    run.add_argument("--repeat", type=int, default=1)
    run.add_argument("--evaluation-mode", choices=["simulated", "llm"], default="simulated")
    run.add_argument("--insecure-ssl", action="store_true")
    run.add_argument("--max-agents", type=int, default=None)
    run.add_argument("--provider", choices=["openai", "anthropic"], default=None)
    run.set_defaults(func=cmd_run_demo)

    verify = sub.add_parser("verify-results")
    verify.add_argument("path")
    verify.set_defaults(func=cmd_verify_results)

    queue_status = sub.add_parser("queue-status")
    queue_status.set_defaults(func=cmd_queue_status)

    queue_run = sub.add_parser("queue-run")
    queue_run.add_argument("path")
    queue_run.set_defaults(func=cmd_queue_run)

    check_launch = sub.add_parser("check-launch")
    check_launch.add_argument("--fetch", action="store_true")
    check_launch.set_defaults(func=cmd_check_launch)

    watch_launch = sub.add_parser("watch-launch")
    watch_launch.add_argument("--interval-seconds", type=int, default=900)
    watch_launch.add_argument("--max-checks", type=int, default=None)
    watch_launch.add_argument("--fetch", action="store_true")
    watch_launch.set_defaults(func=cmd_watch_launch)

    sync_backend = sub.add_parser("sync-backend")
    sync_backend.add_argument("--apply", action="store_true")
    sync_backend.set_defaults(func=cmd_sync_backend)

    sync_votes = sub.add_parser("sync-votes")
    sync_votes.set_defaults(func=cmd_sync_votes)

    sync_votes_chunk = sub.add_parser("sync-votes-chunk")
    sync_votes_chunk.add_argument("--limit", type=int, default=50)
    sync_votes_chunk.set_defaults(func=cmd_sync_votes_chunk)

    sync_votes_parallel_chunk = sub.add_parser("sync-votes-parallel-chunk")
    sync_votes_parallel_chunk.add_argument("--limit", type=int, default=200)
    sync_votes_parallel_chunk.add_argument("--workers", type=int, default=8)
    sync_votes_parallel_chunk.set_defaults(func=cmd_sync_votes_parallel_chunk)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
