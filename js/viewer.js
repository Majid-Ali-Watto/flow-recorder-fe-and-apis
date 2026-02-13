import {
  getFilteredFlow,
  highlightText,
  loadFile,
  makeDetails,
  renderScreenshot,
  renderSummary,
  statusClass,
} from "./utils.js";

const flowContainer = document.getElementById("flowContainer");
const fileInput = document.getElementById("fileInput");

const searchInput = document.getElementById("searchUrl");
const methodFilter = document.getElementById("filterMethod");
const statusFilter = document.getElementById("filterStatus");
const clearBtn = document.getElementById("clearFilters");
const resultCount = document.getElementById("resultCount");

let flow = [];

// ── Populate dropdown options ────────────────────────────────────────────────
function populateFilters() {
  const methods = [
    ...new Set(
      flow
        .filter((e) => e.request)
        ?.map((e) => e.request.method)
        .filter(Boolean),
    ),
  ].sort();
  methodFilter.innerHTML = `<option value="">All Methods</option>`;
  methods.forEach((m) =>
    methodFilter.appendChild(
      Object.assign(document.createElement("option"), {
        value: m,
        textContent: m,
      }),
    ),
  );

  const statuses = [
    ...new Set(
      flow
        .filter((e) => e.response?.status !== undefined)
        .map((e) => e.response.status),
    ),
  ].sort((a, b) => a - b);
  statusFilter.innerHTML = `<option value="">All Statuses</option>`;
  statuses.forEach((s) =>
    statusFilter.appendChild(
      Object.assign(document.createElement("option"), {
        value: String(s),
        textContent: s,
      }),
    ),
  );
}

function renderAPIEntry(entry, i, urlQuery) {
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
    ${entry.page ? `<p class="page-url">📄 FE URL: <a href="${entry.page.url || "#"}" target="_blank">${entry.page.url || ""}</a></p>` : ""}
    <p class="req-url">🔗 API URL: <a href="${safeUrl}" target="_blank">${hlUrl}</a></p>
  `;

  if (entry.request?.headers)
    div.appendChild(makeDetails("Request Headers", entry.request.headers));
  if (entry.request?.postData) {
    let parsed;
    try {
      parsed = JSON.parse(entry.request.postData);
    } catch {
      parsed = entry.request.postData;
    }
    div.appendChild(makeDetails("Request Body", parsed));
  }
  if (entry.response?.headers)
    div.appendChild(makeDetails("Response Headers", entry.response.headers));
  if (entry.responseBody) {
    let parsed = entry.responseBody;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {}
    }
    div.appendChild(makeDetails("Response Body", parsed));
  }

  const screenshot = renderScreenshot(entry);
  if (screenshot) div.appendChild(screenshot);

  return div;
}

function renderFEEntry(entry, i) {
  const div = document.createElement("div");
  div.className = "entry";

  const eventName =
    entry.type === "INITIAL_SCREEN"
      ? "INITIAL SCREEN"
      : entry.event || "FE EVENT";

  div.innerHTML = `
    <div class="entry-header">
      <span class="step-num">#${entry.step ?? i + 1}</span>
      <span class="method-badge" style="background:rgba(167,139,250,0.15);color:#a78bfa">FE</span>
      <span class="entry-time">${entry.readableTime || ""}</span>
    </div>
    <p class="req-url">🖱 Event: <strong>${eventName}</strong></p>
    ${entry.route ? `<p class="page-url">📍 Route: ${entry.route}</p>` : ""}
    ${entry.element ? `<p class="page-url">🔎 Element: ${entry.element}</p>` : ""}
    ${entry.text ? `<p class="page-url">📝 Text: ${entry.text}</p>` : ""}
    `;

  const screenshot = renderScreenshot(entry);
  if (screenshot) div.appendChild(screenshot);

  return div;
}

// ── Render entire flow ──────────────────────────────────────────────────────
function renderFlow() {
  const filtered = getFilteredFlow(
    searchInput,
    methodFilter,
    statusFilter,
    flow,
  );
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
  flowContainer.prepend(renderSummary(flow));

  const urlQuery = searchInput.value.trim().toLowerCase();

  filtered.forEach((entry, i) => {
    const div =
      entry.type === "FE_STEP" || entry.type === "INITIAL_SCREEN"
        ? renderFEEntry(entry, i)
        : renderAPIEntry(entry, i, urlQuery);

    flowContainer.appendChild(div);
  });
}

// ── Event listeners ─────────────────────────────────────────────────────────
searchInput.addEventListener("input", renderFlow);
methodFilter.addEventListener("change", renderFlow);
statusFilter.addEventListener("change", renderFlow);
clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  methodFilter.value = "";
  statusFilter.value = "";
  renderFlow();
});

window.addEventListener("message", (e) => {
  if (e.data.type === "FLOW_JSON") {
    flow = e.data.flow;
    populateFilters();
    renderFlow();
  }
});

loadFile(fileInput, (data) => {
  flow = data;
  populateFilters();
  renderFlow();
});

window.opener?.postMessage({ type: "FLOW_VIEWER_READY" }, "*");
