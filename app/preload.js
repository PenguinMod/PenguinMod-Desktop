// preload.js
// Must be placed at the PRELOAD_PATH referenced by main (preload runs before page scripts)

const { ipcRenderer } = require('electron');

(function installDialogOverrides() {
  // Helper: sync send to main and return value
  function sendSync(channel, payload) {
    try {
      return ipcRenderer.sendSync(channel, payload);
    } catch (err) {
      console.error('[preload] sync ipc failed', channel, err);
      return null;
    }
  }

  // Replace global alert/confirm/prompt
  try {
    // alert: shows a native dialog and returns undefined
    window.alert = function (msg) {
      sendSync('electron-alert', String(msg ?? ''));
    };

    // confirm: returns boolean
    window.confirm = function (msg) {
      const res = sendSync('electron-confirm', String(msg ?? ''));
      // safety: ensure boolean
      return !!res;
    };

    // prompt: synchronous fallback that returns the default value if user accepts,
    // or null if cancelled. (See main for limitations.)
    window.prompt = function (msg, defaultValue = '') {
      const res = sendSync('electron-prompt', { message: String(msg ?? ''), defaultValue: String(defaultValue) });
      // if main returned string, return it; otherwise null
      return (typeof res === 'string') ? res : null;
    };

    // Optionally expose a non-blocking async prompt if you want to use it explicitly:
    // ipcRenderer.invoke('electron-prompt-async', { message, defaultValue }).then(...)
  } catch (e) {
    console.error('[preload] failed to install dialog overrides', e);
  }
})();
