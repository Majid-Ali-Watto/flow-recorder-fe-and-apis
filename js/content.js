// ==========================================================
// FLOW RECORDER - CONTENT SCRIPT
// Stays idle on every page until the background worker says this tab is being
// FE-recorded. Never reads values from password, payment or other sensitive
// fields, and never logs typed characters.
// ==========================================================

(() => {
  if (window.__flowRecorderLoaded) return;
  window.__flowRecorderLoaded = true;

  const REDACTED = "[REDACTED]";
  const SENSITIVE_HINT_RE =
    /pass(word|code)?|pwd|secret|token|otp|one.?time|cvv|cvc|card.?(num|no)|ccnum|ssn|social.?security|iban|routing|account.?(num|no)|(^|[^a-z])pin([^a-z]|$)/i;

  let recording = false;
  let extraMaskKeys = []; // user-defined field names to redact (from settings)
  let routeTimer = null;
  let lastUrl = location.href;
  let lastScroll = 0;
  let lastMutation = 0;
  let changeTimeout = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function isSensitiveField(el) {
    if (!(el instanceof Element)) return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password" || type === "hidden") return true;
    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/cc-|password|one-time-code/.test(autocomplete)) return true;
    const hints = [
      el.getAttribute("name"),
      el.id,
      el.getAttribute("aria-label"),
      el.getAttribute("placeholder"),
    ].filter(Boolean);
    if (hints.some((h) => extraMaskKeys.includes(h.toLowerCase()))) return true;
    return SENSITIVE_HINT_RE.test(hints.join(" "));
  }

  function fieldValue(el) {
    if (isSensitiveField(el)) return REDACTED;
    return String(el.value ?? "").slice(0, 200);
  }

  function visibleText(el, max = 100) {
    if (!(el instanceof HTMLElement)) return "";
    if (el.closest("input, textarea, [contenteditable='true']")) return "";
    return (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, max);
  }

  // ── Element identification (for readable steps and test generation) ──────
  const TEST_ID_ATTRS = ["data-testid", "data-test-id", "data-test", "data-cy", "data-qa"];
  const INTERACTIVE =
    "button, a[href], input, select, textarea, label, summary, [role], [data-testid], [data-test-id], [data-test], [data-cy], [data-qa], [onclick], [tabindex]";

  const attrSel = (name, value) => `[${name}="${String(value).replace(/["\\]/g, "\\$&")}"]`;
  const isUnique = (sel) => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  const looksGenerated = (v) => /\d{4,}|^[a-f0-9-]{16,}$|^:r|^ember\d|^react-/i.test(v);

  function testIdOf(el) {
    for (const attr of TEST_ID_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) return { attr, value: v };
    }
    return null;
  }

  function cssSelector(el) {
    const tid = testIdOf(el);
    if (tid && isUnique(attrSel(tid.attr, tid.value))) return attrSel(tid.attr, tid.value);
    if (el.id && !looksGenerated(el.id) && isUnique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
    const name = el.getAttribute("name");
    const tag = el.tagName.toLowerCase();
    if (name && isUnique(`${tag}${attrSel("name", name)}`)) return `${tag}${attrSel("name", name)}`;

    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth++) {
      const nodeTid = testIdOf(node);
      if (depth > 0 && nodeTid) {
        parts.unshift(attrSel(nodeTid.attr, nodeTid.value));
        break;
      }
      if (depth > 0 && node.id && !looksGenerated(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(" > ");
      if (isUnique(sel)) return sel;
      node = parent;
    }
    return parts.join(" > ");
  }

  function implicitRole(el) {
    const tag = el.tagName;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "BUTTON" || (tag === "INPUT" && ["submit", "button", "reset"].includes(type))) return "button";
    if (tag === "A" && el.hasAttribute("href")) return "link";
    if (tag === "INPUT" && type === "checkbox") return "checkbox";
    if (tag === "INPUT" && type === "radio") return "radio";
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA" || (tag === "INPUT" && ["", "text", "email", "search", "tel", "url", "number", "password"].includes(type))) return "textbox";
    return "";
  }

  function labelOf(el) {
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) {
      const text = labelled
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || "")
        .join(" ")
        .trim();
      if (text) return text.slice(0, 100);
    }
    return (el.labels?.[0]?.innerText || "").trim().slice(0, 100);
  }

  function describeTarget(el) {
    const tid = testIdOf(el);
    const info = {
      tag: el.tagName,
      selector: cssSelector(el),
      testId: tid?.value || "",
      testIdAttr: tid?.attr || "",
      id: el.id || "",
      name: el.getAttribute("name") || "",
      role: el.getAttribute("role") || implicitRole(el),
      ariaLabel: el.getAttribute("aria-label") || "",
      label: labelOf(el),
      placeholder: el.getAttribute("placeholder") || "",
      inputType: el instanceof HTMLInputElement ? el.type : "",
    };
    if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)) {
      info.checked = el.checked;
    }
    return info;
  }

  function interactiveTarget(el) {
    return (el instanceof Element && el.closest(INTERACTIVE)) || el;
  }

  function pointOf(e) {
    if (!e.detail) return null; // keyboard-activated click has no real position
    return { x: e.clientX, y: e.clientY, vw: window.innerWidth, vh: window.innerHeight };
  }

  function isFormField(el) {
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    );
  }

  function sendFeEvent(event, element = "", text = "", extra = {}) {
    if (!recording) return;
    try {
      chrome.runtime
        .sendMessage({
          action: "FE_EVENT",
          event,
          element,
          text,
          route: location.href,
          target: extra.target || null,
          point: extra.point || null,
        })
        .catch(() => {});
    } catch {
      // Extension was reloaded/removed; this script is orphaned.
      setRecording(false);
    }
  }

  // ── Listeners (no-ops unless recording) ───────────────────────────────────
  document.addEventListener(
    "click",
    (e) => {
      if (!recording || !(e.target instanceof Element)) return;
      const target = interactiveTarget(e.target);
      const text = target.getAttribute("aria-label") || visibleText(target);
      const extra = { target: describeTarget(target), point: pointOf(e) };
      sendFeEvent("CLICK", target.tagName, text, extra);

      if (
        target.classList.contains("tab-button") ||
        target.classList.contains("accordion-toggle") ||
        target.getAttribute("role") === "tab" ||
        target.getAttribute("aria-expanded") !== null
      ) {
        sendFeEvent("SECTION_CHANGE", target.tagName, text, { target: extra.target });
      }
    },
    true,
  );

  document.addEventListener(
    "dblclick",
    (e) => {
      if (!recording || !(e.target instanceof Element)) return;
      const target = interactiveTarget(e.target);
      sendFeEvent("DOUBLE_CLICK", target.tagName, visibleText(target), {
        target: describeTarget(target),
        point: pointOf(e),
      });
    },
    true,
  );

  document.addEventListener(
    "change",
    (e) => {
      const target = e.target;
      if (!recording || !isFormField(target)) return;
      const isToggle = target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type);
      // Toggles are sent immediately; text changes are debounced.
      const send = () =>
        sendFeEvent(
          "CHANGE",
          target.tagName,
          isToggle ? (target.checked ? "checked" : "unchecked") : fieldValue(target),
          { target: describeTarget(target) },
        );
      if (isToggle) return send();
      clearTimeout(changeTimeout);
      changeTimeout = setTimeout(() => {
        send();
        changeTimeout = null;
      }, 250);
    },
    true,
  );

  document.addEventListener(
    "blur",
    (e) => {
      const target = e.target;
      if (!recording || !isFormField(target) || !target.value) return;
      if (target instanceof HTMLInputElement && ["checkbox", "radio", "submit", "button", "reset"].includes(target.type)) return;
      sendFeEvent("INPUT_FINAL", target.tagName, fieldValue(target), {
        target: describeTarget(target),
      });
    },
    true,
  );

  document.addEventListener(
    "scroll",
    () => {
      const now = Date.now();
      if (now - lastScroll < 1000) return;
      lastScroll = now;
      sendFeEvent("SCROLL", "WINDOW", `scrollY=${Math.round(window.scrollY)}`);
    },
    { passive: true, capture: true },
  );

  // Only navigation/confirmation keys. Printable characters are never sent.
  document.addEventListener(
    "keydown",
    (e) => {
      if (!recording || !["Enter", "Escape", "Tab"].includes(e.key)) return;
      const target = e.target instanceof Element ? e.target : null;
      sendFeEvent("KEYDOWN", e.key, "", {
        target: target && target !== document.body ? describeTarget(target) : null,
      });
    },
    true,
  );

  // ── SPA route tracking ────────────────────────────────────────────────────
  // Content scripts run in an isolated world, so patching history.pushState
  // here would not see the page's calls. Poll the URL instead.
  function checkRoute() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      sendFeEvent("ROUTE_CHANGE");
    }
  }
  window.addEventListener("popstate", checkRoute);
  window.addEventListener("hashchange", checkRoute);

  // ── DOM mutations (throttled) ─────────────────────────────────────────────
  const observer = new MutationObserver((mutations) => {
    const now = Date.now();
    if (now - lastMutation < 1000) return;
    for (const m of mutations) {
      const el = m.target;
      if (!(el instanceof HTMLElement)) continue;
      let event = null;
      if (el.classList.contains("section") && el.classList.contains("active")) {
        event = ["SECTION_VISIBLE", el.tagName, visibleText(el)];
      } else if (el.classList.contains("loader") && el.style.display === "none") {
        event = ["LOADER_DONE", el.tagName, ""];
      } else if (
        el.classList.contains("accordion") ||
        el.classList.contains("loader") ||
        el.classList.contains("modal")
      ) {
        event = ["DOM_MUTATION", el.tagName, ""];
      }
      if (event) {
        lastMutation = now;
        sendFeEvent(...event);
        return;
      }
    }
  });

  // ── Recording state ───────────────────────────────────────────────────────
  function setRecording(on) {
    if (on === recording) return;
    recording = on;
    if (on) {
      lastUrl = location.href;
      routeTimer = setInterval(checkRoute, 800);
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } else {
      clearInterval(routeTimer);
      routeTimer = null;
      observer.disconnect();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.action === "FE_SET_RECORDING") {
      if (Array.isArray(message.maskKeys)) extraMaskKeys = message.maskKeys;
      setRecording(!!message.recording);
    }
  });

  // Resume after a full page navigation inside the recorded tab.
  try {
    chrome.runtime
      .sendMessage({ action: "FE_STATUS" })
      .then((res) => {
        if (Array.isArray(res?.maskKeys)) extraMaskKeys = res.maskKeys;
        setRecording(!!res?.recording);
        if (recording) sendFeEvent("PAGE_LOAD", "DOCUMENT", document.title.slice(0, 40));
      })
      .catch(() => {});
  } catch {
    // extension context unavailable
  }
})();
