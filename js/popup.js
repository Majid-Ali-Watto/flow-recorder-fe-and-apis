import {
  exportAndDownload,
  saveSettings,
  setButtonState,
  updateStatusIndicator,
} from "./utils.js";

const includeReqHeaders = document.getElementById("includeReqHeaders");
const includeResHeaders = document.getElementById("includeResHeaders");
const captureApiScreenshots = document.getElementById("captureApiScreenshots");

// Load saved settings
chrome.storage.local.get(
  ["includeReqHeaders", "includeResHeaders", "captureApiScreenshots"],
  (data) => {
    includeReqHeaders.checked = data.includeReqHeaders ?? false;
    includeResHeaders.checked = data.includeResHeaders ?? false;
    captureApiScreenshots.checked = data.captureApiScreenshots ?? false;
  },
);

function handleChange() {
  saveSettings(
    includeReqHeaders.checked,
    includeResHeaders.checked,
    captureApiScreenshots.checked,
  );
}

includeReqHeaders.addEventListener("change", handleChange);
includeResHeaders.addEventListener("change", handleChange);
captureApiScreenshots.addEventListener("change", handleChange);

const apiToggle = document.getElementById("apiToggle");
const feToggle = document.getElementById("feToggle");
const bothToggle = document.getElementById("bothToggle");
const screenRecordToggle = document.getElementById("screenRecordToggle");

export let apiRecording = false;
export let feRecording = false;

document.getElementById("openViewer").addEventListener("click", async () => {
  // Get both flows from background
  chrome.runtime.sendMessage({ action: "GET_API_FLOW" }, (apiResponse) => {
    chrome.runtime.sendMessage({ action: "GET_FE_FLOW" }, (feResponse) => {
      const apiFlow = apiResponse.flow || [];
      const feFlow = feResponse.flow || [];

      // Decide which flow to send
      let flowToSend = [];
      if (feFlow.length) {
        flowToSend = feFlow;
      } else if (apiFlow.length) {
        flowToSend = apiFlow;
      } else {
        flowToSend = apiFlow; // fallback to API if both empty
      }

      // Open viewer.html from extension
      const viewerWindow = window.open(
        chrome.runtime.getURL("../html/viewer.html"),
        "_blank",
        "width=1200,height=800",
      );

      // Wait until viewer signals ready
      const handleReady = (e) => {
        if (e.data.type === "FLOW_VIEWER_READY") {
          viewerWindow.postMessage(
            {
              type: "FLOW_JSON",
              flow: flowToSend,
            },
            "*",
          );
          window.removeEventListener("message", handleReady);
        }
      };

      window.addEventListener("message", handleReady);
    });
  });
});

apiToggle.addEventListener("click", async () => {
  if (apiRecording) {
    chrome.runtime.sendMessage({ action: "STOP_API" }, async () => {
      apiRecording = false;
      setButtonState(
        apiToggle,
        apiRecording,
        "Start API Recording",
        "Stop API Recording",
      );
      updateStatusIndicator(apiRecording, feRecording);
      await exportAndDownload(
        "api-flow-record" + new Date().toISOString().slice(0, 10) + ".json",
        "GET_API_FLOW",
      );
    });
  } else {
    chrome.runtime.sendMessage({ action: "START_API" }, () => {
      apiRecording = true;
      setButtonState(
        apiToggle,
        apiRecording,
        "Start API Recording",
        "Stop API Recording",
      );
      updateStatusIndicator(apiRecording, feRecording);
    });
  }
});

feToggle.addEventListener("click", async () => {
  if (feRecording) {
    chrome.runtime.sendMessage({ action: "STOP_FE" }, async () => {
      feRecording = false;
      setButtonState(
        feToggle,
        feRecording,
        "Start FE Recording",
        "Stop FE Recording",
      );
      updateStatusIndicator(apiRecording, feRecording);
      await exportAndDownload(
        "fe-flow-record" + new Date().toISOString().slice(0, 10) + ".json",
        "GET_FE_FLOW",
      );
    });
  } else {
    chrome.runtime.sendMessage({ action: "START_FE" }, () => {
      feRecording = true;
      setButtonState(
        feToggle,
        feRecording,
        "Start FE Recording",
        "Stop FE Recording",
      );
      updateStatusIndicator(apiRecording, feRecording);
    });
  }
});

bothToggle.addEventListener("click", async () => {
  const anyRecording = apiRecording || feRecording;
  if (anyRecording) {
    // stop both
    chrome.runtime.sendMessage({ action: "STOP_API" }, () => {});
    chrome.runtime.sendMessage({ action: "STOP_FE" }, async () => {
      apiRecording = false;
      feRecording = false;
      setButtonState(
        apiToggle,
        apiRecording,
        "Start API Recording",
        "Stop API Recording",
      );
      setButtonState(
        feToggle,
        feRecording,
        "Start FE Recording",
        "Stop FE Recording",
      );
      setButtonState(
        bothToggle,
        false,
        "Start Both Recordings",
        "Stop Both Recordings",
      );
      updateStatusIndicator(apiRecording, feRecording);
      // export combined flow

      await Promise.all([
        exportAndDownload(
          "api-flow-record" + new Date().toISOString().slice(0, 10) + ".json",
          "GET_API_FLOW",
        ),
        exportAndDownload(
          "fe-flow-record" + new Date().toISOString().slice(0, 10) + ".json",
          "GET_FE_FLOW",
        ),
      ]);
    });
  } else {
    // start both
    chrome.runtime.sendMessage({ action: "START_API" }, () => {});
    chrome.runtime.sendMessage({ action: "START_FE" }, () => {
      apiRecording = true;
      feRecording = true;
      setButtonState(
        apiToggle,
        apiRecording,
        "Start API Recording",
        "Stop API Recording",
      );
      setButtonState(
        feToggle,
        feRecording,
        "Start FE Recording",
        "Stop FE Recording",
      );
      setButtonState(
        bothToggle,
        true,
        "Start Both Recordings",
        "Stop Both Recordings",
      );
      updateStatusIndicator(apiRecording, feRecording);
    });
  }
});
// Sync state from background when popup opens
document.addEventListener("DOMContentLoaded", () => {
  chrome.runtime.sendMessage({ action: "GET_RECORDING_STATE" }, (response) => {
    if (!response) return;

    apiRecording = response.apiRecording;
    feRecording = response.feRecording;

    setButtonState(
      apiToggle,
      apiRecording,
      "Start API Recording",
      "Stop API Recording",
    );

    setButtonState(
      feToggle,
      feRecording,
      "Start FE Recording",
      "Stop FE Recording",
    );

    setButtonState(
      bothToggle,
      apiRecording && feRecording,
      "Start Both Recordings",
      "Stop Both Recordings",
    );

    updateStatusIndicator(apiRecording, feRecording);
  });
});

screenRecordToggle.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("../html/recorder.html"),
  });
});
