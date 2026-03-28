# Backend MCP Integration Checklist

- Purpose: what remains to connect the local fake-tool simulation runtime to the backend-provided MCP tool surface later

## Provided MCP tools to integrate
- `search_services`
- `get_service_details`
- `get_service_trust_signals`
- `submit_service`
- `submit_review`
- `record_verified_invocation`

## What is already done
- 5-category fake-tool catalog exists
- local evaluator runtime exists
- per-task vote generation exists
- per-task short review generation exists
- category summary review generation exists
- verified invocation event generation exists
- local result artifacts are written as JSONL/JSON

## What still needs confirming with backend owner
1. input/output shape for each MCP tool
2. whether service identity is stable across runs
3. whether `submit_service` is idempotent or search-before-create is required
4. exact review payload fields
5. exact verified invocation payload fields
6. trust signals response shape

## Expected later connection flow
1. map a fake/local tool candidate to a service search query
2. call `search_services`
3. if a match exists:
   - call `get_service_details`
   - call `get_service_trust_signals`
4. if no match exists:
   - call `submit_service`
5. after evaluation:
   - call `submit_review`
6. after successful execution:
   - call `record_verified_invocation`

## Local artifact sources for mapping
- `results/runs/<run-id>/evaluations.jsonl`
- `results/runs/<run-id>/category_summaries.jsonl`
- `results/runs/<run-id>/verified_invocations.jsonl`
- `results/runs/<run-id>/manifest.json`
