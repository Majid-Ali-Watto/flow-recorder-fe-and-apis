# Flow Recorder — Claude Code Guide

## What this project is

A Chrome Extension (Manifest V3) that records API network traffic and frontend user interactions, then displays them in a built-in Flow Viewer. No build step, no bundler, no framework.

## Stack

- Vanilla JS with ES modules (`type: "module"`)
- Chrome Extension APIs: `chrome.debugger`, `chrome.tabs`, `chrome.storage`, `chrome.downloads`
- Plain HTML + CSS (no preprocessors)
- No npm, no node_modules, no transpilation

## File map

| File | Role |
|---|---|
| `js/background.js` | Service worker — recording logic, debugger event handling |
| `js/content.js` | Injected script — click/route tracking, sends messages to background |
| `js/popup.js` | Popup UI — start/stop buttons, settings toggles |
| `js/recorder.js` | Screen/video recorder using `getDisplayMedia` + `MediaRecorder` |
| `js/viewer.js` | Flow Viewer page — rendering, filtering, event wiring |
| `js/utils.js` | Shared pure utilities — `getFilteredFlow`, `highlightText`, `makeDetails`, `renderScreenshot`, `renderSummary`, etc. |
| `html/popup.html` | Extension popup |
| `html/viewer.html` | Full-page flow viewer |
| `html/recorder.html` | Video recorder UI |
| `styles/popup.css` | Popup styles |
| `styles/viewer.css` | Viewer styles — dark theme, CSS custom properties in `:root` |

## Entry data shapes

**API entry** — `entry.type === "API"`
- `entry.request.url` — API endpoint
- `entry.page.url` — the FE page URL at the time of the request
- `entry.request.postData` — request body string (may be JSON string)
- `entry.responseBody` — response body (string or pre-parsed object)
- `entry.response.status`, `entry.durationMs`, `entry.step`

**FE step** — `entry.type === "FE_STEP"`
- `entry.route` — current page URL (not `entry.page.url`)
- `entry.event`, `entry.element`, `entry.text`

**Initial screen** — `entry.type === "INITIAL_SCREEN"`
- `entry.route` — page URL at recording start

## Key patterns

- `getFilteredFlow(searchInput, methodFilter, statusFilter, flow, searchScope)` in `utils.js` handles all search/filter logic. `searchScope` is `{ feUrl, apiUrl, payload, response }` booleans.
- Viewer renders entries by calling `renderAPIEntry(entry, i, urlQuery, scope)` or `renderFEEntry(entry, i)`.
- `highlightText(text, query)` wraps matches in `<mark>` — only call it when the corresponding scope checkbox is checked.
- `makeDetails(label, data)` produces a collapsible `<details>` panel with a scrollable JSON view and copy button.
- CSS custom properties live in `:root` in `viewer.css` — use `var(--accent)`, `var(--surface)`, etc. for all colours.

## What NOT to do

- Do not introduce a bundler, transpiler, or package.json dependencies
- Do not use `innerHTML` to render content that needs event listeners — use DOM methods and append
- Do not add inline `onclick` attributes
- Do not modify `manifest.json` permissions without noting the user impact
- Do not commit base64 screenshot data as test fixtures
