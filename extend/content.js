/* Sensitive Input Guard – content script
 * - Shows a yellow inline banner “PII detected (N)” with chips
 * - Mirrors your existing enter/click interception & backend call
 * - Tints the composer with a soft state ring (loading|pii|safe)
 */

/* =============== STATE =============== */
let EnableButton = false;
let EnableSubmission = true;

/* =============== INDICATOR GLAZE (kept, used by banner too) =============== */
(function installIndicatorStyles() {
  const old = document.getElementById("__sig_indicator_styles__");
  if (old) old.remove();

  const OUTER_RING_PX = 6;
  const OUTSET_PX     = 8;
  const RADIUS_PX     = 16;

  const st = document.createElement("style");
  st.id = "__sig_indicator_styles__";
  st.textContent = `
    [data-sig-indicator] {
      position: relative;
      transition: background-color .18s ease, box-shadow .18s ease;
      border-radius: ${RADIUS_PX}px;
    }
    [data-sig-indicator]::after {
      content: "";
      position: absolute;
      inset: -${OUTSET_PX}px;
      border-radius: ${RADIUS_PX + OUTSET_PX}px;
      pointer-events: none;
    }
    [data-sig-indicator="loading"] { background-color: #fffbe6 !important; }
    [data-sig-indicator="pii"]     { background-color: #fff3cd !important; } /* soft amber to match banner */
    [data-sig-indicator="safe"]    { background-color: #eafff1 !important; }

    [data-sig-indicator="loading"]::after {
      box-shadow: 0 0 0 ${OUTER_RING_PX}px #f6c34366, inset 0 0 0 1px #f6c34380;
    }
    [data-sig-indicator="pii"]::after {
      box-shadow: 0 0 0 ${OUTER_RING_PX}px #f0ad4e88, inset 0 0 0 1px #f0ad4eaa;
    }
    [data-sig-indicator="safe"]::after {
      box-shadow: 0 0 0 ${OUTER_RING_PX}px #2ecc7166, inset 0 0 0 1px #2ecc7180;
    }

    @media (prefers-color-scheme: dark) {
      [data-sig-indicator="loading"] { background-color: rgba(255, 235, 59, 0.10) !important; }
      [data-sig-indicator="pii"]     { background-color: rgba(240, 173, 78, 0.12) !important; }
      [data-sig-indicator="safe"]    { background-color: rgba(46, 204, 113, 0.10) !important; }
    }
  `;
  document.documentElement.appendChild(st);
})();

function getComposerContainer(editableEl) {
  if (!editableEl) return null;
  const cands = [
    editableEl.closest('[data-testid="conversation-compose"]'),
    editableEl.closest('form'),
    editableEl.closest('div:has(textarea,[contenteditable="true"],[role="textbox"])'),
    editableEl.parentElement,
    editableEl.parentElement?.parentElement,
    editableEl.parentElement?.parentElement?.parentElement
  ].filter(Boolean);
  for (const el of cands) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width >= 500 && r.height >= 56 && r.height <= 400) return el;
    } catch {}
  }
  return editableEl;
}
function setIndicator(el, state) {
  const container = getComposerContainer(el);
  if (!container) return;
  if (!state) container.removeAttribute("data-sig-indicator");
  else container.setAttribute("data-sig-indicator", state);
}
function clearOnNextInput(el) {
  const container = getComposerContainer(el);
  const handler = () => {
    if (container) container.removeAttribute("data-sig-indicator");
    el.removeEventListener("input", handler, true);
  };
  el.addEventListener("input", handler, true);
}

/* =============== SAFE BACKGROUND MESSAGE =============== */
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

/* =============== EDITABLE DETECTION HELPERS =============== */
const isElement = (n) => n instanceof Element;
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
const getDeepActiveElement = () => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el || document.activeElement;
};

/* =============== BANNER UI =============== */
function ensureBanner(container) {
  if (!container) return null;
  let banner = container.querySelector(".sig-banner");
  if (banner) return banner;

  banner = document.createElement("div");
  banner.className = "sig-banner";
  banner.innerHTML = `
    <div class="sig-banner__left">
      <strong class="sig-banner__title">PII detected (<span class="sig-count">0</span>):</strong>
      <div class="sig-chips" role="list"></div>
    </div>
    <button class="sig-close" title="Dismiss" aria-label="Dismiss">×</button>
  `;
  // Top of the composer container
  container.prepend(banner);

  banner.querySelector(".sig-close").addEventListener("click", () => {
    banner.remove();
    container.removeAttribute("data-sig-indicator");
  });

  return banner;
}
function updateBanner(container, items) {
  const banner = ensureBanner(container);
  const chipsWrap = banner.querySelector(".sig-chips");
  chipsWrap.textContent = "";
  const count = Array.isArray(items) ? items.length : 0;
  banner.querySelector(".sig-count").textContent = String(count);

  // Create chips – de-dupe adjacent repeats for cleanliness
  const values = (items || []).map(v =>
    (typeof v === "string") ? v :
    (v?.value ?? v?.text ?? "")
  ).filter(Boolean);

  for (const v of values) {
    const chip = document.createElement("span");
    chip.className = "sig-chip";
    chip.textContent = v;
    chip.setAttribute("role", "listitem");
    chipsWrap.appendChild(chip);
  }

  banner.style.display = count ? "flex" : "none";
}
function hideBanner(container) {
  const b = container?.querySelector(".sig-banner");
  if (b) b.remove();
}

/* =============== CORE: BLOCK & SEND =============== */
const blockAndSend = async (el) => {
  if (!isEditable(el)) return;
  const text = getValue(el);
  if (!text || !String(text).trim()) return;

  const container = getComposerContainer(el);

  // WAITING
  setIndicator(el, "loading");

  // Ask background to POST to /ingest
  const resp = await safeSendMessage({ type: "SEND_PROMPT", text });

  // Interpret backend result
  // Expect either: data.pii === "null" (no pii)  OR  data.pii = [ {type,value}, ... ]
  if (resp?.ok && resp.data?.pii === "null") {
    hideBanner(container);
    setIndicator(el, "safe");
    EnableSubmission = true;
    EnableButton = true;
  } else if (resp?.ok && Array.isArray(resp.data?.pii) && resp.data.pii.length) {
    setIndicator(el, "pii");
    updateBanner(container, resp.data.pii.map(it => it.value ?? String(it)));

    // Require confirmation
    showConfirmationDialog(
      () => {
        // User clicked YES -> actually trigger the send
        EnableButton = true;
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      },
      () => {
        // User clicked NO -> cancel
        EnableButton = false;
      }
    );

    EnableSubmission = true;
  }
  else {
    // Unknown/failed – keep UX non-blocking but don’t show banner
    hideBanner(container);
    setIndicator(el, "");
    EnableSubmission = true;
    EnableButton = true;
    console.warn("SEND_PROMPT failed or unexpected payload:", resp);
  }

  clearOnNextInput(el);
  // Auto-clear tint after a while (banner remains until the user closes or edits)
  setTimeout(() => setIndicator(el, ""), 8000);
};

/* =============== INTERCEPT KEYS & BUTTON =============== */
document.addEventListener("keydown", (e) => {
  const target = resolveEditableFromEvent(e) || e.target;
  if (!isEditable(target)) return;
  if (e.key !== "Enter") return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return; // allow newline and bypass

  if (!EnableButton) {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.cancelBubble = true;
    e.returnValue = false;

    if (EnableSubmission) {
      EnableSubmission = false;
      blockAndSend(target);
    }
  } else {
    EnableButton = false;
  }
}, true);

// Intercept the site’s send button (ChatGPT)
document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest("#composer-submit-button");
  if (!btn) return;

  if (!EnableButton) {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    const target = document.getElementById("prompt-textarea");
    if (!isEditable(target)) return;

    if (EnableSubmission) {
      EnableSubmission = false;
      blockAndSend(target);
    }
  } else {
    EnableButton = false;
  }
}, true);

/* =============== SMALL UX TOGGLES =============== */
document.addEventListener("input", (e) => {
  if (e.target.id === "prompt-textarea") EnableButton = false;
});
document.addEventListener("paste", () => {
  const t = getDeepActiveElement();
  if (t?.id === "prompt-textarea") EnableButton = false;
});
document.addEventListener("cut", () => {
  const t = getDeepActiveElement();
  if (t?.id === "prompt-textarea") EnableButton = false;
});

/* =============== CONFIRMATION MODAL =============== */
function showConfirmationDialog(onYes, onNo) {
  let modal = document.querySelector(".sig-modal");
  if (modal) modal.remove();

  modal = document.createElement("div");
  modal.className = "sig-modal";
  modal.innerHTML = `
    <div class="sig-modal__backdrop"></div>
    <div class="sig-modal__dialog">
      <div class="sig-modal__header">PII detected</div>
      <div class="sig-modal__body">Are you sure you want to send this message?</div>
      <div class="sig-modal__footer">
        <button class="sig-btn sig-btn--no">No</button>
        <button class="sig-btn sig-btn--yes">Yes</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector(".sig-btn--yes").addEventListener("click", () => {
    modal.remove();
    onYes && onYes();
  });
  modal.querySelector(".sig-btn--no").addEventListener("click", () => {
    modal.remove();
    onNo && onNo();
  });
}
