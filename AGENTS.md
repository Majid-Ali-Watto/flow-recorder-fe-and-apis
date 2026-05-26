# Agent Instructions — Flow Recorder

Used by OpenAI Codex, ChatGPT, and other AI agents.

## Project type

Chrome Extension, Manifest V3. Vanilla JavaScript (ES modules), plain HTML, plain CSS. No build step, no npm, no bundler.

## Directory layout

```
js/background.js   — service worker: recording, debugger events
js/content.js      — injected script: click + route tracking
js/popup.js        — popup UI
js/recorder.js     — screen/video recording
js/viewer.js       — Flow Viewer page logic
js/utils.js        — shared pure utilities
html/              — popup.html, viewer.html, recorder.html
styles/            — popup.css, viewer.css
manifest.json      — MV3 manifest
```

## Data model

### API entry
```json
{
  "type": "API",
  "step": 1,
  "request": { "url": "...", "method": "GET", "postData": null, "headers": {} },
  "response": { "status": 200, "headers": {}, "mimeType": "application/json" },
  "responseBody": "{}",
  "durationMs": 100,
  "readableTime": "2024-01-01T00:00:00.000Z",
  "page": { "url": "https://example.com/page" },
  "screenshot": "data:image/png;base64,..."
}
```

### FE step entry
```json
{
  "type": "FE_STEP",
  "step": 2,
  "event": "CLICK",
  "element": "BUTTON",
  "text": "Submit",
  "route": "https://example.com/page",
  "readableTime": "...",
  "screenshot": "..."
}
```

> **Important:** FE entries store the page URL in `entry.route`, not `entry.page.url`.

## Key utilities (js/utils.js)

| Export | Purpose |
|---|---|
| `getFilteredFlow(searchInput, methodFilter, statusFilter, flow, searchScope)` | Filter flow array; `searchScope = { feUrl, apiUrl, payload, response }` |
| `highlightText(text, query)` | Wrap matches in `<mark>` |
| `makeDetails(label, data)` | Collapsible JSON panel with copy button |
| `renderScreenshot(entry)` | Collapsible screenshot panel with download button |
| `statusClass(code)` | CSS class for status badge |

## Constraints

- No npm, no bundler, no TypeScript — files are loaded directly by the browser
- Interactive elements must be built with DOM methods + `addEventListener`, not `innerHTML` + `onclick`
- CSS colours are custom properties in `:root` (viewer.css) — use `var(--accent)`, `var(--surface)`, `var(--border)`, `var(--text-muted)`, etc.
- Search highlights must only apply to fields whose scope checkbox is checked
- Do not modify `manifest.json` permissions without explaining the user-facing impact
