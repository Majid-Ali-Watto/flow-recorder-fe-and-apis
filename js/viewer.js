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

const scopeFeUrl = document.getElementById("scopeFeUrl");
const scopeApiUrl = document.getElementById("scopeApiUrl");
const scopePayload = document.getElementById("scopePayload");
const scopeResponse = document.getElementById("scopeResponse");
const downloadFilteredBtn = document.getElementById("downloadFiltered");

function getSearchScope() {
  return {
    feUrl: scopeFeUrl.checked,
    apiUrl: scopeApiUrl.checked,
    payload: scopePayload.checked,
    response: scopeResponse.checked,
  };
}

let flow = [];
let filteredFlow = [];

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

function makeUrlRow(cssClass, icon, label, url, hlUrl) {
  const p = document.createElement("p");
  p.className = cssClass;
  p.appendChild(document.createTextNode(`${icon} ${label}: `));

  const link = document.createElement("a");
  link.href = url || "#";
  link.target = "_blank";
  link.innerHTML = hlUrl || url;
  p.appendChild(link);

  if (url) {
    const btn = document.createElement("button");
    btn.className = "copy-url-btn";
    btn.title = `Copy ${label} to clipboard`;
    btn.textContent = "Copy";
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1500);
      });
    });
    p.appendChild(btn);
  }

  return p;
}

function renderAPIEntry(entry, i, urlQuery, scope = {}) {
  const div = document.createElement("div");
  div.className = "entry";

  const rawUrl = entry.request?.url || "";
  const hlUrl = scope.apiUrl ? highlightText(rawUrl, urlQuery) : rawUrl;
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
  `;

  const entryJson = JSON.stringify(entry, null, 2);
  const header = div.querySelector(".entry-header");

  const copyBtn = document.createElement("button");
  copyBtn.className = "entry-action-btn";
  copyBtn.title = "Copy the full request/response entry as JSON to the clipboard";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(entryJson).then(() => {
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("copied");
      }, 1500);
    });
  });
  header.appendChild(copyBtn);

  const dlBtn = document.createElement("a");
  dlBtn.className = "entry-action-btn";
  dlBtn.title = `Download this entry as request-step${entry.step ?? i + 1}.json`;
  dlBtn.textContent = "Download";
  dlBtn.href = URL.createObjectURL(new Blob([entryJson], { type: "application/json" }));
  dlBtn.download = `request-step${entry.step ?? i + 1}.json`;
  header.appendChild(dlBtn);

  if (entry.page?.url) {
    const hlFeUrl = scope.feUrl ? highlightText(entry.page.url, urlQuery) : entry.page.url;
    div.appendChild(makeUrlRow("page-url", "📄", "FE URL", entry.page.url, hlFeUrl));
  }
  div.appendChild(makeUrlRow("req-url", "🔗", "API URL", rawUrl, hlUrl));

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
  filteredFlow = getFilteredFlow(
    searchInput,
    methodFilter,
    statusFilter,
    flow,
    getSearchScope(),
  );
  const filtered = filteredFlow;
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

  const scope = getSearchScope();
  filtered.forEach((entry, i) => {
    const div =
      entry.type === "FE_STEP" || entry.type === "INITIAL_SCREEN"
        ? renderFEEntry(entry, i)
        : renderAPIEntry(entry, i, urlQuery, scope);

    flowContainer.appendChild(div);
  });
}

// ── Event listeners ─────────────────────────────────────────────────────────
const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

searchInput.addEventListener("input", debounce(renderFlow, 250));
methodFilter.addEventListener("change", renderFlow);
statusFilter.addEventListener("change", renderFlow);
[scopeFeUrl, scopeApiUrl, scopePayload, scopeResponse].forEach((cb) =>
  cb.addEventListener("change", renderFlow),
);

downloadFilteredBtn.addEventListener("click", () => {
  if (!filteredFlow.length) return;
  const blob = new Blob([JSON.stringify(filteredFlow, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "flow-filtered.json";
  a.click();
  URL.revokeObjectURL(url);
});
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
