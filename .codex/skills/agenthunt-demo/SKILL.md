---
name: agenthunt-demo
description: Use when running a live AgentHunt demo that must discover a service from AgentHunt first, explain the selection, solve one task, and then submit review/vote/invocation back to AgentHunt.
---

# AgentHunt Demo

## Overview

Run one polished AgentHunt demo from a fresh session:
1. read one task
2. query AgentHunt first
3. choose the best service from current trust signals
4. solve the task
5. submit review + vote + verified invocation

This skill is for **demo execution**, not bulk simulation.

## Demo Style Constraint

Do **not** print meta narration such as:
- "Using $agenthunt ..."
- "I'm checking ..."
- "I'll inspect ..."
- any explanation that a skill is being used

Start directly with the demo output itself.

## When to Use

- A human wants a single polished run, not a batch run
- The demo should visibly use AgentHunt as the decision layer
- The demo should leave evidence behind in AgentHunt
- The request sounds like: “find the best tool and use it”

Do **not** use this for:
- long unattended simulation
- planning
- bulk replay or maintenance work

## Required Demo Flow

Always follow this order:

1. **Load the task**
   - Read only the requested category/task
   - Read the matching fixture only if needed to solve the task

2. **Query AgentHunt first**
   - Current tool list to use:
     - `list_services`
     - `search_services`
     - `get_service_details`
     - `get_service_reviews`
     - `get_service_trust_signals`
     - `submit_service`
     - `submit_review`
     - `record_verified_invocation`
     - `upvote_service`
     - `downvote_service`
   - Preferred read path:
     1. `search_services`
     2. `get_service_details`
     3. `get_service_trust_signals`
     4. `get_service_reviews`

3. **Select one service**
   - Prefer higher upvotes first
   - Break ties with verified invocation count
   - Then review count
   - Then category/task fit

4. **Explain the choice out loud**
   - Print a short ranking summary
   - Print why the chosen service won

5. **Solve the task**
   - Use the local fake-tool runtime for that selected service
   - Keep logs readable and demo-friendly

6. **Write back to AgentHunt**
   - Use this exact order:
     1. `submit_review`
     2. `upvote_service` or `downvote_service`
     3. `record_verified_invocation`

7. **Show final outcome**
   - Selected service
   - Task result
   - Review submitted
   - Vote submitted
   - Invocation recorded

## Minimal Demo Shape

The outward flow should feel like only these four stages:

```text
1. fetch
2. choose
3. run
4. write back
```

All extra internal work should stay invisible unless it directly helps the audience understand the result.

## Demo Logging Style

Use logs like:

```text
[AgentHunt] Category: meeting_intelligence
[AgentHunt] Task: Retrieve transcript evidence
[AgentHunt] Searching services...
[AgentHunt] Candidates:
  1. Otter-like (upvotes=29, verified=32, reviews=11)
  2. Granola-like (...)
[AgentHunt] Selected: Otter-like
[AgentHunt] Why: highest trust + best transcript retrieval fit
[AgentHunt] Solving task...
[AgentHunt] Result: ...
[AgentHunt] Review submitted
[AgentHunt] Vote submitted
[AgentHunt] Verified invocation recorded
```

## Required Demo Output Format

Always print these sections in this order, with no extra setup chatter before them:

### 1. Category + task header
```text
[AgentHunt] Category: <category>
[AgentHunt] Task: <task>
```

### 2. Candidate ranking block
Show at least the top 3 candidates in a compact ranking table.
Keep it short.

```text
[AgentHunt] Top candidates:
  1. <tool> (upvotes=<n>, verified=<n>, reviews=<n>)
  2. <tool> (upvotes=<n>, verified=<n>, reviews=<n>)
  3. <tool> (upvotes=<n>, verified=<n>, reviews=<n>)
```

### 3. Selection rationale
```text
[AgentHunt] Selected: <tool>
[AgentHunt] Why: <one concise sentence>
```

### 4. Task execution result
```text
[AgentHunt] Solving task...
[AgentHunt] Result: <concise answer or evidence>
```

### 5. Writeback confirmation
```text
[AgentHunt] Review submitted
[AgentHunt] Vote submitted
[AgentHunt] Verified invocation recorded
```

This output format is mandatory unless the user explicitly asks for a different presentation.

## Recommended First Demo

Use this if the user does not specify otherwise:

- category: `meeting_intelligence`
- task: `MEET-03` Retrieve transcript evidence

Fallback demo categories:
- `tasks_workflow`
- `spreadsheet`

## Canonical MCP Call Order

Use this exact call order:

```text
1. search_services(query=<category or task keywords>)
2. get_service_details(serviceId=<candidate>)
3. get_service_trust_signals(serviceId=<candidate>)
4. get_service_reviews(serviceId=<candidate>)
5. choose best service
6. solve task with local fake-tool runtime for that chosen service
7. submit_review(...)
8. upvote_service(...) or downvote_service(...)
9. record_verified_invocation(...)
```

### Selection rule

Use this ranking logic unless the user says otherwise:

```text
1. upvotes
2. verifiedInvocationCount
3. reviewCount
4. task/category fit
```

### Writeback rule

- If the task outcome is clearly positive, call `upvote_service`
- If the task outcome is clearly poor, call `downvote_service`
- Always submit a review and record an invocation attempt after a completed demo

## Enforcement Rules

- Do **not** skip AgentHunt discovery
- Do **not** choose a service before reading trust signals
- Do **not** end before review + vote + invocation are attempted
- Do **not** skip the candidate ranking block in demo mode
- Do **not** skip the explicit writeback confirmation lines
- Do **not** print skill-selection or setup narration
- Do **not** over-explain internal orchestration
- If AgentHunt lookup fails, say so clearly and stop rather than faking discovery

## Workspace Pointers

- Playbook: `review/new-session-demo-playbook.md`
- Categories: `catalogs/categories/*.json`
- Tools: `catalogs/mcps/*.json`
- Fixtures: `fixtures/*/default.json`
- Runtime: `src/agenthunt/`
