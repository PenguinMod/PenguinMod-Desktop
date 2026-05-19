// preload.js
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Helper for synchronous IPC communications
function sendSync(channel, payload) {
  try {
    return ipcRenderer.sendSync(channel, payload);
  } catch (err) {
    console.error('[preload] sync ipc failed', channel, err);
    return null;
  }
}

// Expose secure hooks to the isolated Main World context
contextBridge.exposeInMainWorld('__electronDialogBridge', {
  alert: (msg) => sendSync('electron-alert', String(msg ?? '')),
  confirm: (msg) => !!sendSync('electron-confirm', String(msg ?? '')),
  prompt: (message, defaultValue) => sendSync('electron-prompt-sync', { message, defaultValue })
});

// Overwrite the webpage's native alert/confirm/prompt globals 
webFrame.executeJavaScript(`
  (function installDialogOverrides() {
    window.alert = (msg) => window.__electronDialogBridge.alert(msg);
    window.confirm = (msg) => window.__electronDialogBridge.confirm(msg);
    window.prompt = (message = '', defaultValue = '') => {
      return window.__electronDialogBridge.prompt(message, defaultValue);
    };
  })();
`);
