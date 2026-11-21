// Behaviour for the e2e test page. The other origin (localhost vs 127.0.0.1)
// is used to check the host allow-list.
const other = location.origin.replace("127.0.0.1", "localhost");

document.getElementById("go").addEventListener("click", async () => {
  await fetch("/data.json?access_token=abc123&q=1", { headers: { Authorization: "Bearer SECRET", "X-Api-Key": "k" } });
  await fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: "u", password: "hunter2" }) });
  fetch(`${other}/data.json?from=other-host`).catch(() => {});
});

document.getElementById("ws").addEventListener("click", () => {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ hello: "server", token: "client-secret" }));
  window.__ws = ws;
});

document.getElementById("sse").addEventListener("click", () => {
  window.__es = new EventSource("/events");
});

document.getElementById("err").addEventListener("click", () => {
  console.error("boom-console", { detail: 1 });
  setTimeout(() => {
    throw new Error("boom-exception");
  }, 0);
});

document.getElementById("spa").addEventListener("click", () => {
  history.pushState({}, "", "/spa-route");
});
