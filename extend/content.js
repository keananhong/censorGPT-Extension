var buttonEn = true;
// === Softer, theme-aware textbox indicator with a larger outside ring ===
(function installIndicatorStyles() {
  const old = document.getElementById("__sig_indicator_styles__");
  if (old) old.remove();

  // Tweak these for heft/spacing
  const OUTER_RING_PX = 6;  // ring thickness
  const OUTSET_PX     = 8;  // how far the ring extends beyond the box
  const RADIUS_PX     = 16; // base radius

  const st = document.createElement("style");
  st.id = "__sig_indicator_styles__";
  st.textContent = `
    [data-sig-indicator] {
      position: relative; /* needed for ::after overlay */
      transition: background-color .18s ease, box-shadow .18s ease;
      border-radius: ${RADIUS_PX}px;
    }
    /* Draw a big ring just outside the container so it looks obvious */
    [data-sig-indicator]::after {
      content: "";
      position: absolute;
      inset: -${OUTSET_PX}px;                 /* extend outside the box */
      border-radius: ${RADIUS_PX + OUTSET_PX}px;
      pointer-events: none;
    }

    /* LIGHT MODE base fills */
    [data-sig-indicator="loading"] { background-color: #fffbe6 !important; }
    [data-sig-indicator="pii"]     { background-color: #ffeaea !important; }
    [data-sig-indicator="safe"]    { background-color: #eafff1 !important; }

    /* LIGHT MODE rings */
    [data-sig-indicator="loading"]::after {
      box-shadow: 0 0 0 ${OUTER_RING_PX}px #f6c34366, inset 0 0 0 1px #f6c34380;
    }
    [data-sig-indicator="pii"]::after {
      box-shadow: 0 0 0 ${OUTER_RING_PX}px #ff6b6b66, inset 0 0 0 1px #ff6b6b80;
    }
    [data-sig-indicator="safe"]::after {
      box-shadow: 0 0 0 ${OUTER_RING_PX}px #2ecc7166, inset 0 0 0 1px #2ecc7180;
    }

    /* DARK MODE — subtler glazes so text remains readable */
    @media (prefers-color-scheme: dark) {
      [data-sig-indicator="loading"] { background-color: rgba(255, 235, 59, 0.08) !important; }
      [data-sig-indicator="pii"]     { background-color: rgba(255, 99, 99, 0.10) !important; }
      [data-sig-indicator="safe"]    { background-color: rgba(46, 204, 113, 0.10) !important; }

      [data-sig-indicator="loading"]::after {
        box-shadow: 0 0 0 ${OUTER_RING_PX}px rgba(246, 195, 67, 0.55), inset 0 0 0 1px rgba(246, 195, 67, 0.65);
      }
      [data-sig-indicator="pii"]::after {
        box-shadow: 0 0 0 ${OUTER_RING_PX}px rgba(255, 107, 107, 0.55), inset 0 0 0 1px rgba(255, 107, 107, 0.65);
      }
      [data-sig-indicator="safe"]::after {
        box-shadow: 0 0 0 ${OUTER_RING_PX}px rgba(46, 204, 113, 0.55), inset 0 0 0 1px rgba(46, 204, 113, 0.65);
      }
    }
  `;
  document.documentElement.appendChild(st);
})();

// Set/clear indicator on the container
function setIndicator(el, state) {
  const container = getComposerContainer(el);
  if (!container) return;
  if (!state) container.removeAttribute("data-sig-indicator");
  else container.setAttribute("data-sig-indicator", state);
}

// Find the composer container (so we tint the whole bar, not just the text node)
function getComposerContainer(editableEl) {
  if (!editableEl) return null;

  // Try likely wrappers first
  const cands = [
    editableEl.closest('[data-testid="conversation-compose"]'),
    editableEl.closest('form'),
    // generic “wrapper with the textbox inside”
    editableEl.closest('div:has(textarea,[contenteditable="true"],[role="textbox"])'),
    editableEl.parentElement,
    editableEl.parentElement?.parentElement,
    editableEl.parentElement?.parentElement?.parentElement
  ].filter(Boolean);

  // Pick the first “big enough” candidate (wide & tall enough to be the whole bar)
  for (const el of cands) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width >= 500 && r.height >= 56 && r.height <= 400) return el;
    } catch {}
  }
  // Fallback to the editable itself
  return editableEl;
}


// Set/clear indicator on the container
function setIndicator(el, state) {
  const container = getComposerContainer(el);
  if (!container) return;
  if (!state) container.removeAttribute("data-sig-indicator");
  else container.setAttribute("data-sig-indicator", state);
}

// Clear the indicator as soon as the user starts typing again
function clearOnNextInput(el) {
  const container = getComposerContainer(el);
  const handler = () => {
    if (container) container.removeAttribute("data-sig-indicator");
    el.removeEventListener("input", handler, true);
  };
  el.addEventListener("input", handler, true);
}

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

  // YELLOW: waiting
  setIndicator(el, "loading");

  // Ask background to POST to /ingest
  const resp = await safeSendMessage({ type: "SEND_PROMPT", text });


  // If background reached /ingest and got PII, show an alert immediately
  if (resp?.ok && resp.data?.pii && resp.data.pii === "null") {
    setIndicator(el, "safe");
    buttonEn = true;
  } else if (resp?.ok && resp.data?.pii && Array.isArray(resp.data.pii) && resp.data.pii.length) {
    setIndicator(el, "pii");
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

  clearOnNextInput(el);
  setTimeout(() => setIndicator(el, ""), 8000);
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