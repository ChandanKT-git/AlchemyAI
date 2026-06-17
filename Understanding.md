Let's start with **Milestone 0 — Understand Backend and Protocol**. No code in this milestone, just understanding.

We've already read the server files together. Let me walk you through the **6 key concepts** you need to internalize, one at a time.

---

## Concept 1: The `seq` Number

Every message the server sends has a `seq` field — a number that starts at 1 and increments by 1 for each message.

From [server.ts](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/src/server.ts#L534-L536):
```typescript
private nextSeq(): number {
  return ++this.seq;
}
```

**In normal mode**: seq is `1, 2, 3, 4, 5...` — always in order, no gaps.

**In chaos mode**: the server shuffles messages through a [buffer of 4](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/src/chaos.ts#L18), so you might receive `seq=3, 1, 4, 2, 5`. Same messages, scrambled order.

**Why it matters**: If you process tokens in the order `3, 1, 4, 2`, the chat text is garbled. You must reorder them before rendering.

**Important detail from** [server.ts L208-211](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/src/server.ts#L208-L211):
```typescript
// Reset sequence and history for a new conversation turn
this.seq = 0;
this.eventHistory = [];
```
The server resets `seq` to 0 on every new `USER_MESSAGE`. So our client must also reset its reorder buffer per conversation turn.

---

## Concept 2: The PING/PONG Heartbeat

From [server.ts L443-L497](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/src/server.ts#L443-L497):
- Server sends a `PING` every **12 seconds** with a random `challenge` string
- Client must reply `PONG` with the **exact same challenge** within **3 seconds**
- **3 missed PONGs** → server terminates the connection

In chaos mode, the challenge can be **empty string** `""`. Your client must still reply `PONG { echo: "" }` — don't crash, don't skip it.

---

## Concept 3: TOOL_CALL → TOOL_ACK → TOOL_RESULT

From [server.ts L336-L371](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/src/server.ts#L336-L371):
1. Server sends `TOOL_CALL` — token streaming **pauses**
2. Client renders tool card, then sends `TOOL_ACK` 
3. Server **waits for ACK** (5s timeout) before proceeding
4. Server sends `TOOL_RESULT` — streaming **resumes**

If client doesn't ACK within 5s, the server logs a **protocol violation** and sends the result anyway.

---

## Concept 4: RESUME on Reconnection

From [server.ts L231-L247](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/src/server.ts#L231-L247):
```typescript
private handleResume(ws: WebSocket, lastSeq: number): void {
  const toReplay = this.eventHistory.filter((m) => m.seq > lastSeq);
  for (const msg of toReplay) {
    this.rawSend(ws, msg);
  }
}
```
On reconnect, client sends `RESUME { last_seq: N }`. Server replays all events with `seq > N`. This is how state recovery works.

---

## Concept 5: Trigger Keywords

From [agent-server/README.md](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/README.md): Different messages trigger different responses:

| What to type | What it tests |
|---|---|
| `hello` | Simple streaming, no tool calls |
| `summarize the report` | 1 tool call mid-stream + context updates |
| `analyze the correlation` | 2 sequential tool calls |
| `find the SLA docs` | Tool call BEFORE any tokens |
| `show me the database schema` | 500KB+ context snapshot |

---

## Concept 6: The Chaos Engine

From [chaos.ts](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/src/chaos.ts#L128-L140): Each connection gets a **random** chaos profile:
- Drop connection after 15–45 messages (50% chance)
- Reorder probability: 15–35%
- Duplicate probability: 5–15%
- Latency spike: 2–6 seconds (5–13% chance)
- Corrupt ping: 15–25% chance

---

Now let's **validate** by running the server. Do you have Docker installed and running?

Ran command: `docker --version`

Docker is installed. Let's build and run the agent-server:

Ran command: `docker build -t agent-server ./agent-server`

Docker daemon isn't running. You'll need to **start Docker Desktop** first. While we wait for that, let's try running the server locally instead so we can observe the protocol:

Ran command: `npm install`
Used tool: manage_task

Good. Now let's build and start the server locally:

Ran command: `npm run build`
Ran command: `npm start`
Used tool: manage_task

Server is running! Let's verify the health endpoint and then observe the protocol live:

Ran command: `curl -s http://localhost:4747/health`
Used tool: manage_task

Let me try with PowerShell instead:

Ran command: `Invoke-RestMethod -Uri http://localhost:4747/health | ConvertTo-Json`

Server is running in **normal mode**. Now let's run the test file that ships with the server — it acts as a reference client showing how the protocol works:

Viewed test.mjs:1-406

This test file is gold — it's a **reference client** showing exactly how every protocol interaction works. Let me highlight the key patterns you should internalize:

---

## 🔑 What the test client teaches us

**Pattern 1: Send message, collect responses** ([test.mjs L59-60](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/test.mjs#L59-L60))
```javascript
ws.send(JSON.stringify({ type: "USER_MESSAGE", content: "hello" }));
// Then listen for messages
```

**Pattern 2: ACK tool calls immediately** ([test.mjs L113-116](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/test.mjs#L113-L116))
```javascript
if (msg.type === "TOOL_CALL") {
  ws.send(JSON.stringify({ type: "TOOL_ACK", call_id: msg.call_id }));
}
```

**Pattern 3: Echo PING challenges** ([test.mjs L126-128](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/test.mjs#L126-L128))
```javascript
if (msg.type === "PING" && msg.challenge) {
  ws.send(JSON.stringify({ type: "PONG", echo: msg.challenge }));
}
```

**Pattern 4: RESUME with last_seq** ([test.mjs L263-264](file:///c:/Users/chand/Downloads/VS%20Codes/Assignments/Alchemy-hiring-agent/hiring/June-2026_FullStackAI/agent-server/test.mjs#L263-L264))
```javascript
const ws2 = await connect();
ws2.send(JSON.stringify({ type: "RESUME", last_seq: lastSeq }));
```

---

## ✅ Milestone 0 Complete

Here's what you now understand:

| Concept | Key Takeaway |
|---|---|
| `seq` | Monotonic counter, reset per turn. Reorder in chaos mode. |
| PING/PONG | Echo challenge within 3s. Empty challenge = still reply. |
| TOOL_CALL flow | Freeze stream → render card → ACK → wait for RESULT → resume |
| RESUME | Send `last_seq` on reconnect → server replays missed events |
| Trigger keywords | `hello`, `report`, `analyze`, `find`, `schema`, `long` |
| Chaos engine | Reorder buffer=4, duplicates, drops, corrupt PINGs, latency spikes |

The server is running at `ws://localhost:4747/ws`. You can try opening your browser's DevTools console and testing it manually:

```javascript
const ws = new WebSocket("ws://localhost:4747/ws");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.onopen = () => ws.send(JSON.stringify({type: "USER_MESSAGE", content: "hello"}));
```

**Ready for Milestone 1?** That's where we scaffold the Next.js project. Let me know when you want to proceed — and feel free to push any notes to GitHub first.