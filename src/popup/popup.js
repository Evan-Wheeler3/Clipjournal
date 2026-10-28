import {
  SLOT_KEYS, load, addClip, updateClip, deleteClip, restoreClip, assignSlot,
  saveSettings, saveLabels, exportAll, importAll, clearAll
} from '../lib/store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
};

const ICONS = {
  copy: '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="9.5" height="10" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-6A1.5 1.5 0 0 0 4 4.5v8A1.5 1.5 0 0 0 5.5 14H7"/></svg>',
  slot: '<svg viewBox="0 0 20 20"><rect x="3" y="5" width="14" height="10" rx="2"/><path d="M7 9h.01M10 9h.01M13 9h.01M7 12h6"/></svg>',
  edit: '<svg viewBox="0 0 20 20"><path d="M13.5 3.5l3 3L8 15H5v-3z"/></svg>',
  pin: '<svg viewBox="0 0 20 20"><path d="M7 3h6l-1 5 3 3H5l3-3zM10 11v6"/></svg>',
  trash: '<svg viewBox="0 0 20 20"><path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/></svg>'
};
const PIN_MARK = '<svg class="pin-mark" viewBox="0 0 20 20"><path d="M7 2h6l-1 6 3.5 3.5h-11L8 8zM9.2 11.5h1.6L10 18z"/></svg>';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let data = { clips: [], slots: {}, labels: [], settings: {} };
const filter = { query: '', labels: new Set(), pinned: false };
let pages = [];
let spread = 0;
let flipping = false;
let staleWhileFlipping = false;

const els = {
  book: $('#book'),
  left: $('#page-left'),
  right: $('#page-right'),
  leaf: $('#leaf'),
  measure: $('#measure'),
  prev: $('#prev'),
  next: $('#next'),
  search: $('#search'),
  filters: $('#filters'),
  toast: $('#toast'),
  popover: $('#slot-popover')
};

// ---------------------------------------------------------------- helpers

const labelOf = (clip) => data.labels.find((l) => l.id === clip.label) || null;
const slotOf = (id) => SLOT_KEYS.find((k) => data.slots[k] === id) || null;
const clipById = (id) => data.clips.find((c) => c.id === id);
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const looksLikeCode = (t) => /^( {2,}|\t)\S/m.test(t) && /[{}();=<>]/.test(t);

function when(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

let toastTimer;
function toast(message, action) {
  els.toast.replaceChildren(message);
  if (action) {
    const b = h('button', { class: 'link', style: 'color:#e9c98f;margin-left:10px' }, action.label);
    b.onclick = () => { action.run(); els.toast.classList.remove('show'); };
    els.toast.append(b);
  }
  els.toast.style.pointerEvents = action ? 'auto' : 'none';
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), action ? 5000 : 2000);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- filtering

function visibleClips() {
  const q = filter.query.trim().toLowerCase();
  const tagQuery = q.startsWith('#') ? q.slice(1) : null;
  let list = data.clips.filter((c) => {
    if (filter.pinned && !c.pinned) return false;
    if (filter.labels.size && !filter.labels.has(c.label)) return false;
    if (!q) return true;
    if (tagQuery !== null) return c.tags?.some((t) => t.toLowerCase().startsWith(tagQuery));
    const hay = [c.title, c.text, ...(c.tags || []), labelOf(c)?.name, c.source && hostOf(c.source.url)].join('\n').toLowerCase();
    return q.split(/\s+/).every((word) => hay.includes(word));
  });
  const sort = data.settings.sort;
  list = [...list].sort((a, b) => {
    if (!!b.pinned - !!a.pinned) return !!b.pinned - !!a.pinned;
    if (sort === 'oldest') return a.createdAt - b.createdAt;
    if (sort === 'title') return (a.title || oneLine(a.text)).localeCompare(b.title || oneLine(b.text), undefined, { sensitivity: 'base' });
    return b.createdAt - a.createdAt;
  });
  return list;
}

const filtering = () => !!(filter.query.trim() || filter.labels.size || filter.pinned);

function renderFilters() {
  els.filters.replaceChildren(
    ...data.labels.map((l) => {
      const b = h('button', { class: 'filter' + (filter.labels.has(l.id) ? ' on' : ''), style: `--c:${l.color}`, title: `Show only “${l.name}”` });
      b.onclick = () => {
        filter.labels.has(l.id) ? filter.labels.delete(l.id) : filter.labels.add(l.id);
        refresh(true);
      };
      return b;
    }),
    (() => {
      const b = h('button', { class: 'filter pinned-filter' + (filter.pinned ? ' on' : ''), title: 'Show only pinned', html: '<svg viewBox="0 0 20 20"><path d="M7 2h6l-1 6 3.5 3.5h-11L8 8zM9.2 11.5h1.6L10 18z"/></svg>' });
      b.onclick = () => { filter.pinned = !filter.pinned; refresh(true); };
      return b;
    })()
  );
}

// ---------------------------------------------------------------- page rendering

function renderEntry(clip) {
  const label = labelOf(clip);
  const slot = slotOf(clip.id);
  const head = h('div', { class: 'entry-head' });
  if (slot) head.append(h('span', { class: 'badge-slot', title: `Quick slot ${slot}` }, slot));
  if (clip.pinned) head.insertAdjacentHTML('beforeend', PIN_MARK);
  const meta = [when(clip.createdAt), clip.source && hostOf(clip.source.url)].filter(Boolean).join(' · ');
  if (clip.title) {
    head.append(h('h3', { class: 'entry-title' }, clip.title), h('span', { class: 'entry-meta' }, meta));
  } else {
    head.append(h('span', { class: 'untitled-meta' }, meta));
  }

  const actions = h('div', { class: 'entry-actions' },
    h('button', { class: 'act', 'data-act': 'copy', title: 'Copy', html: ICONS.copy }),
    h('button', { class: 'act', 'data-act': 'slot', title: 'Assign quick slot', html: ICONS.slot }),
    h('button', { class: 'act', 'data-act': 'pin', title: clip.pinned ? 'Unpin' : 'Pin to front', html: ICONS.pin }),
    h('button', { class: 'act', 'data-act': 'edit', title: 'Edit', html: ICONS.edit }),
    h('button', { class: 'act danger', 'data-act': 'delete', title: 'Tear out', html: ICONS.trash })
  );

  return h('article', {
    class: 'entry' + (label ? '' : ' no-label') + (looksLikeCode(clip.text) ? ' looks-code' : ''),
    style: label ? `--c:${label.color}` : null,
    dataset: { id: clip.id },
    title: 'Click to copy · double-click to edit'
  },
    head,
    h('p', { class: 'entry-text' }, clip.text),
    clip.tags?.length ? h('div', { class: 'entry-tags' }, clip.tags.map((t) => h('span', { class: 'tag', 'data-tag': t }, '#' + t))) : null,
    actions
  );
}

function renderIndex() {
  const mod = {
    'alt+shift': 'Alt+Shift', 'ctrl+shift': 'Ctrl+Shift', 'ctrl+alt': 'Ctrl+Alt', alt: 'Alt'
  }[data.settings.modifier];
  const rows = SLOT_KEYS.map((key) => {
    const clip = clipById(data.slots[key]);
    if (!clip) {
      return h('li', { class: 'slot-row empty' }, h('span', { class: 'keycap' }, key), h('span', { class: 'slot-name' }, 'empty'));
    }
    const label = labelOf(clip);
    return h('li', { class: 'slot-row', dataset: { jump: clip.id }, title: 'Go to entry' },
      h('span', { class: 'keycap' }, key),
      h('span', { class: 'slot-name' + (clip.title ? '' : ' untitled') }, clip.title || oneLine(clip.text)),
      h('span', { class: 'slot-dot', style: label ? `--c:${label.color}` : null }),
      h('button', { class: 'slot-clear', dataset: { clear: key }, title: `Empty slot ${key}` }, '×')
    );
  });
  const count = data.clips.length;
  return [
    h('h2', { class: 'page-title' }, 'Quick Slots'),
    h('p', { class: 'page-sub' },
      mod ? ['Press ', h('kbd', {}, `${mod}+1`), ' … ', h('kbd', {}, `${mod}+0`), ' on any page to paste.'] : 'In-page slot hotkeys are off — see Settings.'),
    h('ol', { class: 'slots' }, rows),
    h('div', { class: 'index-foot' },
      `${count} ${count === 1 ? 'entry' : 'entries'} in this journal`, h('br'),
      'Add copied text with ', h('kbd', {}, captureKey || 'Alt+Shift+S'), ' · flip with ', h('kbd', {}, '←'), ' ', h('kbd', {}, '→'),
      mod && tabStatus ? h('div', { class: `tab-status ${tabStatus}` }, TAB_STATUS_TEXT[tabStatus]) : null)
  ];
}

function renderEmpty() {
  const msg = filtering()
    ? [h('h3', {}, 'Nothing matches'), h('p', {}, 'Try a different search or clear the color filters.')]
    : [
        h('h3', {}, 'A fresh journal'),
        h('p', {}, ['Copy some text anywhere, then press ', h('kbd', {}, captureKey || 'Alt+Shift+S'), ' to file it here.']),
        h('p', {}, 'Or use the pen above to write an entry by hand.')
      ];
  return [h('div', { class: 'empty-page' }, msg)];
}

/** Builds a full `.page` element for page index i, styled as a left or right page. */
function buildPage(i, side) {
  const page = h('section', { class: `page ${side}` });
  fillPage(page, i);
  return page;
}

function fillPage(page, i) {
  const p = pages[i];
  let content = [];
  if (!p || p.kind === 'blank') content = [h('div', { class: 'blank-page' })];
  else if (p.kind === 'index') content = renderIndex();
  else if (p.kind === 'empty') content = renderEmpty();
  else content = p.ids.map((id) => renderEntry(clipById(id)));
  const num = p?.kind === 'index' ? 'contents' : p && p.kind !== 'blank' ? String(i + 1) : '';
  page.replaceChildren(...content, h('div', { class: 'page-num' }, num));
}

/** Splits the visible entries into pages by actually measuring them. */
function paginate() {
  const list = visibleClips();
  pages = [{ kind: 'index' }];
  if (!list.length) {
    pages.push({ kind: 'empty' });
    return;
  }
  const m = els.measure;
  const box = els.right.getBoundingClientRect();
  m.className = 'page right measure';
  m.style.width = box.width + 'px';
  m.style.height = box.height + 'px';
  const limit = box.height - parseFloat(getComputedStyle(m).paddingBottom);
  m.replaceChildren();
  let ids = [];
  for (const clip of list) {
    const el = renderEntry(clip);
    m.append(el);
    if (ids.length && el.offsetTop + el.offsetHeight > limit) {
      pages.push({ kind: 'clips', ids });
      m.replaceChildren(el);
      ids = [];
    }
    ids.push(clip.id);
  }
  pages.push({ kind: 'clips', ids });
  m.replaceChildren();
  if (pages.length % 2) pages.push({ kind: 'blank' });
}

const spreadCount = () => Math.ceil(pages.length / 2);

function renderSpread() {
  spread = Math.max(0, Math.min(spread, spreadCount() - 1));
  fillPage(els.left, spread * 2);
  fillPage(els.right, spread * 2 + 1);
  els.prev.disabled = spread === 0;
  els.next.disabled = spread >= spreadCount() - 1;
}

async function refresh(resetToStart = false) {
  data = await load();
  renderFilters();
  paginate();
  if (resetToStart) spread = 0;
  renderSpread();
}

// ---------------------------------------------------------------- page turning

async function flipTo(target) {
  target = Math.max(0, Math.min(target, spreadCount() - 1));
  if (target === spread || flipping) return;
  if (reducedMotion) {
    spread = target;
    return renderSpread();
  }
  flipping = true;
  const forward = target > spread;
  const leaf = els.leaf;
  const [front, back] = leaf.children;

  if (forward) {
    front.replaceChildren(buildPage(spread * 2 + 1, 'right'));
    back.replaceChildren(buildPage(target * 2, 'left'));
    fillPage(els.right, target * 2 + 1);
  } else {
    front.replaceChildren(buildPage(spread * 2, 'left'));
    back.replaceChildren(buildPage(target * 2 + 1, 'right'));
    fillPage(els.left, target * 2);
  }
  leaf.className = 'leaf ' + (forward ? 'forward' : 'backward');
  leaf.style.display = 'block';

  const dir = forward ? -1 : 1;
  const timing = { duration: 620, easing: 'cubic-bezier(.35,.05,.25,1)' };
  const turn = leaf.animate([
    { transform: 'rotateY(0deg)' },
    { transform: `rotateY(${dir * 90}deg) translateZ(1px)`, offset: 0.5 },
    { transform: `rotateY(${dir * 180}deg)` }
  ], timing);
  front.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(.78)' }], timing);
  back.animate([{ filter: 'brightness(.78)' }, { filter: 'brightness(1)' }], timing);

  await turn.finished.catch(() => {});
  spread = target;
  renderSpread();
  leaf.style.display = 'none';
  front.replaceChildren();
  back.replaceChildren();
  flipping = false;
  if (staleWhileFlipping) {
    staleWhileFlipping = false;
    refresh();
  }
}

const turn = (delta) => flipTo(spread + delta);

function jumpTo(id) {
  let i = pages.findIndex((p) => p.kind === 'clips' && p.ids.includes(id));
  if (i < 0 && filtering()) {
    filter.query = '';
    els.search.value = '';
    filter.labels.clear();
    filter.pinned = false;
    renderFilters();
    paginate();
    renderSpread();
    i = pages.findIndex((p) => p.kind === 'clips' && p.ids.includes(id));
  }
  if (i < 0) return;
  const flash = () => {
    const el = els.book.querySelector(`.entry[data-id="${CSS.escape(id)}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  };
  const target = Math.floor(i / 2);
  if (target === spread) flash();
  else flipTo(target).then(flash);
}

// ---------------------------------------------------------------- entry actions

function stamp(entry, text = 'Copied') {
  entry.querySelector('.stamp')?.remove();
  entry.append(h('span', { class: 'stamp' }, text));
}

async function copyEntry(entry) {
  const clip = clipById(entry.dataset.id);
  if (clip && (await copy(clip.text))) stamp(entry);
  else toast('Could not copy');
}

const confirmEl = {
  wrap: $('#confirm'),
  title: $('#confirm-title'),
  msg: $('#confirm-msg'),
  yes: $('#confirm-yes'),
  no: $('#confirm-no'),
  settle: null
};

/** Journal-styled replacement for window.confirm. Resolves true only on the confirm button. */
function askConfirm({ title, message = '', confirmLabel = 'Delete' }) {
  confirmEl.settle?.(false);
  confirmEl.title.textContent = title;
  confirmEl.msg.textContent = message;
  confirmEl.yes.textContent = confirmLabel;
  confirmEl.wrap.hidden = false;
  confirmEl.no.focus(); // safe default: Enter cancels
  return new Promise((resolve) => {
    confirmEl.settle = (ok) => {
      confirmEl.settle = null;
      confirmEl.wrap.hidden = true;
      resolve(ok);
    };
  });
}

confirmEl.yes.onclick = () => confirmEl.settle?.(true);
confirmEl.no.onclick = () => confirmEl.settle?.(false);
confirmEl.wrap.addEventListener('mousedown', (e) => { if (e.target === confirmEl.wrap) confirmEl.settle?.(false); });

const preview = (clip) => {
  const name = clip.title || oneLine(clip.text);
  return `“${name.length > 80 ? name.slice(0, 79) + '…' : name}”`;
};

async function clearSlot(key) {
  const clip = clipById(data.slots[key]);
  if (!clip) return;
  const ok = await askConfirm({
    title: `Empty quick slot ${key}?`,
    message: `${preview(clip)} stays in your journal — it just won't be on slot ${key} anymore.`,
    confirmLabel: 'Empty slot'
  });
  if (!ok) return false;
  await assignSlot(key, null);
  return true;
}

async function removeEntry(id) {
  const index = data.clips.findIndex((c) => c.id === id);
  const clip = data.clips[index];
  if (!clip) return;
  const slot = slotOf(id);
  const ok = await askConfirm({
    title: 'Tear out this entry?',
    message: preview(clip) + (slot ? `\nIt will also be removed from quick slot ${slot}.` : ''),
    confirmLabel: 'Tear out'
  });
  if (!ok) return;
  await deleteClip(id);
  toast('Entry torn out', { label: 'Undo', run: () => restoreClip(clip, index, slot) });
}

els.book.addEventListener('click', (e) => {
  const clear = e.target.closest('[data-clear]');
  if (clear) return clearSlot(clear.dataset.clear);
  const jump = e.target.closest('[data-jump]');
  if (jump) return jumpTo(jump.dataset.jump);
  const tag = e.target.closest('[data-tag]');
  if (tag) {
    els.search.value = '#' + tag.dataset.tag;
    filter.query = els.search.value;
    return refresh(true);
  }
  const entry = e.target.closest('.entry');
  if (!entry) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  const id = entry.dataset.id;
  if (!act) return copyEntry(entry);
  if (act === 'copy') return copyEntry(entry);
  if (act === 'edit') return openEditor(clipById(id));
  if (act === 'delete') return removeEntry(id);
  if (act === 'pin') return updateClip(id, { pinned: !clipById(id).pinned });
  if (act === 'slot') return openSlotPopover(e.target.closest('[data-act]'), id);
});

els.book.addEventListener('dblclick', (e) => {
  const entry = e.target.closest('.entry');
  if (entry && !e.target.closest('[data-act]')) openEditor(clipById(entry.dataset.id));
});

let wheelLock = 0;
els.book.addEventListener('wheel', (e) => {
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(d) < 12 || Date.now() < wheelLock) return;
  wheelLock = Date.now() + 700;
  turn(d > 0 ? 1 : -1);
}, { passive: true });

els.prev.onclick = () => turn(-1);
els.next.onclick = () => turn(1);

// ---------------------------------------------------------------- slot popover

function slotButtons(currentKey, onPick, { includeNone = true } = {}) {
  const wrap = h('div', { class: 'slot-pick' });
  for (const key of SLOT_KEYS) {
    const occupant = clipById(data.slots[key]);
    const b = h('button', {
      type: 'button',
      class: 'slot-btn' + (key === currentKey ? ' on' : occupant ? ' taken' : ''),
      title: occupant && key !== currentKey ? `Replace: ${occupant.title || oneLine(occupant.text).slice(0, 60)}` : `Slot ${key}`
    }, key);
    b.onclick = () => onPick(key);
    wrap.append(b);
  }
  if (includeNone) {
    const none = h('button', { type: 'button', class: 'slot-btn none' + (currentKey ? '' : ' on') }, currentKey ? 'Remove from slot' : 'No slot');
    none.onclick = () => onPick(null);
    wrap.append(none);
  }
  return wrap;
}

function openSlotPopover(anchor, id) {
  const pop = els.popover;
  const current = slotOf(id);
  pop.replaceChildren(
    h('p', {}, 'Paste with a hotkey from slot…'),
    slotButtons(current, async (key) => {
      closePopover();
      if (key) {
        await assignSlot(key, id);
        toast(`Filed in quick slot ${key}`);
      } else if (current && (await clearSlot(current))) {
        toast('Removed from quick slot');
      }
    })
  );
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.left = Math.min(innerWidth - pr.width - 8, Math.max(8, r.left + r.width / 2 - pr.width / 2)) + 'px';
  pop.style.top = (r.bottom + pr.height + 8 > innerHeight ? r.top - pr.height - 6 : r.bottom + 6) + 'px';
}

const closePopover = () => { els.popover.hidden = true; };
document.addEventListener('mousedown', (e) => {
  if (!els.popover.hidden && !els.popover.contains(e.target) && !e.target.closest('[data-act="slot"]')) closePopover();
});

// ---------------------------------------------------------------- editor

const ed = {
  wrap: $('#editor'),
  form: $('#editor-form'),
  heading: $('#editor-heading'),
  title: $('#ed-title'),
  text: $('#ed-text'),
  labels: $('#ed-labels'),
  tags: $('#ed-tags'),
  slot: $('#ed-slot'),
  pinned: $('#ed-pinned'),
  source: $('#ed-source'),
  del: $('#ed-delete'),
  editing: null,
  label: null,
  slotKey: null
};

function renderEditorLabels() {
  const opts = [{ id: null, name: 'No color' }, ...data.labels];
  ed.labels.replaceChildren(...opts.map((l) => {
    const b = h('button', {
      type: 'button',
      class: 'swatch' + (l.id ? '' : ' none') + (ed.label === l.id ? ' on' : ''),
      style: l.color ? `--c:${l.color}` : null,
      title: l.name
    });
    b.onclick = () => { ed.label = l.id; renderEditorLabels(); };
    return b;
  }));
}

function renderEditorSlots() {
  ed.slot.replaceChildren(...slotButtons(ed.slotKey, (key) => { ed.slotKey = key; renderEditorSlots(); }, { includeNone: false }).children);
  // clicking the selected slot again clears it
  for (const b of ed.slot.children) {
    if (b.textContent === ed.slotKey) b.onclick = () => { ed.slotKey = null; renderEditorSlots(); };
  }
}

function openEditor(clip = null, preset = {}) {
  closePopover();
  ed.editing = clip;
  ed.heading.textContent = clip ? 'Edit entry' : 'New entry';
  ed.title.value = clip?.title ?? preset.title ?? '';
  ed.text.value = clip?.text ?? preset.text ?? '';
  ed.tags.value = (clip?.tags || []).join(', ');
  ed.pinned.checked = !!clip?.pinned;
  ed.label = clip?.label ?? (filter.labels.size === 1 ? [...filter.labels][0] : null);
  ed.slotKey = clip ? slotOf(clip.id) : null;
  ed.del.hidden = !clip;
  ed.source.replaceChildren();
  if (clip) {
    const bits = [`Saved ${new Date(clip.createdAt).toLocaleString()}`];
    if (clip.updatedAt && clip.updatedAt - clip.createdAt > 1000) bits.push(`edited ${when(clip.updatedAt)}`);
    ed.source.append(bits.join(' · '));
    if (clip.source?.url) {
      ed.source.append(' · from ', h('a', { href: clip.source.url, target: '_blank', title: clip.source.url }, clip.source.title || hostOf(clip.source.url)));
    }
  }
  renderEditorLabels();
  renderEditorSlots();
  ed.wrap.hidden = false;
  (clip ? ed.text : ed.title).focus();
}

const closeEditor = () => { ed.wrap.hidden = true; ed.editing = null; };

ed.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = { title: ed.title.value, text: ed.text.value, label: ed.label, tags: ed.tags.value, pinned: ed.pinned.checked };
  if (!fields.text.trim()) {
    ed.text.focus();
    return toast('An entry needs some text');
  }
  const editing = ed.editing;
  closeEditor();
  if (editing) {
    await updateClip(editing.id, fields);
    const before = slotOf(editing.id);
    if (ed.slotKey !== before) {
      if (ed.slotKey) await assignSlot(ed.slotKey, editing.id);
      else await assignSlot(before, null);
    }
    toast('Entry updated');
  } else {
    const { clip } = await addClip({ ...fields, slot: ed.slotKey }, { manual: true });
    await refresh();
    jumpTo(clip.id);
    toast('Entry added');
  }
});

$('#ed-cancel').onclick = closeEditor;
ed.del.onclick = async () => {
  const id = ed.editing?.id;
  if (!id) return;
  const before = data.clips.length;
  await removeEntry(id);
  if ((await load()).clips.length < before) closeEditor(); // stay open if they cancelled
};
ed.wrap.addEventListener('mousedown', (e) => { if (e.target === ed.wrap) closeEditor(); });

// ---------------------------------------------------------------- settings

const st = {
  wrap: $('#settings'),
  modifier: $('#set-modifier'),
  autoSlot: $('#set-autoslot'),
  dedupe: $('#set-dedupe'),
  sort: $('#set-sort'),
  labels: $('#label-editor'),
  shortcuts: $('#shortcut-list')
};

async function openSettings() {
  st.modifier.value = data.settings.modifier;
  st.autoSlot.checked = data.settings.autoSlot;
  st.dedupe.checked = data.settings.dedupe;
  st.sort.value = data.settings.sort;
  st.labels.replaceChildren(...data.labels.map((l) => {
    const input = h('input', { value: l.name, maxlength: 24, 'aria-label': `Name for ${l.id}` });
    input.onchange = () => {
      const labels = data.labels.map((x) => (x.id === l.id ? { ...x, name: input.value.trim() || x.name } : x));
      saveLabels(labels);
    };
    return h('label', {}, h('span', { class: 'swatch', style: `--c:${l.color}` }), input);
  }));
  const order = (c) => (c.name === '_execute_action' ? -2 : c.name === 'capture-clipboard' ? -1 : SLOT_KEYS.indexOf(c.name.slice(-1)));
  const cmds = (await chrome.commands.getAll()).sort((a, b) => order(a) - order(b));
  const named = { _execute_action: 'Open the journal' };
  st.shortcuts.replaceChildren(...cmds.flatMap((c) => [
    h('span', {}, named[c.name] || c.description),
    h('span', { class: c.shortcut ? '' : 'unset' }, c.shortcut ? h('kbd', {}, c.shortcut) : 'not set')
  ]));
  st.wrap.hidden = false;
}

st.modifier.onchange = () => saveSettings({ modifier: st.modifier.value });
st.autoSlot.onchange = () => saveSettings({ autoSlot: st.autoSlot.checked });
st.dedupe.onchange = () => saveSettings({ dedupe: st.dedupe.checked });
st.sort.onchange = () => saveSettings({ sort: st.sort.value });
$('#open-shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
$('#settings-done').onclick = () => { st.wrap.hidden = true; };
st.wrap.addEventListener('mousedown', (e) => { if (e.target === st.wrap) st.wrap.hidden = true; });

$('#export').onclick = async () => {
  const blob = new Blob([JSON.stringify(await exportAll(), null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `clipjournal-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

$('#import').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const n = await importAll(JSON.parse(await file.text()));
    toast(`Imported ${n} ${n === 1 ? 'entry' : 'entries'}`);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not valid JSON' : err.message);
  }
};

$('#clear-all').onclick = async () => {
  const n = data.clips.length;
  const ok = await askConfirm({
    title: `Empty the whole journal?`,
    message: `All ${n} ${n === 1 ? 'entry' : 'entries'} and every quick slot will be deleted. This can't be undone — use Export first if you might want them back.`,
    confirmLabel: 'Delete everything'
  });
  if (!ok) return;
  await clearAll();
  st.wrap.hidden = true;
  toast('Journal emptied');
};

// ---------------------------------------------------------------- toolbar

$('#btn-write').onclick = () => openEditor();
$('#btn-settings').onclick = openSettings;

async function captureClipboard() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return toast('Could not read the clipboard');
  }
  if (!text.trim()) return toast('Clipboard has no text');
  const { clip, duplicate } = await addClip({ text });
  if (duplicate) return toast('Already the latest entry');
  await refresh();
  jumpTo(clip.id);
  toast('Clipboard added to journal');
}
$('#btn-capture').onclick = captureClipboard;

let searchTimer;
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filter.query = els.search.value;
    refresh(true);
  }, 120);
});

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select');
  const sheetOpen = !ed.wrap.hidden || !st.wrap.hidden;

  if (!confirmEl.wrap.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      confirmEl.settle?.(false);
    }
    return;
  }
  if (e.key === 'Escape') {
    if (!els.popover.hidden) return closePopover();
    if (!ed.wrap.hidden) return closeEditor();
    if (!st.wrap.hidden) return (st.wrap.hidden = true);
    if (els.search.value) {
      els.search.value = '';
      filter.query = '';
      e.preventDefault();
      return refresh(true);
    }
    return; // let Chrome close the popup
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !ed.wrap.hidden) {
    e.preventDefault();
    return ed.form.requestSubmit();
  }
  if (typing || sheetOpen || e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); turn(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn(-1); }
  else if (e.key === 'Home') flipTo(0);
  else if (e.key === 'End') flipTo(spreadCount() - 1);
  else if (e.key === '/') { e.preventDefault(); els.search.focus(); }
  else if (e.key === 'n') { e.preventDefault(); openEditor(); }
  else if (/^\d$/.test(e.key)) {
    const clip = clipById(data.slots[e.key]);
    if (!clip) return toast(`Quick slot ${e.key} is empty`);
    copy(clip.text).then((ok) => toast(ok ? `Slot ${e.key} copied` : 'Could not copy'));
  }
});

// ---------------------------------------------------------------- boot

let captureKey = '';
let tabStatus = null; // 'ok' | 'blocked' — can the slot hotkeys run in the tab behind the popup?

const TAB_STATUS_TEXT = {
  ok: 'Slot hotkeys are ready on this tab.',
  blocked: 'Hotkeys can’t run on this tab — try a regular website.'
};

async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  try {
    if ((await chrome.tabs.sendMessage(tab.id, { type: 'cj-ping' }, { frameId: 0 }))?.ok) return 'ok';
  } catch {}
  // Not there yet (e.g. the tab was open before install) — add it now.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/content.js'] });
    return 'ok';
  } catch {
    return 'blocked';
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (flipping) staleWhileFlipping = true;
  else refresh();
});

(async () => {
  const cmds = await chrome.commands.getAll();
  captureKey = cmds.find((c) => c.name === 'capture-clipboard')?.shortcut || '';
  await refresh();
  tabStatus = await checkActiveTab();
  if (tabStatus) renderSpread();
})();
