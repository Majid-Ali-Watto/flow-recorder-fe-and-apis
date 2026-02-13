// ==========================================================
// FLOW VIEWER - BACKGROUND SERVICE WORKER
// Dual Mode:
//   1) API FLOW (original network debugger)
//   2) FE FLOW (visual frontend recorder)
// ==========================================================

import { shouldIgnoreRequest } from "./utils.js";

let attachedTabId = null;

// Keepalive window id to prevent service worker shutdown
export let keepaliveWindowId = null;

// Separate recording flags
export let isApiRecording = false;
export let isFeRecording = false;

// Cached settings from popup toggles
let includeReqHeaders = false;
let includeResHeaders = false;
let captureApiScreenshots = false;

// initialize cached settings
chrome.storage?.local?.get(
  ["includeReqHeaders", "includeResHeaders", "captureApiScreenshots"],
  (data) => {
    if (data) {
      includeReqHeaders = data.includeReqHeaders ?? includeReqHeaders;
      includeResHeaders = data.includeResHeaders ?? includeResHeaders;
      captureApiScreenshots =
        data.captureApiScreenshots ?? captureApiScreenshots;
    }
  },
);

// keep them updated if popup changes settings
chrome.storage?.onChanged?.addListener?.((changes, area) => {
  if (area !== "local") return;
  if (changes.includeReqHeaders)
    includeReqHeaders = !!changes.includeReqHeaders.newValue;
  if (changes.includeResHeaders)
    includeResHeaders = !!changes.includeResHeaders.newValue;
  if (changes.captureApiScreenshots)
    captureApiScreenshots = !!changes.captureApiScreenshots.newValue;
});

// Separate flows
let apiFlow = [];
let feFlow = [];

// API request tracking
let requestMap = new Map();

// ==========================================================
// MESSAGE LISTENER
// ==========================================================

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "GET_RECORDING_STATE") {
    sendResponse({
      apiRecording: isApiRecording,
      feRecording: isFeRecording,
    });
  }

  // ---------------- API CONTROL ----------------
  if (message.action === "START_API") {
    await startApiRecording();
  }

  if (message.action === "STOP_API") {
    stopApiRecording();
  }

  if (message.action === "GET_API_FLOW") {
    sendResponse({ flow: apiFlow });
  }

  // ---------------- FE CONTROL ----------------

  if (message.action === "START_FE") {
    await startFeRecording();
    chrome.scripting.executeScript({
      target: { tabId: attachedTabId },
      func: () => startRouteTracking(),
    });
  }

  if (message.action === "STOP_FE") {
    stopFeRecording();
    chrome.scripting.executeScript({
      target: { tabId: attachedTabId },
      func: () => stopRouteTracking(),
    });
  }

  if (message.action === "GET_FE_FLOW") {
    sendResponse({ flow: feFlow });
  }

  // ---------------- FE EVENTS FROM CONTENT SCRIPT ----------------
  if (message.action === "FE_EVENT" && isFeRecording) {
    if (!sender.tab?.id) return;

    const screenshot = await captureVisibleScreenshot(sender.tab.id);

    feFlow.push({
      type: "FE_STEP",
      step: feFlow.length + 1,
      event: message.event,
      element: message.element || "",
      text: message.text || "",
      route: message.route || "",
      readableTime: new Date().toISOString(),
      screenshot,
    });
  }

  return true;
});

// ==========================================================
// API FLOW RECORDING
// ==========================================================

async function startApiRecording() {
  if (isApiRecording) return;

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab) return;

  attachedTabId = tab.id;
  apiFlow = [];
  requestMap.clear();

  chrome.debugger.attach({ tabId: tab.id }, "1.3", () => {
    if (chrome.runtime.lastError) {
      console.error("Debugger attach failed:", chrome.runtime.lastError);
      return;
    }

    chrome.debugger.sendCommand({ tabId: tab.id }, "Network.enable", {}, () => {
      if (chrome.runtime.lastError) {
        console.error("Network.enable failed");
        return;
      }

      isApiRecording = true;
      console.log("API recording started");
    });
  });
}

function stopApiRecording() {
  if (!attachedTabId || !isApiRecording) return;

  chrome.debugger.detach({ tabId: attachedTabId }, () => {
    if (chrome.runtime.lastError) {
      console.warn("Detach warning:", chrome.runtime.lastError);
    }
  });

  isApiRecording = false;
  console.log("API recording stopped");
}

// ==========================================================
// API DEBUGGER EVENTS
// ==========================================================

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (!isApiRecording) return;
  if (source.tabId !== attachedTabId) return;

  // Request started
  if (method === "Network.requestWillBeSent") {
    if (!params?.request) return;

    const resourceType = params.type;
    if (shouldIgnoreRequest(params.request.url, resourceType)) return;

    requestMap.set(params.requestId, {
      type: "API",
      step: apiFlow.length + 1,
      request: {
        url: params.request.url,
        method: params.request.method,
        postData: params.request.postData || null,
        headers: includeReqHeaders ? params.request.headers || null : null,
      },
      startTime: Date.now(),
      page: { url: params.documentURL || null },
    });
  }

  // Response finished
  // Response received (status + headers)
  if (method === "Network.responseReceived") {
    const entry = requestMap.get(params.requestId);
    if (!entry) return;

    entry.response = {
      status: params.response?.status,
      headers: includeResHeaders ? params.response?.headers || null : null,
      mimeType: params.response?.mimeType || null,
    };
  }

  if (method === "Network.loadingFinished") {
    const entry = requestMap.get(params.requestId);
    if (!entry) return;

    // get response body (if available)
    chrome.debugger.sendCommand(
      { tabId: source.tabId },
      "Network.getResponseBody",
      { requestId: params.requestId },
      (res) => {
        try {
          if (chrome.runtime.lastError) {
            console.warn("getResponseBody failed:", chrome.runtime.lastError);
          } else if (res) {
            entry.responseBody = res.body;
            entry.responseBodyBase64 = !!res.base64Encoded;
          }
        } catch (err) {
          console.warn("Error getting response body", err);
        }

        const finalize = () => {
          entry.durationMs = Date.now() - entry.startTime;
          entry.readableTime = new Date().toISOString();

          apiFlow.push(entry);
          requestMap.delete(params.requestId);
        };

        // Use cached flag to decide whether to capture a screenshot
        try {
          if (captureApiScreenshots) {
            captureVisibleScreenshot(source.tabId)
              .then((screenshot) => {
                entry.screenshot = screenshot;
                finalize();
              })
              .catch(() => finalize());
          } else {
            finalize();
          }
        } catch (err) {
          finalize();
        }
      },
    );
  }
});

// ==========================================================
// FE FLOW RECORDING
// ==========================================================

async function startFeRecording() {
  if (isFeRecording) return;

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab) return;

  attachedTabId = tab.id;
  feFlow = [];
  isFeRecording = true;

  // Capture initial screen
  const screenshot = await captureVisibleScreenshot(tab.id);

  feFlow.push({
    type: "INITIAL_SCREEN",
    step: 1,
    route: tab.url,
    readableTime: new Date().toISOString(),
    screenshot,
  });

  console.log("FE recording started");
}

function stopFeRecording() {
  if (!isFeRecording) return;

  isFeRecording = false;
  console.log("FE recording stopped");
}

// ==========================================================
// SCREENSHOT CAPTURE (SAFE & STABLE)
// ==========================================================

function captureVisibleScreenshot(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.warn("Screenshot error:", chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(dataUrl || null);
        }
      });
    } catch (err) {
      console.error("Screenshot exception:", err);
      resolve(null);
    }
  });
}

// ==========================================================
// CLEANUP WHEN TAB CLOSES
// ==========================================================

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === attachedTabId) {
    isApiRecording = false;
    isFeRecording = false;
    attachedTabId = null;
    requestMap.clear();
  }
});
