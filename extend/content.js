
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
// content.js — robust targets + full removal of sensitive matches

const REDIRECT_MODE_CHATGPT = /(^|\.)chatgpt\.com$/.test(location.hostname) || /(^|\.)openai\.com$/.test(location.hostname);

// ---------- small utils ----------
const lastCleanValue = new WeakMap();
const perElemTimers  = new WeakMap();
const debouncePerEl = (el, fn, ms = 220) => {
  clearTimeout(perElemTimers.get(el));
  const t = setTimeout(fn, ms);
  perElemTimers.set(el, t);
};

const isElement = (n) => n instanceof Element;

const getDeepActiveElement = () => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el || document.activeElement;
};

const isEditable = (el) => {
  if (!isElement(el)) return false;
  if (el.disabled || el.readOnly) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
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

const setValue = (el, v) => {
  if (!isEditable(el)) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = v ?? "";
  } else {
    el.textContent = v ?? "";
  }
  try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
};

const uniq = (arr) => [...new Set(arr)];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Remove the exact sensitive substrings returned by the API
const removeSensitive = (text, words) => {
  let out = String(text ?? "");
  for (const w of new Set(words)) {
    const re = new RegExp(escapeRe(w), "gi");
    out = out.replace(re, "");
  }
  // collapse multiple spaces that can result from removal
  out = out.replace(/\s{2,}/g, " ").trimStart();
  return out;
};

// One tooltip per element//
// One tooltip per element
const tooltips = new WeakMap();

const showWarning = (el, words) => {
  if (!(el instanceof Element)) return; 

  // Create or reuse tooltip
  let tip = tooltips.get(el);
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "sig-tooltip";
    tip.style.position = "absolute";
    tip.style.background = "#ffefef";
    tip.style.border = "1px solid #e66363";
    tip.style.padding = "8px 10px";
    tip.style.borderRadius = "6px";
    tip.style.fontSize = "12px";
    tip.style.zIndex = "2147483647";
    tip.style.boxShadow = "0 4px 10px rgba(0,0,0,.08)";
    tip.style.pointerEvents = "none"; // don’t interfere with clicks
    document.body.appendChild(tip);
    tooltips.set(el, tip);
  }

  // Content
  const unique = [...new Set(words)].join(", ");
  tip.textContent = `Blocked sensitive terms: ${unique}`;

  // Position under the element
  try {
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.round(window.scrollX + r.left)}px`;
    tip.style.top  = `${Math.round(window.scrollY + r.bottom + 6)}px`;
  } catch (e) {
    // fallback position
    tip.style.left = `${window.scrollX + 20}px`;
    tip.style.top  = `${window.scrollY + 20}px`;
  }

  try { el.classList.add("sig-blocked"); } catch {}
};

const clearWarning = (el) => {
  if (!(el instanceof Element)) return; 
  try { el.classList.remove("sig-blocked"); } catch {}
  const tip = tooltips.get(el);
  if (tip && tip.parentNode) {
    tip.parentNode.removeChild(tip);
    tooltips.delete(el);
  }
};



const checkSensitive = (text) => new Promise((resolve) => {
  safeSendMessage({ type: "CHECK_SENSITIVE", text }).then((resp) => {
    if (!resp || typeof resp !== "object") return resolve({ ok: false });
    resolve(resp);
  });
});

// ---------- core validation ----------
const validateElement = async (el) => {
  if (!isEditable(el)) return;

  let value;
  try { value = getValue(el); }
  catch { return; } // super defensive; bail if something odd

  if (!value || !String(value).trim()) {
    lastCleanValue.set(el, value ?? "");
    clearWarning(el);
    return;
  }

  const { ok, data } = await checkSensitive(value);
  if (!ok) return; // fail-open on API error

  const hits = (data && Array.isArray(data.sensitive_words)) ? data.sensitive_words : [];
  if (hits.length > 0) {
    if (!REDIRECT_MODE_CHATGPT) {
      const cleaned = removeSensitive(value, hits);
      setValue(el, cleaned);
      lastCleanValue.set(el, cleaned);
    } else {
      // On ChatGPT pages, do NOT mutate text; only show a warning.
      lastCleanValue.set(el, value);
    }
    // showWarning(el, hits);
  } else {
    lastCleanValue.set(el, value);
    // clearWarning(el);
  }
};

// ---------- event-driven path ----------
document.addEventListener("focusin", (e) => {
  const target = resolveEditableFromEvent(e);
  if (!target) return;
  lastCleanValue.set(target, getValue(target));
}, true);

document.addEventListener("input", (e) => {
  const target = resolveEditableFromEvent(e);
  if (!target) return;
  debouncePerEl(target, () => validateElement(target), 220);
}, true);

document.addEventListener("submit", (e) => {
  if (document.querySelectorAll(".sig-blocked").length) {
    e.preventDefault();
    alert("Form contains blocked sensitive information. Please remove it before submitting.");
  }
}, true);

// Listen for PII alerts from background

chrome.runtime.onMessage.addListener((msg) => {
  console.log("onMsg");
  console.log(msg.type);
  if (msg.type === "SHOW_PII_ALERT") {
    const piiList = msg.pii.map(it => `${it.type}: ${it.value}`).join("\n");
    console.log("hello");
    alert(
      "⚠️ Sensitive Information Detected!\n\n" +
      "The following data you entered may contain PII:\n\n" +
      piiList +
      "\n\nPlease review before proceeding."
    );
    return true; 
  }
});


// ---------- polling fallback (for pages that don't bubble input reliably) ----------
let lastPolled = { el: null, val: "" };
setInterval(() => {
  const el = getDeepActiveElement();
  if (!isEditable(el)) {
    lastPolled.el = null;
    lastPolled.val = "";
    return;
  }
  const v = getValue(el);
  if (el !== lastPolled.el || v !== lastPolled.val) {
    if (!lastCleanValue.has(el)) lastCleanValue.set(el, v ?? "");
    lastPolled.el = el;
    lastPolled.val = v;
    debouncePerEl(el, () => validateElement(el), 220);
  }
}, 250);

// ----- dev breadcrumb (remove later if you want) -----
console.debug("SIG content script loaded", { id: chrome.runtime?.id, href: location.href });


// If the extension was just reloaded, the page's old content script can be orphaned.
// Show a one-time hint to refresh the tab if messaging repeatedly fails.
let __failedMsgCount = 0;
function maybeShowReloadHint(err) {
  if (!err) return;
  if (!String(err).includes("context invalidated")) return;
  __failedMsgCount++;
  if (__failedMsgCount < 2 || window.__sigExtReloadHint) return;
  window.__sigExtReloadHint = true;
  try {
    const toast = document.createElement("div");
    toast.textContent = "Extension updated—refresh this tab for it to work.";
    toast.style.position = "fixed";
    toast.style.bottom = "16px";
    toast.style.right = "16px";
    toast.style.padding = "10px 12px";
    toast.style.background = "#fffbe6";
    toast.style.border = "1px solid #e0c200";
    toast.style.borderRadius = "8px";
    toast.style.fontSize = "12px";
    toast.style.zIndex = "2147483647";
    document.body.appendChild(toast);
    setTimeout(()=> toast.remove(), 4000);
  } catch {}
}


// Visually disable ChatGPT send button
(function () {
  const STYLE_ID = "__sig_disable_send_btn_style__";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      /* Grey out and disable pointer for known send buttons */
      button[data-testid="send-button"][data-sig-disabled="1"] {
        opacity: 0.4 !important;
        cursor: not-allowed !important;
      }
      /* Prevent hover styles from re-enabling clicks */
      button[data-testid="send-button"][data-sig-disabled="1"] * {
        pointer-events: none !important;
      }
    `;
    document.documentElement.appendChild(st);
  }

  function markDisabled(btn) {
    if (!btn || btn.dataset.sigDisabled === "1") return;
    btn.dataset.sigDisabled = "1";
    try {
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("disabled", "true");
      btn.title = "Blocked by extension: sending is disabled";
    } catch {}
  }

  function scanAndDisable(root=document) {
    ensureStyle();
    const btns = root.querySelectorAll('button[data-testid="send-button"]');
    btns.forEach(markDisabled);
  }

  // Initial scan + observe for re-renders
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) scanAndDisable(n);
        });
      } else if (m.type === "attributes" && m.target?.matches?.('button[data-testid="send-button"]')) {
        markDisabled(m.target);
      }
    }
  });

  try {
    scanAndDisable(document);
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-testid"] });
  } catch {}
})();



// // === Intercept + redirect to backend without clearing text ===
// const blockAndSend = async (el) => {
//   if (!isEditable(el)) return;
//   const text = getValue(el);
//   if (!text || !String(text).trim()) return;
//   const resp = await safeSendMessage({ type: "SEND_PROMPT", text });
//   // Optional UX toast
//   // try {
//   //   const toast = document.createElement("div");
//   //   const ok = resp && resp.ok;
//   //   toast.textContent = ok ? "Sent to local /ingest" : ("Failed to send: " + (resp?.error || ""));
//   //   toast.style.position = "fixed";
//   //   toast.style.bottom = "16px";
//   //   toast.style.right = "16px";
//   //   toast.style.padding = "8px 10px";
//   //   toast.style.background = ok ? "#e8fff1" : "#ffefef";
//   //   toast.style.border = "1px solid " + (ok ? "#2ecc71" : "#e66363");
//   //   toast.style.borderRadius = "8px";
//   //   toast.style.fontSize = "12px";
//   //   toast.style.zIndex = "2147483647";
//   //   document.body.appendChild(toast);
//   //   setTimeout(()=> toast.remove(), 1400);
//   // } catch {}
// };

// === Intercept + redirect to backend without clearing text ===
const blockAndSend = async (el) => {
  if (!isEditable(el)) return;
  const text = getValue(el);
  if (!text || !String(text).trim()) return;

  // Ask background to POST to /ingest
  const resp = await safeSendMessage({ type: "SEND_PROMPT", text });
  console.log(resp);
  // If background reached /ingest and got PII, show an alert immediately
  if (resp?.ok && resp.data?.pii && Array.isArray(resp.data.pii) && resp.data.pii.length) {
    const piiList = resp.data.pii.map(it => `${it.type}: ${it.value}`).join("\n");
    alert(
      "⚠️ Sensitive Information Detected!\n\n" +
      "The following data you entered may contain PII:\n\n" +
      piiList +
      "\n\nPlease review before proceeding."
    );
  } else if (!resp?.ok) {
    // Optional: surface errors if needed
    console.warn("SEND_PROMPT failed:", resp?.error);
  }
};


// Capture-phase keydown to beat site handlers
document.addEventListener("keydown", (e) => {
  if (!REDIRECT_MODE_CHATGPT) return; // only redirect on ChatGPT pages
  const target = resolveEditableFromEvent(e) || e.target;
  if (!isEditable(target)) return;
  if (e.key !== "Enter") return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return; // allow newline and bypass
  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  e.cancelBubble = true;
  e.returnValue = false;
  blockAndSend(target);
}, true);

// Extra capture handlers to fully block Enter bubbling
const hardBlock = (e) => {
  if (!REDIRECT_MODE_CHATGPT) return;
  const target = resolveEditableFromEvent(e) || e.target;
  if (!isEditable(target)) return;
  if (e.key !== "Enter") return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  e.cancelBubble = true;
  e.returnValue = false;
};
document.addEventListener("keypress", hardBlock, true);
document.addEventListener("keyup", hardBlock, true);

// Intercept send button clicks
document.addEventListener("click", (e) => {
  if (!REDIRECT_MODE_CHATGPT) return;
  const btn = e.target.closest && e.target.closest('button[data-testid="send-button"]');
  if (!btn) return;
  const target = getDeepActiveElement();
  if (!isEditable(target)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  e.cancelBubble = true;
  e.returnValue = false;
  blockAndSend(target);
}, true);
