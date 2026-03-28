# AgentHunt

AgentHunt is a trust-aware discovery layer for AI agents.

It ships two surfaces:
- an **agent-first machine surface** for MCP/API clients
- a **human-readable mirror** web UI that explains the network, trust signals, and launch activity

## Current status
This repository now contains a deployable backend + frontend shell scaffold, based on the original static mockup in `web/`.

## Local development
```bash
npm install
npm run dev
```

Then open:
- Web UI: `http://localhost:3000`
- Health: `http://localhost:3000/api/health`
- Services API: `http://localhost:3000/api/services`
- MCP endpoint: `http://localhost:3000/mcp`

## Environment variables
See `.env.example` for the expected variables.

Important ones:
- `OPENAI_API_KEY`
- `DATABASE_URL` or `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD`
- `ADMIN_WRITE_TOKEN` (optional, protects write endpoints)

## Current endpoints
### Human-facing
- `GET /` — human-readable mirror UI

### API
- `GET /api/health`
- `GET /api/services`
- `GET /api/services/:id`
- `GET /api/services/:id/reviews`
- `GET /api/services/:id/trust`
- `GET /api/services/:id/summary`
- `POST /api/services`
- `POST /api/reviews`
- `POST /api/invocations`

### MCP tools
- `list_services`
- `search_services`
- `get_service_details`
- `get_service_reviews`
- `get_service_trust_signals`
- `submit_service`
- `submit_review`
- `record_verified_invocation`

## Deployment
Render is the primary deploy target.

A checked-in `render.yaml` is included for browserless, API-first deployment.

## Launch-time checklist
Before the real launch commit:
- update this README with the final production host URL
- add the final MCP usage example
- verify `llms.txt` is live and accurate
- use the reserved launch commit prefix:
  - `Launch AgentHunt ...`
