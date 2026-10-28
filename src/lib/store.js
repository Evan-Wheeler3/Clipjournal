// Shared data layer for the popup and the service worker.
// Everything lives in chrome.storage.local:
//   clips    – array of entries, newest first
//   slots    – { "1": clipId | null, …, "0": clipId | null }
//   labels   – color labels with user-editable names
//   settings – user preferences

export const SLOT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export const DEFAULT_LABELS = [
  { id: 'oxblood', name: 'Oxblood', color: '#8e3131' },
  { id: 'ochre', name: 'Ochre', color: '#b97a1c' },
  { id: 'moss', name: 'Moss', color: '#5d7838' },
  { id: 'teal', name: 'Teal', color: '#2a7576' },
  { id: 'ink', name: 'Ink', color: '#2f4f80' },
  { id: 'plum', name: 'Plum', color: '#6c3f78' },
  { id: 'graphite', name: 'Graphite', color: '#5a5a5a' }
];

export const DEFAULT_SETTINGS = {
  modifier: 'alt+shift', // in-page hotkey modifier for quick slots
  autoSlot: false, // put new captures in the next empty quick slot
  dedupe: true, // skip a capture identical to the newest entry
  sort: 'newest' // newest | oldest | title
};

const emptySlots = () => Object.fromEntries(SLOT_KEYS.map((k) => [k, null]));

export async function load() {
  const data = await chrome.storage.local.get(['clips', 'slots', 'labels', 'settings']);
  return {
    clips: data.clips || [],
    slots: { ...emptySlots(), ...(data.slots || {}) },
    labels: mergeLabels(data.labels),
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
  };
}

function mergeLabels(saved) {
  if (!Array.isArray(saved)) return DEFAULT_LABELS.map((l) => ({ ...l }));
  return DEFAULT_LABELS.map((l) => ({ ...l, ...(saved.find((s) => s.id === l.id) || {}) }));
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const cleanTags = (tags) =>
  [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(','))
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean))];

/**
 * Adds an entry. Returns { clip, duplicate } — duplicate is true when skipped.
 * opts.manual: written by hand in the journal, so skip dedupe and auto-slotting.
 */
export async function addClip({ text, title = '', label = null, tags = [], pinned = false, slot = null, source = null }, opts = {}) {
  text = String(text ?? '');
  if (!text.trim()) throw new Error('Nothing to save — the text is empty.');
  const { clips, slots, settings } = await load();

  if (!opts.manual && settings.dedupe && clips[0] && clips[0].text === text) {
    return { clip: clips[0], duplicate: true };
  }

  const now = Date.now();
  const clip = { id: uid(), title: title.trim(), text, label, tags: cleanTags(tags), pinned, source, createdAt: now, updatedAt: now };
  clips.unshift(clip);

  if (slot === null && !opts.manual && settings.autoSlot) slot = SLOT_KEYS.find((k) => !slots[k]) ?? null;
  if (slot !== null) placeInSlot(slots, slot, clip.id);

  await chrome.storage.local.set({ clips, slots });
  return { clip, duplicate: false };
}

export async function updateClip(id, patch) {
  const { clips } = await load();
  const clip = clips.find((c) => c.id === id);
  if (!clip) return null;
  if ('tags' in patch) patch = { ...patch, tags: cleanTags(patch.tags) };
  if ('title' in patch) patch = { ...patch, title: String(patch.title || '').trim() };
  Object.assign(clip, patch, { updatedAt: Date.now() });
  await chrome.storage.local.set({ clips });
  return clip;
}

export async function deleteClip(id) {
  const { clips, slots } = await load();
  for (const k of SLOT_KEYS) if (slots[k] === id) slots[k] = null;
  await chrome.storage.local.set({ clips: clips.filter((c) => c.id !== id), slots });
}

/** Puts a deleted entry back where it was (undo). */
export async function restoreClip(clip, index, slotKey) {
  const { clips, slots } = await load();
  if (clips.some((c) => c.id === clip.id)) return;
  clips.splice(Math.min(index, clips.length), 0, clip);
  if (slotKey && !slots[slotKey]) slots[slotKey] = clip.id;
  await chrome.storage.local.set({ clips, slots });
}

/** A clip occupies at most one slot; assigning moves it. Pass null to clear the slot. */
export async function assignSlot(key, clipId) {
  const { slots } = await load();
  placeInSlot(slots, key, clipId);
  await chrome.storage.local.set({ slots });
}

function placeInSlot(slots, key, clipId) {
  if (clipId) for (const k of SLOT_KEYS) if (slots[k] === clipId) slots[k] = null;
  slots[key] = clipId;
}

export async function getSlotClip(key) {
  const { clips, slots } = await load();
  return clips.find((c) => c.id === slots[key]) || null;
}

export async function saveSettings(patch) {
  const { settings } = await load();
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
}

export async function saveLabels(labels) {
  await chrome.storage.local.set({ labels });
}

export async function exportAll() {
  return { app: 'ClipJournal', version: 1, exportedAt: new Date().toISOString(), ...(await load()) };
}

/** Merges an export into the journal. Existing ids are kept; slots only fill empty ones. */
export async function importAll(data) {
  if (!data || !Array.isArray(data.clips)) throw new Error('That file is not a ClipJournal export.');
  const current = await load();
  const known = new Set(current.clips.map((c) => c.id));
  const incoming = data.clips
    .filter((c) => c && typeof c.text === 'string' && !known.has(c.id))
    .map((c) => ({ ...c, id: c.id || uid(), tags: cleanTags(c.tags) }));
  const clips = [...current.clips, ...incoming].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const ids = new Set(clips.map((c) => c.id));
  const slots = { ...current.slots };
  for (const k of SLOT_KEYS) if (!slots[k] && data.slots?.[k] && ids.has(data.slots[k])) slots[k] = data.slots[k];
  const labels = Array.isArray(data.labels) ? mergeLabels(data.labels) : current.labels;
  await chrome.storage.local.set({ clips, slots, labels });
  return incoming.length;
}

export async function clearAll() {
  await chrome.storage.local.set({ clips: [], slots: emptySlots() });
}
