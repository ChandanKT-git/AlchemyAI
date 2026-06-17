# Agent Console

A real-time AI agent console built with Next.js 16. It connects to a streaming WebSocket backend, renders token-by-token responses with mid-stream tool call cards, shows a live trace timeline of every protocol event, and survives chaos mode (out-of-order delivery, connection drops, duplicate messages, 500 KB+ payloads) without losing state or rendering corrupt output.

## Architecture

The app is split into three layers that evolve independently:

| Layer | Location | Responsibility |
|---|---|---|
| **Connection** | `lib/protocol/` | WebSocket lifecycle, PING/PONG, backoff reconnection, message reordering |
| **Agent State** | `lib/agent/` | Pure reducer: server messages → typed UI state |
| **UI** | `components/` | React components that read state and render |

### State Machines

**Connection state** — owned by `WSClient`:

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> CONNECTING: connect()
    CONNECTING --> CONNECTED: onopen (first time)
    CONNECTING --> DISCONNECTED: onclose / onerror
    CONNECTED --> DISCONNECTED: onclose / onerror
    DISCONNECTED --> CONNECTING: backoff timer fires\n(never connected before)
    DISCONNECTED --> RECONNECTING: backoff timer fires\n(had connected before)
    RECONNECTING --> CONNECTED: onopen (sends RESUME)
    RECONNECTING --> DISCONNECTED: onclose / onerror
```

**Stream state** — owned by `agentReducer`:

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> streaming: first TOKEN
    streaming --> tool_pending: TOOL_CALL received
    tool_pending --> streaming: TOOL_RESULT received
    streaming --> complete: STREAM_END
    tool_pending --> complete: STREAM_END while pending
    complete --> idle: new USER_MESSAGE sent
```

### Data Flow

```mermaid
flowchart TD
    WS[WebSocket frame]
    P[parseRawMessage\nboundary validator]
    RB[ReorderBuffer\nseq reorder + dedup]
    R[agentReducer\npure state machine]
    CTX[AgentProvider\nReact context]
    Chat[ChatPanel\ntoken stream + tool cards]
    TL[TraceTimeline\nlive event log]
    CI[ContextPanel\nJSON diff + scrubber]

    WS --> P --> RB --> R --> CTX
    CTX --> Chat
    CTX --> TL
    CTX --> CI
```

## Running

### Docker — recommended, zero setup

```bash
# From June-2026_FullStackAI/
docker build -t agent-server ./agent-server
docker compose up
```

Open **http://localhost:3000**. The server runs on `ws://localhost:4747/ws`.

To run in chaos mode:

```bash
docker compose down
docker run -d -p 4747:4747 agent-server --mode chaos
docker compose up agent-console
```

### Local development

```bash
# Terminal 1 — backend
cd agent-server && npm install && npm run dev

# Terminal 2 — frontend
cd agent-console && npm install && npm run dev
```

### Local production build

```bash
cd agent-console
npm install && npm run build && npm run start
```

## Testing

### Unit tests (115 assertions)

```bash
cd agent-console && npm test
```

Covers: protocol parser, reorder buffer, agent reducer, JSON diff algorithm.

### Integration tests (24 assertions, 0 protocol violations)

```bash
# Requires agent-server running on port 4747
node agent-server/run-tests.mjs
```

Covers: normal flow, tool call + ACK, multi-tool, PING/PONG, RESUME, TOOL_ACK logging, 500 KB+ context, `/log` clean check.

### Protocol compliance

```bash
curl -s http://localhost:4747/log | python3 -m json.tool
# Every entry should show "verdict": "ok"
```

## Trigger Keywords

| Message contains | Script | What it exercises |
|---|---|---|
| `hello` / `hi` | Greeting | Token streaming, CONTEXT_SNAPSHOT |
| `report` / `summary` / `q3` | Report | One TOOL_CALL mid-stream |
| `analyze` / `compare` | Analysis | Two sequential TOOL_CALLs |
| `lookup` / `find` / `search` | Lookup | TOOL_CALL before any tokens |
| `schema` / `database` / `large` | Schema | 500 KB+ CONTEXT_SNAPSHOT |
| `long` / `detailed` / `document` | Long | Many tokens + TOOL_CALL |

## Project Structure

```
agent-console/
├── lib/
│   ├── protocol/
│   │   ├── types.ts            ServerMessage / ClientMessage discriminated unions
│   │   ├── parse.ts            Runtime boundary validator — returns null, never throws
│   │   ├── reorder-buffer.ts   TCP-like seq reordering + dedup (Set + Map)
│   │   └── ws-client.ts        WebSocket lifecycle, exponential backoff, RESUME
│   ├── agent/
│   │   ├── types.ts            Block, StreamState, AgentState, TimelineEntry
│   │   ├── reducer.ts          Pure reducer: (AgentState, ServerMessage) → AgentState
│   │   └── context.tsx         AgentProvider: wires WSClient → reducer → React context
│   ├── timeline/
│   │   └── grouping.ts         Groups consecutive TOKEN events for the timeline panel
│   └── context-inspector/
│       └── diff.ts             O(n) recursive JSON diff (added / removed / changed paths)
├── components/
│   ├── shell/                  AppShell layout, ConnectionStatus with backoff countdown
│   ├── chat/                   ChatPanel, StreamMessage, ToolCard, MessageInput
│   ├── timeline/               TraceTimeline, TimelineRow, TimelineFilter
│   └── context/                ContextPanel, JsonTree, DiffView, SnapshotHistory
└── __tests__/                  Jest unit tests (ts-jest)
```
