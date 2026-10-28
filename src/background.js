import { SLOT_KEYS, load, addClip, getSlotClip } from './lib/store.js';

// ---------- clipboard access (service workers have no DOM, so use an offscreen page) ----------

const OFFSCREEN_URL = 'src/offscreen.html';
let creatingOffscreen = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  if (existing.length) return;
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['CLIPBOARD'],
    justification: 'Read copied text into the journal and copy saved entries back out.'
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function offscreen(type, text) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', type, text });
}

const readClipboard = () => offscreen('read-clipboard');
const writeClipboard = (text) => offscreen('write-clipboard', text);

// ---------- feedback ----------

let badgeTimer;
function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1800);
}

async function toast(tabId, message, color) {
  if (tabId == null) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'cj-toast', message, color }, { frameId: 0 });
  } catch {
    // No content script on this page (chrome:// pages, the Web Store…). The badge is enough.
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

const sourceOf = (tab) => (tab?.url && /^https?:/.test(tab.url) ? { url: tab.url, title: tab.title || '' } : null);

// ---------- actions ----------

async function saveText(text, tab, how) {
  if (!text || !text.trim()) {
    flashBadge('∅', '#7a5a3a');
    return toast(tab?.id, how === 'clipboard' ? 'Clipboard has no text to save' : 'Nothing selected');
  }
  try {
    const { clip, duplicate } = await addClip({ text, source: sourceOf(tab) });
    if (duplicate) {
      flashBadge('=', '#7a5a3a');
      return toast(tab?.id, 'Already the latest entry in your journal');
    }
    const { slots } = await load();
    const slot = SLOT_KEYS.find((k) => slots[k] === clip.id);
    flashBadge('+', '#3f6b35');
    toast(tab?.id, slot ? `Saved to journal · slot ${slot}` : 'Saved to journal');
  } catch (err) {
    flashBadge('!', '#8e3131');
    toast(tab?.id, err.message);
  }
}

// info.selectionText collapses line breaks, so ask the frame for the real selection first.
async function saveSelection(info, tab) {
  let text = info.selectionText;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'cj-selection' }, { frameId: info.frameId ?? 0 });
    if (res?.text?.trim()) text = res.text;
  } catch {}
  await saveText(text, tab, 'selection');
}

async function captureClipboard() {
  const tab = await activeTab();
  let text = '';
  try {
    text = await readClipboard();
  } catch (err) {
    console.error('ClipJournal: clipboard read failed', err);
  }
  await saveText(text, tab, 'clipboard');
}

async function pasteSlot(key, tabId, frameId) {
  const clip = await getSlotClip(key);
  const tab = tabId == null ? await activeTab() : { id: tabId };
  if (!clip) {
    flashBadge(key, '#7a5a3a');
    return toast(tab?.id, `Quick slot ${key} is empty`);
  }
  let handled = false;
  try {
    const opts = frameId == null ? {} : { frameId };
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'cj-paste', text: clip.text, slot: key, force: frameId != null }, opts);
    handled = !!res?.handled;
  } catch {
    // Page without our content script — fall back to the clipboard below.
  }
  if (!handled) {
    await writeClipboard(clip.text);
    flashBadge(key, '#2f4f80');
    toast(tab?.id, `Slot ${key} copied — paste with Ctrl/⌘+V`);
  }
}

// ---------- context menus ----------

const slotMenuTitle = (key, clip) => {
  if (!clip) return `${key}   —  empty`;
  const name = clip.title || clip.text.replace(/\s+/g, ' ').trim();
  return `${key}   ${name.length > 48 ? name.slice(0, 47) + '…' : name}`;
};

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'save-selection', title: 'Save selection to ClipJournal', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'paste-root', title: 'Paste from ClipJournal', contexts: ['editable'] });
  const { clips, slots } = await load();
  for (const key of SLOT_KEYS) {
    const clip = clips.find((c) => c.id === slots[key]);
    chrome.contextMenus.create({
      id: `paste-slot-${key}`,
      parentId: 'paste-root',
      title: slotMenuTitle(key, clip),
      enabled: !!clip,
      contexts: ['editable']
    });
  }
}

async function refreshSlotMenus() {
  const { clips, slots } = await load();
  for (const key of SLOT_KEYS) {
    const clip = clips.find((c) => c.id === slots[key]);
    chrome.contextMenus.update(`paste-slot-${key}`, { title: slotMenuTitle(key, clip), enabled: !!clip }, () => void chrome.runtime.lastError);
  }
}

// ---------- wiring ----------

// Declared content scripts only reach pages loaded after install, so add the
// hotkey script to tabs that were already open (also replaces stale copies
// left behind when the extension is reloaded or updated).
async function injectIntoOpenTabs() {
  // Filtering by URL would need the "tabs" permission; pages we can't script just fail.
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/content.js'] }).catch(() => {})
  ));
}

chrome.runtime.onInstalled.addListener(() => {
  buildMenus();
  injectIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(buildMenus);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.slots || changes.clips)) refreshSlotMenus();
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'capture-clipboard') return captureClipboard();
  const m = command.match(/^paste-slot-(\d)$/);
  if (m) pasteSlot(m[1], tab?.id);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-selection') return saveSelection(info, tab);
  const m = String(info.menuItemId).match(/^paste-slot-(\d)$/);
  if (m) pasteSlot(m[1], tab?.id, info.frameId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'cj-capture') {
    captureClipboard().then(() => sendResponse({ ok: true }));
    return true;
  }
});
