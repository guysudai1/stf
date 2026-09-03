# Agent mission board

The mission board is a local, self-contained workflow for handing work to a
pool of workers. It persists missions in JSON, dispatches the highest-priority
queued item to an available worker, and updates the Kanban UI over SSE.

## Start

From this repository:

```sh
npm run agent-board
```

Open <http://127.0.0.1:7130>. The default uses three safe demo workers. Set
`AGENT_BOARD_WORKERS` to change the pool size and `AGENT_BOARD_FILE` to choose
the state file.

Set `AGENT_RUNNER=codex` to make new UI/API missions use the local Codex CLI.
Use a dedicated checkout as `AGENT_WORKDIR` when running real agents. Real
execution is opt-in because mission prompts can contain arbitrary instructions.
For unattended execution, explicitly choose the Codex flags, for example
`AGENT_CODEX_ARGS_JSON='["--full-auto"]'`.

## SimpleX Chat

The optional bridge connects one manually verified SimpleX CLI contact to the
board. It is disabled unless enabled explicitly:

```sh
SIMPLEX_CHAT_ENABLED=1 \
SIMPLEX_CHAT_CONTACT=alice \
SIMPLEX_CHAT_ALLOWED_SENDER=alice \
npm run agent-board
```

The local `simplex-chat` profile must already exist and the contact must have
been admitted and security-code verified by the operator. Send
`/mission Title :: detailed prompt` to queue a mission, `/status` to request a
summary, or `/help` to list the board commands. Only the exact configured sender is accepted. Board updates are
sent back to `@alice`; invitations, contact admission, and identity
verification are never automated.

Set `SIMPLEX_CHAT_COMMAND` for a non-default binary and
`SIMPLEX_CHAT_ARGS_JSON='["-d","/path/to/profile"]'` for CLI arguments.
The bridge starts the CLI's localhost WebSocket bot API (`SIMPLEX_CHAT_PORT`,
default `5225`) and consumes structured `newChatItems` events. Set
`SIMPLEX_CHAT_CONTACT_ID` to pin the numeric contact ID; otherwise the bridge
resolves the exact configured sender name through the SimpleX contacts API.
`GET /api/integrations` exposes starting, connected, reconnecting, error, and
stopped bridge states. Outbound commands use correlated WebSocket requests and
are queued while the transport reconnects.

## Tests

```sh
node agent-board/test/agent-board.test.js
```

The HTTP test needs loopback binding. In a restricted sandbox, run it in the
same host context used to launch the board.
