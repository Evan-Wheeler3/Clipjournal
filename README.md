# ClipJournal

A Chrome extension that keeps your clipboard in a leather-bound journal. Save what you copy with one shortcut, flip through it page by page, and paste any of 10 quick slots into the page you're on with a hotkey.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
3. Pin ClipJournal from the puzzle-piece menu so the journal drops down from the toolbar.

## Shortcuts

| Action | Default |
| --- | --- |
| Save the clipboard to the journal | `Alt+Shift+S` |
| Open the journal | `Alt+Shift+J` |
| Paste quick slot 1…9, 0 into the focused field | `Alt+Shift+1` … `Alt+Shift+0` |

- Slot hotkeys work on regular web pages. You can change the modifier in **Settings** (Alt+Shift, Ctrl+Shift, Ctrl+Alt, Alt, or off).
- To change the save/open keys, or to bind slots so they also work outside web pages, go to `chrome://extensions/shortcuts`. Settings has a button that opens it.
- If no text field has focus, the slot is copied to your clipboard instead.
- Right-click menu: **Save selection to ClipJournal**, and **Paste from ClipJournal → slot** in any text field.

### If the slot hotkeys don't work

- Open the journal on the tab you're using. The bottom of the Quick Slots page says whether hotkeys are ready on that tab. Opening the journal also switches them on for tabs that were open before ClipJournal was installed.
- They can't run on Chrome's own pages (new tab, settings, `chrome://…`), the Chrome Web Store or the built-in PDF viewer. For those, bind slots on `chrome://extensions/shortcuts`.
- Make sure the slot isn't empty. You'll see "Quick slot N is empty" if it is.
- On Windows, `Alt+Shift` can also switch the keyboard language if you have more than one installed. If that gets in the way, change the modifier in Settings.

## The journal

- The left page of the first spread is the **Quick Slots** index. Click a slot to jump to its entry, or × to empty the slot.
- Entries fill the following pages. Each one gets a colored edge and an optional **bold title**, and shows its slot number, tags, date and source site.
- **Click** an entry to copy it. **Double-click** it, or use the pencil on hover, to edit. The hover bar also lets you copy, assign a slot, pin, edit or tear out.
- Anything that deletes (tearing out an entry, emptying a slot, emptying the journal) asks you to confirm first. Cancel is the default button, so pressing Enter or Esc is safe. A torn-out entry can still be brought back with **Undo** for a few seconds.
- Flip pages with `←` `→`, the mouse wheel, or the page corners. `Home`/`End` jump to the first or last spread.
- In the journal: `/` searches, `n` writes a new entry, `1`…`0` copies a slot, `Esc` clears search or closes a dialog.
- Use the pen button to write entries by hand: title, text, color, tags, slot and pin.

### Organizing

- **Color labels:** 7 colors. Rename them in Settings (e.g. Oxblood → "Work"). Click the dots in the top bar to filter; you can pick more than one.
- **Tags:** comma-separated. Click a tag to filter, or search `#tag`.
- **Pin** keeps an entry at the front. The pin button in the top bar shows pinned entries only.
- **Search** matches titles, text, tags, label names and source sites.
- **Order:** newest, oldest or title A–Z (Settings).
- **Export / Import** as JSON. Importing merges into what you already have.

## Files

```
manifest.json
src/background.js      shortcuts, context menus, clipboard capture
src/offscreen.*        clipboard bridge for the service worker
src/content.js         in-page slot hotkeys, pasting, toasts
src/lib/store.js       storage (chrome.storage.local)
src/popup/             the journal UI
icons/                 icon.svg + PNGs (regenerate: node scripts/make-icons.js)
```

Everything is stored locally in your browser (`chrome.storage.local`). Nothing leaves your machine.
