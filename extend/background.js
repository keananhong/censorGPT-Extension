let API_URL = "http://127.0.0.1:8000/check";
let INGEST_URL = "http://127.0.0.1:8000/ingest";

console.log("Sensitive Input Guard SW loaded at", new Date().toISOString());

// hydrate API_URL from storage on startup
chrome.storage.sync.get(["API_URL","INGEST_URL"], ({ API_URL: savedAPI, INGEST_URL: savedIngest }) => {
  if (savedAPI) API_URL = savedAPI;
  if (savedIngest) INGEST_URL = savedIngest;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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


if (msg.type === "SEND_PROMPT") {
  console.log("gello");
  fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: msg.text || "" })
  })
    .then(r => r.json())
    .then(data => {
      console.log(data);
      sendResponse({ ok: true, data });
      if (sender.tab && data && data.pii) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SHOW_PII_ALERT",
            pii: data.pii
          });
        }  
    })
    .catch(err => sendResponse({ ok: false, error: String(err) }));
  return true;
}



if (msg.type === "SET_INGEST_URL" && msg.url) {
  INGEST_URL = msg.url;
  chrome.storage.sync.set({ INGEST_URL });
  sendResponse({ ok: true });
  return;
}
});
