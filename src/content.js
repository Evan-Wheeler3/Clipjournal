// In-page side of ClipJournal: quick-slot hotkeys, pasting into the focused
// field, and small toasts. Kept dependency-free because content scripts can't
// be ES modules.
(() => {
  if (window.__clipJournal) return;
  window.__clipJournal = true;

  const SLOT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const state = { clips: [], slots: {}, modifier: 'alt+shift' };

  const ready = chrome.storage.local.get(['clips', 'slots', 'settings']).then(apply);

  function apply(data) {
    if ('clips' in data) state.clips = data.clips || [];
    if ('slots' in data) state.slots = data.slots || {};
    if ('settings' in data) state.modifier = data.settings?.modifier || 'alt+shift';
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    apply(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
  });

  // ---------- hotkeys ----------

  function modifierMatches(e) {
    switch (state.modifier) {
      case 'alt+shift': return e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
      case 'ctrl+shift': return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
      case 'ctrl+alt': return e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey;
      case 'alt': return e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey;
      default: return false;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat || !/^(Digit|Numpad)\d$/.test(e.code) || !modifierMatches(e)) return;
    const key = e.code.slice(-1);
    e.preventDefault();
    e.stopImmediatePropagation();
    ready.then(() => {
      const clip = state.clips.find((c) => c.id === state.slots[key]);
      if (!clip) return toast(`Quick slot ${key} is empty`);
      deliver(clip.text, key);
    });
  }, true);

  // ---------- pasting ----------

  const TEXT_INPUTS = /^(text|search|url|tel|email|password|number|)$/i;

  function editableTarget() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    if (!el || el.disabled || el.readOnly) return null;
    if (el.tagName === 'TEXTAREA') return el;
    if (el.tagName === 'INPUT' && TEXT_INPUTS.test(el.type)) return el;
    if (el.isContentEditable) return el;
    return null;
  }

  function insertInto(el, text) {
    el.focus();
    // execCommand keeps native undo and works with React/Vue/rich editors.
    if (document.execCommand('insertText', false, text)) return true;
    if ('setRangeText' in el && el.tagName !== 'DIV') {
      try {
        el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        return true;
      } catch {}
    }
    const sel = getSelection();
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return true;
    }
    return false;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.documentElement.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  /** Pastes into the focused field, or copies when nothing editable is focused. */
  async function deliver(text, key) {
    const el = editableTarget();
    if (el && insertInto(el, text)) return true;
    if (await copyText(text)) {
      toast(`Slot ${key} copied — click a field and paste`);
      return true;
    }
    return false;
  }

  // ---------- messages from the service worker ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'cj-paste') {
      // Every frame hears this; only the one with focus answers.
      if (!msg.force && !document.hasFocus()) return;
      deliver(msg.text, msg.slot).then((handled) => sendResponse({ handled }));
      return true;
    }
    if (msg?.type === 'cj-toast') {
      toast(msg.message);
      sendResponse({ ok: true });
    }
    if (msg?.type === 'cj-selection') {
      sendResponse({ text: getSelection()?.toString() || '' });
    }
  });

  // ---------- toast ----------

  let host, box, timer;
  function toast(message) {
    if (!host) {
      host = document.createElement('clipjournal-toast');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          :host { all: initial; position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; pointer-events: none; }
          .t {
            font: 500 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f4e9d4;
            background: #4a2c1c linear-gradient(180deg, #5a3523, #3e2416); border-radius: 8px;
            padding: 10px 14px 10px 12px; display: flex; gap: 10px; align-items: center; max-width: 320px;
            box-shadow: 0 8px 24px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,235,200,.08);
            outline: 1px dashed rgba(240,214,170,.45); outline-offset: -5px;
            opacity: 0; transform: translateY(8px); transition: opacity .18s ease, transform .18s ease;
          }
          .t.show { opacity: 1; transform: none; }
          .mark { width: 18px; height: 22px; flex: none; background: #b23a3a; clip-path: polygon(0 0,100% 0,100% 100%,50% 78%,0 100%); }
        </style>
        <div class="t"><span class="mark"></span><span class="msg"></span></div>`;
      box = root.querySelector('.t');
    }
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    box.querySelector('.msg').textContent = message;
    requestAnimationFrame(() => box.classList.add('show'));
    clearTimeout(timer);
    timer = setTimeout(() => box.classList.remove('show'), 2200);
  }
})();
