// End-to-end test: loads the unpacked extension into headless Chrome through the
// DevTools pipe (Extensions.loadUnpacked), records a local test site and checks
// what was captured. Run: node --test tests/
// Set CHROME_PATH to use a different Chrome binary. Skips if Chrome is missing.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "tests", "fixtures", "site");
const CHROME = process.env.CHROME_PATH || "google-chrome";
const haveChrome = spawnSync(CHROME, ["--version"]).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = "[REDACTED]";

// ── Minimal CDP client over --remote-debugging-pipe ──────────────────────────
class Cdp {
  constructor(child) {
    this.out = child.stdio[3];
    this.in = child.stdio[4];
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    let buf = Buffer.alloc(0);
    this.in.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let i;
      while ((i = buf.indexOf(0)) !== -1) {
        const msg = JSON.parse(buf.subarray(0, i).toString("utf8"));
        buf = buf.subarray(i + 1);
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej, method } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result);
        } else {
          this.listeners.forEach((fn) => fn(msg));
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.out.write(JSON.stringify(msg) + "\0");
    return new Promise((res, rej) => this.pending.set(id, { res, rej, method }));
  }
}

// ── Local test server (HTTP + WebSocket + SSE) ───────────────────────────────
function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/login") {
      req.resume();
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end('{"ok":true,"session_id":"sess-secret"}');
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write('data: {"token":"sse-secret","n":1}\n\n');
      const t = setTimeout(() => res.write('event: tick\ndata: {"n":2}\n\n'), 200);
      req.on("close", () => clearTimeout(t));
      return;
    }
    const file = url.pathname === "/" || url.pathname === "/spa-route" ? "index.html" : url.pathname.slice(1);
    try {
      const body = readFileSync(join(SITE, file));
      const type = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" }[extname(file)] || "text/plain";
      res.writeHead(200, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  const sockets = new Set();
  server.on("upgrade", (req, socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    const accept = createHash("sha1")
      .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const payload = Buffer.from('{"welcome":true,"token":"ws-secret"}');
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
    socket.on("data", () => {}); // ignore client frames
  });
  return new Promise((res) =>
    server.listen(0, "127.0.0.1", () => res({ server, sockets, port: server.address().port })),
  );
}

// ── Shared state ─────────────────────────────────────────────────────────────
let chrome;
let cdp;
let srv;
let profile;
let extId;
let ctl; // session on an extension page used to message the background
const exceptions = [];

async function openPage(url) {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await sleep(800);
  return { targetId, sessionId };
}

async function evaluate(sessionId, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

const bg = (action, extra = {}) =>
  evaluate(ctl, `chrome.runtime.sendMessage(${JSON.stringify({ action, ...extra })})`);

async function click(sessionId, selector) {
  const [x, y] = await evaluate(
    sessionId,
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
  );
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, sessionId);
  }
}

before(async () => {
  if (!haveChrome) return;
  srv = await startServer();
  profile = mkdtempSync(join(tmpdir(), "flow-recorder-e2e-"));
  chrome = spawn(
    CHROME,
    ["--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
      "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "about:blank"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  );
  cdp = new Cdp(chrome);
  cdp.listeners.add((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
  });
  ({ id: extId } = await cdp.send("Extensions.loadUnpacked", { path: ROOT }));
  await sleep(1000);
  ({ sessionId: ctl } = await openPage(`chrome-extension://${extId}/html/options.html`));
});

after(async () => {
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited;
  }
  srv?.sockets.forEach((s) => s.destroy());
  srv?.server.close();
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

// Waits until the background has processed all queued FE events.
async function waitForStableCounts() {
  let last = "";
  for (let i = 0; i < 40; i++) {
    const s = await bg("GET_RECORDING_STATE");
    const now = `${s.apiCount}/${s.feCount}`;
    if (now === last) return s;
    last = now;
    await sleep(1000);
  }
  throw new Error("recording never settled");
}

const run = haveChrome ? test : test.skip;
let apiFlow = [];
let feFlow = [];
let recovered = null;

run("records API, console, WebSocket, SSE and FE steps with masking", { timeout: 90_000 }, async () => {
  await evaluate(
    ctl,
    `chrome.storage.local.set({ includeReqHeaders: true, includeResHeaders: true, maskSecrets: true,
       customMaskKeys: "fullname", hostAllowList: "127.0.0.1:${srv.port}", captureConsole: true,
       captureWebSockets: true, keepHistory: true })`,
  );
  await sleep(300);

  const page = await openPage(`http://127.0.0.1:${srv.port}/`);
  await cdp.send("Target.activateTarget", { targetId: page.targetId });

  assert.equal((await bg("START_API")).ok, true);
  assert.equal((await bg("START_FE")).ok, true);
  await sleep(500);

  const s = page.sessionId;
  await click(s, "#go");
  await sleep(1500);
  await click(s, "#ws");
  await click(s, "#sse");
  await sleep(800);
  await click(s, "#err");
  await click(s, "#email");
  await cdp.send("Input.insertText", { text: "jane@example.com" }, s);
  await click(s, "#pw");
  await cdp.send("Input.insertText", { text: "hunter2" }, s);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", text: "a" }, s);
  await click(s, "#fullname");
  await cdp.send("Input.insertText", { text: "Jane Doe" }, s);
  await click(s, "#remember");
  await evaluate(s, `(() => { const p = document.getElementById("plan"); p.value = "pro"; p.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, s);
  await click(s, "#spa");
  await sleep(1500); // route changes are detected by polling every 800 ms

  // ── Service-worker restart: state must be recovered from IndexedDB ──
  const before = await waitForStableCounts();
  await sleep(1500); // let IndexedDB writes settle
  await cdp.send("ServiceWorker.enable", {}, ctl).catch(() => {});
  await cdp.send("ServiceWorker.stopAllWorkers", {}, ctl).catch(() => {});
  await sleep(1000);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const swAlive = targetInfos.some((t) => t.type === "service_worker" && t.url.includes(extId));
  const afterRestart = await bg("GET_RECORDING_STATE"); // wakes the worker
  recovered = { swStopped: !swAlive, before, afterRestart };
  await click(s, "#go"); // must still be recorded after the restart
  await waitForStableCounts();

  assert.equal((await bg("STOP_API")).ok, true);
  assert.equal((await bg("STOP_FE")).ok, true);
  apiFlow = (await bg("GET_API_FLOW")).flow;
  feFlow = (await bg("GET_FE_FLOW")).flow;

  // ── HTTP ──
  const data = apiFlow.filter((e) => e.type === "API" && e.request.url.includes("/data.json"));
  assert.ok(data.length >= 2, "data.json recorded before and after restart");
  for (const e of data) {
    assert.ok(e.request.url.includes("access_token=%5BREDACTED%5D"), e.request.url);
    assert.equal(e.request.headers.Authorization, R);
    assert.equal(JSON.parse(e.responseBody).token, R);
    assert.ok(e.timing && e.timing.wait >= 0, "timing captured");
    assert.ok(e.transferSize > 0, "transfer size captured");
  }
  assert.ok(!apiFlow.some((e) => e.request?.url.includes("localhost")), "host allow-list excludes other hosts");
  const login = apiFlow.find((e) => e.request?.url.endsWith("/login"));
  assert.equal(JSON.parse(login.request.postData).password, R);
  assert.equal(JSON.parse(login.responseBody).session_id, R);
  assert.equal(login.response.status, 201);

  // ── Console ──
  const consoleEntries = apiFlow.filter((e) => e.type === "CONSOLE");
  assert.ok(consoleEntries.some((e) => e.source === "console.error" && e.message.includes("boom-console")));
  assert.ok(consoleEntries.some((e) => e.source === "exception" && e.message.includes("boom-exception")));

  // ── WebSocket ──
  const ws = apiFlow.find((e) => e.type === "WEBSOCKET");
  assert.ok(ws, "websocket recorded");
  assert.equal(ws.response.status, 101);
  const received = ws.frames.find((f) => f.dir === "received");
  const sent = ws.frames.find((f) => f.dir === "sent");
  assert.equal(JSON.parse(received.data).token, R);
  assert.equal(JSON.parse(sent.data).token, R);

  // ── SSE ──
  const sse = apiFlow.find((e) => e.stream === "sse");
  assert.ok(sse?.sseEvents?.length >= 1, "SSE events recorded");
  assert.equal(JSON.parse(sse.sseEvents[0].data).token, R);

  // ── FE ──
  const finals = feFlow.filter((e) => e.event === "INPUT_FINAL" || e.event === "CHANGE");
  const valueOf = (sel) => finals.find((e) => e.target?.selector === sel)?.text;
  assert.equal(valueOf("#email"), "jane@example.com");
  assert.equal(valueOf("#pw"), R);
  assert.equal(valueOf("#fullname"), R, "custom mask key applied in the page");
  assert.equal(feFlow.find((e) => e.event === "CHANGE" && e.target?.selector === "#remember")?.text, "checked");
  assert.equal(feFlow.find((e) => e.event === "CHANGE" && e.target?.selector === "#plan")?.text, "pro");
  assert.ok(!feFlow.some((e) => e.event === "KEYDOWN" && e.element === "a"), "printable keys are not logged");
  assert.ok(feFlow.some((e) => e.event === "KEYDOWN" && e.element === "Enter"));
  assert.ok(feFlow.some((e) => e.event === "ROUTE_CHANGE" && e.route.endsWith("/spa-route")));
  const go = feFlow.find((e) => e.event === "CLICK" && e.target?.testId === "load-data");
  assert.ok(go, "click carries data-testid");
  assert.equal(go.target.selector, '[data-testid="load-data"]');
  assert.ok(go.point && go.point.vw > 0, "click position captured");
  const shots = feFlow.filter((e) => e.screenshot).length;
  // Bursts faster than ~2 events/s skip screenshots by design; the test types far faster than a person.
  assert.ok(feFlow[0].screenshot, "initial screen captured");
  assert.ok(shots >= 5, `screenshots captured (${shots}/${feFlow.length})`);
});

run("recovers the recording after a service-worker restart", { skip: !haveChrome }, () => {
  assert.ok(recovered, "previous test ran");
  if (!recovered.swStopped) {
    console.log("  (note: Chrome did not stop the worker; recovery path not exercised)");
    return;
  }
  assert.equal(recovered.afterRestart.apiRecording, true);
  assert.equal(recovered.afterRestart.feRecording, true);
  assert.ok(recovered.afterRestart.apiCount >= recovered.before.apiCount - 2, "API entries restored");
  assert.ok(recovered.afterRestart.feCount >= recovered.before.feCount - 2, "FE entries restored");
});

run("history keeps the session and returns the combined flow", async () => {
  const { sessions } = await bg("GET_SESSIONS");
  assert.equal(sessions.length, 1);
  assert.ok(sessions[0].endedAt, "session closed when recording stopped");
  const { flow } = await bg("GET_SESSION_FLOW", { id: sessions[0].id });
  assert.equal(flow.length, apiFlow.length + feFlow.length);
  assert.deepEqual(flow.map((e) => e.step), flow.map((_, i) => i + 1));
});

run("viewer renders list, links, waterfall, compare and generates tests", async () => {
  const { sessionId: v } = await openPage(`chrome-extension://${extId}/html/viewer.html?source=live`);
  await sleep(800);
  const counts = await evaluate(
    v,
    `({ entries: document.querySelectorAll(".entry").length,
        console: document.querySelectorAll(".entry-console").length,
        chips: document.querySelectorAll(".link-chip").length,
        markers: document.querySelectorAll(".click-marker").length,
        timing: document.querySelectorAll(".timing-bar").length,
        curl: [...document.querySelectorAll(".entry-action-btn")].filter(b => b.textContent === "cURL").length })`,
  );
  assert.equal(counts.entries, apiFlow.length + feFlow.length);
  assert.ok(counts.console >= 2);
  assert.ok(counts.chips > 0, "FE steps link to the requests they triggered");
  assert.ok(counts.markers > 0, "click markers drawn on screenshots");
  assert.ok(counts.timing > 0);
  assert.ok(counts.curl > 0);

  await evaluate(v, `document.querySelector('[data-view="waterfall"]').click()`);
  assert.ok((await evaluate(v, `document.querySelectorAll(".wf-bar").length`)) > 0);

  await evaluate(v, `document.querySelector('[data-view="compare"]').click()`);
  const sessionId = (await bg("GET_SESSIONS")).sessions[0].id;
  await evaluate(v, `(() => { const s = document.getElementById("compareSelect"); s.value = ${JSON.stringify(sessionId)}; s.dispatchEvent(new Event("change")); })()`);
  await sleep(500);
  const compareText = await evaluate(v, `document.getElementById("flowContainer").textContent`);
  assert.match(compareText, /0 changed/);

  const code = await evaluate(
    v,
    `(async () => { const m = await import("/js/exporters.js");
       const { flow } = await chrome.runtime.sendMessage({ action: "GET_COMBINED_FLOW" });
       return { pw: m.toPlaywright(flow), har: m.toHar(flow).log.entries.length }; })()`,
  );
  assert.match(code.pw, /page\.getByTestId\("load-data"\)\.click\(\)/);
  assert.match(code.pw, /waitForResponse/);
  assert.match(code.pw, /process\.env\.PASSWORD/);
  assert.ok(code.har >= 3);
});

run("viewer neutralises malicious uploaded flows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flow-recorder-fixture-"));
  const file = join(dir, "evil.json");
  writeFileSync(
    file,
    JSON.stringify([
      { type: "FE_STEP", step: 1, event: "CLICK", element: "<img id=pwn1 src=x>", text: "<b id=pwn2>b</b>", route: "https://e.com/<i id=pwn3>", readableTime: "<u id=pwn4>", screenshot: "https://evil.example/t.png", target: { selector: "<s id=pwn5>" } },
      { type: "API", step: "<s id=pwn6>", request: { url: "javascript:alert(1)//<img id=pwn7 src=x>", method: 'GET" id="pwn8' }, response: { status: "200<em id=pwn9>" }, error: "<em id=pwn10>" },
      { type: "CONSOLE", level: "error", message: "<img id=pwn11 src=x>", stack: "<b id=pwn12>" },
      { type: "WEBSOCKET", request: { url: "wss://x/<b id=pwn13>", method: "WS" }, frames: [{ dir: "sent", data: "<b id=pwn14>" }] },
    ]),
  );
  const { sessionId: v } = await openPage(`chrome-extension://${extId}/html/viewer.html`);
  const { root } = await cdp.send("DOM.getDocument", {}, v);
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#fileInput" }, v);
  await cdp.send("DOM.setFileInputFiles", { files: [file], nodeId }, v);
  await sleep(800);
  const result = await evaluate(
    v,
    `({ entries: document.querySelectorAll(".entry").length,
        injected: [...Array(14)].map((_, i) => "#pwn" + (i + 1)).filter((s) => document.querySelector(s)),
        remoteImages: [...document.images].map((i) => i.src).filter((s) => !s.startsWith("data:") && !s.startsWith(location.origin)),
        jsLinks: document.querySelectorAll('a[href^="javascript"]').length })`,
  );
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.entries, 4);
  assert.deepEqual(result.injected, []);
  assert.deepEqual(result.remoteImages, []);
  assert.equal(result.jsLinks, 0);
});

run("last recording survives a worker restart after it was stopped", async () => {
  await cdp.send("ServiceWorker.stopAllWorkers", {}, ctl).catch(() => {});
  await sleep(1000);
  const state = await bg("GET_RECORDING_STATE");
  assert.equal(state.apiCount, apiFlow.length);
  assert.equal(state.feCount, feFlow.length);
});

run("popup, options, recorder and legal pages load without errors", async () => {
  const popup = await openPage(`chrome-extension://${extId}/html/popup.html`);
  assert.equal(await evaluate(popup.sessionId, `document.getElementById("statusText").textContent`), "Idle");
  assert.match(await evaluate(popup.sessionId, `document.getElementById("statusCounts").textContent`), /API/);

  const options = await openPage(`chrome-extension://${extId}/html/options.html`);
  assert.equal(await evaluate(options.sessionId, `document.querySelectorAll("#shortcutList li").length`), 3);
  assert.equal(await evaluate(options.sessionId, `document.getElementById("hostAllowList").value`), `127.0.0.1:${srv.port}`);

  const rec = await openPage(`chrome-extension://${extId}/html/recorder.html`);
  assert.ok((await evaluate(rec.sessionId, `document.getElementById("tabSelect").options.length`)) >= 2);

  for (const page of ["privacy", "terms"]) {
    const p = await openPage(`chrome-extension://${extId}/html/${page}.html`);
    assert.ok((await evaluate(p.sessionId, `document.querySelectorAll("h2").length`)) > 3);
  }

  assert.equal((await bg("CLEAR_DATA")).ok, true);
  assert.equal((await bg("GET_SESSIONS")).sessions.length, 0);

  // Exceptions from extension pages (the test site throws one on purpose).
  const unexpected = exceptions.filter((e) => !String(e).includes("boom-exception"));
  assert.deepEqual(unexpected, []);
});
