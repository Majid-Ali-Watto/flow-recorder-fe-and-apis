import { diffFlows } from "./diff.js";
import {
  toCurl,
  toCypress,
  toFetch,
  toHar,
  toHtmlReport,
  toPlaywright,
} from "./exporters.js";
import {
  entryTime,
  getFilteredFlow,
  highlightText,
  isFeEntry,
  linkTriggers,
  loadFile,
  makeDetails,
  renderScreenshot,
  renderSummary,
  safeHttpUrl,
  shortUrl,
  statusClass,
  timestampSlug,
} from "./utils.js";
import { mountThemeToggle } from "./theme.js";

mountThemeToggle(document.getElementById("themeToggle"));

// ── Elements ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const flowContainer = $("flowContainer");
const searchInput = $("searchUrl");
const methodFilter = $("filterMethod");
const statusFilter = $("filterStatus");
const resultCount = $("resultCount");
const scopeInputs = {
  feUrl: $("scopeFeUrl"),
  apiUrl: $("scopeApiUrl"),
  payload: $("scopePayload"),
  response: $("scopeResponse"),
};
const historySelect = $("historySelect");
const compareBar = $("compareBar");
const compareSelect = $("compareSelect");
const videoPanel = $("videoPanel");
const videoPlayer = $("videoPlayer");

// ── State ────────────────────────────────────────────────────────────────────
let flow = [];
let filteredFlow = [];
let links = { triggersOf: new Map(), triggeredBy: new Map() };
let indexOf = new Map();
let view = "list";
let source = null; // { kind: "live" } | { kind: "session", id } | { kind: "file" }
let compareFlow = null;
let compareLabel = "";
let videoUrl = null;

const getSearchScope = () =>
  Object.fromEntries(Object.entries(scopeInputs).map(([k, el]) => [k, el.checked]));

// ── Small helpers ────────────────────────────────────────────────────────────
// el("span", { className: "x", text: "y" }, [children])
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { text, ...rest } = props;
  Object.assign(node, rest);
  if (text !== undefined) node.textContent = String(text);
  children.filter(Boolean).forEach((c) => node.appendChild(c));
  return node;
}

function flash(btn, label = "Copy") {
  btn.textContent = "Copied!";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = label;
    btn.classList.remove("copied");
  }, 1500);
}

function copyButton(label, title, getText, className = "entry-action-btn") {
  const btn = el("button", { className, title, text: label });
  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(getText()).then(() => flash(btn, label));
  });
  return btn;
}

function downloadText(text, filename, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  el("a", { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function stepLabel(entry, i) {
  return `#${Number.isFinite(entry.step) ? entry.step : i + 1}`;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function showEmpty(message, title = "Nothing to show") {
  flowContainer.replaceChildren(
    el("div", { className: "empty-state" }, [
      el("div", { className: "empty-icon" }),
      el("p", { className: "empty-title", text: title }),
      el("p", { text: message }),
    ]),
  );
}

// "14:03:22.481" in local time; full ISO timestamp on hover.
function formatTime(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return String(iso || "");
  const hms = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${hms}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

// ── Filters ──────────────────────────────────────────────────────────────────
function populateFilters() {
  const methods = [...new Set(flow.map((e) => e.request?.method).filter(Boolean))].sort();
  methodFilter.innerHTML = `<option value="">All methods</option>`;
  methods.forEach((m) => methodFilter.appendChild(el("option", { value: m, text: m })));

  const statuses = [
    ...new Set(flow.map((e) => e.response?.status).filter((s) => s !== undefined && s !== null)),
  ].sort((a, b) => a - b);
  statusFilter.innerHTML = `<option value="">All statuses</option>`;
  statuses.forEach((s) => statusFilter.appendChild(el("option", { value: String(s), text: s })));
}

// ── Navigation between linked entries ───────────────────────────────────────
function entryDomId(entry) {
  return `entry-${indexOf.get(entry)}`;
}

function goToEntry(entry) {
  if (view !== "list") setView("list");
  let node = $(entryDomId(entry));
  if (!node) {
    searchInput.value = "";
    methodFilter.value = "";
    statusFilter.value = "";
    renderFlow();
    node = $(entryDomId(entry));
  }
  if (!node) return;
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.classList.remove("flash");
  void node.offsetWidth; // restart the animation
  node.classList.add("flash");
}

function entryLink(entry, label) {
  const btn = el("button", { className: "link-chip", text: label });
  btn.addEventListener("click", () => goToEntry(entry));
  return btn;
}

function describeEntry(e) {
  if (e.type === "CONSOLE") return `${e.level === "error" ? "ERR" : "WARN"} ${String(e.message || "").slice(0, 50)}`;
  if (e.type === "WEBSOCKET") return `WS ${shortUrl(e.request?.url)}`;
  if (isFeEntry(e)) return `${e.type === "INITIAL_SCREEN" ? "INITIAL SCREEN" : e.event} ${e.text ? `“${String(e.text).slice(0, 30)}”` : ""}`;
  const status = e.response?.status ?? (e.error ? "ERR" : "…");
  return `${e.request?.method || "?"} ${shortUrl(e.request?.url)} · ${status}`;
}

function triggerRow(entry) {
  const cause = links.triggeredBy.get(entry);
  if (!cause) return null;
  return kvRow("Caused by", entryLink(cause, `${stepLabel(cause, indexOf.get(cause))} ${describeEntry(cause)}`), "trigger-row");
}

function triggeredList(entry) {
  const effects = links.triggersOf.get(entry);
  if (!effects?.length) return null;
  const chips = effects.slice(0, 20).map((e) => {
    const chip = entryLink(e, describeEntry(e));
    const status = e.response?.status;
    if (e.type === "CONSOLE") chip.classList.add(e.level === "error" ? "chip-error" : "chip-warn");
    else if (status >= 400 || e.error) chip.classList.add("chip-error");
    return chip;
  });
  if (effects.length > 20) chips.push(el("span", { className: "kv-hint", text: `+${effects.length - 20} more` }));
  return kvRow("Triggered", chips, "trigger-row");
}

// ── Video sync ───────────────────────────────────────────────────────────────
function seekButton(entry) {
  const offset = entry.videoOffsetMs;
  if (!Number.isFinite(offset) || offset < 0) return null;
  const btn = el("button", {
    className: "entry-action-btn",
    title: "Jump to this moment in the screen recording",
    text: `▶ ${formatClock(offset)}`,
  });
  btn.addEventListener("click", () => {
    if (!videoUrl) {
      alert("Load the matching screen recording first (🎬 Load video).");
      return;
    }
    videoPanel.hidden = false;
    videoPlayer.currentTime = offset / 1000;
    videoPlayer.play().catch(() => {});
  });
  return btn;
}

// ── Entry renderers ──────────────────────────────────────────────────────────
// Label / value row used inside cards.
function kvRow(label, children, className = "") {
  const value = el("div", { className: "kv-value" });
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach((c) =>
    value.appendChild(typeof c === "string" ? document.createTextNode(c) : c),
  );
  return el("div", { className: `kv-row ${className}`.trim() }, [el("span", { className: "kv-label", text: label }), value]);
}

function makeUrlRow(cssClass, label, url, query) {
  const p = kvRow(label, [], cssClass);
  const valueEl = p.querySelector(".kv-value");
  const text = String(url ?? "");
  const href = safeHttpUrl(text);
  const link = el(href ? "a" : "span");
  if (href) {
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  // highlightText escapes the text, so this is safe to assign as HTML.
  link.innerHTML = highlightText(text, query);
  link.classList.add("mono");
  valueEl.appendChild(link);
  if (text) valueEl.appendChild(copyButton("Copy", `Copy ${label} to clipboard`, () => text, "copy-url-btn"));
  return p;
}

function header(entry, i, badges, actions = []) {
  return el("div", { className: "entry-header" }, [
    el("span", { className: "step-num", text: stepLabel(entry, i) }),
    ...badges,
    el("span", { className: "entry-time", text: formatTime(entry.readableTime), title: entry.readableTime || "" }),
    el("span", { className: "entry-actions" }, actions),
  ]);
}

function entryKind(entry) {
  if (isFeEntry(entry)) return "fe";
  if (entry.type === "CONSOLE") return entry.level === "error" ? "console-error" : "console-warning";
  if (entry.type === "WEBSOCKET") return "ws";
  const status = Number(entry.response?.status);
  if (entry.error || status >= 500) return "bad";
  if (status >= 400) return "warn";
  if (status >= 300) return "redirect";
  return "ok";
}

const TIMING_PHASES = [
  ["blocked", "Queued / blocked"],
  ["dns", "DNS lookup"],
  ["connect", "Connection (incl. TLS)"],
  ["send", "Request sent"],
  ["wait", "Waiting for server (TTFB)"],
  ["receive", "Content download"],
];

function renderTiming(entry) {
  const t = entry.timing;
  const size = formatBytes(entry.transferSize);
  if (!t && !size) return null;
  const row = el("div", { className: "timing-row" });
  if (t) {
    const total = TIMING_PHASES.reduce((acc, [k]) => acc + Math.max(0, t[k] || 0), 0) || 1;
    const bar = el("div", { className: "timing-bar", title: "Request timing breakdown" });
    TIMING_PHASES.forEach(([k, label]) => {
      const v = Math.max(0, t[k] || 0);
      if (!v) return;
      bar.appendChild(
        el("span", {
          className: `timing-seg seg-${k}`,
          title: `${label}: ${v} ms`,
          style: `width:${(v / total) * 100}%`,
        }),
      );
    });
    row.appendChild(bar);
  }
  const facts = [];
  if (t?.wait >= 0) facts.push(`TTFB ${Math.round(t.wait)} ms`);
  if (t?.receive > 0) facts.push(`download ${Math.round(t.receive)} ms`);
  if (size) facts.push(`${size} transferred`);
  if (entry.response?.fromCache) facts.push("from cache");
  if (entry.response?.protocol) facts.push(entry.response.protocol);
  row.appendChild(el("span", { className: "timing-facts", text: facts.join(" · ") }));
  return row;
}

function renderAPIEntry(entry, i, urlQuery, scope) {
  const rawUrl = String(entry.request?.url || "");
  const method = String(entry.request?.method || "?");
  const methodSlug = method.toLowerCase().replace(/[^a-z]/g, "");
  const status = Number(entry.response?.status) || null;
  const duration = Number(entry.durationMs);
  const step = Number.isFinite(entry.step) ? entry.step : i + 1;
  const json = () => JSON.stringify(entry, null, 2);

  const dlBtn = el("button", {
    className: "entry-action-btn",
    title: `Download this entry as request-step${step}.json`,
    text: "Download",
  });
  dlBtn.addEventListener("click", () => downloadText(json(), `request-step${step}.json`));

  const div = el("div", { className: "entry" }, [
    header(
      entry,
      i,
      [
        el("span", { className: `method-badge method-${methodSlug}`, text: method }),
        status && el("span", { className: `status-badge ${statusClass(status)}`, text: status }),
        entry.stream === "sse" && el("span", { className: "method-badge method-ws", text: "SSE" }),
        duration > 0 && el("span", { className: "duration", text: `${duration} ms` }),
      ],
      [
        seekButton(entry),
        copyButton("Copy", "Copy the full entry as JSON", json),
        copyButton("cURL", "Copy as a cURL command", () => toCurl(entry)),
        copyButton("fetch", "Copy as a JavaScript fetch() call", () => toFetch(entry)),
        dlBtn,
      ],
    ),
  ]);

  if (entry.page?.url) {
    div.appendChild(makeUrlRow("page-url", "Page", entry.page.url, scope.feUrl ? urlQuery : ""));
  }
  div.appendChild(makeUrlRow("req-url", "Endpoint", rawUrl, scope.apiUrl ? urlQuery : ""));
  if (entry.redirectedTo) div.appendChild(kvRow("Redirect", el("span", { className: "mono", text: entry.redirectedTo })));
  if (entry.error) div.appendChild(el("p", { className: "entry-error", text: `⚠ ${entry.error}` }));

  const trig = triggerRow(entry);
  if (trig) div.appendChild(trig);
  const timing = renderTiming(entry);
  if (timing) div.appendChild(timing);

  if (entry.request?.headers) div.appendChild(makeDetails("Request Headers", entry.request.headers));
  if (entry.request?.postData) div.appendChild(makeDetails("Request Body", parseMaybeJson(entry.request.postData)));
  if (entry.response?.headers) div.appendChild(makeDetails("Response Headers", entry.response.headers));
  if (entry.responseBody) {
    const label = entry.responseBodyTruncated ? "Response Body (truncated)" : "Response Body";
    div.appendChild(makeDetails(label, parseMaybeJson(entry.responseBody)));
  }
  if (entry.sseEvents?.length) {
    const extra = entry.sseEventsDropped ? ` +${entry.sseEventsDropped} dropped` : "";
    div.appendChild(makeDetails(`Server-Sent Events (${entry.sseEvents.length}${extra})`, entry.sseEvents));
  }

  const screenshot = renderScreenshot(entry);
  if (screenshot) div.appendChild(screenshot);
  return div;
}

function renderWebSocketEntry(entry, i, urlQuery, scope) {
  const status = Number(entry.response?.status) || null;
  const frames = entry.frames || [];
  const sent = frames.filter((f) => f.dir === "sent").length;
  const div = el("div", { className: "entry" }, [
    header(
      entry,
      i,
      [
        el("span", { className: "method-badge method-ws", text: "WS" }),
        status && el("span", { className: `status-badge ${statusClass(status)}`, text: status }),
        el("span", { className: "duration", text: entry.closedAt ? `closed · ${entry.durationMs} ms` : "open" }),
      ],
      [
        seekButton(entry),
        copyButton("Copy", "Copy the full entry as JSON", () => JSON.stringify(entry, null, 2)),
      ],
    ),
  ]);
  if (entry.page?.url) div.appendChild(makeUrlRow("page-url", "Page", entry.page.url, scope.feUrl ? urlQuery : ""));
  div.appendChild(makeUrlRow("req-url", "Socket", entry.request?.url, scope.apiUrl ? urlQuery : ""));
  const trig = triggerRow(entry);
  if (trig) div.appendChild(trig);
  const extra = entry.framesDropped ? `, +${entry.framesDropped} dropped` : "";
  div.appendChild(
    makeDetails(`Frames (${frames.length}: ${sent} sent, ${frames.length - sent} received${extra})`, frames),
  );
  if (entry.response?.headers) div.appendChild(makeDetails("Handshake Response Headers", entry.response.headers));
  return div;
}

function renderConsoleEntry(entry, i) {
  const isError = entry.level === "error";
  const div = el("div", { className: `entry entry-console ${isError ? "is-error" : "is-warning"}` }, [
    header(
      entry,
      i,
      [
        el("span", { className: `method-badge ${isError ? "method-delete" : "method-put"}`, text: isError ? "ERROR" : "WARN" }),
        el("span", { className: "entry-time", text: entry.source || "" }),
      ],
      [seekButton(entry), copyButton("Copy", "Copy message and stack", () => [entry.message, entry.location, entry.stack].filter(Boolean).join("\n"))],
    ),
    el("pre", { className: "console-msg", text: entry.message || "" }),
  ]);
  if (entry.location) div.appendChild(kvRow("Source", el("span", { className: "mono", text: entry.location })));
  if (entry.page?.url) div.appendChild(kvRow("Page", el("span", { className: "mono", text: entry.page.url })));
  const trig = triggerRow(entry);
  if (trig) div.appendChild(trig);
  if (entry.stack) div.appendChild(makeDetails("Stack trace", entry.stack));
  return div;
}

const FE_EVENT_LABELS = {
  INITIAL_SCREEN: "Recording started",
  PAGE_LOAD: "Page loaded",
  CLICK: "Click",
  DOUBLE_CLICK: "Double-click",
  CHANGE: "Changed value",
  INPUT_FINAL: "Entered value",
  KEYDOWN: "Key press",
  SCROLL: "Scroll",
  ROUTE_CHANGE: "Navigated",
  SECTION_CHANGE: "Toggled section",
  SECTION_VISIBLE: "Section shown",
  LOADER_DONE: "Loader finished",
  DOM_MUTATION: "UI changed",
};

function renderFEEntry(entry, i) {
  const key = entry.type === "INITIAL_SCREEN" ? "INITIAL_SCREEN" : String(entry.event || "");
  const title = FE_EVENT_LABELS[key] || key || "FE event";
  const div = el("div", { className: "entry" }, [
    header(
      entry,
      i,
      [
        el("span", { className: "method-badge method-fe", text: "FE" }),
        el("span", { className: "entry-title", text: title, title: key }),
      ],
      [seekButton(entry)],
    ),
  ]);

  if (entry.route) div.appendChild(makeUrlRow("page-url", "Route", entry.route, ""));
  if (entry.element || entry.text) {
    const parts = [];
    if (entry.element) parts.push(el("code", { className: "selector", text: entry.element.toLowerCase() }));
    if (entry.text) parts.push(el("span", { className: "quote", text: `“${entry.text}”` }));
    div.appendChild(kvRow(entry.event === "KEYDOWN" ? "Key" : "Element", parts));
  }

  const t = entry.target;
  if (t?.selector) {
    const ids = [
      t.testId && `${t.testIdAttr || "data-testid"}="${t.testId}"`,
      t.role && `role=${t.role}`,
      (t.ariaLabel || t.label) && `name="${t.ariaLabel || t.label}"`,
    ].filter(Boolean);
    div.appendChild(
      kvRow("Selector", [
        el("code", { className: "selector", text: t.selector }),
        copyButton("Copy", "Copy CSS selector", () => t.selector, "copy-url-btn"),
        ids.length ? el("span", { className: "kv-hint", text: ids.join(" · ") }) : null,
      ]),
    );
  }

  const effects = triggeredList(entry);
  if (effects) div.appendChild(effects);

  const screenshot = renderScreenshot(entry);
  if (screenshot) div.appendChild(screenshot);
  return div;
}

function renderEntry(entry, i, urlQuery, scope) {
  let node;
  if (isFeEntry(entry)) node = renderFEEntry(entry, i);
  else if (entry.type === "CONSOLE") node = renderConsoleEntry(entry, i);
  else if (entry.type === "WEBSOCKET") node = renderWebSocketEntry(entry, i, urlQuery, scope);
  else node = renderAPIEntry(entry, i, urlQuery, scope);
  node.id = entryDomId(entry);
  node.dataset.kind = entryKind(entry);
  return node;
}

// ── Views ────────────────────────────────────────────────────────────────────
function renderList() {
  const urlQuery = searchInput.value.trim().toLowerCase();
  const scope = getSearchScope();
  const timeline = el("div", { className: "timeline" });
  filteredFlow.forEach((entry) => timeline.appendChild(renderEntry(entry, indexOf.get(entry), urlQuery, scope)));
  flowContainer.replaceChildren(renderSummary(flow), timeline);
}

function renderWaterfall() {
  const rows = filteredFlow.filter((e) => e.type === "API" || e.type === "WEBSOCKET");
  if (!rows.length) return showEmpty("Record with API recording to see request timings here.", "No requests to show");

  const start = Math.min(...rows.map(entryTime));
  const end = Math.max(...rows.map((e) => entryTime(e) + (e.durationMs || 0)));
  const range = Math.max(1, end - start);
  const pct = (ms) => `${Math.max(0, Math.min(100, (ms / range) * 100))}%`;

  const wrap = el("div", { className: "waterfall" });

  // Time axis
  const axis = el("div", { className: "wf-row wf-axis" }, [el("span", { className: "wf-label", text: "Request" })]);
  const axisTrack = el("div", { className: "wf-track" });
  for (let k = 0; k <= 4; k++) {
    axisTrack.appendChild(el("span", { className: "wf-tick", style: `left:${k * 25}%`, text: `${Math.round((range * k) / 4)} ms` }));
  }
  axis.appendChild(axisTrack);
  wrap.appendChild(axis);

  // FE steps as markers
  const steps = flow.filter((e) => isFeEntry(e) && entryTime(e) >= start && entryTime(e) <= end);
  if (steps.length) {
    const stepTrack = el("div", { className: "wf-track" });
    steps.forEach((s) => {
      const m = el("button", {
        className: "wf-step",
        style: `left:${pct(entryTime(s) - start)}`,
        title: describeEntry(s),
      });
      m.addEventListener("click", () => goToEntry(s));
      stepTrack.appendChild(m);
    });
    wrap.appendChild(el("div", { className: "wf-row" }, [el("span", { className: "wf-label muted", text: "FE steps" }), stepTrack]));
  }

  rows.forEach((e) => {
    const status = e.response?.status;
    const label = el("button", { className: "wf-label wf-link", title: e.request?.url || "" }, [
      el("span", { className: `wf-method method-${(e.request?.method || "").toLowerCase().replace(/[^a-z]/g, "")}`, text: e.request?.method || "?" }),
      document.createTextNode(` ${shortUrl(e.request?.url)}`),
    ]);
    label.addEventListener("click", () => goToEntry(e));

    const offset = entryTime(e) - start;
    const dur = Math.max(e.durationMs || 0, range * 0.004);
    const bar = el("div", {
      className: `wf-bar ${status >= 400 || e.error ? "wf-bad" : ""} ${e.type === "WEBSOCKET" ? "wf-ws" : ""}`,
      style: `left:${pct(offset)};width:${pct(dur)}`,
      title: `${e.request?.method} ${e.request?.url}\n${status ?? e.error ?? ""} · ${e.durationMs ?? "?"} ms`,
    });
    const t = e.timing;
    if (t) {
      const total = TIMING_PHASES.reduce((acc, [k]) => acc + Math.max(0, t[k] || 0), 0) || 1;
      TIMING_PHASES.forEach(([k]) => {
        const v = Math.max(0, t[k] || 0);
        if (v) bar.appendChild(el("span", { className: `timing-seg seg-${k}`, style: `width:${(v / total) * 100}%` }));
      });
    }
    const track = el("div", { className: "wf-track" }, [bar]);
    wrap.appendChild(
      el("div", { className: "wf-row" }, [
        label,
        track,
        el("span", { className: "wf-dur", text: `${e.durationMs ?? "—"} ms` }),
      ]),
    );
  });

  const legend = el("div", { className: "timing-legend" });
  TIMING_PHASES.forEach(([k, labelText]) =>
    legend.appendChild(el("span", {}, [el("span", { className: `timing-seg seg-${k} legend-swatch` }), document.createTextNode(labelText)])),
  );
  flowContainer.replaceChildren(renderSummary(flow), legend, wrap);
}

function renderCompare() {
  if (!compareFlow) {
    return showEmpty("Pick recording B above, from History or a JSON file, to compare it with the current flow (A).", "Choose a recording to compare");
  }
  const { rows, summary } = diffFlows(flow, compareFlow, { ignoreVolatile: $("ignoreVolatile").checked });
  const onlyDiffs = $("onlyDiffs").checked;
  const visible = onlyDiffs ? rows.filter((r) => r.state !== "same") : rows;

  const head = el("div", { className: "flow-summary" }, [
    el("strong", { text: "A: " }),
    document.createTextNode(`${sourceLabel()}  ⇄  `),
    el("strong", { text: "B: " }),
    document.createTextNode(`${compareLabel} — `),
    el("span", { className: "diff-chip diff-changed", text: `${summary.changed} changed` }),
    el("span", { className: "diff-chip diff-onlyA", text: `${summary.onlyA} only in A` }),
    el("span", { className: "diff-chip diff-onlyB", text: `${summary.onlyB} only in B` }),
    el("span", { className: "diff-chip diff-same", text: `${summary.same} identical` }),
  ]);

  if (!visible.length) {
    flowContainer.replaceChildren(head, el("div", { className: "empty-state", text: "No differences in API requests." }));
    return;
  }

  const table = el("table", { className: "diff-table" });
  table.appendChild(
    el("thead", {}, [
      el("tr", {}, ["", "Request", "Status A → B", "Duration A → B", "Response changes"].map((h) => el("th", { text: h }))),
    ]),
  );
  const tbody = el("tbody");
  visible.forEach((r) => {
    const stateText = { changed: "≠", same: "=", onlyA: "A", onlyB: "B" }[r.state];
    const statusCell = el("td", {}, [
      el("span", { className: `status-badge ${statusClass(r.statusA)}`, text: r.statusA ?? "—" }),
      document.createTextNode(" → "),
      el("span", { className: `status-badge ${statusClass(r.statusB)}`, text: r.statusB ?? "—" }),
    ]);
    let durText = `${r.durationA ?? "—"} → ${r.durationB ?? "—"} ms`;
    if (r.durationA != null && r.durationB != null) {
      const delta = r.durationB - r.durationA;
      durText += ` (${delta >= 0 ? "+" : ""}${delta})`;
    }
    const changesCell = el("td");
    if (r.changes.length) {
      const det = el("details", {}, [el("summary", { text: `${r.changes.length}${r.changes.length >= 50 ? "+" : ""} field(s)` })]);
      const list = el("ul", { className: "diff-list" });
      r.changes.forEach((c) =>
        list.appendChild(
          el("li", {}, [
            el("code", { text: c.path }),
            document.createTextNode(": "),
            el("span", { className: "diff-a", text: c.a }),
            document.createTextNode(" → "),
            el("span", { className: "diff-b", text: c.b }),
          ]),
        ),
      );
      det.appendChild(list);
      changesCell.appendChild(det);
    } else {
      changesCell.textContent = r.state === "same" || r.state === "changed" ? "none" : "—";
    }
    const reqCell = el("td", { title: r.url }, [
      el("span", { className: `method-badge method-${r.method.toLowerCase().replace(/[^a-z]/g, "")}`, text: r.method }),
      document.createTextNode(` ${shortUrl(r.url)}${r.occurrence > 1 ? ` (#${r.occurrence})` : ""}`),
    ]);
    tbody.appendChild(
      el("tr", { className: `diff-row diff-${r.state}` }, [
        el("td", { className: "diff-state", text: stateText }),
        reqCell,
        statusCell,
        el("td", { text: durText }),
        changesCell,
      ]),
    );
  });
  table.appendChild(tbody);
  flowContainer.replaceChildren(head, el("div", { className: "diff-wrap" }, [table]));
}

function renderFlow() {
  filteredFlow = getFilteredFlow(searchInput, methodFilter, statusFilter, flow, getSearchScope());
  resultCount.textContent = `${filteredFlow.length} / ${flow.length} entries`;

  if (view === "compare") return renderCompare();
  if (!flow.length) return showEmpty("Open a JSON file, pick a recording from History, or record one from the extension popup.", "No flow loaded yet");
  if (!filteredFlow.length) return showEmpty("Try a different search, or clear the filters.", "No matching entries");
  if (view === "waterfall") return renderWaterfall();
  return renderList();
}

function setView(next) {
  view = next;
  document.querySelectorAll(".view-tab").forEach((b) => b.classList.toggle("active", b.dataset.view === next));
  compareBar.hidden = next !== "compare";
  renderFlow();
}

function setFlow(data, newSource) {
  flow = Array.isArray(data) ? data : [];
  if (newSource) source = newSource;
  links = linkTriggers(flow);
  indexOf = new Map(flow.map((e, i) => [e, i]));
  populateFilters();
  renderFlow();
}

function sourceLabel() {
  if (source?.kind === "live") return "current recording";
  if (source?.kind === "session") return historySelect.selectedOptions[0]?.textContent || "history session";
  return "uploaded file";
}

// ── History ──────────────────────────────────────────────────────────────────
function sessionLabel(s) {
  const when = new Date(s.startedAt).toLocaleString();
  let host = "";
  try {
    host = new URL(s.tabUrl).host;
  } catch {}
  return `${when} · ${host || s.tabTitle || "recording"} · ${s.apiCount ?? 0} API / ${s.feCount ?? 0} FE${s.videoStartedAt ? " · 🎬" : ""}`;
}

let sessions = [];
async function loadSessions() {
  const res = await chrome.runtime.sendMessage({ action: "GET_SESSIONS" }).catch(() => null);
  sessions = res?.sessions || [];
  const fill = (select, placeholder, includeLive) => {
    const keep = select.value;
    select.replaceChildren(el("option", { value: "", text: placeholder }));
    if (includeLive) select.appendChild(el("option", { value: "live", text: "● Current / last recording" }));
    sessions.forEach((s) =>
      select.appendChild(el("option", { value: s.id, text: `${s.id === res?.currentId ? "● " : ""}${sessionLabel(s)}` })),
    );
    if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  };
  fill(historySelect, sessions.length ? "History…" : "History (empty)", true);
  fill(compareSelect, "Choose recording…", true);
}

async function fetchSessionFlow(id) {
  if (id === "live") {
    const res = await chrome.runtime.sendMessage({ action: "GET_COMBINED_FLOW" });
    return res?.flow || [];
  }
  const res = await chrome.runtime.sendMessage({ action: "GET_SESSION_FLOW", id });
  if (res?.ok === false) throw new Error(res.error);
  return res?.flow || [];
}

async function openSource(id) {
  try {
    const data = await fetchSessionFlow(id);
    setFlow(data, id === "live" ? { kind: "live" } : { kind: "session", id });
  } catch (err) {
    showEmpty(err.message, "Could not load the recording");
  }
}

// ── Event wiring ─────────────────────────────────────────────────────────────
const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

searchInput.addEventListener("input", debounce(renderFlow, 250));
methodFilter.addEventListener("change", renderFlow);
statusFilter.addEventListener("change", renderFlow);
Object.values(scopeInputs).forEach((cb) => cb.addEventListener("change", renderFlow));

$("clearFilters").addEventListener("click", () => {
  searchInput.value = "";
  methodFilter.value = "";
  statusFilter.value = "";
  renderFlow();
});

document.querySelectorAll(".view-tab").forEach((btn) =>
  btn.addEventListener("click", () => setView(btn.dataset.view)),
);

historySelect.addEventListener("change", () => {
  if (historySelect.value) openSource(historySelect.value);
});

$("refreshFlow").addEventListener("click", async () => {
  await loadSessions();
  if (source?.kind === "live") openSource("live");
  else if (source?.kind === "session") openSource(source.id);
});

$("deleteSession").addEventListener("click", async () => {
  const id = historySelect.value;
  if (!id || id === "live") return alert("Pick a saved session in History first.");
  if (!confirm("Delete this recording from history? This cannot be undone.")) return;
  const res = await chrome.runtime.sendMessage({ action: "DELETE_SESSION", id }).catch((e) => ({ ok: false, error: e.message }));
  if (res?.ok === false) return alert(res.error);
  historySelect.value = "";
  await loadSessions();
});

const exportName = (ext) => `flow-${timestampSlug()}.${ext}`;
const requireData = (list) => {
  if (!list.length) {
    alert("Nothing to export: load a flow first (or clear the filters).");
    return false;
  }
  return true;
};

$("downloadFiltered").addEventListener("click", () => {
  if (requireData(filteredFlow)) downloadText(JSON.stringify(filteredFlow, null, 2), exportName("json"));
});
$("downloadHar").addEventListener("click", () => {
  if (!requireData(filteredFlow)) return;
  const har = toHar(filteredFlow, { version: chrome.runtime.getManifest().version });
  if (!har.log.entries.length) return alert("No HTTP or WebSocket requests in the visible entries.");
  downloadText(JSON.stringify(har, null, 2), exportName("har"));
});
$("downloadReport").addEventListener("click", () => {
  if (!requireData(filteredFlow)) return;
  downloadText(toHtmlReport(filteredFlow, { title: `Flow report — ${sourceLabel()}` }), exportName("html"), "text/html");
});
const requireFeSteps = () => {
  if (flow.some((e) => e.type === "FE_STEP")) return true;
  alert("Test generation needs FE steps. Record with “FE Recording” (ideally together with API recording).");
  return false;
};
$("downloadPlaywright").addEventListener("click", () => {
  if (requireFeSteps()) downloadText(toPlaywright(flow), `recorded-flow-${timestampSlug()}.spec.ts`, "text/plain");
});
$("downloadCypress").addEventListener("click", () => {
  if (requireFeSteps()) downloadText(toCypress(flow), `recorded-flow-${timestampSlug()}.cy.js`, "text/plain");
});

// Export menu: close after choosing, on outside click, or Escape
const exportMenu = $("exportMenu");
exportMenu.querySelectorAll(".menu-list button").forEach((b) =>
  b.addEventListener("click", () => exportMenu.removeAttribute("open")),
);
document.addEventListener("click", (e) => {
  if (exportMenu.open && !exportMenu.contains(e.target)) exportMenu.removeAttribute("open");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") exportMenu.removeAttribute("open");
});

// Compare
compareSelect.addEventListener("change", async () => {
  if (!compareSelect.value) return;
  try {
    compareFlow = await fetchSessionFlow(compareSelect.value);
    compareLabel = compareSelect.selectedOptions[0].textContent;
  } catch (err) {
    alert(`Could not load recording B: ${err.message}`);
  }
  renderFlow();
});
loadFile($("compareFile"), (data) => {
  compareFlow = data;
  compareLabel = "uploaded file";
  compareSelect.value = "";
  renderFlow();
});
$("ignoreVolatile").addEventListener("change", renderFlow);
$("onlyDiffs").addEventListener("change", renderFlow);

// Video
$("videoInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  videoPlayer.src = videoUrl;
  videoPanel.hidden = false;
  e.target.value = "";
});
$("closeVideo").addEventListener("click", () => {
  videoPlayer.pause();
  videoPanel.hidden = true;
});

loadFile($("fileInput"), (data) => {
  historySelect.value = "";
  setFlow(data, { kind: "file" });
});

// ── Startup ──────────────────────────────────────────────────────────────────
loadSessions().then(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("source") === "live") {
    historySelect.value = "live";
    openSource("live");
  } else if (params.get("session")) {
    historySelect.value = params.get("session");
    openSource(params.get("session"));
  }
});
