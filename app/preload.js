// preload.js
const { ipcRenderer } = require('electron');

(function installDialogOverrides() {
  function sendSync(channel, payload) {
    try {
      return ipcRenderer.sendSync(channel, payload);
    } catch (err) {
      console.error('[preload] sync ipc failed', channel, err);
      return null;
    }
  }

  window.alert = msg => sendSync('electron-alert', String(msg ?? ''));
  window.confirm = msg => !!sendSync('electron-confirm', String(msg ?? ''));

  window.prompt = (message = '', defaultValue = '') => {
    // synchronous IPC — main will block until prompt closes
    return sendSync('electron-prompt-sync', { message, defaultValue });
  };
})();
