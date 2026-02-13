function sendFeEvent(event, element = "", text = "") {
  chrome.runtime.sendMessage({
    action: "FE_EVENT",
    event,
    element,
    text,
    route: window.location.href,
    scrollY: window.scrollY,
  });
}

// Click tracking
document.addEventListener("click", (e) => {
  const target = e.target;
  sendFeEvent("CLICK", target.tagName, target.innerText?.slice(0, 40));
});

// Route change tracking (SPA)
let lastUrl = location.href;

setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    sendFeEvent("ROUTE_CHANGE");
  }
}, 800);
