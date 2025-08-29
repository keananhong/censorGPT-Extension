let API_URL = "http://127.0.0.1:8000/check";

console.log("Sensitive Input Guard SW loaded at", new Date().toISOString());

// hydrate API_URL from storage on startup
chrome.storage.sync.get(["API_URL"], ({ API_URL: saved }) => {
  if (saved) API_URL = saved;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "PING") {
    console.log("SW awake");
    sendResponse({ ok: true, pong: true });
    return true;
  }

  if (msg.type === "CHECK_SENSITIVE") {
    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg.text })
    })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true; // keep channel open
  }

  if (msg.type === "SET_API_URL" && msg.url) {
    API_URL = msg.url;
    chrome.storage.sync.set({ API_URL });
    sendResponse({ ok: true });
    return;
  }
});
