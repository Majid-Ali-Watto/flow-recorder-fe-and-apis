# ⚡ Flow Recorder

A Chrome extension that records API network traffic and frontend user interactions — with optional screenshots and video — and lets you view, search, filter, and export the results.

---

## Features

- **API Recording** — Captures network requests/responses (URL, method, headers, body, status, duration) via the Chrome Debugger API
- **FE Recording** — Tracks user interactions (clicks, route changes) with screenshots at each step
- **Video Recording** — Records a synchronized screen capture (video + audio) alongside API/FE events
- **Both Modes** — Run API and FE recording simultaneously
- **Flow Viewer** — Full-page viewer with:
  - Debounced search across URL, payload, and response body
  - Scope checkboxes to choose which fields to search (FE URL, API Endpoint, Payload, Response)
  - Filter by HTTP method and response status
  - Highlighted search matches in matching fields only
  - Copy and Download buttons on each request card
  - Download filtered results as JSON
- **Export** — Downloads recorded flows as `.json` files; video as `.webm`
- **Upload & Replay** — Load previously exported JSON files back into the viewer
- **Configurable** — Toggle request headers, response headers, and per-API screenshot capture

---

## Project Structure

```
├── manifest.json             # Extension manifest (MV3)
├── js/
│   ├── background.js         # Service worker: recording logic, debugger events
│   ├── content.js            # Injected into pages: click & route tracking
│   ├── popup.js              # Popup UI logic: start/stop controls
│   ├── recorder.js           # Screen/video recorder
│   ├── viewer.js             # Flow Viewer page logic
│   └── utils.js              # Shared utilities (filtering, rendering, export)
├── html/
│   ├── popup.html            # Extension popup
│   ├── recorder.html         # Screen/video recorder UI
│   └── viewer.html           # Full-page flow viewer
└── styles/
    ├── popup.css
    └── viewer.css
```

---

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer Mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the project root folder
5. The ⚡ Flow Recorder icon will appear in your toolbar

---

## Usage

### Recording

1. Click the extension icon to open the popup
2. Navigate to the tab you want to record
3. Choose a recording mode:
   - **Start API Recording** — captures network requests only
   - **Start FE Recording** — captures clicks, route changes, and screenshots
   - **Start Video Recording** — captures screen video/audio only
   - **Start Both Recordings** — runs API + FE simultaneously
4. Interact with the page
5. Click the active button again to **stop** — the flow downloads as `.json` and video as `.webm`

### Viewing

- Click **Open Flow Viewer** to open the viewer with the current recorded flow
- Or upload a previously saved `.json` file via the **📂 Upload JSON** button

### Search & Filters

| Control              | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| Search bar           | Debounced full-text search (250 ms delay)                            |
| Search scope         | Checkboxes: FE URL, API Endpoint, Payload, Response (all on by default) |
| Method dropdown      | Filter by HTTP method (GET, POST, PUT, PATCH, DELETE…)               |
| Status dropdown      | Filter by HTTP response status code                                  |
| ✕ Clear              | Reset all filters                                                    |
| ⬇ Download JSON      | Download currently filtered entries as a `.json` file                |

### Per-Entry Actions

Each API request card has:

| Button     | Action                                                      |
| ---------- | ----------------------------------------------------------- |
| **Copy**   | Copy the full entry JSON to the clipboard                   |
| **Download** | Download the entry as `request-step<N>.json`              |
| **Copy URL** | Copy the API or FE URL to the clipboard (inline per row) |

Screenshots (when present) have a **Download** button that saves the image as `screenshot-step<N>.png`.

---

## Settings

Configure before recording via the popup:

| Setting                | Default | Description                                        |
| ---------------------- | ------- | -------------------------------------------------- |
| Request Headers        | ✅ On   | Include request headers in recorded entries        |
| Response Headers       | ✅ On   | Include response headers in recorded entries       |
| Capture API Screenshot | ❌ Off  | Take a screenshot after each API request completes |

Settings are persisted via `chrome.storage.local`.

---

## Data Format

### API Entry

```json
{
  "type": "API",
  "step": 1,
  "request": {
    "url": "https://api.example.com/data",
    "method": "GET",
    "postData": null,
    "headers": { "Authorization": "Bearer ..." }
  },
  "response": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "mimeType": "application/json"
  },
  "responseBody": "{\"key\": \"value\"}",
  "durationMs": 142,
  "readableTime": "2024-01-15T10:23:45.000Z",
  "page": { "url": "https://example.com/dashboard" },
  "screenshot": "data:image/png;base64,..."
}
```

### FE Step Entry

```json
{
  "type": "FE_STEP",
  "step": 3,
  "event": "CLICK",
  "element": "BUTTON",
  "text": "Submit",
  "route": "https://example.com/form",
  "readableTime": "2024-01-15T10:23:50.000Z",
  "screenshot": "data:image/png;base64,..."
}
```

### Initial Screen Entry

```json
{
  "type": "INITIAL_SCREEN",
  "step": 1,
  "route": "https://example.com",
  "readableTime": "2024-01-15T10:23:40.000Z",
  "screenshot": "data:image/png;base64,..."
}
```

---

## Permissions

| Permission                     | Reason                                      |
| ------------------------------ | ------------------------------------------- |
| `debugger`                     | Attach to tabs to intercept network traffic |
| `tabs`                         | Query and capture the active tab            |
| `storage`                      | Persist user settings across sessions       |
| `downloads`                    | Save exported JSON files                    |
| `activeTab`                    | Access the currently active tab             |
| `host_permissions: <all_urls>` | Record requests on any website              |

---

## Ignored Request Types

The following resource types are automatically excluded from API recordings:

- Scripts (`.js`)
- Stylesheets (`.css`)
- Images (`.png`, `.jpg`, `.gif`, `.svg`, `.webp`, `.ico`)
- Fonts (`.woff`, `.woff2`, `.ttf`, `.eot`)
- Source maps (`.map`)
- Media files

---

## Technical Notes

- **Manifest V3** with a service worker as the background script; no build step required
- All JS files use **ES modules** (`type: "module"`) — no bundler, no transpilation
- FE recording detects SPA route changes by polling `window.location.href` every 800 ms
- Screenshots are captured via `chrome.tabs.captureVisibleTab` and embedded as base64 data URLs
- Video recording uses `navigator.mediaDevices.getDisplayMedia` + `MediaRecorder`, saved as `.webm`
- The service worker stays active while recording; flows are lost if it is terminated before export
