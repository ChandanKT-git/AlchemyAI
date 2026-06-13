# Agent Console

A Next.js application that connects to a mock AI agent backend over WebSockets, renders streaming responses with mid-stream tool call interruptions, displays a live agent trace timeline, and survives chaos mode.

## Architecture

<!-- TODO: Add state machine diagram and detailed architecture after implementation -->

The application is structured in three layers:
1. **Connection Layer** (`lib/protocol/`) — WebSocket lifecycle, heartbeat, reconnection, message reordering
2. **Stream/Tool Layer** (`lib/agent/`) — Reducer-based state machine for token streaming and tool calls
3. **UI Layer** (`components/`) — React components that read state and render

## Running the App

```bash
# 1. Start the agent server (in the agent-server directory)
cd ../agent-server
npm install && npm run build && npm start

# 2. Start the console (in this directory)
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Running Against Chaos Mode

```bash
cd ../agent-server
npm start -- --mode chaos
```

## Building for Production

```bash
npm run build
npm run start
```
