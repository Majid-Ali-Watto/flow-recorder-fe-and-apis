import { highlightText, makeDetails, statusClass } from "./utils";

const flowContainer = document.getElementById("flowContainer");
const fileInput = document.getElementById("fileInput");

// ── Filter bar elements ──────────────────────────────────────────────────────
const searchInput = document.getElementById("searchUrl");
const methodFilter = document.getElementById("filterMethod");
const statusFilter = document.getElementById("filterStatus");
const clearBtn = document.getElementById("clearFilters");
const resultCount = document.getElementById("resultCount");

let flow = [];

// ── Populate dropdown options from live data ─────────────────────────────────
function populateFilters() {
  // ── Methods (API only) ──
  const methods = [
    ...new Set(
      flow
        .filter((e) => e.request) // only API entries
        .map((e) => e.request.method)
        .filter(Boolean),
    ),
  ].sort();

  methodFilter.innerHTML = `<option value="">All Methods</option>`;
  methods.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    methodFilter.appendChild(opt);
  });

  // ── Status codes (API only) ──
  const statuses = [
    ...new Set(
      flow
        .filter((e) => e.response?.status !== undefined) // only API entries
        .map((e) => e.response.status),
    ),
  ].sort((a, b) => a - b);

  statusFilter.innerHTML = `<option value="">All Statuses</option>`;
  statuses.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = s;
    statusFilter.appendChild(opt);
  });
}

function getFilteredFlow() {
  const urlQuery = searchInput.value.trim().toLowerCase();
  const method = methodFilter.value;
  const status = statusFilter.value;

  return flow.filter((entry) => {
    // If FE entry → allow it unless filtering specifically by method/status
    if (entry.type === "FE_STEP" || entry.type === "INITIAL_SCREEN") {
      if (method || status) return false; // hide FE when filtering by API fields
      return true;
    }

    const url = (entry.request?.url || "").toLowerCase();
    if (urlQuery && !url.includes(urlQuery)) return false;
    if (method && entry.request?.method !== method) return false;
    if (status && String(entry.response?.status) !== status) return false;
    return true;
  });
}

function renderSummary() {
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

  flowContainer.prepend(summary);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderFlow() {
  const filtered = getFilteredFlow();
  resultCount.textContent = `${filtered.length} / ${flow.length} requests`;

  if (!flow.length) {
    flowContainer.innerHTML = `<div class="empty-state">No flow data loaded yet.<br>Upload a JSON file or use the extension popup.</div>`;
    return;
  }

  if (!filtered.length) {
    flowContainer.innerHTML = `<div class="empty-state">No requests match the current filters.</div>`;
    return;
  }

  flowContainer.innerHTML = "";
  renderSummary();

  const urlQuery = searchInput.value.trim().toLowerCase();

  filtered.forEach((entry, i) => {
    // ───────────────────────────────
    // FE ENTRY
    // ───────────────────────────────
    if (entry.type === "FE_STEP" || entry.type === "INITIAL_SCREEN") {
      const div = document.createElement("div");
      div.className = "entry";

      const eventName =
        entry.type === "INITIAL_SCREEN"
          ? "INITIAL SCREEN"
          : entry.event || "FE EVENT";

      div.innerHTML = `
        <div class="entry-header">
          <span class="step-num">#${entry.step ?? i + 1}</span>
          <span class="method-badge" style="background:rgba(167,139,250,0.15);color:#a78bfa">
            FE
          </span>
          <span class="entry-time">${entry.readableTime || ""}</span>
        </div>

        <p class="req-url">🖱 Event: <strong>${eventName}</strong></p>
        ${entry.route ? `<p class="page-url">📍 Route: ${entry.route}</p>` : ""}
        ${entry.element ? `<p class="page-url">🔎 Element: ${entry.element}</p>` : ""}
        ${entry.text ? `<p class="page-url">📝 Text: ${entry.text}</p>` : ""}
        ${entry.scrollY ? `<p class="page-url">📜 ScrollY: ${entry.scrollY}</p>` : ""}
      `;

      // Screenshot
      if (entry.screenshot) {
        const det = document.createElement("details");
        det.className = "details-block";
        det.innerHTML = `<summary>📸 Screenshot</summary>`;
        const img = document.createElement("img");
        img.src = entry.screenshot;
        img.style.maxWidth = "100%";
        img.style.marginTop = "8px";
        img.style.borderRadius = "4px";
        det.appendChild(img);
        div.appendChild(det);
      }

      flowContainer.appendChild(div);
      return; // Skip API rendering for this entry
    }

    // ───────────────────────────────
    // API ENTRY (existing code)
    // ───────────────────────────────
    const div = document.createElement("div");
    div.className = "entry";

    const rawUrl = entry.request?.url || "";
    const safeUrl = rawUrl || "#";
    const hlUrl = highlightText(rawUrl, urlQuery);
    const method = entry.request?.method || "?";
    const status = entry.response?.status;
    const sBadge = status
      ? `<span class="status-badge ${statusClass(status)}">${status}</span>`
      : "";
    const methodCls = `method-badge method-${method.toLowerCase()}`;

    div.innerHTML = `
      <div class="entry-header">
        <span class="step-num">#${entry.step ?? i + 1}</span>
        <span class="${methodCls}">${method}</span>
        ${sBadge}
        <span class="entry-time">${entry.readableTime || ""}</span>
        ${entry.durationMs ? `<span class="duration">${entry.durationMs} ms</span>` : ""}
      </div>
      ${entry.page ? `<p class="page-url">📄 FE URL:  <a href="${entry.page.url || "#"}" target="_blank">${entry.page.url || ""}</a></p>` : ""}
      <p class="req-url">🔗 API URL:  <a href="${safeUrl}" target="_blank">${hlUrl}</a></p>
    `;

    // ── Request Headers ──
    if (entry.request?.headers)
      div.appendChild(makeDetails("Request Headers", entry.request.headers));

    // ── Request Body ──
    if (entry.request?.postData) {
      let parsed;
      try {
        parsed = JSON.parse(entry.request.postData);
      } catch {
        parsed = entry.request.postData;
      }
      div.appendChild(makeDetails("Request Body", parsed));
    }

    // ── Response Headers ──
    if (entry.response?.headers)
      div.appendChild(makeDetails("Response Headers", entry.response.headers));

    // ── Response Body ──
    if (entry.responseBody) {
      let parsed = entry.responseBody;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {}
      }
      div.appendChild(makeDetails("Response Body", parsed));
    }

    // ── Screenshot ──
    if (entry.screenshot) {
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
      div.appendChild(det);
    }

    flowContainer.appendChild(div);
  });
}

// ── Filter event listeners ────────────────────────────────────────────────────
searchInput.addEventListener("input", renderFlow);
methodFilter.addEventListener("change", renderFlow);
statusFilter.addEventListener("change", renderFlow);
clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  methodFilter.value = "";
  statusFilter.value = "";
  renderFlow();
});

// ── Receive flow JSON from extension popup ────────────────────────────────────
window.addEventListener("message", (e) => {
  if (e.data.type === "FLOW_JSON") {
    flow = e.data.flow;
    populateFilters();
    renderFlow();
  }
});

// ── File upload fallback ──────────────────────────────────────────────────────
fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      flow = JSON.parse(e.target.result);
      populateFilters();
      renderFlow();
    } catch (err) {
      alert("Invalid JSON file");
      console.error(err);
    }
  };
  reader.readAsText(file);
});

// ── Signal ready to popup ─────────────────────────────────────────────────────
window.opener?.postMessage({ type: "FLOW_VIEWER_READY" }, "*");
