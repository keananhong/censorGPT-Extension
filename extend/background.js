let INGEST_URL = "http://127.0.0.1:8000/ingest";

console.log("Sensitive Input Guard SW loaded at", new Date().toISOString());

// hydrate API_URL from storage on startup
chrome.storage.sync.get(["INGEST_URL"], ({ INGEST_URL: savedIngest }) => {
  if (savedIngest) INGEST_URL = savedIngest;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SEND_PROMPT") {
    console.log("Hello")
    fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg.text || "" })
    })
      .then(r => r.json())
      .then(data => {
        sendResponse({ ok: true, data });
      })
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

});
