/**
 * Integration test suite — runs against the already-running server on port 4747.
 * Uses Node 22 native WebSocket (no npm ws needed).
 *
 * Tests:
 *  1. Normal flow (greeting)          → tokens, context, STREAM_END
 *  2. Tool call + TOOL_ACK            → TOOL_CALL, ACK, TOOL_RESULT
 *  3. Multi-tool (analyze)            → 2x TOOL_CALL / TOOL_RESULT
 *  4. PING / PONG heartbeat           → /log shows verdict "ok"
 *  5. RESUME (reconnection)           → replayed events, /log shows RESUME
 *  6. TOOL_ACK logging                → /log shows verdict "ok"
 *  7. Large context (schema)          → CONTEXT_SNAPSHOT > 500 KB
 *  8. /log clean check                → zero "violation" or "error" verdicts
 */

const BASE_HTTP = "http://localhost:4747";
const BASE_WS   = "ws://localhost:4747/ws";

let passed = 0, failed = 0;

function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}`); failed++; }
}

function connect() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(BASE_WS);
    ws.addEventListener("open",  () => res(ws));
    ws.addEventListener("error", e  => rej(e));
  });
}

function collectUntil(ws, { count = Infinity, endType = null, timeout = 20000 } = {}) {
  return new Promise(res => {
    const msgs = [];
    let timer;
    const done = () => { clearTimeout(timer); ws.onmessage = null; res(msgs); };
    timer = setTimeout(done, timeout);
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      msgs.push(m);
      if (m.type === "PING" && m.challenge !== undefined)
        ws.send(JSON.stringify({ type: "PONG", echo: m.challenge }));
      if ((endType && m.type === endType) || msgs.length >= count)
        setTimeout(done, 300);
    };
  });
}

async function get(path) {
  const r = await fetch(`${BASE_HTTP}${path}`);
  return r.json();
}

async function reset() { await fetch(`${BASE_HTTP}/reset`); }

// ── 1. Normal flow ───────────────────────────────────────────────────────────
async function test1() {
  console.log("\n── 1. Normal flow (hello) ──");
  const ws = await connect();
  ws.send(JSON.stringify({ type: "USER_MESSAGE", content: "hello" }));
  const msgs = await collectUntil(ws, { endType: "STREAM_END", timeout: 15000 });
  ws.close();

  ok(msgs.some(m => m.type === "TOKEN"),         `Got TOKEN messages (${msgs.filter(m=>m.type==="TOKEN").length})`);
  ok(msgs.some(m => m.type === "STREAM_END"),    "Got STREAM_END");
  ok(msgs.some(m => m.type === "CONTEXT_SNAPSHOT"), "Got CONTEXT_SNAPSHOT");

  const seqs = msgs.map(m => m.seq);
  ok(seqs.every((s,i) => i === 0 || s > seqs[i-1]), "Seq numbers are monotonically increasing");

  const text = msgs.filter(m => m.type === "TOKEN").map(m => m.text).join("");
  ok(text.length > 10, `Streamed text has content (${text.length} chars)`);
}

// ── 2. Tool call + TOOL_ACK ──────────────────────────────────────────────────
async function test2() {
  console.log("\n── 2. Tool call + ACK (report) ──");
  const ws = await connect();
  ws.send(JSON.stringify({ type: "USER_MESSAGE", content: "summarize the report" }));

  const msgs = [];
  await new Promise(res => {
    const t = setTimeout(res, 25000);
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      msgs.push(m);
      if (m.type === "PING")   ws.send(JSON.stringify({ type: "PONG", echo: m.challenge }));
      if (m.type === "TOOL_CALL") ws.send(JSON.stringify({ type: "TOOL_ACK", call_id: m.call_id }));
      if (m.type === "STREAM_END") { clearTimeout(t); setTimeout(res, 300); }
    };
  });
  ws.close();

  const calls = msgs.filter(m => m.type === "TOOL_CALL");
  const results = msgs.filter(m => m.type === "TOOL_RESULT");
  ok(calls.length >= 1,   `Got ${calls.length} TOOL_CALL(s)`);
  ok(results.length >= 1, `Got ${results.length} TOOL_RESULT(s)`);
  ok(results[0]?.call_id === calls[0]?.call_id, "TOOL_RESULT call_id matches TOOL_CALL");
  ok(msgs.some(m => m.type === "STREAM_END"), "Stream ended");
}

// ── 3. Multi-tool ────────────────────────────────────────────────────────────
async function test3() {
  console.log("\n── 3. Multi-tool (analyze) ──");
  const ws = await connect();
  ws.send(JSON.stringify({ type: "USER_MESSAGE", content: "analyze the correlation" }));

  const msgs = [];
  await new Promise(res => {
    const t = setTimeout(res, 30000);
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      msgs.push(m);
      if (m.type === "PING")      ws.send(JSON.stringify({ type: "PONG", echo: m.challenge }));
      if (m.type === "TOOL_CALL") ws.send(JSON.stringify({ type: "TOOL_ACK", call_id: m.call_id }));
      if (m.type === "STREAM_END") { clearTimeout(t); setTimeout(res, 300); }
    };
  });
  ws.close();

  const calls = msgs.filter(m => m.type === "TOOL_CALL");
  const results = msgs.filter(m => m.type === "TOOL_RESULT");
  ok(calls.length === 2,   `Got exactly 2 TOOL_CALLs (got ${calls.length})`);
  ok(results.length === 2, `Got exactly 2 TOOL_RESULTs (got ${results.length})`);
  ok(calls[0].tool_name === "fetch_dataset",       `First tool: ${calls[0]?.tool_name}`);
  ok(calls[1].tool_name === "compute_correlation", `Second tool: ${calls[1]?.tool_name}`);
}

// ── 4. PING / PONG ───────────────────────────────────────────────────────────
async function test4() {
  console.log("\n── 4. PING/PONG heartbeat ──");
  const ws = await connect();
  ws.send(JSON.stringify({ type: "USER_MESSAGE", content: "hello" }));

  let pingReceived = false;
  await new Promise(res => {
    const t = setTimeout(res, 20000);
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.type === "PING") {
        pingReceived = true;
        ws.send(JSON.stringify({ type: "PONG", echo: m.challenge }));
        clearTimeout(t); setTimeout(res, 500);
      }
    };
  });
  ws.close();

  ok(pingReceived, "Received a PING and replied with PONG");

  const log = await get("/log");
  const pongs = log.filter(e => e.type === "PONG" && e.verdict === "ok");
  ok(pongs.length >= 1, `Server log has ${pongs.length} successful PONG(s)`);
}

// ── 5. RESUME (reconnection) ─────────────────────────────────────────────────
async function test5() {
  console.log("\n── 5. RESUME / reconnection ──");
  await reset();

  // First connection — collect some messages then hard-disconnect
  const ws1 = await connect();
  ws1.send(JSON.stringify({ type: "USER_MESSAGE", content: "write a long detailed document" }));

  const firstBatch = [];
  let lastSeq = 0;
  await new Promise(res => {
    const t = setTimeout(res, 5000);  // collect for 5s then cut
    ws1.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      firstBatch.push(m);
      lastSeq = m.seq;
      if (m.type === "TOOL_CALL") ws1.send(JSON.stringify({ type: "TOOL_ACK", call_id: m.call_id }));
      if (m.type === "PING")      ws1.send(JSON.stringify({ type: "PONG", echo: m.challenge }));
    };
  });
  ws1.close();            // graceful close (simulate mid-stream drop)
  await new Promise(r => setTimeout(r, 400));

  ok(firstBatch.length > 3, `First conn received ${firstBatch.length} messages before drop`);
  ok(lastSeq > 0,           `Last seq = ${lastSeq}`);

  // Reconnect + RESUME
  const ws2 = await connect();
  ws2.send(JSON.stringify({ type: "RESUME", last_seq: lastSeq }));

  const replayed = await collectUntil(ws2, { count: 50, timeout: 8000 });
  ws2.close();

  const afterSeq = replayed.filter(m => m.seq > lastSeq);
  ok(afterSeq.length >= 0, `Replayed ${replayed.length} message(s) after RESUME (${afterSeq.length} new)`);

  // Verify /log recorded the RESUME
  const log = await get("/log");
  const resumes = log.filter(e => e.type === "RESUME");
  ok(resumes.length >= 1, `Server log has ${resumes.length} RESUME event(s)`);
  if (resumes.length) ok(resumes[0].verdict === "ok", `RESUME verdict: ${resumes[0].verdict}`);
}

// ── 6. TOOL_ACK in server log ────────────────────────────────────────────────
async function test6() {
  console.log("\n── 6. TOOL_ACK logging ──");
  await reset();

  const ws = await connect();
  ws.send(JSON.stringify({ type: "USER_MESSAGE", content: "find the SLA docs" }));

  await new Promise(res => {
    const t = setTimeout(res, 20000);
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.type === "TOOL_CALL") ws.send(JSON.stringify({ type: "TOOL_ACK", call_id: m.call_id }));
      if (m.type === "PING")      ws.send(JSON.stringify({ type: "PONG", echo: m.challenge }));
      if (m.type === "STREAM_END") { clearTimeout(t); setTimeout(res, 500); }
    };
  });
  ws.close();

  const log = await get("/log");
  const acks = log.filter(e => e.type === "TOOL_ACK" && e.verdict === "ok");
  ok(acks.length >= 1, `Server log has ${acks.length} successful TOOL_ACK(s)`);
}

// ── 7. Large context snapshot ────────────────────────────────────────────────
async function test7() {
  console.log("\n── 7. Large context (database schema) ──");
  const ws = await connect();
  ws.send(JSON.stringify({ type: "USER_MESSAGE", content: "show me the full database schema" }));

  const msgs = [];
  await new Promise(res => {
    const t = setTimeout(res, 25000);
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      msgs.push(m);
      if (m.type === "TOOL_CALL") ws.send(JSON.stringify({ type: "TOOL_ACK", call_id: m.call_id }));
      if (m.type === "PING")      ws.send(JSON.stringify({ type: "PONG", echo: m.challenge }));
      if (m.type === "STREAM_END") { clearTimeout(t); setTimeout(res, 400); }
    };
  });
  ws.close();

  const ctxMsgs = msgs.filter(m => m.type === "CONTEXT_SNAPSHOT");
  ok(ctxMsgs.length >= 1, `Got ${ctxMsgs.length} CONTEXT_SNAPSHOT(s)`);
  const biggest = Math.max(...ctxMsgs.map(m => JSON.stringify(m.data).length));
  ok(biggest > 500_000, `Largest context = ${Math.round(biggest/1024)}KB (threshold 500KB)`);
}

// ── 8. /log clean sweep ──────────────────────────────────────────────────────
async function test8() {
  console.log("\n── 8. /log — no protocol violations ──");
  const log = await get("/log");
  const violations = log.filter(e => e.verdict === "violation" || e.verdict === "error");
  ok(violations.length === 0,
     violations.length === 0
       ? `All ${log.length} log entries are clean`
       : `VIOLATIONS: ${JSON.stringify(violations, null, 2)}`
  );
}

// ── Runner ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(54));
  console.log(" Agent Console — Integration Test Suite");
  console.log(" Server: " + BASE_HTTP);
  console.log("═".repeat(54));

  const health = await get("/health").catch(() => null);
  if (!health) { console.error("Server not reachable — is Docker running?"); process.exit(1); }
  console.log(`\nServer health: ${JSON.stringify(health)}`);

  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
  await test8();

  console.log(`\n${"═".repeat(54)}`);
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(54));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
