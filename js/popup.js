import {
  DEFAULT_SETTINGS,
  exportAndDownload,
  timestampSlug,
  saveSettings,
  setButtonState,
  updateStatusIndicator,
} from "./utils.js";
import { mountThemeToggle } from "./theme.js";

mountThemeToggle(document.getElementById("themeToggle"));

// ── Settings toggles ─────────────────────────────────────────────────────────
// Only the quick toggles live in the popup; the rest are on the options page.
// saveSettings merges, so options-page values are left untouched.
const settingInputs = Object.fromEntries(
  Object.keys(DEFAULT_SETTINGS)
    .map((key) => [key, document.getElementById(key)])
    .filter(([, input]) => input),
);

chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (data) => {
  for (const [key, input] of Object.entries(settingInputs)) {
    input.checked = data[key] ?? DEFAULT_SETTINGS[key];
  }
});

for (const input of Object.values(settingInputs)) {
  input.addEventListener("change", () => {
    saveSettings(
      Object.fromEntries(
        Object.entries(settingInputs).map(([key, el]) => [key, el.checked]),
      ),
    );
  });
}

// ── Elements ─────────────────────────────────────────────────────────────────
const apiToggle = document.getElementById("apiToggle");
const feToggle = document.getElementById("feToggle");
const bothToggle = document.getElementById("bothToggle");
const screenRecordToggle = document.getElementById("screenRecordToggle");
const clearDataBtn = document.getElementById("clearData");
const messageEl = document.getElementById("popupMessage");

let apiRecording = false;
let feRecording = false;

// ── Helpers ──────────────────────────────────────────────────────────────────
async function send(action) {
  try {
    const res = await chrome.runtime.sendMessage({ action });
    if (res && res.ok === false && res.error) throw new Error(res.error);
    return res || {};
  } catch (err) {
    showMessage(err.message || String(err), "error");
    return null;
  }
}

function showMessage(text, kind = "info") {
  messageEl.textContent = text || "";
  messageEl.dataset.kind = kind;
  messageEl.hidden = !text;
}

const today = () => timestampSlug();

function refreshUi() {
  setButtonState(apiToggle, apiRecording, "Record API", "Stop API");
  setButtonState(feToggle, feRecording, "Record FE", "Stop FE");
  setButtonState(bothToggle, apiRecording || feRecording, "Record both", "Stop all");
  updateStatusIndicator(apiRecording, feRecording);
}

async function syncState() {
  const state = await send("GET_RECORDING_STATE");
  if (!state) return;
  apiRecording = !!state.apiRecording;
  feRecording = !!state.feRecording;
  document.getElementById("statusCounts").textContent =
    state.apiCount || state.feCount ? `${state.apiCount} API · ${state.feCount} FE` : "";
  refreshUi();
}

async function startApi() {
  const res = await send("START_API");
  if (res) apiRecording = true;
}

async function startFe() {
  const res = await send("START_FE");
  if (res) {
    feRecording = true;
    if (res.warning) showMessage(res.warning, "warn");
  }
}

async function stopApi() {
  await send("STOP_API");
  apiRecording = false;
  await exportAndDownload(`api-flow-record-${today()}.json`, "GET_API_FLOW");
}

async function stopFe() {
  await send("STOP_FE");
  feRecording = false;
  await exportAndDownload(`fe-flow-record-${today()}.json`, "GET_FE_FLOW");
}

// ── Buttons ──────────────────────────────────────────────────────────────────
apiToggle.addEventListener("click", async () => {
  showMessage("");
  await (apiRecording ? stopApi() : startApi());
  await syncState();
});

feToggle.addEventListener("click", async () => {
  showMessage("");
  await (feRecording ? stopFe() : startFe());
  await syncState();
});

bothToggle.addEventListener("click", async () => {
  showMessage("");
  if (apiRecording || feRecording) {
    if (apiRecording) await stopApi();
    if (feRecording) await stopFe();
  } else {
    await startApi();
    await startFe();
  }
  await syncState();
});

document.getElementById("openViewer").addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("html/viewer.html?source=live"),
  });
});

screenRecordToggle.addEventListener("click", async () => {
  // Pre-select the tab the user was on, so the recorder can also capture it.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const query = tab?.id ? `?tabId=${tab.id}` : "";
  chrome.tabs.create({ url: chrome.runtime.getURL(`html/recorder.html${query}`) });
});

document.getElementById("exportData").addEventListener("click", async () => {
  const slug = today();
  const [api, fe] = await Promise.all([
    exportAndDownload(`api-flow-record-${slug}.json`, "GET_API_FLOW"),
    exportAndDownload(`fe-flow-record-${slug}.json`, "GET_FE_FLOW"),
  ]);
  showMessage(api || fe ? "Recording exported to Downloads." : "Nothing recorded yet.", "info");
});

document.getElementById("openSettings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

clearDataBtn.addEventListener("click", async () => {
  if (!confirm("Delete the current recording and all saved history from this device?")) return;
  const res = await send("CLEAR_DATA");
  if (res) {
    showMessage("All recorded data deleted.", "info");
    syncState();
  }
});

chrome.commands.getAll((commands) => {
  const names = { "toggle-api": "API", "toggle-fe": "FE", "open-viewer": "Viewer" };
  const keys = commands
    .filter((c) => c.shortcut && names[c.name])
    .map((c) => `${names[c.name]} ${c.shortcut}`);
  document.getElementById("shortcutHint").textContent = keys.length ? keys.join("  ·  ") : "";
});

document.addEventListener("DOMContentLoaded", syncState);
