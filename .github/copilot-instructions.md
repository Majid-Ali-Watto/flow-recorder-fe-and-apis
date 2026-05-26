# GitHub Copilot Instructions — Flow Recorder

## Project overview

Chrome Extension (Manifest V3) that records API requests and frontend interactions. No build step — plain ES modules, vanilla JS, plain CSS.

## Architecture

- `js/background.js` — service worker, Chrome Debugger API, recording state
- `js/content.js` — injected page script, click/route tracking
- `js/popup.js` — popup UI
- `js/recorder.js` — screen video recording
- `js/viewer.js` — Flow Viewer page (rendering + event wiring)
- `js/utils.js` — shared pure utilities (filtering, rendering helpers)
- `styles/viewer.css` — dark theme with CSS custom properties (`var(--accent)`, `var(--surface)`, etc.)

## Entry shapes

```js
// API entry
{ type: "API", step, request: { url, method, postData, headers }, response: { status, headers }, responseBody, durationMs, readableTime, page: { url }, screenshot }

// FE step
{ type: "FE_STEP", step, event, element, text, route, readableTime, screenshot }

// Initial screen
{ type: "INITIAL_SCREEN", step, route, readableTime, screenshot }
```

Note: FE entries use `entry.route` for the page URL, NOT `entry.page.url`.

## Conventions

- Build DOM nodes with `document.createElement` and `addEventListener` — do not use `innerHTML` for interactive content
- Search scope is `{ feUrl, apiUrl, payload, response }` booleans passed to `getFilteredFlow`
- Highlight matched text with `highlightText(text, query)` only for checked scope fields
- CSS colours come from `:root` custom properties — never hardcode hex colours that duplicate existing tokens
- No npm, no bundler, no TypeScript
