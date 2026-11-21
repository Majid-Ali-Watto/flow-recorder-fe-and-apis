// Requests to ignore (static assets)
export function shouldIgnoreRequest(url, resourceType) {
  if (resourceType) {
    const ignoreTypes = ["Script", "Stylesheet", "Image", "Font", "Media"];
    if (ignoreTypes.includes(resourceType)) return true;
  }

  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (
      path.match(
        /\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|map|woff|woff2|ttf|eot)$/,
      )
    )
      return true;
  } catch (err) {
    // ignore URL parse failures
  }

  return false;
}

// ── Secret masking (best effort) ─────────────────────────────────────────────
const REDACTED = "[REDACTED]";
const SENSITIVE_HEADER_RE =
  /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|api[-_]?key|session|csrf|xsrf|password/i;
const SENSITIVE_KEY_RE =
  /pass(word|wd|code)?$|^pwd$|secret|token|api[-_]?key|authorization|cookie|session[-_]?id|^otp$|cvv|cvc|card[-_]?number|^ssn$|^pin$|private[-_]?key|client[-_]?secret/i;

// Parses a user-entered list ("foo, bar\nbaz") into lower-case keys.
export function parseKeyList(text) {
  return String(text || "")
    .split(/[\s,;]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

function isSensitiveKey(key, extraKeys = []) {
  return (
    SENSITIVE_KEY_RE.test(key) || extraKeys.includes(String(key).toLowerCase())
  );
}

export function redactHeaders(headers, extraKeys = []) {
  if (!headers || typeof headers !== "object") return null;
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] =
      SENSITIVE_HEADER_RE.test(name) || extraKeys.includes(name.toLowerCase())
        ? REDACTED
        : value;
  }
  return out;
}

function redactValue(value, extraKeys) {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, extraKeys));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k, extraKeys) ? REDACTED : redactValue(v, extraKeys);
    }
    return out;
  }
  return value;
}

// Masks sensitive keys in a JSON or form-urlencoded body string. Other formats
// are returned unchanged.
export function redactBody(body, extraKeys = []) {
  if (typeof body !== "string" || !body) return body;
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(redactValue(JSON.parse(trimmed), extraKeys));
    } catch {
      return body;
    }
  }
  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed)) {
    const params = new URLSearchParams(trimmed);
    let changed = false;
    for (const key of [...params.keys()]) {
      if (isSensitiveKey(key, extraKeys)) {
        params.set(key, REDACTED);
        changed = true;
      }
    }
    return changed ? params.toString() : body;
  }
  return body;
}

export function redactUrl(url, extraKeys = []) {
  try {
    const u = new URL(url);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (
        isSensitiveKey(key, extraKeys) ||
        /^(access_token|code|sig|signature)$/i.test(key)
      ) {
        u.searchParams.set(key, REDACTED);
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

// ── Domain allow-list ────────────────────────────────────────────────────────
// Patterns: "api.example.com", "*.example.com", "localhost:3000". An empty
// list allows everything.
export function matchesHostList(url, patterns) {
  if (!patterns?.length) return true;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const hostname = u.hostname.toLowerCase();
  const host = u.host.toLowerCase();
  return patterns.some((raw) => {
    const p = raw.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
    if (!p) return false;
    if (p.startsWith("*.")) {
      const base = p.slice(2);
      return hostname === base || hostname.endsWith("." + base);
    }
    return p.includes(":") ? host === p : hostname === p;
  });
}

// ── Safe rendering helpers ───────────────────────────────────────────────────
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow http(s) links from recorded/uploaded data.
export function safeHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

// Only allow inline image data, never remote URLs (which would leak that the
// file was opened, or load untrusted content).
export function safeImageSrc(src) {
  return typeof src === "string" &&
    /^data:image\/(png|jpeg|webp);base64,/i.test(src)
    ? src
    : null;
}

// ── Highlight matching text ──────────────────────────────────────────────────
// Returns an HTML string: the text is escaped and matches wrapped in <mark>.
export function highlightText(text, query) {
  const raw = String(text ?? "");
  if (!query) return escapeHtml(raw);
  const lower = raw.toLowerCase();
  const q = String(query).toLowerCase();
  let out = "";
  let pos = 0;
  let idx;
  while ((idx = lower.indexOf(q, pos)) !== -1) {
    out += escapeHtml(raw.slice(pos, idx));
    out += `<mark>${escapeHtml(raw.slice(idx, idx + q.length))}</mark>`;
    pos = idx + q.length;
  }
  return out + escapeHtml(raw.slice(pos));
}

// ── Scrollable JSON panel with Copy button ────────────────────────────────────
export function createScrollableJSON(jsonData) {
  const wrapper = document.createElement("div");
  wrapper.className = "json-wrapper";

  const pre = document.createElement("pre");
  pre.className = "json-pre";
  pre.textContent =
    typeof jsonData === "string" ? jsonData : JSON.stringify(jsonData, null, 2);
  wrapper.appendChild(pre);

  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard
      .writeText(pre.textContent)
      .then(() => {
        copyBtn.textContent = "Copied!";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "Copy";
          copyBtn.classList.remove("copied");
        }, 1500);
      })
      .catch(() => alert("Failed to copy"));
  });
  wrapper.appendChild(copyBtn);

  return wrapper;
}

export function makeDetails(label, data) {
  const det = document.createElement("details");
  det.className = "details-block";
  const sum = document.createElement("summary");
  sum.textContent = label;
  det.appendChild(sum);
  det.appendChild(createScrollableJSON(data));
  return det;
}

// ── Status badge class ────────────────────────────────────────────────────────
export function statusClass(code) {
  if (!code) return "status-unknown";
  if (code < 300) return "status-2xx";
  if (code < 400) return "status-3xx";
  if (code < 500) return "status-4xx";
  return "status-5xx";
}

// ── Render helper functions ──────────────────────────────────────────────────
export function renderScreenshot(entry) {
  const src = safeImageSrc(entry.screenshot);
  if (!src) return null;
  const det = document.createElement("details");
  det.className = "details-block";
  const sum = document.createElement("summary");
  sum.textContent = "Screenshot";
  det.appendChild(sum);

  const wrapper = document.createElement("div");
  wrapper.className = "screenshot-wrapper";

  const frame = document.createElement("div");
  frame.className = "shot-frame";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "screenshot";
  frame.appendChild(img);

  // Marker where the user clicked (coordinates are relative to the viewport,
  // which is what captureVisibleTab captures).
  const pt = entry.point;
  if (pt && pt.vw > 0 && pt.vh > 0 && pt.x >= 0 && pt.y >= 0) {
    const marker = document.createElement("span");
    marker.className = "click-marker";
    marker.title = `Click at ${Math.round(pt.x)}, ${Math.round(pt.y)}`;
    marker.style.left = `${Math.min(100, (pt.x / pt.vw) * 100)}%`;
    marker.style.top = `${Math.min(100, (pt.y / pt.vh) * 100)}%`;
    frame.appendChild(marker);
  }
  wrapper.appendChild(frame);

  const step = Number.isFinite(entry.step) ? entry.step : "";
  const ext = src.startsWith("data:image/jpeg") ? "jpg" : src.startsWith("data:image/webp") ? "webp" : "png";
  const dlBtn = document.createElement("a");
  dlBtn.className = "copy-btn";
  dlBtn.title = `Download screenshot as screenshot-step${step}.${ext}`;
  dlBtn.textContent = "Download";
  dlBtn.href = src;
  dlBtn.download = `screenshot-step${step}.${ext}`;
  wrapper.appendChild(dlBtn);

  det.appendChild(wrapper);
  return det;
}

// ── Render summary ───────────────────────────────────────────────────────────
export function renderSummary(flow) {
  const requests = flow.filter((e) => e.type === "API" || e.type === "WEBSOCKET");
  const failed = requests.filter(
    (e) => e.response?.status >= 400 || (e.type === "API" && e.error),
  ).length;
  const timed = requests.filter((e) => e.type === "API" && e.durationMs);
  const avg = timed.reduce((acc, e) => acc + e.durationMs, 0) / (timed.length || 1);
  const steps = flow.filter((e) => e.type === "FE_STEP" || e.type === "INITIAL_SCREEN").length;
  const errors = flow.filter((e) => e.type === "CONSOLE" && e.level === "error").length;
  const sockets = flow.filter((e) => e.type === "WEBSOCKET").length;

  const summary = document.createElement("div");
  summary.className = "flow-summary stat-grid";
  [
    ["Entries", flow.length, ""],
    ["Requests", requests.length, ""],
    ["Failed", failed, failed ? "bad" : "good"],
    ["Avg time", `${Math.round(avg)} ms`, ""],
    ["FE steps", steps, ""],
    ["Console errors", errors, errors ? "bad" : "good"],
    ["WebSockets", sockets, ""],
  ].forEach(([label, value, tone]) => {
    const tile = document.createElement("div");
    tile.className = `stat${tone ? ` stat-${tone}` : ""}`;
    const v = document.createElement("span");
    v.className = "stat-value";
    v.textContent = String(value);
    const l = document.createElement("span");
    l.className = "stat-label";
    l.textContent = label;
    tile.append(v, l);
    summary.appendChild(tile);
  });

  return summary;
}

export function updateStatusIndicator(apiRecording, feRecording) {
  const dot = document.getElementById("statusDot");
  const txt = document.getElementById("statusText");
  dot.closest(".status-pill")?.classList.toggle("is-recording", apiRecording || feRecording);
  if (apiRecording || feRecording) {
    dot.classList.add("recording");
    txt.textContent =
      apiRecording && feRecording
        ? "API + FE Recording…"
        : apiRecording
          ? "API Recording…"
          : "FE Recording…";
  } else {
    dot.classList.remove("recording");
    txt.textContent = "Idle";
  }
}

export async function exportAndDownload(filename, actionGet) {
  const response = await chrome.runtime
    .sendMessage({ action: actionGet })
    .catch(() => null);
  const flow = response?.flow || [];
  if (!flow.length) return false;

  const blob = new Blob([JSON.stringify(flow, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return true;
}

export function setButtonState(btn, recording, startLabel, stopLabel) {
  const label = btn.querySelector(".tile-title") || btn;
  label.textContent = recording ? stopLabel : startLabel;
  btn.classList.toggle("btn-stop", recording);
  btn.classList.toggle("btn-start", !recording);
}

// ── Filtering ───────────────────────────────────────────────────────────────
export const isFeEntry = (e) => e.type === "FE_STEP" || e.type === "INITIAL_SCREEN";

function lowerJson(value) {
  if (value == null) return "";
  return (typeof value === "string" ? value : JSON.stringify(value)).toLowerCase();
}

export function getFilteredFlow(searchInput, methodFilter, statusFilter, flow, searchScope = {}) {
  const urlQuery = searchInput.value.trim().toLowerCase();
  const method = methodFilter.value;
  const status = statusFilter.value;
  const {
    feUrl: scopeFeUrl = true,
    apiUrl: scopeApiUrl = true,
    payload: scopePayload = true,
    response: scopeResponse = true,
  } = searchScope;

  return flow.filter((entry) => {
    const apiUrl = (entry.request?.url || "").toLowerCase();
    const feUrl = (entry.page?.url || entry.route || "").toLowerCase();

    if (isFeEntry(entry)) {
      if (method || status) return false;
      if (urlQuery && !(scopeFeUrl && feUrl.includes(urlQuery))) return false;
      return true;
    }

    if (entry.type === "CONSOLE") {
      if (method || status) return false;
      if (
        urlQuery &&
        !(scopeFeUrl && feUrl.includes(urlQuery)) &&
        !(scopeResponse && lowerJson(entry.message).includes(urlQuery))
      )
        return false;
      return true;
    }

    const postData = (entry.request?.postData || "").toLowerCase();
    const responseBody =
      lowerJson(entry.responseBody) +
      lowerJson(entry.frames) +
      lowerJson(entry.sseEvents);

    if (
      urlQuery &&
      !(scopeApiUrl && apiUrl.includes(urlQuery)) &&
      !(scopeFeUrl && feUrl.includes(urlQuery)) &&
      !(scopePayload && postData.includes(urlQuery)) &&
      !(scopeResponse && responseBody.includes(urlQuery))
    )
      return false;
    if (method && entry.request?.method !== method) return false;
    if (status && String(entry.response?.status) !== status) return false;
    return true;
  });
}

// ── Combining & linking flows ───────────────────────────────────────────────
export function entryTime(entry) {
  if (Number.isFinite(entry?.startTime)) return entry.startTime;
  if (Number.isFinite(entry?.timestamp)) return entry.timestamp;
  const parsed = Date.parse(entry?.readableTime);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Merges API and FE flows into one timeline with fresh step numbers.
export function combineFlows(apiFlow = [], feFlow = []) {
  if (!apiFlow.length) return feFlow;
  if (!feFlow.length) return apiFlow;
  return [...feFlow, ...apiFlow]
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => entryTime(a.entry) - entryTime(b.entry) || a.i - b.i)
    .map(({ entry }, i) => ({ ...entry, step: i + 1 }));
}

const TRIGGER_EVENTS = new Set([
  "INITIAL_SCREEN", "PAGE_LOAD", "CLICK", "DOUBLE_CLICK", "KEYDOWN",
  "CHANGE", "INPUT_FINAL", "SECTION_CHANGE", "ROUTE_CHANGE",
]);
export const TRIGGER_WINDOW_MS = 3000;

// Associates each request / console message with the FE step that most likely
// caused it: the latest qualifying step at most TRIGGER_WINDOW_MS before it.
export function linkTriggers(flow) {
  const triggersOf = new Map();
  const triggeredBy = new Map();
  const steps = flow
    .filter((e) => isFeEntry(e) && TRIGGER_EVENTS.has(e.type === "INITIAL_SCREEN" ? e.type : e.event))
    .map((e) => ({ e, t: entryTime(e) }))
    .sort((a, b) => a.t - b.t);
  if (!steps.length) return { triggersOf, triggeredBy };

  for (const entry of flow) {
    if (isFeEntry(entry)) continue;
    const t = entryTime(entry);
    let lo = 0;
    let hi = steps.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (steps[mid].t <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0 || t - steps[found].t > TRIGGER_WINDOW_MS) continue;
    const step = steps[found].e;
    triggeredBy.set(entry, step);
    if (!triggersOf.has(step)) triggersOf.set(step, []);
    triggersOf.get(step).push(entry);
  }
  return { triggersOf, triggeredBy };
}

export function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search.length > 40 ? u.search.slice(0, 40) + "…" : u.search);
  } catch {
    return String(url || "");
  }
}

export function loadFile(fileInput, onLoad) {
  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const flow = Array.isArray(data) ? data : data?.flow;
        if (!Array.isArray(flow)) throw new Error("Expected a JSON array of entries");
        onLoad(flow.filter((entry) => entry && typeof entry === "object"));
      } catch (err) {
        alert("Invalid flow file: " + err.message);
        console.error(err);
      }
    };
    reader.readAsText(file);
    fileInput.value = ""; // allow re-uploading the same file
  });
}

export const DEFAULT_SETTINGS = {
  includeReqHeaders: false,
  includeResHeaders: false,
  captureApiScreenshots: false,
  maskSecrets: true,
  customMaskKeys: "",
  hostAllowList: "",
  captureConsole: true,
  captureWebSockets: true,
  keepHistory: true,
  historyLimit: 20,
};

export function timestampSlug(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
}

export function saveSettings(settings) {
  chrome.storage.local.set(settings);
}
