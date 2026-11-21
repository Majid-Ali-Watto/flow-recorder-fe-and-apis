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
| `js/background.js` | Service worker — recording logic, debugger events (network, console, WebSocket, SSE), sessions, shortcuts |
| `js/history.js` | IndexedDB recording history (sessions + entries); used only by `background.js` |
| `js/content.js` | Injected script — interaction/route tracking, element selectors, click points; idle unless its tab is recorded |
| `js/options.js` | Settings page (domain allow-list, custom mask keys, console/WS capture, history) |
| `js/exporters.js` | Pure — `toCurl`, `toFetch`, `toHar`, `toHtmlReport`, `toPlaywright`, `toCypress`, `buildTestSteps` |
| `js/diff.js` | Pure — `diffFlows`, `jsonDiff`, `normalizePath` for the Compare view |
| `js/popup.js` | Popup UI — start/stop buttons, settings toggles |
| `js/recorder.js` | Screen/video recorder using `getDisplayMedia` + `MediaRecorder` |
| `js/viewer.js` | Flow Viewer page — list / waterfall / compare views, history, exports, video sync |
| `js/utils.js` | Shared pure utilities — `getFilteredFlow`, `highlightText`, `makeDetails`, `renderScreenshot`, `renderSummary`, etc. |
| `html/popup.html` | Extension popup |
| `html/viewer.html` | Full-page flow viewer |
| `html/recorder.html` | Video recorder UI |
| `html/options.html` | Settings page |
| `html/privacy.html`, `html/terms.html` | Generated from `PRIVACY.md` / `TERMS.md` by `node scripts/build-legal-pages.mjs` |
| `styles/legal.css`, `styles/options.css` | Styles for the privacy/terms pages and the settings page |
| `icons/` | `icon.svg` source + PNG sizes referenced by the manifest |
| `tests/` | `node --test "tests/*.test.mjs"` — unit tests + headless-Chrome e2e (no npm) |
| `styles/base.css` | Design system — colour tokens (dark default + light via `prefers-color-scheme` / `data-theme`), buttons, switches, chips, badges, details/JSON panels, footer. Every page loads it first. |
| `js/theme-init.js`, `js/theme.js` | Classic script in `<head>` that applies the saved theme before paint; module with `mountThemeToggle(button)` (system → light → dark) |
| `styles/popup.css` | Popup styles |
| `styles/viewer.css` | Viewer layout — app bar, filter bar, timeline cards, waterfall, compare, video panel |

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

- `entry.target` — `{ selector, testId, testIdAttr, id, name, role, ariaLabel, label, placeholder, inputType, tag, checked? }`
- `entry.point` — `{ x, y, vw, vh }` click position in the viewport

**Initial screen** — `entry.type === "INITIAL_SCREEN"`
- `entry.route` — page URL at recording start

**Console** — `entry.type === "CONSOLE"`: `level`, `source`, `message`, `location`, `stack` (stored in the API flow)

**WebSocket** — `entry.type === "WEBSOCKET"`: `request.url`, `request.method === "WS"`, `response.status`, `frames[]`

API entries may also carry `timing`, `transferSize`, `error`, `redirectedTo`, `stream: "sse"` + `sseEvents`; any entry may carry `videoOffsetMs` when a synced video was recorded.

## Key patterns

- `getFilteredFlow(searchInput, methodFilter, statusFilter, flow, searchScope)` in `utils.js` handles all search/filter logic. `searchScope` is `{ feUrl, apiUrl, payload, response }` booleans.
- Viewer renders entries by calling `renderAPIEntry(entry, i, urlQuery, scope)` or `renderFEEntry(entry, i)`.
- `highlightText(text, query)` HTML-escapes the text and wraps matches in `<mark>`. Pass an empty query when the corresponding scope checkbox is unchecked.
- Recorded/uploaded data is untrusted: render it with `textContent`, links through `safeHttpUrl`, images through `safeImageSrc`.
- `redactHeaders` / `redactBody` / `redactUrl` in `utils.js` implement the "Mask Secrets" setting.
- Background message handlers are split into `controlHandlers` (extension pages only) and `contentHandlers` (content script); return values become the response. Every handler and listener awaits `ready` (settings + session recovery) first.
- New entries go through `pushEntry(kind, entry)` in `background.js`, which numbers them and persists them to history. Call `persistEntry`/`persistLater` after mutating an entry that was already pushed.
- `linkTriggers(flow)` and `combineFlows(api, fe)` in `utils.js` are shared by the viewer, exporters and background.
- Settings live in `DEFAULT_SETTINGS` (`utils.js`). The popup shows only the toggles it has elements for; the options page shows all.
- `makeDetails(label, data)` produces a collapsible `<details>` panel with a scrollable JSON view and copy button.
- CSS custom properties live in `:root` in `styles/base.css` (with light overrides) — use `var(--accent)`, `var(--surface)`, `var(--text-muted)`, `var(--green)` etc. for all colours, never hex values, so both themes work. Tinted backgrounds use `color-mix(in srgb, var(--tone) 14%, transparent)`.
- Shared components: `.btn` / `.btn-primary` / `.tool-btn` / `.icon-btn`, `input.switch`, `label.chip > input[type=checkbox]`, `.method-badge` / `.status-badge` (colour via `--tone`), `.details-block`.
- Viewer cards use `kvRow(label, children)` for label/value rows and get `data-kind` (fe, ok, warn, bad, ws, console-error…) for their accent colour.

## What NOT to do

- Do not introduce a bundler, transpiler, or package.json dependencies
- Do not use `innerHTML` to render content that needs event listeners — use DOM methods and append
- Do not add inline `onclick` attributes
- Do not modify `manifest.json` permissions without noting the user impact
- Do not commit base64 screenshot data as test fixtures
- Do not record typed characters or values of sensitive inputs in `content.js`
- If you change what data is collected, update `PRIVACY.md` and run `node scripts/build-legal-pages.mjs`
- Keep `exporters.js`, `diff.js` and `utils.js` free of top-level `chrome.*`/DOM access so the unit tests can import them in Node
