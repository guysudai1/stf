# Local agent mission board

This directory contains a self-contained local mission board. It stores missions in a JSON file,
dispatches queued missions to a configurable number of workers, and exposes a small HTTP/SSE API.
No public STF UI files are involved.

## Run

From the STF repository root:

```sh
npm run agent-board
```

The server listens on `http://127.0.0.1:7130` and stores data in
`.stf-agent-board/missions.json`. Configure it with `AGENT_BOARD_PORT`, `AGENT_BOARD_FILE`, and
`AGENT_BOARD_WORKERS`.

## Mission API

Create a demo mission:

```sh
curl -X POST http://127.0.0.1:7130/api/missions \
  -H 'content-type: application/json' \
  -d '{"title":"Say hello","prompt":"hello"}'
```

Use `GET /api/missions` to list missions, `GET /api/missions/:id` for one mission, and
`GET /api/events` for server-sent `mission` events. `POST /api/missions/:id/cancel` and
`POST /api/missions/:id/retry` control queued/running and failed/cancelled missions.

Missions use the `demo` adapter by default when they have a prompt. A command mission can provide
`{"adapter":"command","command":"/path/to/program","args":["arg"]}`. Commands are spawned
without a shell. A Codex mission uses `{"adapter":"codex","prompt":"..."}` and runs
`codex exec <prompt>`; pass adapter options programmatically when a different Codex command or
flags are required.

## Tests and module exports

```sh
npm run test:agent-board
```

`require('./agent-board')` exports `MissionStore`, `MissionScheduler`,
`createDemoWorker`, `createCommandAdapter`, `createCodexAdapter`, `createAgentBoard`, and
`createServer`. `createAgentBoard()` is the lifecycle-friendly API for tests and embedding;
`createServer()` returns the raw Node HTTP server.
