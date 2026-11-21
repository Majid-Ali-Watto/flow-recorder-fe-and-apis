// ==========================================================
// EXPORTERS — pure functions that turn recorded entries into other formats.
// No DOM or chrome.* access, so they can be unit-tested in Node.
// ==========================================================

import {
  entryTime,
  escapeHtml,
  isFeEntry,
  linkTriggers,
  safeImageSrc,
} from "./utils.js";

const REDACTED = "[REDACTED]";
const SKIP_HEADERS = /^(:|content-length$|host$|connection$|accept-encoding$)/i;

function bodyText(value) {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function hasRedactions(entry) {
  return JSON.stringify([entry.request?.headers, entry.request?.postData, entry.request?.url]).includes(REDACTED);
}

// ── cURL / fetch ─────────────────────────────────────────────────────────────
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function toCurl(entry) {
  const req = entry.request || {};
  const lines = [];
  if (hasRedactions(entry)) lines.push("# Note: some values were masked as [REDACTED] when recorded.");
  const parts = [`curl ${shellQuote(req.url || "")}`];
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" || req.postData) parts.push(`-X ${method}`);
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (!SKIP_HEADERS.test(k)) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  }
  if (req.postData) parts.push(`--data-raw ${shellQuote(req.postData)}`);
  lines.push(parts.join(" \\\n  "));
  return lines.join("\n");
}

export function toFetch(entry) {
  const req = entry.request || {};
  const init = { method: (req.method || "GET").toUpperCase() };
  const headers = Object.fromEntries(
    Object.entries(req.headers || {}).filter(([k]) => !SKIP_HEADERS.test(k)),
  );
  if (Object.keys(headers).length) init.headers = headers;
  if (req.postData) init.body = req.postData;
  const note = hasRedactions(entry) ? "// Note: some values were masked as [REDACTED] when recorded.\n" : "";
  return `${note}await fetch(${JSON.stringify(req.url || "")}, ${JSON.stringify(init, null, 2)});`;
}

// ── HAR 1.2 ──────────────────────────────────────────────────────────────────
const toNameValue = (obj) =>
  Object.entries(obj || {}).map(([name, value]) => ({ name, value: String(value) }));

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key]) : "";
}

function queryString(url) {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

export function toHar(flow, { version = "1.0" } = {}) {
  const entries = flow
    .filter((e) => e.type === "API" || e.type === "WEBSOCKET")
    .map((e) => {
      const req = e.request || {};
      const res = e.response || {};
      const t = e.timing || {};
      const body = bodyText(e.responseBody);
      const httpVersion = res.protocol || "HTTP/1.1";
      const timings = {
        blocked: t.blocked ?? -1,
        dns: t.dns ?? -1,
        connect: t.connect ?? -1,
        ssl: t.ssl ?? -1,
        send: t.send ?? 0,
        wait: t.wait ?? (e.durationMs || 0),
        receive: t.receive ?? 0,
      };
      const har = {
        startedDateTime: new Date(entryTime(e) || Date.now()).toISOString(),
        time: e.durationMs || 0,
        request: {
          method: req.method === "WS" ? "GET" : req.method || "GET",
          url: req.url || "",
          httpVersion,
          cookies: [],
          headers: toNameValue(req.headers),
          queryString: queryString(req.url),
          headersSize: -1,
          bodySize: req.postData ? req.postData.length : 0,
        },
        response: {
          status: res.status || 0,
          statusText: e.error || "",
          httpVersion,
          cookies: [],
          headers: toNameValue(res.headers),
          content: {
            size: e.responseSize ?? body.length,
            mimeType: res.mimeType || "",
            ...(body ? { text: body } : {}),
            ...(e.responseBodyBase64 ? { encoding: "base64" } : {}),
          },
          redirectURL: e.redirectedTo || "",
          headersSize: -1,
          bodySize: e.transferSize ?? -1,
          ...(e.transferSize != null ? { _transferSize: e.transferSize } : {}),
        },
        cache: {},
        timings,
        _resourceType: e.type === "WEBSOCKET" ? "websocket" : (e.resourceType || "").toLowerCase() || "fetch",
      };
      if (req.postData) {
        har.request.postData = {
          mimeType: headerValue(req.headers, "content-type") || "application/octet-stream",
          text: req.postData,
        };
      }
      if (res.remoteAddress) har.serverIPAddress = res.remoteAddress.replace(/:\d*$/, "");
      if (e.error) har._error = e.error;
      if (e.type === "WEBSOCKET") {
        har._webSocketMessages = (e.frames || [])
          .filter((f) => f.dir !== "error")
          .map((f) => ({
            type: f.dir === "sent" ? "send" : "receive",
            time: Date.parse(f.time) / 1000,
            opcode: f.opcode ?? 1,
            data: f.data,
          }));
      }
      return har;
    });

  return {
    log: {
      version: "1.2",
      creator: { name: "Flow Recorder", version },
      pages: [],
      entries,
    },
  };
}

// ── Test generation (Playwright / Cypress) ──────────────────────────────────
const REQUEST_TYPES = new Set(["API", "WEBSOCKET"]);

function fieldName(target, i) {
  const raw = target?.name || target?.id || target?.label || target?.placeholder || `FIELD_${i}`;
  return raw.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toUpperCase() || `FIELD_${i}`;
}

// Turns FE steps into a normalised action list.
export function buildTestSteps(flow) {
  const { triggersOf } = linkTriggers(flow);
  const steps = [];
  let fieldCounter = 0;

  for (const e of flow) {
    if (!isFeEntry(e)) continue;
    const target = e.target || null;
    const requests = (triggersOf.get(e) || []).filter(
      (r) => REQUEST_TYPES.has(r.type) && r.type === "API" && r.request?.method,
    );

    if (e.type === "INITIAL_SCREEN") {
      if (e.route) steps.push({ action: "goto", url: e.route });
      continue;
    }
    const last = steps[steps.length - 1];
    const sameTarget = (s) => s && target && s.target?.selector === target.selector;

    switch (e.event) {
      case "CLICK":
      case "DOUBLE_CLICK": {
        if (!target) break;
        const isToggle = ["checkbox", "radio"].includes(target.inputType);
        if (isToggle) break; // handled by CHANGE (check/uncheck)
        steps.push({ action: e.event === "CLICK" ? "click" : "dblclick", target, text: e.text, requests });
        break;
      }
      case "CHANGE":
      case "INPUT_FINAL": {
        if (!target) break;
        if (["checkbox", "radio"].includes(target.inputType)) {
          if (e.event === "CHANGE") steps.push({ action: e.text === "unchecked" ? "uncheck" : "check", target, requests });
          break;
        }
        const action = target.tag === "SELECT" ? "select" : "fill";
        const sensitive = e.text === REDACTED;
        const step = { action, target, value: e.text, sensitive, requests };
        if (sensitive) step.envName = fieldName(target, ++fieldCounter);
        // A field usually produces click → INPUT_FINAL → CHANGE; keep one fill.
        if (last && sameTarget(last) && ["fill", "select"].includes(last.action)) {
          steps[steps.length - 1] = { ...step, requests: [...last.requests, ...requests] };
        } else if (last && sameTarget(last) && last.action === "click" && action === "fill") {
          steps[steps.length - 1] = { ...step, requests: [...last.requests, ...requests] };
        } else {
          steps.push(step);
        }
        break;
      }
      case "KEYDOWN":
        if (["Enter", "Escape"].includes(e.element)) {
          steps.push({ action: "press", key: e.element, target, requests });
        }
        break;
      case "ROUTE_CHANGE":
      case "PAGE_LOAD":
        if (e.route && !(last?.action === "expectUrl" && last.url === e.route)) {
          steps.push({ action: "expectUrl", url: e.route });
        }
        break;
      default:
        break;
    }
  }
  return steps;
}

function urlPattern(url) {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return String(url || "");
  }
}

const js = (v) => JSON.stringify(String(v ?? ""));

function playwrightLocator(t) {
  if (!t) return "page.locator('body')";
  if (t.testId && t.testIdAttr === "data-testid") return `page.getByTestId(${js(t.testId)})`;
  if (t.testId) return `page.locator(${js(`[${t.testIdAttr}="${t.testId}"]`)})`;
  const name = t.ariaLabel || t.label;
  if (["button", "link", "checkbox", "radio", "tab", "menuitem"].includes(t.role) && (name || t.text)) {
    return `page.getByRole(${js(t.role)}, { name: ${js(name || t.text)} })`;
  }
  if (t.label) return `page.getByLabel(${js(t.label)})`;
  if (t.placeholder) return `page.getByPlaceholder(${js(t.placeholder)})`;
  return `page.locator(${js(t.selector)})`;
}

function originOf(flow) {
  const first = flow.find((e) => e.type === "INITIAL_SCREEN" && e.route);
  try {
    return new URL(first.route).origin;
  } catch {
    return "";
  }
}

export function toPlaywright(flow) {
  const steps = buildTestSteps(flow);
  const out = [
    "// Generated by Flow Recorder. Review selectors and assertions before use.",
    'import { test, expect } from "@playwright/test";',
    "",
    'test("recorded flow", async ({ page }) => {',
  ];
  const ind = "  ";
  for (const s of steps) {
    if (s.action === "goto") {
      out.push(`${ind}await page.goto(${js(s.url)});`);
      continue;
    }
    if (s.action === "expectUrl") {
      out.push(`${ind}await expect(page).toHaveURL(${js(s.url)});`);
      continue;
    }
    const loc = playwrightLocator(s.target ? { ...s.target, text: s.text } : null);
    let code;
    let comment = "";
    switch (s.action) {
      case "click": code = `${loc}.click()`; break;
      case "dblclick": code = `${loc}.dblclick()`; break;
      case "check": code = `${loc}.check()`; break;
      case "uncheck": code = `${loc}.uncheck()`; break;
      case "select": code = `${loc}.selectOption(${js(s.value)})`; break;
      case "fill":
        if (s.sensitive) {
          code = `${loc}.fill(process.env.${s.envName} ?? "")`;
          comment = " // value was redacted when recorded";
        } else {
          code = `${loc}.fill(${js(s.value)})`;
        }
        break;
      case "press":
        code = s.target ? `${loc}.press(${js(s.key)})` : `page.keyboard.press(${js(s.key)})`;
        break;
      default:
        continue;
    }
    const req = s.requests?.[0];
    if (!req) {
      out.push(`${ind}await ${code};${comment}`);
      continue;
    }
    const method = req.request.method.toUpperCase();
    const path = urlPattern(req.request.url);
    out.push(
      `${ind}{`,
      `${ind}  const responsePromise = page.waitForResponse(`,
      `${ind}    (r) => r.request().method() === ${js(method)} && new URL(r.url()).pathname === ${js(path)},`,
      `${ind}  );`,
      `${ind}  await ${code};${comment}`,
      req.response?.status
        ? `${ind}  expect((await responsePromise).status()).toBe(${req.response.status});`
        : `${ind}  await responsePromise;`,
      `${ind}}`,
    );
  }
  out.push("});", "");
  return out.join("\n");
}

function cypressGet(t, text) {
  if (!t) return "cy.get('body')";
  if (t.testId) return `cy.get(${js(`[${t.testIdAttr || "data-testid"}="${t.testId}"]`)})`;
  if (["button", "link"].includes(t.role) && text && !t.ariaLabel) {
    return `cy.contains(${js(t.tag?.toLowerCase() || "*")}, ${js(text)})`;
  }
  return `cy.get(${js(t.selector)})`;
}

export function toCypress(flow) {
  const steps = buildTestSteps(flow);
  const origin = originOf(flow);
  const out = [
    "// Generated by Flow Recorder. Review selectors and assertions before use.",
    'describe("recorded flow", () => {',
    '  it("replays the recorded steps", () => {',
  ];
  const ind = "    ";
  let alias = 0;
  for (const s of steps) {
    const get = cypressGet(s.target, s.text);
    let action;
    switch (s.action) {
      case "goto":
        out.push(`${ind}cy.visit(${js(s.url)});`);
        continue;
      case "expectUrl": {
        let path = s.url;
        if (origin && s.url.startsWith(origin)) path = s.url.slice(origin.length) || "/";
        out.push(`${ind}cy.url().should("include", ${js(path)});`);
        continue;
      }
      case "click":
        action = `${get}.click();`;
        break;
      case "dblclick":
        action = `${get}.dblclick();`;
        break;
      case "check":
        action = `${get}.check();`;
        break;
      case "uncheck":
        action = `${get}.uncheck();`;
        break;
      case "select":
        action = `${get}.select(${js(s.value)});`;
        break;
      case "fill":
        action = s.sensitive
          ? `${get}.clear().type(Cypress.env(${js(s.envName)}) || "", { log: false }); // value was redacted when recorded`
          : `${get}.clear().type(${js(s.value)});`;
        break;
      case "press":
        action = s.target
          ? `${get}.type(${js(s.key === "Enter" ? "{enter}" : "{esc}")});`
          : `cy.get("body").type(${js(s.key === "Enter" ? "{enter}" : "{esc}")});`;
        break;
      default:
        continue;
    }
    const req = s.requests?.[0];
    if (req) {
      const name = `req${++alias}`;
      out.push(`${ind}cy.intercept(${js(req.request.method.toUpperCase())}, ${js(`**${urlPattern(req.request.url)}*`)}).as(${js(name)});`);
      out.push(`${ind}${action}`);
      out.push(
        req.response?.status
          ? `${ind}cy.wait(${js("@" + name)}).its("response.statusCode").should("eq", ${req.response.status});`
          : `${ind}cy.wait(${js("@" + name)});`,
      );
    } else {
      out.push(`${ind}${action}`);
    }
  }
  out.push("  });", "});", "");
  return out.join("\n");
}

// ── Self-contained HTML report ──────────────────────────────────────────────
const REPORT_CSS = `
:root{--bg:#0a0c13;--card:#11141e;--card2:#171b28;--border:#242a3c;--text:#e7eaf3;--muted:#8c94aa;--accent:#6e8cff;--green:#34d399;--amber:#fbbf24;--red:#f87171;--violet:#a78bfa;--code:#0c0f18;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f4f6fb;--card:#fff;--card2:#f3f5fa;--border:#e1e5ef;--text:#151826;--muted:#59627a;--accent:#4d68f5;--green:#059669;--amber:#b45309;--red:#dc2626;--violet:#7c3aed;--code:#f6f8fc;color-scheme:light}}
*{box-sizing:border-box}
body{font-family:Inter,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:32px 24px;line-height:1.55;font-size:14px}
.wrap{max-width:1000px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}
.meta{color:var(--muted);font-size:13px;margin-bottom:20px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:24px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.stat b{display:block;font-size:20px}.stat span{font-size:12px;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:12px;border-top:2px solid var(--kind,var(--accent))}
.hdr{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;font-size:13px}
.badge{padding:1px 8px;border-radius:6px;font-weight:700;font-size:11px;font-family:ui-monospace,monospace;background:var(--card2);border:1px solid var(--border)}
.ok{color:var(--green)}.warn{color:var(--amber)}.err{color:var(--red)}.fe{color:var(--violet)}.muted{color:var(--muted)}
.url{font-family:ui-monospace,monospace;font-size:12px;word-break:break-all}
details{margin-top:8px;border:1px solid var(--border);border-radius:8px;background:var(--card2)}
summary{cursor:pointer;color:var(--muted);font-size:12.5px;padding:7px 10px}
pre{margin:0;background:var(--code);padding:10px 12px;overflow:auto;max-height:400px;font-size:12px;white-space:pre-wrap;word-break:break-all;border-top:1px solid var(--border)}
.shot{position:relative;display:inline-block;max-width:100%;margin:10px}
.shot img{max-width:100%;border-radius:6px;display:block;border:1px solid var(--border)}
.dot{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:3px solid #ef4444;background:rgba(239,68,68,.25);box-shadow:0 0 0 3px rgba(255,255,255,.85)}
`;

function prettyBody(value) {
  const text = bodyText(value);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function clip(text, max = 200_000) {
  return text.length > max ? `${text.slice(0, max)}\n… [truncated in report]` : text;
}

const det = (label, content) =>
  content ? `<details><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(clip(content))}</pre></details>` : "";

function screenshotHtml(e) {
  const src = safeImageSrc(e.screenshot);
  if (!src) return "";
  const p = e.point;
  const dot =
    p && p.vw > 0 && p.vh > 0
      ? `<span class="dot" style="left:${((p.x / p.vw) * 100).toFixed(2)}%;top:${((p.y / p.vh) * 100).toFixed(2)}%"></span>`
      : "";
  return `<details><summary>Screenshot</summary><div class="shot"><img src="${src}" alt="screenshot">${dot}</div></details>`;
}

function statusCls(status) {
  if (!status) return "muted";
  return status < 400 ? "ok" : status < 500 ? "warn" : "err";
}

export function toHtmlReport(flow, { title = "Flow Recorder report", generatedAt = new Date() } = {}) {
  const { triggeredBy } = linkTriggers(flow);
  const requests = flow.filter((e) => REQUEST_TYPES.has(e.type));
  const failed = requests.filter((e) => e.response?.status >= 400 || e.error).length;
  const errors = flow.filter((e) => e.type === "CONSOLE" && e.level === "error").length;
  const steps = flow.filter(isFeEntry).length;

  const cards = flow.map((e, i) => {
    const step = `#${Number.isFinite(e.step) ? e.step : i + 1}`;
    const time = escapeHtml(e.readableTime || "");
    const cause = triggeredBy.get(e);
    const causeHtml = cause
      ? `<div class="muted">↳ after step #${escapeHtml(cause.step)} ${escapeHtml(cause.event || cause.type)} ${escapeHtml(cause.text || "")}</div>`
      : "";

    if (isFeEntry(e)) {
      const name = e.type === "INITIAL_SCREEN" ? "INITIAL SCREEN" : e.event;
      return `<div class="card" style="--kind:var(--violet)"><div class="hdr"><span class="muted">${step}</span><span class="badge fe">FE</span><strong>${escapeHtml(name)}</strong><span class="muted">${time}</span></div>
${e.route ? `<div class="url">${escapeHtml(e.route)}</div>` : ""}
${e.element || e.text ? `<div>${escapeHtml(e.element || "")} ${e.text ? `“${escapeHtml(e.text)}”` : ""}</div>` : ""}
${e.target?.selector ? `<div class="url muted">${escapeHtml(e.target.selector)}</div>` : ""}
${screenshotHtml(e)}</div>`;
    }

    if (e.type === "CONSOLE") {
      const cls = e.level === "error" ? "err" : "warn";
      return `<div class="card" style="--kind:var(--${cls === "err" ? "red" : "amber"})"><div class="hdr"><span class="muted">${step}</span><span class="badge ${cls}">${escapeHtml(e.level.toUpperCase())}</span><span class="muted">${escapeHtml(e.source || "")} · ${time}</span></div>
<pre>${escapeHtml(e.message || "")}</pre>${e.location ? `<div class="url muted">${escapeHtml(e.location)}</div>` : ""}${det("Stack", e.stack)}${causeHtml}</div>`;
    }

    const status = e.response?.status;
    const method = e.request?.method || "?";
    const kind = { ok: "green", warn: "amber", err: "red", muted: "accent" }[statusCls(status)];
    return `<div class="card" style="--kind:var(--${e.error ? "red" : kind})"><div class="hdr"><span class="muted">${step}</span><span class="badge">${escapeHtml(method)}</span><span class="badge ${statusCls(status)}">${escapeHtml(status ?? (e.error ? "ERR" : "—"))}</span>${e.durationMs ? `<span class="muted">${escapeHtml(e.durationMs)} ms</span>` : ""}<span class="muted">${time}</span></div>
<div class="url">${escapeHtml(e.request?.url || "")}</div>
${e.error ? `<div class="err">⚠ ${escapeHtml(e.error)}</div>` : ""}${causeHtml}
${det("Request headers", e.request?.headers ? JSON.stringify(e.request.headers, null, 2) : "")}
${det("Request body", e.request?.postData ? prettyBody(e.request.postData) : "")}
${det("Response headers", e.response?.headers ? JSON.stringify(e.response.headers, null, 2) : "")}
${det("Response body", e.responseBody && !e.responseBodyBase64 ? prettyBody(e.responseBody) : "")}
${det(`WebSocket frames (${e.frames?.length || 0})`, e.frames?.length ? JSON.stringify(e.frames, null, 2) : "")}
${det(`Server-Sent Events (${e.sseEvents?.length || 0})`, e.sseEvents?.length ? JSON.stringify(e.sseEvents, null, 2) : "")}
${screenshotHtml(e)}</div>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
<h1>${escapeHtml(title)}</h1>
<div class="meta">Generated ${escapeHtml(generatedAt.toISOString())} by Flow Recorder. This file may contain sensitive data from the recorded site.</div>
<div class="summary"><div class="stat"><b>${flow.length}</b><span>Entries</span></div><div class="stat"><b>${requests.length}</b><span>Requests</span></div><div class="stat"><b class="${failed ? "err" : ""}">${failed}</b><span>Failed</span></div><div class="stat"><b>${steps}</b><span>FE steps</span></div><div class="stat"><b class="${errors ? "err" : ""}">${errors}</b><span>Console errors</span></div></div>
${cards.join("\n")}
</div>
</body>
</html>
`;
}

