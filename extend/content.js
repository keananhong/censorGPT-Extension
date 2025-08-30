var buttonEn = true;

// ---- Safe messaging helper to avoid "Extension context invalidated" errors ----
function safeSendMessage(msg) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.id) return resolve({ ok: false, error: "no-runtime-id" });
      chrome.runtime.sendMessage(msg, (resp) => {
        const err = chrome.runtime?.lastError?.message;
        if (err) return resolve({ ok: false, error: err });
        resolve(resp && typeof resp === "object" ? resp : { ok: false });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

const isElement = (n) => n instanceof Element;

const isEditable = (el) => {
  if (!isElement(el)) {
    console.log("is not element");
    return false;
  }
  if (el.disabled || el.readOnly) {
    console.log("is disabled or read only");
    return false;
  }
  if (el instanceof HTMLTextAreaElement) {
    console.log("is html text");
    return true;
  }
  if (el instanceof HTMLInputElement) {
    console.log("is html input element")
    const types = new Set(["text","search","email","tel","url","password","number"]);
    return types.has((el.type || "text").toLowerCase());
  }
  const ce   = el.isContentEditable === true;
  const aria = (el.getAttribute?.("role") || "").toLowerCase() === "textbox";

  return ce || aria;
};

// Best-effort: resolve the true editable element from an event
const resolveEditableFromEvent = (e) => {
  const path = (e.composedPath?.() || [e.target]).filter(isElement);
  for (const n of path) {
    if (isEditable(n)) return n;
    const c = n.closest?.('input,textarea,[contenteditable="true"],[role="textbox"]');
    if (c && isEditable(c)) return c;
  }
  return null;
};

const getValue = (el) => {
  if (!isEditable(el)) return "";
  return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    ? (el.value ?? "")
    : (el.textContent ?? "");
};

// === Intercept + redirect to backend without clearing text ===
const blockAndSend = async (el) => {
  if (!isEditable(el)) return;
  const text = getValue(el);
  if (!text || !String(text).trim()) return;

  // Ask background to POST to /ingest
  const resp = await safeSendMessage({ type: "SEND_PROMPT", text });
  // If background reached /ingest and got PII, show an alert immediately
  if (resp?.ok && resp.data?.pii && resp.data.pii === "null") {
    alert("No issues");
    butonEn = true;
  } else if (resp?.ok && resp.data?.pii && Array.isArray(resp.data.pii) && resp.data.pii.length) {
    const piiList = resp.data.pii.map(it => `${it.type}: ${it.value}`).join("\n");
    alert(
      "⚠️ Sensitive Information Detected!\n\n" +
      "The following data you entered may contain PII:\n\n" +
      piiList +
      "\n\nPlease review before proceeding."
    );
    butonEn = true;
  } else if (!resp?.ok) {
    // Optional: surface errors if needed
    console.warn("SEND_PROMPT failed:", resp?.error);
    butonEn = true;
  }
};


// Capture-phase keydown to beat site handlers
document.addEventListener("keydown", (e) => {
  if (buttonEn) {
    const target = resolveEditableFromEvent(e) || e.target;
    if (!isEditable(target)) return;
    if (e.key !== "Enter") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return; // allow newline and bypass
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.cancelBubble = true;
    e.returnValue = false;
    buttonEn = false;
    blockAndSend(target);
  }
}, true);

// Intercept send button clicks
document.addEventListener("click", (e) => {
  if (buttonEn) {
    const btn = e.target.closest && e.target.closest("#composer-submit-button");
    if (!btn) return;
    //if (!isEditable(target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    const target = document.getElementById("prompt-textarea");

    if (!isEditable(target)) return;
    buttonEn = false;
    blockAndSend(target);
  }
}, true);