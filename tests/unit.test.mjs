// Unit tests for the pure modules. Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";

import { diffFlows, jsonDiff, normalizePath } from "../js/diff.js";
import {
  buildTestSteps,
  toCurl,
  toCypress,
  toFetch,
  toHar,
  toHtmlReport,
  toPlaywright,
} from "../js/exporters.js";
import {
  combineFlows,
  highlightText,
  linkTriggers,
  matchesHostList,
  parseKeyList,
  redactBody,
  redactHeaders,
  redactUrl,
  safeHttpUrl,
  safeImageSrc,
} from "../js/utils.js";

const R = "[REDACTED]";

// ── Fixtures ─────────────────────────────────────────────────────────────────
const T0 = Date.parse("2026-11-21T10:00:00.000Z");
const fe = (step, ms, extra) => ({ type: "FE_STEP", step, timestamp: T0 + ms, readableTime: new Date(T0 + ms).toISOString(), ...extra });
const api = (step, ms, extra) => ({
  type: "API",
  step,
  startTime: T0 + ms,
  timestamp: T0 + ms,
  request: { url: "https://app.test/api/items", method: "GET", postData: null, headers: null },
  response: { status: 200, headers: null, mimeType: "application/json" },
  durationMs: 40,
  ...extra,
});

const sampleFlow = [
  { type: "INITIAL_SCREEN", step: 1, route: "https://app.test/login", timestamp: T0 },
  fe(2, 100, { event: "CLICK", element: "INPUT", target: { tag: "INPUT", selector: "#email", label: "Email", role: "textbox", inputType: "email" } }),
  fe(3, 200, { event: "INPUT_FINAL", element: "INPUT", text: "a@b.co", target: { tag: "INPUT", selector: "#email", label: "Email", role: "textbox", inputType: "email" } }),
  fe(4, 300, { event: "INPUT_FINAL", element: "INPUT", text: R, target: { tag: "INPUT", selector: "#password", name: "password", role: "textbox", inputType: "password" } }),
  fe(5, 400, { event: "CHANGE", element: "INPUT", text: "checked", target: { tag: "INPUT", selector: "#remember", role: "checkbox", inputType: "checkbox", label: "Remember me" } }),
  fe(6, 500, { event: "CLICK", element: "BUTTON", text: "Sign in", target: { tag: "BUTTON", selector: "form > button", role: "button" } }),
  api(7, 600, { request: { url: "https://app.test/api/login", method: "POST", postData: '{"user":"a"}', headers: { "Content-Type": "application/json", Authorization: R } }, response: { status: 201, headers: { "content-type": "application/json" }, mimeType: "application/json" }, responseBody: '{"ok":true}', timing: { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 0.2, wait: 30, receive: 2 }, transferSize: 120 }),
  { type: "CONSOLE", step: 8, level: "error", message: "boom", timestamp: T0 + 700 },
  fe(9, 900, { event: "ROUTE_CHANGE", route: "https://app.test/dashboard" }),
  fe(10, 10_000, { event: "CLICK", element: "A", text: "Far later", target: { tag: "A", selector: "nav a", testId: "nav-link", testIdAttr: "data-testid", role: "link" } }),
];

// ── Redaction ────────────────────────────────────────────────────────────────
test("redactHeaders masks auth, cookies, tokens and custom keys", () => {
  assert.deepEqual(
    redactHeaders({ Authorization: "Bearer x", "Content-Type": "json", Cookie: "a=1", "X-CSRF-Token": "t", "X-Tenant": "acme" }, ["x-tenant"]),
    { Authorization: R, "Content-Type": "json", Cookie: R, "X-CSRF-Token": R, "X-Tenant": R },
  );
  assert.equal(redactHeaders(null), null);
});

test("redactBody masks JSON (nested) and form bodies, leaves other text", () => {
  assert.equal(
    redactBody('{"user":"a","password":"p","nested":{"access_token":"t","list":[{"apiKey":"k"}]}}'),
    `{"user":"a","password":"${R}","nested":{"access_token":"${R}","list":[{"apiKey":"${R}"}]}}`,
  );
  assert.equal(redactBody("username=a&password=secret"), "username=a&password=%5BREDACTED%5D");
  assert.equal(redactBody("plain text"), "plain text");
  assert.equal(redactBody('{"spinner":true,"pinned":1}'), '{"spinner":true,"pinned":1}');
  assert.equal(redactBody('{"dob":"2000-01-01","name":"x"}', ["dob"]), `{"dob":"${R}","name":"x"}`);
});

test("redactUrl masks sensitive query parameters only", () => {
  assert.equal(redactUrl("https://a.com/x?access_token=abc&q=1"), "https://a.com/x?access_token=%5BREDACTED%5D&q=1");
  assert.equal(redactUrl("https://a.com/x?q=1"), "https://a.com/x?q=1");
  assert.equal(redactUrl("https://a.com/x?tenant=1", ["tenant"]), "https://a.com/x?tenant=%5BREDACTED%5D");
});

test("parseKeyList splits on commas, whitespace and newlines", () => {
  assert.deepEqual(parseKeyList(" Foo, bar\nBAZ ;qux "), ["foo", "bar", "baz", "qux"]);
  assert.deepEqual(parseKeyList(""), []);
});

test("matchesHostList supports exact, wildcard and port patterns", () => {
  assert.equal(matchesHostList("https://x.com/a", []), true);
  assert.equal(matchesHostList("https://api.x.com/a", ["api.x.com"]), true);
  assert.equal(matchesHostList("https://cdn.x.com/a", ["api.x.com"]), false);
  assert.equal(matchesHostList("https://a.b.x.com/", ["*.x.com"]), true);
  assert.equal(matchesHostList("https://x.com/", ["*.x.com"]), true);
  assert.equal(matchesHostList("https://evilx.com/", ["*.x.com"]), false);
  assert.equal(matchesHostList("http://localhost:3000/", ["localhost:3000"]), true);
  assert.equal(matchesHostList("http://localhost:4000/", ["localhost:3000"]), false);
  assert.equal(matchesHostList("https://api.x.com/", ["https://api.x.com/path"]), true);
});

// ── Safe rendering ───────────────────────────────────────────────────────────
test("highlightText escapes HTML and marks matches", () => {
  assert.equal(highlightText("<img src=x onerror=alert(1)>/api", "api"), "&lt;img src=x onerror=alert(1)&gt;/<mark>api</mark>");
  assert.equal(highlightText("a<b", ""), "a&lt;b");
  assert.equal(highlightText("ABCabc", "bc"), "A<mark>BC</mark>a<mark>bc</mark>");
});

test("safe URL and image helpers reject dangerous values", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("https://a.com/"), "https://a.com/");
  assert.equal(safeImageSrc("https://evil/track.png"), null);
  assert.ok(safeImageSrc("data:image/png;base64,AAAA"));
  assert.equal(safeImageSrc("data:image/svg+xml;base64,AAAA"), null);
});

// ── Combining & linking ──────────────────────────────────────────────────────
test("combineFlows orders by time and renumbers steps", () => {
  const out = combineFlows([api(1, 50)], [fe(1, 0, { event: "CLICK" }), fe(2, 100, { event: "CLICK" })]);
  assert.deepEqual(out.map((e) => [e.type, e.step]), [["FE_STEP", 1], ["API", 2], ["FE_STEP", 3]]);
});

test("linkTriggers attaches requests and console errors to the preceding step", () => {
  const { triggersOf, triggeredBy } = linkTriggers(sampleFlow);
  const click = sampleFlow[5];
  assert.deepEqual(triggersOf.get(click).map((e) => e.type), ["API", "CONSOLE"]);
  assert.equal(triggeredBy.get(sampleFlow[6]), click);
  // nothing within 3 s after the last click
  assert.equal(triggersOf.get(sampleFlow[9]), undefined);
});

// ── Exporters ────────────────────────────────────────────────────────────────
test("toCurl and toFetch reproduce the request", () => {
  const entry = sampleFlow[6];
  const curl = toCurl(entry);
  assert.match(curl, /^# Note: some values were masked/);
  assert.match(curl, /curl 'https:\/\/app\.test\/api\/login'/);
  assert.match(curl, /-X POST/);
  assert.match(curl, /-H 'Content-Type: application\/json'/);
  assert.match(curl, /--data-raw '\{"user":"a"\}'/);
  assert.equal(toCurl({ request: { url: "https://a/x'y", method: "GET" } }), "curl 'https://a/x'\\''y'");

  const fetchCode = toFetch(entry);
  assert.match(fetchCode, /await fetch\("https:\/\/app\.test\/api\/login"/);
  assert.match(fetchCode, /"method": "POST"/);
});

test("toHar produces a valid HAR 1.2 log", () => {
  const ws = { type: "WEBSOCKET", startTime: T0, request: { url: "wss://app.test/ws", method: "WS" }, response: { status: 101 }, frames: [{ dir: "sent", time: new Date(T0).toISOString(), opcode: 1, data: "hi" }] };
  const har = toHar([...sampleFlow, ws], { version: "9.9" });
  assert.equal(har.log.version, "1.2");
  assert.equal(har.log.creator.version, "9.9");
  assert.equal(har.log.entries.length, 2); // API + WEBSOCKET only
  const e = har.log.entries[0];
  assert.equal(e.request.method, "POST");
  assert.equal(e.request.postData.mimeType, "application/json");
  assert.equal(e.response.status, 201);
  assert.equal(e.response.content.text, '{"ok":true}');
  assert.equal(e.response.bodySize, 120);
  assert.equal(e.timings.wait, 30);
  assert.ok(["send", "wait", "receive"].every((k) => e.timings[k] >= 0));
  assert.equal(har.log.entries[1]._webSocketMessages[0].type, "send");
  assert.equal(har.log.entries[1].request.method, "GET");
});

test("buildTestSteps merges field interactions into single actions", () => {
  const steps = buildTestSteps(sampleFlow);
  assert.deepEqual(
    steps.map((s) => s.action),
    ["goto", "fill", "fill", "check", "click", "expectUrl", "click"],
  );
  assert.equal(steps[2].sensitive, true);
  assert.equal(steps[2].envName, "PASSWORD");
  assert.equal(steps[4].requests[0].request.method, "POST");
});

test("toPlaywright emits locators, env vars for secrets and response waits", () => {
  const code = toPlaywright(sampleFlow);
  assert.match(code, /import \{ test, expect \} from "@playwright\/test";/);
  assert.match(code, /await page\.goto\("https:\/\/app\.test\/login"\);/);
  assert.match(code, /page\.getByLabel\("Email"\)\.fill\("a@b\.co"\)/);
  assert.match(code, /page\.locator\("#password"\)\.fill\(process\.env\.PASSWORD \?\? ""\)/);
  assert.match(code, /getByRole\("checkbox", \{ name: "Remember me" \}\)\.check\(\)/);
  assert.match(code, /getByRole\("button", \{ name: "Sign in" \}\)\.click\(\)/);
  assert.match(code, /new URL\(r\.url\(\)\)\.pathname === "\/api\/login"/);
  assert.match(code, /toBe\(201\)/);
  assert.match(code, /toHaveURL\("https:\/\/app\.test\/dashboard"\)/);
  assert.match(code, /page\.getByTestId\("nav-link"\)\.click\(\)/);
  assert.doesNotThrow(() => new Function(code.replace(/^import .*$/m, "").replace(/\bawait\b/g, "")));
});

test("toCypress emits intercepts and env vars", () => {
  const code = toCypress(sampleFlow);
  assert.match(code, /cy\.visit\("https:\/\/app\.test\/login"\);/);
  assert.match(code, /cy\.intercept\("POST", "\*\*\/api\/login\*"\)\.as\("req1"\);/);
  assert.match(code, /cy\.wait\("@req1"\)\.its\("response\.statusCode"\)\.should\("eq", 201\);/);
  assert.match(code, /Cypress\.env\("PASSWORD"\)/);
  assert.match(code, /cy\.url\(\)\.should\("include", "\/dashboard"\);/);
  assert.match(code, /cy\.get\("\[data-testid=\\"nav-link\\"\]"\)\.click\(\);/);
  assert.doesNotThrow(() => new Function(code));
});

test("toHtmlReport escapes content, embeds only data images and locks down CSP", () => {
  const evil = [
    fe(1, 0, { event: "<script>alert(1)</script>", text: "<img src=x onerror=alert(1)>", screenshot: "https://evil/x.png", point: { x: 1, y: 1, vw: 10, vh: 10 } }),
    api(2, 10, { request: { url: "https://a/<b>", method: "GET" }, screenshot: "data:image/png;base64,AAAA" }),
  ];
  const html = toHtmlReport(evil, { title: "<t>", generatedAt: new Date(T0) });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("https://evil/x.png"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes('src="data:image/png;base64,AAAA"'));
  assert.ok(html.includes("default-src 'none'; img-src data:"));
  assert.ok(html.includes("<title>&lt;t&gt;</title>"));
});

// ── Diff ─────────────────────────────────────────────────────────────────────
test("normalizePath replaces ids and hashes", () => {
  assert.equal(normalizePath("https://a.com/users/42/orders/9f86d081884c7d65?x=1"), "a.com/users/:id/orders/:id");
  assert.equal(normalizePath("https://a.com/users/me"), "a.com/users/me");
});

test("jsonDiff reports changed, added and removed fields", () => {
  const d = jsonDiff({ a: 1, b: { c: [1, 2] }, gone: true, id: 5 }, { a: 2, b: { c: [1, 3, 4] }, id: 6 }, { ignoreVolatile: true });
  assert.deepEqual(d.map((x) => x.path), ["$.a", "$.b.c[1]", "$.b.c[2]", "$.gone"]);
  assert.equal(jsonDiff({ id: 1 }, { id: 2 }).length, 1);
});

test("diffFlows pairs requests and classifies them", () => {
  const A = [
    api(1, 0, { request: { url: "https://a.com/users/1", method: "GET" }, responseBody: '{"name":"x","updatedAt":"t1"}' }),
    api(2, 10, { request: { url: "https://a.com/only-a", method: "GET" } }),
    api(3, 20, { request: { url: "https://a.com/save", method: "POST" }, response: { status: 200 } }),
  ];
  const B = [
    api(1, 0, { request: { url: "https://a.com/users/2", method: "GET" }, responseBody: '{"name":"x","updatedAt":"t2"}' }),
    api(2, 20, { request: { url: "https://a.com/save", method: "POST" }, response: { status: 500 } }),
    api(3, 30, { request: { url: "https://a.com/only-b", method: "GET" } }),
  ];
  const { rows, summary } = diffFlows(A, B);
  assert.deepEqual(summary, { total: 4, same: 1, changed: 1, onlyA: 1, onlyB: 1 });
  const changed = rows.find((r) => r.state === "changed");
  assert.equal(changed.statusA, 200);
  assert.equal(changed.statusB, 500);
});
