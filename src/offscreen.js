// Clipboard bridge for the service worker. execCommand works here because the
// extension holds the clipboardRead / clipboardWrite permissions.
const buffer = document.getElementById('buffer');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'read-clipboard') {
    buffer.value = '';
    buffer.focus();
    document.execCommand('paste');
    sendResponse(buffer.value);
  } else if (msg.type === 'write-clipboard') {
    buffer.value = msg.text;
    buffer.select();
    document.execCommand('copy');
    sendResponse(true);
  }
});
