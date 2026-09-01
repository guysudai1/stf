# Mission Control public UI

This directory is a self-contained, dependency-free mission board. Serve it at
`/agent-board/public/` from the local STF process and keep the API on the same
origin so the browser can call:

- `GET /api/missions` and `POST /api/missions`
- `PATCH /api/missions/:id` for claiming a mission
- `POST /api/missions/:id/retry` for blocked missions
- `GET /api/agents` and `POST /api/agents/:id/stop`
- `GET /api/events` as an SSE stream, with a 10-second polling fallback

The client accepts either a bare array or `{ missions: [] }` / `{ agents: [] }`
response envelope. Mission statuses are normalized into queued, active, blocked,
and completed columns.
