# ⚡ Flow Recorder

A Chrome extension that records API traffic, console errors, WebSockets and frontend user interactions, with screenshots and optional synced screen video. It lets you inspect, compare and export the results as JSON, HAR, HTML reports or Playwright/Cypress tests. Everything stays on your device.

---

## Features

**Recording**
- **API recording**: requests and responses (URL, method, headers, body, status) via the Chrome Debugger API, with a **timing breakdown** (blocked, DNS, connect, send, TTFB, download), **transfer size**, protocol and redirects
- **Console errors and exceptions**: `console.error`/`warn`, uncaught exceptions with stack traces, and browser warnings
- **WebSockets and Server-Sent Events**: connections with up to 1,000 frames or events each
- **FE recording**: clicks, form changes, route changes and Enter/Escape/Tab, each with a screenshot, a **click marker** on the screenshot, and **element identification** (CSS selector, `data-testid`, role, label)
- **Screen recording synced with the flow**: start video plus API/FE recording together, then jump from any step to that moment in the video
- **Domain allow-list**: record only the hosts you care about
- **Keyboard shortcuts**: `Alt+Shift+A` (API), `Alt+Shift+F` (FE), `Alt+Shift+V` (viewer); change them at `chrome://extensions/shortcuts`
- **Recording history** in IndexedDB: recordings survive browser restarts, and a recording continues if Chrome restarts the extension's service worker

**Flow Viewer**
- **List view** with search, scope checkboxes, method and status filters
- **"Triggered by" links**: each FE step lists the requests and console errors it caused, and each request links back to its step
- **Waterfall view**: request timing bars with FE steps as markers
- **Compare view**: diff two recordings (status, duration, response-body fields), ignoring IDs and timestamps if you like
- **History picker**: reopen or delete past recordings
- **Copy as cURL / fetch** on every request
- **Exports**: JSON, **HAR** (opens in DevTools, Postman, Charles), a self-contained **HTML report**, and **Playwright** or **Cypress** tests generated from the FE steps

**Design**
- Light and dark themes (follows your OS, or switch with the theme button on any page)
- Timeline-style viewer with summary stat tiles, colour-coded cards and readable local timestamps

**Privacy**
- Secrets are masked by default (auth headers, cookies, tokens, passwords), plus **custom keys** you define
- Typed characters are never logged; password, payment and custom-masked fields are stored as `[REDACTED]`
- Only the tab you chose is recorded; a toolbar badge shows when recording is on
- No servers, analytics or trackers. See the [Privacy Policy](PRIVACY.md) and [Terms of Use](TERMS.md)

---

## Project Structure

```
├── manifest.json             # Extension manifest (MV3)
├── icons/                    # icon.svg source + 16/32/48/128 PNGs
├── js/
│   ├── background.js         # Service worker: recording, debugger events, sessions, shortcuts
│   ├── history.js            # IndexedDB recording history (used by background.js)
│   ├── content.js            # Injected into pages: interactions, selectors, route tracking
│   ├── popup.js              # Popup UI
│   ├── theme.js · theme-init.js # Theme toggle + pre-paint theme application
│   ├── options.js            # Settings page
│   ├── recorder.js           # Screen/video recorder (optionally syncs API + FE recording)
│   ├── viewer.js             # Flow Viewer: list, waterfall, compare, history, exports, video
│   ├── exporters.js          # Pure: cURL, fetch, HAR, HTML report, Playwright, Cypress
│   ├── diff.js               # Pure: compare two flows
│   └── utils.js              # Shared helpers: filtering, redaction, rendering, linking
├── html/
│   ├── popup.html · viewer.html · recorder.html · options.html
│   ├── privacy.html          # Generated from PRIVACY.md
│   └── terms.html            # Generated from TERMS.md
├── styles/
│   ├── base.css              # Design system: tokens (light + dark), buttons, switches, chips, badges
│   ├── popup.css · viewer.css · options.css · legal.css
├── scripts/
│   └── build-legal-pages.mjs # Regenerates html/privacy.html + html/terms.html
├── tests/
│   ├── unit.test.mjs         # Pure-module tests
│   ├── e2e.test.mjs          # Loads the extension in headless Chrome and records a test site
│   └── fixtures/site/        # Test site (HTTP, WebSocket, SSE, console errors, forms)
├── PRIVACY.md
└── TERMS.md
```

---

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer Mode** (top-right)
4. Click **Load unpacked** and select the project root folder
5. The ⚡ Flow Recorder icon appears in your toolbar. Pin it for quick access.

---

## Usage

### Recording

1. Open the tab you want to record and click the extension icon (or use a shortcut)
2. Choose a mode:
   - **Start API Recording**: network, console, WebSocket and SSE
   - **Start FE Recording**: interactions and screenshots
   - **Start Both Recordings**: API and FE together, in one session
   - **Start Screen Recording**: opens the recorder; pick a tab to also record API/FE in sync with the video
3. Interact with the page
4. Click the button again to stop. The flow downloads as `.json`. **Export Recording (JSON)** downloads the last recording again at any time.

### Viewing

- **Open Flow Viewer** shows the current or last recording, with API and FE entries merged into one timeline
- **📚 History** reopens past recordings; **🗑** deletes the selected one
- **📂 Upload JSON** opens an exported file (only open files you trust)
- **🎬 Load video**: load the `.webm` from a synced screen recording, then click **▶ m:ss** on any entry to jump there

### Views

| View | What it shows |
| --- | --- |
| **List** | Cards for every entry. FE steps show the requests and errors they triggered; requests show the step that caused them, plus a timing bar. |
| **Waterfall** | Request bars on a shared time axis, split into timing phases, with FE steps as ◆ markers. Click a row to open its card. |
| **Compare** | Current flow (A) against a history session or uploaded file (B). Rows are *changed*, *only in A*, *only in B* or *identical*, with field-level response diffs. |

### Exports

| Button | Output |
| --- | --- |
| **JSON** | Visible (filtered) entries |
| **HAR** | Visible HTTP + WebSocket requests as HAR 1.2 |
| **Report** | Self-contained HTML report (screenshots embedded, no scripts) |
| **Playwright** | `*.spec.ts` built from FE steps, with `waitForResponse` checks for triggered requests |
| **Cypress** | `*.cy.js` with `cy.intercept` / `cy.wait` checks |

Generated tests read redacted field values from environment variables (`process.env.PASSWORD` or `Cypress.env("PASSWORD")`). Review selectors before use.

Each request card also has **Copy**, **cURL**, **fetch** and **Download**.

---

## Settings

Quick toggles are in the popup; everything else is on the **Settings** page (⚙ in the popup).

| Setting | Default | Description |
| --- | --- | --- |
| Mask secrets | ✅ On | Redact auth/cookie headers, tokens, passwords and similar fields in URLs, bodies, frames and events |
| Extra fields to mask | — | Your own header/JSON/form/query names to redact (also applied to page form fields) |
| Only record these hosts | — (all) | `api.example.com`, `*.example.com`, `localhost:3000` |
| Request / Response headers | ❌ Off | Include headers in API entries |
| Screenshot after each request | ❌ Off | Skipped when requests arrive faster than ~2/s |
| Console errors & exceptions | ✅ On | Requires API recording (uses the debugger) |
| WebSocket frames | ✅ On | Up to 1,000 frames per socket |
| Keep history | ✅ On | Save recordings on this device; also enables recovery after a worker restart |
| History size | 20 | Number of recordings kept (1–100) |

---

## Data Format

### API entry

```json
{
  "type": "API",
  "step": 3,
  "request": { "url": "https://api.example.com/orders", "method": "POST", "postData": "{\"item\":1}", "headers": null },
  "response": { "status": 201, "headers": null, "mimeType": "application/json", "protocol": "h2", "remoteAddress": "1.2.3.4:443", "fromCache": false },
  "responseBody": "{\"id\":42}",
  "timing": { "blocked": 1.2, "dns": -1, "connect": -1, "ssl": -1, "send": 0.1, "wait": 85.3, "receive": 2.4 },
  "transferSize": 512,
  "durationMs": 90,
  "startTime": 1763719425000,
  "readableTime": "2026-11-21T10:23:45.090Z",
  "page": { "url": "https://example.com/checkout" },
  "videoOffsetMs": 12500
}
```

Optional fields: `error` (failed request), `redirectedTo`, `responseBodyTruncated`, `responseBodyBase64`, `stream: "sse"` + `sseEvents`, `screenshot`.

### FE step

```json
{
  "type": "FE_STEP",
  "step": 2,
  "event": "CLICK",
  "element": "BUTTON",
  "text": "Place order",
  "route": "https://example.com/checkout",
  "target": { "tag": "BUTTON", "selector": "[data-testid=\"place-order\"]", "testId": "place-order", "testIdAttr": "data-testid", "role": "button" },
  "point": { "x": 640, "y": 410, "vw": 1280, "vh": 800 },
  "timestamp": 1763719424900,
  "readableTime": "2026-11-21T10:23:44.900Z",
  "screenshot": "data:image/png;base64,..."
}
```

Events: `CLICK`, `DOUBLE_CLICK`, `CHANGE`, `INPUT_FINAL`, `KEYDOWN` (Enter/Escape/Tab only), `SCROLL`, `ROUTE_CHANGE`, `PAGE_LOAD`, `SECTION_CHANGE`, `SECTION_VISIBLE`, `LOADER_DONE`, `DOM_MUTATION`.

### Other entry types

- `INITIAL_SCREEN`: `route`, `screenshot` at recording start
- `CONSOLE`: `level` (`error`/`warning`), `source` (`exception`, `console.error`, `console.warn`, or a browser source), `message`, `location`, `stack`
- `WEBSOCKET`: `request.url`, `request.method: "WS"`, `response.status` (101), `frames: [{ dir, time, opcode, data }]`, `closedAt`

---

## Permissions

| Permission | Reason |
| --- | --- |
| `debugger` | Read network, WebSocket/SSE and console events in the recorded tab |
| `tabs`, `activeTab` | Find the tab to record and capture screenshots |
| `storage` | Settings and recording status |
| `downloads` | Save exports |
| `host_permissions: <all_urls>` + content script | Record any site you test; the content script is idle unless its tab is being recorded |

Keyboard shortcuts (`commands`), the settings page (`options_ui`) and IndexedDB history need no extra permissions.

---

## Privacy & Security

- No servers, analytics or trackers. Data stays in memory and in the extension's IndexedDB on this device.
- FE recording never logs typed characters and stores `[REDACTED]` for password, payment, one-time-code, secret-named and custom-masked fields.
- Only the chosen tab is captured, and screenshots are skipped while it is not visible.
- The viewer renders all recorded/uploaded data as text, links only `http(s)` URLs, and shows only inline `data:image` screenshots. HTML reports contain no scripts and use a `default-src 'none'` CSP.
- Masking is best effort: review exports before sharing them.

If you edit [PRIVACY.md](PRIVACY.md) or [TERMS.md](TERMS.md), run `node scripts/build-legal-pages.mjs` to regenerate the in-extension pages.

---

## Testing

No npm install needed: tests use Node's built-in runner (Node 20+) and your local Chrome.

```sh
node --test "tests/*.test.mjs"          # unit + end-to-end
node --test tests/unit.test.mjs         # unit only (fast)
CHROME_PATH=/path/to/chrome node --test tests/e2e.test.mjs
```

The e2e test loads the unpacked extension with `Extensions.loadUnpacked` over `--remote-debugging-pipe`, records the fixture site (HTTP, WebSocket, SSE, console errors, forms, SPA route change) and checks:

- masking and the host allow-list
- timing, WebSocket and SSE capture, and console capture
- selectors and click points
- recovery after the service worker is stopped mid-recording
- history, every viewer view, and test generation
- that a malicious uploaded flow can't inject markup

It is skipped if Chrome isn't installed.

---

## Ignored Request Types

Scripts, stylesheets, images, fonts, media and source maps are excluded from API recordings.

---

## Technical Notes

- Manifest V3, ES modules, no build step or bundler
- SPA route changes are detected by polling `location.href` every 800 ms (content scripts run in an isolated world, so patching `history.pushState` does not work)
- Screenshots use `chrome.tabs.captureVisibleTab` (~2/s limit). FE steps queue for a slot; when more than 3 are waiting, later steps skip the screenshot so the flow keeps up. API screenshots are skipped when busy.
- Response bodies over ~1 MB are truncated; each flow is capped at 5,000 entries
- A keep-alive ping keeps the worker running while recording. If Chrome restarts it anyway, the session is reloaded from IndexedDB and recording continues while the debugger is still attached.
- "Triggered by" links connect a request or console message to the latest FE step up to 3 s before it
- Compare matches requests by method, host and path, treating numeric and hash segments as `:id`, plus occurrence order
