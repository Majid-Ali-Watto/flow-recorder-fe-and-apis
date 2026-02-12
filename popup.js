const includeReqHeaders = document.getElementById("includeReqHeaders");
const includeResHeaders = document.getElementById("includeResHeaders");
const captureApiScreenshots = document.getElementById("captureApiScreenshots");

// Load saved settings
chrome.storage.local.get(
  ["includeReqHeaders", "includeResHeaders", "captureApiScreenshots"],
  (data) => {
    includeReqHeaders.checked = data.includeReqHeaders ?? true;
    includeResHeaders.checked = data.includeResHeaders ?? true;
    captureApiScreenshots.checked = data.captureApiScreenshots ?? false;
  },
);

// Save on change
includeReqHeaders.addEventListener("change", saveSettings);
includeResHeaders.addEventListener("change", saveSettings);
captureApiScreenshots.addEventListener("change", saveSettings);

function saveSettings() {
  chrome.storage.local.set({
    includeReqHeaders: includeReqHeaders.checked,
    includeResHeaders: includeResHeaders.checked,
    captureApiScreenshots: captureApiScreenshots.checked,
  });
}

const apiToggle = document.getElementById("apiToggle");
const feToggle = document.getElementById("feToggle");
const bothToggle = document.getElementById("bothToggle");

let apiRecording = false;
let feRecording = false;

function updateStatusIndicator() {
  const dot = document.getElementById("statusDot");
  const txt = document.getElementById("statusText");
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

function setButtonState(btn, recording, startLabel, stopLabel) {
  btn.textContent = recording ? stopLabel : startLabel;
  btn.classList.toggle("btn-stop", recording);
  btn.classList.toggle("btn-start", !recording);
}

async function exportAndDownload(filename, actionGet) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: actionGet }, (response) => {
      const flow = response.flow || [];
      if (!flow.length) return resolve();

      const blob = new Blob([JSON.stringify(flow, null, 2)], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);

      chrome.downloads.download({ url, filename }, () => resolve());
    });
  });
}

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
      updateStatusIndicator();
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
      updateStatusIndicator();
    });
  }
});

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
        chrome.runtime.getURL("viewer.html"),
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
      updateStatusIndicator();
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
      updateStatusIndicator();
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
      updateStatusIndicator();
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
      updateStatusIndicator();
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

    updateStatusIndicator();
  });
});
