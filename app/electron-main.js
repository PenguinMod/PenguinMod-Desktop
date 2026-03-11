// electron-main.js
const { app, BrowserWindow, ipcMain, protocol, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let isQuitting = false;

// path to preload script (make sure this file exists)
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

// Register app:// protocol
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      allowServiceWorkers: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);

      // pathname can be "/" or "/index.html"
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/' || pathname === '') {
        pathname = '/index.html';
      }

      // strip leading slash
      const relativePath = pathname.replace(/^\/+/, '');
      const filePath = path.join(__dirname, relativePath);

      if (!fs.existsSync(filePath)) {
        console.error('[app://] file not found:', filePath);
        return new Response('Not found', { status: 404 });
      }

      // net.fetch needs a valid file:// URL
      const fileUrl = `file://${filePath}`;
      return net.fetch(fileUrl);
    } catch (err) {
      console.error('[app://] handler error:', err);
      return new Response('Protocol error', { status: 500 });
    }
  });

  createWindow(process.argv[2] || 'index.html');
});

// Create main window
function createWindow(startFile) {
  // Clean up previous window if any
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.removeAllListeners();
      mainWindow.destroy();
    } catch (e) {
      console.error('[main] destroy previous window failed', e);
    }
    mainWindow = null;
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      // keep your original compatibility flags
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      // ensure the preload we provide runs before page scripts
      preload: PRELOAD_PATH
    }
  });

  // Console messages from renderer
  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    const prefix = `[renderer:${sourceId}:${line}]`;
    if (level >= 2) console.error(prefix, message);
    else console.log(prefix, message);
  });

  //
  // ROUTE JS DIALOGS: ipc handlers for alert/confirm/prompt
  //
  // These are synchronous handlers because the preload uses sendSync so
  // renderer code that expects immediate results still works.
  //
  ipcMain.on('electron-alert', (event, message, opts = {}) => {
    // showMessageBoxSync is blocking on the main thread until user responds
    try {
      dialog.showMessageBoxSync(mainWindow, {
        type: opts.type || 'info',
        buttons: ['OK'],
        defaultId: 0,
        message: String(message ?? ''),
        detail: opts.detail || undefined,
        noLink: true
      });
    } catch (e) {
      console.error('[main] electron-alert dialog failed', e);
    }
    // no return value needed for alert
    event.returnValue = null;
  });

  ipcMain.on('electron-confirm', (event, message, opts = {}) => {
    try {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: opts.type || 'question',
        buttons: opts.buttons || ['OK', 'Cancel'],
        defaultId: (opts.defaultId === 1) ? 1 : 0,
        cancelId: (opts.cancelId === 1) ? 1 : 1,
        message: String(message ?? ''),
        detail: opts.detail || undefined,
        noLink: true
      });
      // return true if first button chosen
      event.returnValue = (choice === 0);
    } catch (e) {
      console.error('[main] electron-confirm dialog failed', e);
      event.returnValue = false;
    }
  });

  // Best-effort prompt (synchronous fallback)
  ipcMain.on('electron-prompt', (event, { message, defaultValue = '', opts = {} }) => {
    try {
      // NOTE: Electron does not expose a native synchronous text-input dialog.
      // As a pragmatic fallback we show a MessageBoxSync that returns whether
      // the user accepts; if they accept, we return the defaultValue (not a typed value).
      // If typed input is required you should allow async prompt flows and we can
      // implement a modal BrowserWindow for input (async). See comments below.
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: opts.type || 'question',
        buttons: ['OK', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: String(message ?? ''),
        detail: (opts.detail ? opts.detail + '\n\n' : '') + `Default: ${String(defaultValue)}`,
        noLink: true
      });

      if (choice === 0) {
        event.returnValue = String(defaultValue);
      } else {
        event.returnValue = null;
      }
    } catch (e) {
      console.error('[main] electron-prompt dialog failed', e);
      event.returnValue = null;
    }
  });

  //
  // Handle pages that try to prevent unload (beforeunload)
  // We do NOT automatically call event.preventDefault() here because
  // you said you want the user to decide — the preload will route
  // confirm/prompt/alert into main dialogs so the user still sees UI.
  //
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    console.log('[main] will-prevent-unload fired — renderer attempted to block unload');
    // Let the renderer show its prompt (we've already overridden it via preload),
    // so don't force unload here. If you want to force in some cases, add conditional logic.
    // (If the renderer is unresponsive or crashed, we handle that elsewhere.)
  });

  // Renderer crashed / gone
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[main] render-process-gone:', details);
    try {
      if (!mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        console.log('[main] attempting to reload after render-process-gone');
        mainWindow.webContents.reloadIgnoringCache();
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.getURL() === '') {
            console.log('[main] reload did not recover — recreating window');
            createWindow(process.argv[2] || 'index.html');
          }
        }, 1000);
      } else {
        console.log('[main] webContents destroyed — recreating window');
        createWindow(process.argv[2] || 'index.html');
      }
    } catch (err) {
      console.error('[main] error handling render-process-gone:', err);
      try { createWindow(process.argv[2] || 'index.html'); } catch (e) { console.error(e); }
    }
  });

  // Older crash event
  mainWindow.webContents.on('crashed', () => {
    console.error('[main] renderer crashed event');
    try {
      mainWindow.reload();
    } catch (e) {
      console.error('[main] reload failed after crash, destroying and recreating', e);
      try { mainWindow.destroy(); } catch (_) {}
      createWindow(process.argv[2] || 'index.html');
    }
  });

  // Unresponsive handler
  mainWindow.on('unresponsive', () => {
    console.warn('[main] window unresponsive — will attempt reload, then recreate');
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    } catch (e) {
      console.error('[main] reload failed while unresponsive:', e);
    }
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.warn('[main] still unresponsive — destroying and recreating window');
        try { mainWindow.destroy(); } catch (e) { console.error(e); }
        createWindow(process.argv[2] || 'index.html');
      }
    }, 1500);
  });

  // Normal close lifecycle
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load URL
  const startUrl = `app:///${startFile}`;
  console.log('[main] loading', startUrl);
  mainWindow.loadURL(startUrl).catch(err => {
    console.error('[main] loadURL failed:', err);
  });
}

// IPC reload (keeps previous guard logic)
ipcMain.on('renderer-request-reload', () => {
  if (isQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const wc = mainWindow.webContents;
  if (!wc || wc.isDestroyed()) {
    console.warn('[main] requested reload but webContents is destroyed — recreating window');
    createWindow(process.argv[2] || 'index.html');
    return;
  }

  try {
    console.log('[main] safe reload requested');
    wc.reloadIgnoringCache();
  } catch (e) {
    console.error('[main] reload failed:', e);
    try { mainWindow.loadURL(`app:///${process.argv[2] || 'index.html'}`); } catch (e2) { console.error(e2); }
  }
});

// Quit handlers
app.on('before-quit', () => {
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

// Global exception handlers
process.on('uncaughtException', err => {
  console.error('[main] uncaughtException:', err);
});

process.on('unhandledRejection', reason => {
  console.error('[main] unhandledRejection:', reason);
});
