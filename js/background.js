// ==========================================================
// FLOW RECORDER - BACKGROUND SERVICE WORKER
//   1) API FLOW: network, console, WebSocket and SSE capture via chrome.debugger
//   2) FE FLOW:  user interactions reported by content.js
//
// Recorded data lives in memory and (when "Keep history" is on) in the
// extension's IndexedDB on this device. Nothing is sent anywhere.
// ==========================================================

import * as history from "./history.js";
import {
  DEFAULT_SETTINGS,
  combineFlows,
  matchesHostList,
  parseKeyList,
  redactBody,
  redactHeaders,
  redactUrl,
  shouldIgnoreRequest,
} from "./utils.js";

// ---------------- Limits ----------------
const MAX_ENTRIES = 5000; // per flow
const MAX_BODY_CHARS = 1_000_000; // ~1 MB of text per body
const MAX_STREAM_ITEMS = 1000; // WebSocket frames / SSE events per entry
const MAX_STREAM_ITEM_CHARS = 10_000;
const MAX_CONSOLE_CHARS = 2000;
const MIN_SCREENSHOT_GAP_MS = 600; // captureVisibleTab allows ~2 calls/sec
const KEEPALIVE_MS = 20_000; // MV3 workers idle out after ~30s

// ---------------- State ----------------
let session = null; // { id, startedAt, tabUrl, tabTitle, videoStartedAt }
let lastSessionId = null; // most recent session, reloaded after a worker restart
let pendingVideoStart = null;
let apiTabId = null;
let feTabId = null;
let isApiRecording = false;
let isFeRecording = false;

let apiFlow = [];
let feFlow = [];
const requestMap = new Map(); // requestId -> { entry, monoStart, requestTime, receiveHeadersEnd }
const socketMap = new Map(); // requestId -> WEBSOCKET entry
const pushed = new WeakSet(); // entries already in a flow
const entryKeys = new WeakMap(); // entry -> IndexedDB key
let lastDocumentUrl = null;

let lastScreenshotAt = 0;
let keepaliveTimer = null;

// ---------------- Settings ----------------
const settings = { ...DEFAULT_SETTINGS };
let extraMaskKeys = [];
let hostList = [];

function applySettings(data) {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (data?.[key] !== undefined) settings[key] = data[key];
  }
  extraMaskKeys = parseKeyList(settings.customMaskKeys);
  hostList = parseKeyList(settings.hostAllowList);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const data = {};
  for (const [key, change] of Object.entries(changes)) data[key] = change.newValue;
  applySettings(data);
  if (changes.customMaskKeys && isFeRecording) notifyContentScript(feTabId, true);
});

const mask = {
  headers: (h) => (settings.maskSecrets ? redactHeaders(h, extraMaskKeys) : h || null),
  body: (b) => (settings.maskSecrets && b ? redactBody(b, extraMaskKeys) : b),
  url: (u) => (settings.maskSecrets ? redactUrl(u, extraMaskKeys) : u),
};

// ==========================================================
// STARTUP / RECOVERY
// If Chrome restarted this worker mid-recording, reload the session from
// IndexedDB and keep recording when the debugger is still attached.
// ==========================================================

const ready = (async () => {
  applySettings(await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS)));
  const { recordingState } = await chrome.storage.session.get("recordingState");
  lastSessionId = recordingState?.lastSessionId ?? null;
  const restoreId = recordingState?.session?.id ?? lastSessionId;
  if (restoreId && settings.keepHistory) {
    try {
      const { api, fe } = await history.loadSessionFlows(restoreId);
      apiFlow = api.map((r) => restoreRecord(r));
      feFlow = fe.map((r) => restoreRecord(r));
    } catch (err) {
      console.warn("Could not restore session:", err);
    }
  }
  if (!recordingState?.session) return refreshIndicators();

  session = recordingState.session;

  if (recordingState.apiTabId) {
    const tabId = recordingState.apiTabId;
    let attached = false;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
      attached = true;
    } catch {
      // not attached any more
    }
    if (attached && settings.keepHistory) {
      apiTabId = tabId;
      isApiRecording = true;
      await enableDebuggerDomains(tabId);
    } else if (attached) {
      chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }

  if (recordingState.feTabId && settings.keepHistory) {
    const tab = await chrome.tabs.get(recordingState.feTabId).catch(() => null);
    if (tab) {
      feTabId = tab.id;
      isFeRecording = true;
      notifyContentScript(tab.id, true);
    }
  }

  if (!isApiRecording && !isFeRecording) endSession();
  persistState();
})();

function restoreRecord(record) {
  const entry = record.entry;
  pushed.add(entry);
  entryKeys.set(entry, record.key);
  return entry;
}

function persistState() {
  chrome.storage.session
    .set({
      recordingState: {
        session,
        lastSessionId: session?.id ?? lastSessionId,
        apiTabId: isApiRecording ? apiTabId : null,
        feTabId: isFeRecording ? feTabId : null,
      },
    })
    .catch(() => {});
  refreshIndicators();
}

function refreshIndicators() {
  const text =
    isApiRecording && isFeRecording
      ? "REC"
      : isApiRecording
        ? "API"
        : isFeRecording
          ? "FE"
          : "";
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: "#d93025" }).catch(() => {});

  const active = isApiRecording || isFeRecording;
  if (active && !keepaliveTimer) {
    keepaliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(), KEEPALIVE_MS);
  } else if (!active && keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function flashBadgeError(message) {
  chrome.action.setBadgeText({ text: "!" }).catch(() => {});
  chrome.action.setTitle({ title: `Flow Recorder: ${message}` }).catch(() => {});
  setTimeout(() => {
    chrome.action.setTitle({ title: "Flow Recorder" }).catch(() => {});
    refreshIndicators();
  }, 4000);
}

// ==========================================================
// SESSIONS & PERSISTENCE
// ==========================================================

// A session starts when a recording starts while nothing else is recording.
async function ensureSession(tab) {
  if (isApiRecording || isFeRecording) return;
  session = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    endedAt: null,
    tabUrl: mask.url(tab.url || ""),
    tabTitle: (tab.title || "").slice(0, 200),
    apiCount: 0,
    feCount: 0,
    videoStartedAt:
      pendingVideoStart && Date.now() - pendingVideoStart < 60_000
        ? pendingVideoStart
        : null,
  };
  apiFlow = [];
  feFlow = [];
  requestMap.clear();
  socketMap.clear();
  if (settings.keepHistory) {
    await history.saveSession(session).catch(() => {});
    history.prune(Number(settings.historyLimit) || 20, session.id).catch(() => {});
  }
}

function endSession() {
  if (session) lastSessionId = session.id;
  if (session && settings.keepHistory) {
    history
      .updateSession(session.id, {
        endedAt: Date.now(),
        apiCount: apiFlow.length,
        feCount: feFlow.length,
      })
      .catch(() => {});
  }
  session = null;
}

function maybeEndSession() {
  if (!isApiRecording && !isFeRecording) endSession();
  persistState();
}

let countsTimer = null;
function persistEntry(kind, entry) {
  if (!settings.keepHistory || !session) return;
  let key = entryKeys.get(entry);
  if (!key) {
    key = `${session.id}:${kind}:${String(entry.step).padStart(6, "0")}`;
    entryKeys.set(entry, key);
  }
  history.putEntry({ key, sessionId: session.id, kind, entry }).catch(() => {});
  clearTimeout(countsTimer);
  const id = session.id;
  countsTimer = setTimeout(() => {
    history
      .updateSession(id, { apiCount: apiFlow.length, feCount: feFlow.length })
      .catch(() => {});
  }, 1000);
}

// Streams (WebSocket frames, SSE events) mutate an entry many times; batch.
const dirty = new Map();
function persistLater(kind, entry) {
  if (dirty.has(entry)) return;
  dirty.set(
    entry,
    setTimeout(() => {
      dirty.delete(entry);
      persistEntry(kind, entry);
    }, 1000),
  );
}

function pushEntry(kind, entry) {
  const flow = kind === "api" ? apiFlow : feFlow;
  if (pushed.has(entry) || flow.length >= MAX_ENTRIES) return false;
  entry.step = flow.length + 1;
  if (session?.videoStartedAt) {
    entry.videoOffsetMs = (entry.startTime ?? entry.timestamp) - session.videoStartedAt;
  }
  flow.push(entry);
  pushed.add(entry);
  persistEntry(kind, entry);
  return true;
}

// ==========================================================
// MESSAGE ROUTING
// ==========================================================

const EXTENSION_ORIGIN = chrome.runtime.getURL("");

// Actions only extension pages (popup, viewer, options, recorder) may call.
const controlHandlers = {
  GET_RECORDING_STATE: () => ({
    apiRecording: isApiRecording,
    feRecording: isFeRecording,
    apiCount: apiFlow.length,
    feCount: feFlow.length,
    sessionId: session?.id ?? null,
  }),
  START_API: (msg) => startApiRecording(msg.tabId),
  STOP_API: () => stopApiRecording(),
  START_FE: (msg) => startFeRecording(msg.tabId),
  STOP_FE: () => stopFeRecording(),
  GET_API_FLOW: () => ({ flow: apiFlow }),
  GET_FE_FLOW: () => ({ flow: feFlow }),
  GET_COMBINED_FLOW: () => ({ flow: combineFlows(apiFlow, feFlow) }),
  CLEAR_DATA: () => clearData(),
  GET_SESSIONS: async () => ({
    sessions: settings.keepHistory ? await history.listSessions() : [],
    currentId: session?.id ?? null,
  }),
  GET_SESSION_FLOW: async (msg) => {
    const { api, fe } = await history.loadSessionFlows(String(msg.id));
    return {
      flow: combineFlows(
        api.map((r) => r.entry),
        fe.map((r) => r.entry),
      ),
      session: await history.getSession(String(msg.id)),
    };
  },
  DELETE_SESSION: async (msg) => {
    if (msg.id === session?.id) throw new Error("Stop the recording before deleting it.");
    await history.deleteSession(String(msg.id));
    return { ok: true };
  },
  CLEAR_HISTORY: async () => {
    const sessions = await history.listSessions();
    for (const s of sessions) if (s.id !== session?.id) await history.deleteSession(s.id);
    return { ok: true };
  },
  VIDEO_STARTED: (msg) => {
    const at = Number(msg.at) || Date.now();
    pendingVideoStart = at;
    if (session && !session.videoStartedAt) {
      session.videoStartedAt = at;
      for (const e of [...apiFlow, ...feFlow]) {
        e.videoOffsetMs = (e.startTime ?? e.timestamp) - at;
      }
      if (settings.keepHistory) history.updateSession(session.id, { videoStartedAt: at }).catch(() => {});
      persistState();
    }
    return { ok: true };
  },
  VIDEO_STOPPED: () => {
    pendingVideoStart = null;
    return { ok: true };
  },
};

// Actions the content script may call.
const contentHandlers = {
  FE_STATUS: (_msg, sender) => ({
    recording: isFeRecording && sender.tab?.id === feTabId && sender.frameId === 0,
    maskKeys: extraMaskKeys,
  }),
  FE_EVENT: (msg, sender) => recordFeEvent(msg, sender),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message?.action) return false;

  const fromExtensionPage = sender.url?.startsWith(EXTENSION_ORIGIN);
  const handler = fromExtensionPage
    ? controlHandlers[message.action]
    : contentHandlers[message.action];
  if (!handler) return false;

  ready
    .then(() => handler(message, sender))
    .then(
      (res) => sendResponse(res ?? { ok: true }),
      (err) => sendResponse({ ok: false, error: String(err?.message || err) }),
    );
  return true; // keep the channel open for the async response
});

async function clearData() {
  lastSessionId = null;
  apiFlow = [];
  feFlow = [];
  requestMap.clear();
  socketMap.clear();
  await history.clearAll().catch(() => {});
  if (session) {
    // keep recording, but into a fresh (empty) session record
    session = { ...session, apiCount: 0, feCount: 0 };
    if (settings.keepHistory) await history.saveSession(session).catch(() => {});
  }
  persistState();
  return { ok: true };
}

async function resolveTab(tabId) {
  if (tabId) {
    const tab = await chrome.tabs.get(Number(tabId)).catch(() => null);
    if (!tab) throw new Error("The selected tab no longer exists.");
    return tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  return tab;
}

// ==========================================================
// KEYBOARD SHORTCUTS (manifest "commands")
// ==========================================================

chrome.commands.onCommand.addListener(async (command, tab) => {
  await ready;
  try {
    if (command === "toggle-api") {
      if (isApiRecording) await stopApiRecording();
      else await startApiRecording(tab?.id);
    } else if (command === "toggle-fe") {
      if (isFeRecording) await stopFeRecording();
      else await startFeRecording(tab?.id);
    } else if (command === "open-viewer") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("html/viewer.html?source=live") });
    }
  } catch (err) {
    flashBadgeError(err?.message || String(err));
  }
});

// ==========================================================
// API FLOW RECORDING
// ==========================================================

async function enableDebuggerDomains(tabId) {
  const target = { tabId };
  if (settings.captureConsole) {
    await chrome.debugger.sendCommand(target, "Runtime.enable").catch(() => {});
    await chrome.debugger.sendCommand(target, "Log.enable").catch(() => {});
  }
}

async function startApiRecording(tabId) {
  if (isApiRecording) return { ok: true };

  const tab = await resolveTab(tabId);
  try {
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");
  } catch (err) {
    throw new Error(
      `Cannot record this tab (${err?.message || err}). Browser pages and the Chrome Web Store cannot be recorded.`,
    );
  }

  try {
    await chrome.debugger.sendCommand({ tabId: tab.id }, "Network.enable", {
      maxPostDataSize: 65536,
    });
  } catch (err) {
    chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    throw new Error(`Network.enable failed: ${err?.message || err}`);
  }

  await ensureSession(tab);
  apiTabId = tab.id;
  lastDocumentUrl = tab.url || null;
  requestMap.clear();
  socketMap.clear();
  isApiRecording = true;
  await enableDebuggerDomains(tab.id);
  persistState();
  return { ok: true };
}

async function stopApiRecording() {
  if (!isApiRecording) return { ok: true };
  const tabId = apiTabId;
  isApiRecording = false;
  flushPendingStreams();
  maybeEndSession();
  await chrome.debugger.detach({ tabId }).catch(() => {});
  return { ok: true };
}

// Persist open WebSockets / unfinished SSE streams as they are when stopping.
function flushPendingStreams() {
  for (const entry of socketMap.values()) persistEntry("api", entry);
  for (const { entry } of requestMap.values()) if (pushed.has(entry)) persistEntry("api", entry);
  requestMap.clear();
  socketMap.clear();
}

// User clicked "Cancel" on the debugging banner, or the tab crashed/closed.
chrome.debugger.onDetach.addListener(async (source) => {
  await ready;
  if (source.tabId === apiTabId && isApiRecording) {
    isApiRecording = false;
    flushPendingStreams();
    maybeEndSession();
  }
});

function limitBody(body, base64Encoded, mimeType) {
  if (typeof body !== "string") return { body: null };
  if (base64Encoded && !/json|text|xml|javascript/i.test(mimeType || "")) {
    return body.length > MAX_BODY_CHARS
      ? { body: `[binary ${mimeType || "data"} omitted]`, truncated: true }
      : { body, base64: true };
  }
  if (body.length > MAX_BODY_CHARS) {
    return { body: body.slice(0, MAX_BODY_CHARS), truncated: true };
  }
  return { body, base64: !!base64Encoded };
}

const round = (n) => Math.round(n * 10) / 10;

// Converts CDP ResourceTiming (ms offsets from requestTime) into HAR-style phases.
function computeTiming(t, monoStart) {
  if (!t || !Number.isFinite(t.requestTime)) return null;
  const span = (a, b) => (t[a] >= 0 && t[b] >= 0 ? round(t[b] - t[a]) : -1);
  const firstStart = [t.dnsStart, t.connectStart, t.sendStart].find((v) => v >= 0) ?? 0;
  return {
    blocked: round(Math.max(0, (t.requestTime - monoStart) * 1000 + firstStart)),
    dns: span("dnsStart", "dnsEnd"),
    connect: span("connectStart", "connectEnd"),
    ssl: span("sslStart", "sslEnd"),
    send: Math.max(0, span("sendStart", "sendEnd")),
    wait: Math.max(0, span("sendEnd", "receiveHeadersEnd")),
    receive: 0,
  };
}

function finishRequest(rec, monoEnd) {
  const { entry } = rec;
  entry.durationMs = Number.isFinite(monoEnd)
    ? Math.max(0, Math.round((monoEnd - rec.monoStart) * 1000))
    : Date.now() - entry.startTime;
  if (entry.timing && Number.isFinite(rec.requestTime) && Number.isFinite(monoEnd)) {
    entry.timing.receive = round(
      Math.max(0, (monoEnd - (rec.requestTime + rec.receiveHeadersEnd / 1000)) * 1000),
    );
  }
  entry.readableTime = new Date().toISOString();
}

function newApiEntry(req, params) {
  return {
    type: "API",
    request: {
      url: mask.url(req.url),
      method: req.method,
      postData: req.postData ?? null,
      headers: settings.includeReqHeaders ? mask.headers(req.headers) : null,
    },
    resourceType: params.type || null,
    startTime: Date.now(),
    timestamp: Date.now(),
    page: { url: params.documentURL ? mask.url(params.documentURL) : null },
  };
}

function shouldRecordUrl(url, type) {
  return !shouldIgnoreRequest(url, type) && matchesHostList(url, hostList);
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  await ready;
  if (!isApiRecording || source.tabId !== apiTabId) return;
  const target = { tabId: source.tabId };

  switch (method) {
    // ---------------- HTTP ----------------
    case "Network.requestWillBeSent": {
      const req = params?.request;
      if (!req) return;
      if (params.type === "Document") lastDocumentUrl = req.url;

      // Redirect: the previous hop shares the requestId. Record it.
      const prev = requestMap.get(params.requestId);
      if (prev && params.redirectResponse) {
        prev.entry.response = {
          status: params.redirectResponse.status,
          headers: settings.includeResHeaders ? mask.headers(params.redirectResponse.headers) : null,
          mimeType: params.redirectResponse.mimeType || null,
        };
        prev.entry.redirectedTo = mask.url(req.url);
        finishRequest(prev, params.timestamp);
        pushEntry("api", prev.entry);
        requestMap.delete(params.requestId);
      }

      if (!shouldRecordUrl(req.url, params.type)) return;
      const entry = newApiEntry(req, params);
      requestMap.set(params.requestId, { entry, monoStart: params.timestamp });

      // Large bodies are not inlined in the event; fetch them separately.
      if (req.hasPostData && req.postData == null) {
        const res = await chrome.debugger
          .sendCommand(target, "Network.getRequestPostData", { requestId: params.requestId })
          .catch(() => null);
        entry.request.postData = res?.postData ?? null;
      }
      entry.request.postData = mask.body(entry.request.postData);
      return;
    }

    case "Network.responseReceived": {
      const rec = requestMap.get(params.requestId);
      if (!rec) return;
      const r = params.response || {};
      rec.entry.response = {
        status: r.status,
        headers: settings.includeResHeaders ? mask.headers(r.headers) : null,
        mimeType: r.mimeType || null,
        protocol: r.protocol || null,
        remoteAddress: r.remoteIPAddress ? `${r.remoteIPAddress}:${r.remotePort ?? ""}` : null,
        fromCache: !!(r.fromDiskCache || r.fromServiceWorker || r.fromPrefetchCache),
      };
      rec.entry.timing = computeTiming(r.timing, rec.monoStart);
      rec.requestTime = r.timing?.requestTime;
      rec.receiveHeadersEnd = r.timing?.receiveHeadersEnd ?? 0;
      return;
    }

    case "Network.loadingFailed": {
      const rec = requestMap.get(params.requestId);
      if (!rec) return;
      requestMap.delete(params.requestId);
      rec.entry.error = params.canceled ? "Canceled" : params.errorText || "Request failed";
      finishRequest(rec, params.timestamp);
      if (pushed.has(rec.entry)) persistEntry("api", rec.entry);
      else pushEntry("api", rec.entry);
      return;
    }

    case "Network.loadingFinished": {
      const rec = requestMap.get(params.requestId);
      if (!rec) return;
      requestMap.delete(params.requestId);
      const { entry } = rec;
      finishRequest(rec, params.timestamp);
      entry.transferSize = params.encodedDataLength ?? null;

      const res = await chrome.debugger
        .sendCommand(target, "Network.getResponseBody", { requestId: params.requestId })
        .catch(() => null); // not available for redirects, evicted bodies, etc.
      if (res) {
        const limited = limitBody(res.body, res.base64Encoded, entry.response?.mimeType);
        entry.responseBody = limited.base64 ? limited.body : mask.body(limited.body);
        entry.responseBodyBase64 = !!limited.base64;
        if (limited.truncated) entry.responseBodyTruncated = true;
        entry.responseSize = typeof res.body === "string" ? res.body.length : null;
      }

      if (settings.captureApiScreenshots && !entry.screenshot) {
        entry.screenshot = await captureTabScreenshot(source.tabId);
      }
      if (pushed.has(entry)) persistEntry("api", entry);
      else if (isApiRecording) pushEntry("api", entry);
      return;
    }

    // ---------------- Server-Sent Events ----------------
    case "Network.eventSourceMessageReceived": {
      const rec = requestMap.get(params.requestId);
      if (!rec) return;
      const entry = rec.entry;
      entry.stream = "sse";
      entry.sseEvents ??= [];
      if (entry.sseEvents.length < MAX_STREAM_ITEMS) {
        entry.sseEvents.push({
          time: new Date().toISOString(),
          event: params.eventName || "message",
          id: params.eventId || "",
          data: mask.body(String(params.data ?? "").slice(0, MAX_STREAM_ITEM_CHARS)),
        });
      } else {
        entry.sseEventsDropped = (entry.sseEventsDropped || 0) + 1;
      }
      if (!pushed.has(entry)) {
        entry.readableTime = new Date().toISOString();
        pushEntry("api", entry);
      } else {
        persistLater("api", entry);
      }
      return;
    }

    // ---------------- WebSockets ----------------
    case "Network.webSocketCreated": {
      if (!settings.captureWebSockets || !matchesHostList(params.url, hostList)) return;
      const entry = {
        type: "WEBSOCKET",
        request: { url: mask.url(params.url), method: "WS", postData: null, headers: null },
        response: { status: null, headers: null, mimeType: null },
        frames: [],
        startTime: Date.now(),
        timestamp: Date.now(),
        readableTime: new Date().toISOString(),
        page: { url: lastDocumentUrl ? mask.url(lastDocumentUrl) : null },
      };
      socketMap.set(params.requestId, entry);
      pushEntry("api", entry);
      return;
    }

    case "Network.webSocketHandshakeResponseReceived": {
      const entry = socketMap.get(params.requestId);
      if (!entry) return;
      entry.response.status = params.response?.status ?? null;
      if (settings.includeResHeaders) entry.response.headers = mask.headers(params.response?.headers);
      persistLater("api", entry);
      return;
    }

    case "Network.webSocketFrameSent":
    case "Network.webSocketFrameReceived":
    case "Network.webSocketFrameError": {
      const entry = socketMap.get(params.requestId);
      if (!entry) return;
      if (entry.frames.length >= MAX_STREAM_ITEMS) {
        entry.framesDropped = (entry.framesDropped || 0) + 1;
        return;
      }
      const dir =
        method === "Network.webSocketFrameSent"
          ? "sent"
          : method === "Network.webSocketFrameReceived"
            ? "received"
            : "error";
      const opcode = params.response?.opcode;
      let data;
      if (dir === "error") data = String(params.errorMessage || "error");
      else if (opcode === 1) data = mask.body(String(params.response?.payloadData ?? "").slice(0, MAX_STREAM_ITEM_CHARS));
      else data = `[binary frame, opcode ${opcode}]`;
      entry.frames.push({ dir, time: new Date().toISOString(), opcode: opcode ?? null, data });
      persistLater("api", entry);
      return;
    }

    case "Network.webSocketClosed": {
      const entry = socketMap.get(params.requestId);
      if (!entry) return;
      socketMap.delete(params.requestId);
      entry.closedAt = new Date().toISOString();
      entry.durationMs = Date.now() - entry.startTime;
      persistEntry("api", entry);
      return;
    }

    // ---------------- Console & exceptions ----------------
    case "Runtime.exceptionThrown": {
      if (!settings.captureConsole) return;
      const d = params.exceptionDetails || {};
      recordConsole({
        level: "error",
        source: "exception",
        message: d.exception?.description || d.text || "Uncaught exception",
        url: d.url,
        line: d.lineNumber,
        column: d.columnNumber,
        stackTrace: d.stackTrace,
      });
      return;
    }

    case "Runtime.consoleAPICalled": {
      if (!settings.captureConsole) return;
      const level = { error: "error", assert: "error", warning: "warning" }[params.type];
      if (!level) return;
      const frame = params.stackTrace?.callFrames?.[0];
      recordConsole({
        level,
        source: `console.${params.type === "warning" ? "warn" : params.type}`,
        message: (params.args || []).map(remoteObjectToText).join(" "),
        url: frame?.url,
        line: frame?.lineNumber,
        column: frame?.columnNumber,
        stackTrace: params.stackTrace,
      });
      return;
    }

    case "Log.entryAdded": {
      if (!settings.captureConsole) return;
      const e = params.entry || {};
      // "network" duplicates failed requests already in the flow; console-api
      // duplicates Runtime.consoleAPICalled.
      if (!["error", "warning"].includes(e.level) || ["network", "console-api"].includes(e.source)) return;
      recordConsole({
        level: e.level,
        source: e.source || "browser",
        message: e.text || "",
        url: e.url,
        line: e.lineNumber,
        stackTrace: e.stackTrace,
      });
      return;
    }
  }
});

function remoteObjectToText(arg) {
  if (!arg) return "";
  if (arg.type === "string") return arg.value;
  if ("value" in arg) {
    try {
      return typeof arg.value === "object" ? JSON.stringify(arg.value) : String(arg.value);
    } catch {
      return String(arg.value);
    }
  }
  return arg.unserializableValue || arg.description || `[${arg.type}]`;
}

function recordConsole({ level, source, message, url, line, column, stackTrace }) {
  const frames = (stackTrace?.callFrames || []).slice(0, 10);
  pushEntry("api", {
    type: "CONSOLE",
    level,
    source,
    message: String(message).slice(0, MAX_CONSOLE_CHARS),
    location: url ? `${mask.url(url)}:${(line ?? 0) + 1}:${(column ?? 0) + 1}` : null,
    stack: frames.length
      ? frames
          .map((f) => `at ${f.functionName || "(anonymous)"} (${mask.url(f.url)}:${f.lineNumber + 1}:${f.columnNumber + 1})`)
          .join("\n")
      : null,
    timestamp: Date.now(),
    readableTime: new Date().toISOString(),
    page: { url: lastDocumentUrl ? mask.url(lastDocumentUrl) : null },
  });
}

// ==========================================================
// FE FLOW RECORDING
// ==========================================================

async function notifyContentScript(tabId, recording) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "FE_SET_RECORDING",
      recording,
      maskKeys: extraMaskKeys,
    });
    return true;
  } catch {
    return false; // content script not present (page opened before install, or restricted page)
  }
}

async function startFeRecording(tabId) {
  if (isFeRecording) return { ok: true };

  const tab = await resolveTab(tabId);
  await ensureSession(tab);
  feTabId = tab.id;
  feFlow = [];
  isFeRecording = true;
  persistState();

  pushEntry("fe", {
    type: "INITIAL_SCREEN",
    route: mask.url(tab.url || ""),
    timestamp: Date.now(),
    readableTime: new Date().toISOString(),
    screenshot: await captureTabScreenshot(tab.id, { wait: true }),
  });

  const reached = await notifyContentScript(tab.id, true);
  return reached
    ? { ok: true }
    : {
        ok: true,
        warning:
          "Interaction tracking is not active on this page. Reload the page to start capturing clicks.",
      };
}

async function stopFeRecording() {
  if (!isFeRecording) return { ok: true };
  const tabId = feTabId;
  isFeRecording = false;
  maybeEndSession();
  await notifyContentScript(tabId, false);
  return { ok: true };
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);

function sanitizeTarget(t) {
  if (!t || typeof t !== "object") return null;
  const out = {
    selector: str(t.selector, 500),
    testId: str(t.testId, 200),
    testIdAttr: str(t.testIdAttr, 40),
    id: str(t.id, 200),
    name: str(t.name, 200),
    role: str(t.role, 40),
    ariaLabel: str(t.ariaLabel, 200),
    label: str(t.label, 200),
    placeholder: str(t.placeholder, 200),
    inputType: str(t.inputType, 40),
    tag: str(t.tag, 40),
  };
  if (typeof t.checked === "boolean") out.checked = t.checked;
  for (const k of Object.keys(out)) if (out[k] === "") delete out[k];
  return Object.keys(out).length ? out : null;
}

function sanitizePoint(p) {
  if (!p || typeof p !== "object") return null;
  const point = { x: num(p.x), y: num(p.y), vw: num(p.vw), vh: num(p.vh) };
  return Object.values(point).every((v) => v !== null && v >= 0) ? point : null;
}

// FE events are processed one at a time so steps keep their real order while
// each waits for its screenshot slot.
// When events pile up (fast typing/clicking), later ones skip the screenshot
// instead of waiting, so the flow keeps up with the page.
let feQueue = Promise.resolve();
let feBacklog = 0;
const MAX_SCREENSHOT_BACKLOG = 3;

function recordFeEvent(message, sender) {
  const waitForShot = feBacklog < MAX_SCREENSHOT_BACKLOG;
  feBacklog++;
  const run = feQueue
    .then(() => recordFeEventNow(message, sender, waitForShot))
    .finally(() => feBacklog--);
  feQueue = run.catch(() => null);
  return run;
}

async function recordFeEventNow(message, sender, waitForShot = true) {
  if (!isFeRecording) return { ok: false };
  // Only accept events from the top frame of the tab being recorded.
  if (sender.tab?.id !== feTabId || sender.frameId !== 0) return { ok: false };
  if (feFlow.length >= MAX_ENTRIES) return { ok: false };

  const entry = {
    type: "FE_STEP",
    event: str(message.event, 40),
    element: str(message.element, 40),
    text: str(message.text, 200),
    route: mask.url(str(message.route, 2048)),
    target: sanitizeTarget(message.target),
    point: sanitizePoint(message.point),
    timestamp: Date.now(),
    readableTime: new Date().toISOString(),
  };
  if (!entry.target) delete entry.target;
  if (!entry.point) delete entry.point;
  entry.screenshot = await captureTabScreenshot(sender.tab.id, { wait: waitForShot });
  if (!isFeRecording) return { ok: false };

  pushEntry("fe", entry);
  return { ok: true };
}

// ==========================================================
// SCREENSHOT CAPTURE
// Captures only the recorded tab, and only while it is the visible tab in its
// window, so screenshots never include another site the user switched to.
// Chrome allows ~2 captures/sec, so captures are serialised. With wait=true the
// call queues for the next free slot (FE steps); otherwise it is skipped when
// a capture happened too recently (API requests, which can arrive in bursts).
// ==========================================================

let captureChain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function captureTabScreenshot(tabId, { wait = false } = {}) {
  if (!wait && Date.now() - lastScreenshotAt < MIN_SCREENSHOT_GAP_MS) {
    return Promise.resolve(null);
  }
  const run = captureChain.then(async () => {
    const gap = MIN_SCREENSHOT_GAP_MS - (Date.now() - lastScreenshotAt);
    if (gap > 0) {
      if (!wait) return null;
      await sleep(gap);
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.active) return null;
    lastScreenshotAt = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch (err) {
      console.warn("Screenshot error:", err?.message || err);
      return null;
    }
  });
  captureChain = run.catch(() => null);
  return run;
}

// ==========================================================
// CLEANUP WHEN TAB CLOSES
// ==========================================================

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  let changed = false;
  if (tabId === apiTabId && isApiRecording) {
    isApiRecording = false;
    flushPendingStreams();
    changed = true;
  }
  if (tabId === feTabId && isFeRecording) {
    isFeRecording = false;
    changed = true;
  }
  if (changed) maybeEndSession();
});
