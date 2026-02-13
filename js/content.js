function sendFeEvent(event, element = "", text = "") {
  chrome.runtime.sendMessage({
    action: "FE_EVENT",
    event,
    element,
    text,
    route: window.location.href,
  });
}

// Clicks (detect section/tab/accordion toggles)
document.addEventListener("click", (e) => {
  const target = e.target;

  // Generic click logging
  sendFeEvent("CLICK", target.tagName, target.innerText?.slice(0, 40));

  // Detect section/tab/accordion toggles
  if (
    target.classList.contains("tab-button") ||
    target.classList.contains("accordion-toggle") ||
    target.getAttribute("role") === "tab" ||
    target.getAttribute("aria-expanded") !== null
  ) {
    sendFeEvent(
      "SECTION_CHANGE",
      target.tagName,
      target.innerText?.slice(0, 40),
    );
  }
});

// Double clicks
document.addEventListener("dblclick", (e) => {
  const target = e.target;
  sendFeEvent("DOUBLE_CLICK", target.tagName, target.innerText?.slice(0, 40));
});

// ── Input / Change (only on blur/change, not every keystroke) ───────────────
let changeTimeout = null;

document.addEventListener("change", (e) => {
  const target = e.target;

  // Clear any pending timeout
  if (changeTimeout) {
    clearTimeout(changeTimeout);
  }

  // Debounce: wait 300ms after the last change before sending
  changeTimeout = setTimeout(() => {
    sendFeEvent("CHANGE", target.tagName, target.value?.slice(0, 40));
    changeTimeout = null;
  }, 250);
});

document.addEventListener(
  "blur",
  (e) => {
    const target = e.target;
    if (target.value) {
      sendFeEvent("INPUT_FINAL", target.tagName, target.value?.slice(0, 40));
    }
  },
  true,
);

// ── Scroll (throttled) ─────────────────────────────────────────────────────
let lastScroll = 0;
document.addEventListener(
  "scroll",
  () => {
    const now = Date.now();
    if (now - lastScroll > 250) {
      // throttle to 1 event per 250ms
      lastScroll = now;
      sendFeEvent("SCROLL", "WINDOW", `scrollY=${window.scrollY}`);
    }
  },
  { passive: true },
);

// ── Key presses (only meaningful keys) ──────────────────────────────────────
let keydownTimeout = null;

document.addEventListener("keydown", (e) => {
  // Only capture meaningful keys
  if (e.key.length === 1 || ["Enter", "Escape", "Tab"].includes(e.key)) {
    // Clear any pending timeout
    if (keydownTimeout) {
      clearTimeout(keydownTimeout);
    }

    // Set a new timeout (debounce)
    keydownTimeout = setTimeout(() => {
      sendFeEvent("KEYDOWN", e.key, "");
      keydownTimeout = null;
    }, 250); // wait 300ms after last key press
  }
});

// ── Route change tracking (SPA) using history API ──────────────────────────
let lastUrl = location.href;
function handleRouteChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    sendFeEvent("ROUTE_CHANGE");
  }
}
const pushState = history.pushState;
history.pushState = function (...args) {
  pushState.apply(this, args);
  handleRouteChange();
};
window.addEventListener("popstate", handleRouteChange);

// ── MutationObserver (filtered to meaningful UI elements) ───────────────────
const observer = new MutationObserver((mutations) => {
  mutations.forEach((m) => {
    const el = m.target;
    // Detect when a section becomes visible
    if (el.classList?.contains("section") && el.classList.contains("active")) {
      sendFeEvent("SECTION_VISIBLE", el.tagName, el.innerText?.slice(0, 40));
    }
    // Detect loader disappearing
    if (el.classList?.contains("loader") && el.style.display === "none") {
      sendFeEvent("LOADER_DONE", el.tagName, "");
    }
    if (
      el.classList?.contains("accordion") ||
      el.classList?.contains("loader") ||
      el.classList?.contains("modal")
    ) {
      sendFeEvent("DOM_MUTATION", el.tagName, "");
    }
  });
});
observer.observe(document.body, { childList: true, subtree: true });
