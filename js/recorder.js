import { mountThemeToggle } from "./theme.js";
import { exportAndDownload, timestampSlug } from "./utils.js";

mountThemeToggle(document.getElementById("themeToggle"));

let recorder = null;
let stream = null;
let chunks = [];
let slug = "";
let startedApi = false;
let startedFe = false;

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const tabSelect = document.getElementById("tabSelect");
const syncApi = document.getElementById("syncApi");
const syncFe = document.getElementById("syncFe");

const setStatus = (text) => {
  statusEl.textContent = text;
};

// ── Elapsed timer ────────────────────────────────────────────────────────────
const timerEl = document.getElementById("timer");
const stateEl = document.getElementById("recState");
let timerId = null;
function setRecordingUi(on) {
  document.body.classList.toggle("is-recording", on);
  clearInterval(timerId);
  if (on) {
    const started = Date.now();
    const tick = () => {
      const s = Math.floor((Date.now() - started) / 1000);
      timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    tick();
    timerId = setInterval(tick, 500);
    stateEl.textContent = "Recording";
  } else {
    stateEl.textContent = "Ready to record";
  }
}

// ── Tab picker ───────────────────────────────────────────────────────────────
async function loadTabs() {
  const preferred = Number(new URLSearchParams(location.search).get("tabId"));
  const tabs = await chrome.tabs.query({});
  tabSelect.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Don't record a flow (video only)";
  tabSelect.appendChild(none);
  for (const tab of tabs) {
    if (!/^https?:/.test(tab.url || "")) continue;
    const opt = document.createElement("option");
    opt.value = String(tab.id);
    opt.textContent = `${(tab.title || tab.url).slice(0, 70)} — ${new URL(tab.url).host}`;
    tabSelect.appendChild(opt);
  }
  if (preferred > 0 && [...tabSelect.options].some((o) => Number(o.value) === preferred)) {
    tabSelect.value = String(preferred);
  } else if (tabSelect.options.length > 1) {
    tabSelect.selectedIndex = 1;
  }
}
loadTabs();

async function send(action, extra = {}) {
  const res = await chrome.runtime.sendMessage({ action, ...extra }).catch((e) => ({ ok: false, error: e.message }));
  if (res?.ok === false) throw new Error(res.error);
  return res;
}

// ── Recording ────────────────────────────────────────────────────────────────
function pickMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function releaseStream() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

function saveRecording(mimeType) {
  if (!chunks.length) return;
  const blob = new Blob(chunks, { type: mimeType || "video/webm" });
  chunks = [];
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flow-recording-${slug}.webm`;
  a.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function stopFlowRecordings() {
  const tasks = [];
  if (startedApi) tasks.push(send("STOP_API").catch(() => {}));
  if (startedFe) tasks.push(send("STOP_FE").catch(() => {}));
  await Promise.all(tasks);
  await send("VIDEO_STOPPED").catch(() => {});
  const exports = [];
  if (startedApi) exports.push(exportAndDownload(`api-flow-record-${slug}.json`, "GET_API_FLOW"));
  if (startedFe) exports.push(exportAndDownload(`fe-flow-record-${slug}.json`, "GET_FE_FLOW"));
  await Promise.all(exports);
  startedApi = startedFe = false;
}

startBtn.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    setStatus(
      err?.name === "NotAllowedError"
        ? "Screen sharing was cancelled."
        : `Could not start recording: ${err?.message || err}`,
    );
    return;
  }

  slug = timestampSlug();
  const mimeType = pickMimeType();
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  chunks = [];

  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });

  recorder.addEventListener("stop", async () => {
    saveRecording(recorder.mimeType);
    releaseStream();
    recorder = null;
    await stopFlowRecordings();
    setRecordingUi(false);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus("Saved to your Downloads folder. Open the Flow Viewer and use 🎬 Load video to sync.");
  });

  // The browser's own "Stop sharing" button ends the track, not the recorder.
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (recorder?.state === "recording") recorder.stop();
  });

  recorder.start(1000);
  setRecordingUi(true);
  await send("VIDEO_STARTED", { at: Date.now() }).catch(() => {});
  startBtn.disabled = true;
  stopBtn.disabled = false;

  const tabId = Number(tabSelect.value) || null;
  const problems = [];
  if (tabId && syncApi.checked) {
    try {
      await send("START_API", { tabId });
      startedApi = true;
    } catch (err) {
      problems.push(`API: ${err.message}`);
    }
  }
  if (tabId && syncFe.checked) {
    try {
      const res = await send("START_FE", { tabId });
      startedFe = true;
      if (res?.warning) problems.push(res.warning);
    } catch (err) {
      problems.push(`FE: ${err.message}`);
    }
  }
  const what = [startedApi && "API", startedFe && "FE"].filter(Boolean).join(" + ");
  setStatus(
    `Recording video${what ? ` and ${what} flow` : ""}… Keep this tab open until you stop.` +
      (problems.length ? ` ⚠ ${problems.join(" ")}` : ""),
  );
});

stopBtn.addEventListener("click", () => {
  if (recorder?.state === "recording") {
    recorder.stop();
  } else {
    releaseStream();
    stopBtn.disabled = true;
    startBtn.disabled = false;
  }
});

window.addEventListener("beforeunload", (e) => {
  if (recorder?.state === "recording") e.preventDefault();
});
