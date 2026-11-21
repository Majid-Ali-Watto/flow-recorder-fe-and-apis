# Flow Recorder — Privacy Policy

**Effective date:** 21 November 2026
**Developer:** Majid Ali, Full Stack Web Developer — [majidev.netlify.app](https://majidev.netlify.app) · [github.com/Majid-Ali-Watto](https://github.com/Majid-Ali-Watto)

Flow Recorder is a Chrome extension for developers and testers. It records network traffic and page interactions in a browser tab **only when you start a recording**, and keeps everything on your device.

## The short version

- Flow Recorder has **no servers, accounts, analytics, ads or trackers**.
- Recorded data **never leaves your computer** unless you share an exported file yourself.
- Recordings are kept in the extension's own storage on this device (recording history) until you delete them, or you can turn history off.
- Nothing is recorded until you press a Start button. The toolbar badge shows **API**, **FE** or **REC** while a recording is running.
- Data is not sold, shared with anyone, or used for any purpose other than showing it back to you.

## What is recorded, and when

| Mode | Started by | What it captures |
| --- | --- | --- |
| **API recording** | "Start API Recording" or `Alt+Shift+A` | For the one tab you chose: request URL, method, request body, response status, MIME type, response body, timing breakdown, transfer size, protocol, server IP address, and the URL of the page that made the request. Also, unless turned off in Settings: console errors and warnings, uncaught JavaScript exceptions (message, file location, stack trace), WebSocket connections with up to 1,000 frames each, and Server-Sent Events. Request/response headers only if you turn those toggles on. A screenshot after each request only if "Capture API Screenshot" is on. If you set "Only record these hosts", requests to other hosts are ignored. |
| **FE recording** | "Start FE Recording" or `Alt+Shift+F` | For the one tab you chose: clicks (including where on the screen you clicked), double-clicks, form changes, scrolls, Enter/Escape/Tab key presses, route changes and page loads, short element text (up to 100 characters), values of non-sensitive form fields (up to 200 characters), identifying attributes of the element you used (tag, id, name, role, label, placeholder, `data-testid`, and a CSS selector), the page URL, and a screenshot of that tab at each step. |
| **Screen recording** | "Start Screen Recording" | Video (and audio if you allow it) of the tab, window or screen you pick in Chrome's sharing dialog. Optionally it also starts API and FE recording of a tab you select, and stores the video start time so the viewer can jump to each step. |

What Flow Recorder **does not** do:

- It does not record the characters you type. Only Enter, Escape and Tab are logged.
- It does not read values from password fields, hidden fields, payment-card fields, one-time-code fields, fields whose name or label suggests a secret (such as PIN, CVV, SSN or token), or fields you list under "Extra fields to mask". Those are stored as `[REDACTED]`.
- It does not take screenshots of other tabs. If you switch away from the recorded tab, screenshots are skipped until you return.
- It does not record anything in tabs you did not start a recording on.

### Secret masking

The **Mask Secrets** setting is on by default. It replaces `Authorization`, `Cookie`, `Set-Cookie`, API keys and similar headers, and JSON or form fields named like passwords, tokens or secrets, with `[REDACTED]`. It applies to request and response bodies, URL query strings, WebSocket frames and Server-Sent Events. You can add your own field names under **Settings → Extra fields to mask**. Console messages and screenshots are not masked. Masking is best effort: it cannot recognise every sensitive value, so **always review an export before sharing it**.

## Where data is kept

| Data | Location | How long |
| --- | --- | --- |
| Current recording | Memory of the extension's background worker | Until you click **Clear All Data**, start a new recording, disable or remove the extension, or close Chrome |
| Recording history (when **Keep history** is on, the default) | The extension's IndexedDB storage on your device | The newest 20 recordings by default (adjustable 1–100). Older ones are deleted automatically. Delete individual recordings in the viewer, or everything with **Clear All Data** or **Settings → Delete all saved history**. Removing the extension deletes it too. |
| Settings | `chrome.storage.local` on your device | Until you change them or remove the extension |
| Recording status (which tab is being recorded, last session id) | `chrome.storage.session` on your device | Cleared when Chrome closes |
| Exported files (`.json`, `.har`, `.html` reports, generated test scripts, `.webm` video) | Your Downloads folder | Until you delete them |

Exported files can contain sensitive information from the pages you recorded, such as personal data, session tokens (if masking is off), console messages and screenshots. HTML reports embed screenshots, and generated Playwright/Cypress tests contain the form values you typed (except masked fields). You control those files and are responsible for storing and sharing them safely.

The video you load into the viewer to sync with a recording is opened locally in that page. It is not copied or uploaded.

## Permissions and why they are needed

| Permission | Why |
| --- | --- |
| `debugger` | Reads network requests and responses, WebSocket/SSE messages and console errors in the tab you are API-recording. Chrome shows a "started debugging this browser" banner while it is active. |
| `tabs`, `activeTab` | Finds the tab you want to record and takes screenshots of it. |
| Access to all sites (`<all_urls>`) and a content script on all pages | Lets you record any site you are testing, and lets the content script report interactions in the recorded tab. On tabs that are not being recorded, the content script does nothing and sends nothing. |
| `storage` | Saves your settings and the current recording status. (Recording history uses the extension's built-in IndexedDB storage, which needs no permission.) |
| `downloads` | Saves exported recordings to your Downloads folder. |

Screen recording uses the standard browser screen-sharing prompt (`getDisplayMedia`) and needs no extra permission. Keyboard shortcuts and the Settings page need no permission either.

## Third parties

Flow Recorder sends no data to third parties. The links to the developer's website and GitHub in the extension open those sites only when you click them. Those sites have their own privacy policies.

## Chrome Web Store User Data Policy

Flow Recorder's use of information complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used only to provide the recording and viewing features you request. It is not transferred, sold, used for advertising, or used to determine creditworthiness.

## Children

Flow Recorder is a developer tool and is not directed at children under 13.

## Your choices

- Do not start a recording on pages with information you do not want captured.
- Keep **Mask Secrets** on, and leave the header toggles off unless you need headers.
- Use **Settings → Only record these hosts** to capture only the API you are testing.
- Turn off console or WebSocket capture in Settings if you do not need them.
- Turn off **Keep history** if you do not want recordings saved on disk.
- Click **Clear All Data** in the popup to delete the current recording and all saved history at any time.
- Remove the extension from `chrome://extensions` to delete its settings, history and any in-memory data.

## Changes to this policy

If this policy changes, the new version will be published in this repository and shipped with the extension, and the effective date above will be updated.

## Contact

Questions or concerns: open an issue at [github.com/Majid-Ali-Watto/flow-recorder-fe-and-apis/issues](https://github.com/Majid-Ali-Watto/flow-recorder-fe-and-apis/issues), or reach Majid Ali via [majidev.netlify.app](https://majidev.netlify.app).
