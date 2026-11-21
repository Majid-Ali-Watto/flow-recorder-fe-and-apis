import { mountThemeToggle } from "./theme.js";
import { DEFAULT_SETTINGS, saveSettings } from "./utils.js";

mountThemeToggle(document.getElementById("themeToggle"));
const savedNote = document.getElementById("savedNote");
let savedTimer = null;

const keys = Object.keys(DEFAULT_SETTINGS);
const inputs = Object.fromEntries(keys.map((k) => [k, document.getElementById(k)]));

function read(input, key) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") {
    const n = Math.round(Number(input.value));
    return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : DEFAULT_SETTINGS[key];
  }
  return input.value;
}

function write(input, value) {
  if (input.type === "checkbox") input.checked = !!value;
  else input.value = value ?? "";
}

chrome.storage.local.get(keys, (data) => {
  for (const key of keys) write(inputs[key], data[key] ?? DEFAULT_SETTINGS[key]);
});

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSettings(Object.fromEntries(keys.map((k) => [k, read(inputs[k], k)])));
    savedNote.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedNote.hidden = true), 1500);
  }, 300);
}

for (const input of Object.values(inputs)) {
  input.addEventListener(input.tagName === "TEXTAREA" || input.type === "number" ? "input" : "change", save);
}

// ── History ──────────────────────────────────────────────────────────────────
const historyStatus = document.getElementById("historyStatus");
document.getElementById("clearHistory").addEventListener("click", async () => {
  if (!confirm("Delete all saved recordings? A recording in progress is kept.")) return;
  const res = await chrome.runtime.sendMessage({ action: "CLEAR_HISTORY" }).catch((e) => ({ ok: false, error: e.message }));
  historyStatus.textContent = res?.ok === false ? `Failed: ${res.error}` : "History deleted.";
});

// ── Shortcuts ────────────────────────────────────────────────────────────────
chrome.commands.getAll((commands) => {
  const list = document.getElementById("shortcutList");
  for (const cmd of commands) {
    if (!cmd.description) continue;
    const li = document.createElement("li");
    li.appendChild(document.createTextNode(cmd.description));
    const kbd = document.createElement("kbd");
    kbd.textContent = cmd.shortcut || "Not set";
    li.appendChild(kbd);
    list.appendChild(li);
  }
});

document.getElementById("editShortcuts").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
