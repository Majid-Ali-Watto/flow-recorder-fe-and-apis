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
} // ── Status badge class ────────────────────────────────────────────────────────
export function statusClass(code) {
  if (!code) return "status-unknown";
  if (code < 300) return "status-2xx";
  if (code < 400) return "status-3xx";
  if (code < 500) return "status-4xx";
  return "status-5xx";
}
