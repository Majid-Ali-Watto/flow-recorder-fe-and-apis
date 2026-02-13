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

// ── Highlight matching URL text ───────────────────────────────────────────────
export function highlightText(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
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
  if (!entry.screenshot) return null;
  const det = document.createElement("details");
  det.className = "details-block";
  det.innerHTML = `<summary>📸 Screenshot</summary>`;
  const img = document.createElement("img");
  img.src = entry.screenshot;
  img.alt = "screenshot";
  img.style.maxWidth = "100%";
  img.style.marginTop = "8px";
  img.style.borderRadius = "4px";
  det.appendChild(img);
  return det;
}

// ── Render summary ───────────────────────────────────────────────────────────
export function renderSummary(flow) {
  const total = flow.length;
  const failed = flow.filter((e) => e.response?.status >= 400).length;
  const avg =
    flow.reduce((acc, e) => acc + (e.durationMs || 0), 0) /
    (flow.filter((e) => e.durationMs).length || 1);

  const summary = document.createElement("div");
  summary.style.marginBottom = "20px";
  summary.innerHTML = `
    <div style="padding:10px;background:#1e2436;border-radius:8px">
      <strong>Total:</strong> ${total} |
      <strong>Failed:</strong> ${failed} |
      <strong>Avg:</strong> ${Math.round(avg)} ms
    </div>
  `;

  return summary;
}

export function updateStatusIndicator(apiRecording, feRecording) {
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

export async function exportAndDownload(filename, actionGet) {
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

export function setButtonState(btn, recording, startLabel, stopLabel) {
  btn.textContent = recording ? stopLabel : startLabel;
  btn.classList.toggle("btn-stop", recording);
  btn.classList.toggle("btn-start", !recording);
}

// ── Filtering ───────────────────────────────────────────────────────────────
export function getFilteredFlow(searchInput, methodFilter, statusFilter, flow) {
  const urlQuery = searchInput.value.trim().toLowerCase();
  const method = methodFilter.value;
  const status = statusFilter.value;

  return flow.filter((entry) => {
    if (entry.type === "FE_STEP" || entry.type === "INITIAL_SCREEN") {
      if (method || status) return false;
      return true;
    }

    const url = (entry.request?.url || "").toLowerCase();
    if (urlQuery && !url.includes(urlQuery)) return false;
    if (method && entry.request?.method !== method) return false;
    if (status && String(entry.response?.status) !== status) return false;
    return true;
  });
}

export function loadFile(fileInput, onLoad) {
  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        onLoad(data); // pass data back to caller
      } catch (err) {
        alert("Invalid JSON file");
        console.error(err);
      }
    };
    reader.readAsText(file);
  });
}

export function saveSettings(
  includeReqHeaders,
  includeResHeaders,
  captureApiScreenshots,
) {
  chrome.storage.local.set({
    includeReqHeaders,
    includeResHeaders,
    captureApiScreenshots,
  });
}
