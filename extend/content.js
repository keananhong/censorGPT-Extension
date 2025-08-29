// content.js — robust targets + full removal of sensitive matches

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
  chrome.runtime.sendMessage({ type: "CHECK_SENSITIVE", text }, (resp) => {
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
    // NEW: remove the entire sensitive substrings from the *current* value
    const cleaned = removeSensitive(value, hits);
    setValue(el, cleaned);
    lastCleanValue.set(el, cleaned);
    showWarning(el, hits);
  } else {
    lastCleanValue.set(el, value);
    clearWarning(el);
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
