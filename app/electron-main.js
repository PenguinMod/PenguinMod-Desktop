// electron-main.js
const { app, BrowserWindow, ipcMain, protocol, net, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');

let mainWindow = null;
let isQuitting = false;

// path to preload script (make sure this file exists)
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

// Privileged schemes
protocol.registerSchemesAsPrivileged([
  { scheme: 'home', privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true, corsEnabled: true, stream: true } },
  { scheme: 'editor', privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true, corsEnabled: true, stream: true } }
]);

/**
 * Registers a protocol that serves files from a local folder
 * Works for both window navigation and fetch requests
 */
function registerStaticProtocol(scheme, rootDir) {
  protocol.registerBufferProtocol(scheme, (request, callback) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!pathname) pathname = 'index.html';

      if (pathname.includes('..')) return callback({ statusCode: 403, data: Buffer.from('Forbidden') });

      let filePath = path.join(rootDir, pathname);
      if (!fs.existsSync(filePath)) return callback({ statusCode: 404, data: Buffer.from('Not found') });
      if (fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        if (!fs.existsSync(filePath)) return callback({ statusCode: 404, data: Buffer.from('Not found') });
      }

      const data = fs.readFileSync(filePath);

      const mimeType = mime.lookup(filePath) || 'application/octet-stream';

      callback({ data, mimeType });
    } catch (err) {
      console.error(`[${scheme}] protocol error:`, err);
      callback({ statusCode: 500, data: Buffer.from('Internal error') });
    }
  });
}

/**
 * Adds a local offline handler for a domain or URL pattern.
 * @param {RegExp} urlPattern - Regex to match URLs.
 * @param {string} localFolder - Local folder where files are stored.
 */
function addLocalOfflineHandler(urlPattern, localFolder) {
  protocol.interceptBufferProtocol('https', (request, callback) => {
    const url = request.url;

    let filePath;
    if (/^https:\/\/extensions\.turbowarp\.org\/.*$/.test(url)) {
      const urlPath = new URL(url).pathname.replace(/^\/+/, '');
      filePath = path.join(__dirname, 'TurboWarp-ExtensionsGallery', urlPath);
    } else if (/^https:\/\/extensions\.penguinmod\.com\/$/.test(url)) {
      const urlPath = new URL(url).pathname.replace(/^\/+/, '');
      filePath = path.join(__dirname, 'PenguinMod-ExtensionsGallery', urlPath);
    } else if (/^https:\/\/(?:sharkpool-sp\.github\.io\/SharkPools-Extensions.*|sharkpools-extensions\.vercel\.app\/.*|raw\.githubusercontent\.com\/SharkPool-SP\/SharkPools-Extensions\/refs\/heads\/main\/.*)$/.test(url)) {
      const urlPath = new URL(url).pathname.replace(/^\/+/, '');
      filePath = path.join(__dirname, 'SharkPools-Extensions', urlPath);
    } else {
      return callback({ url }); // pass through everything else
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error('Failed to load local file:', filePath, err);
        return callback({ statusCode: 404, data: Buffer.from('Not found') });
      }

      let mimeType = 'text/plain';
      if (filePath.endsWith('.html')) mimeType = 'text/html';
      else if (filePath.endsWith('.js')) mimeType = 'application/javascript';
      else if (filePath.endsWith('.css')) mimeType = 'text/css';
      else if (filePath.endsWith('.json')) mimeType = 'application/json';
      else if (filePath.endsWith('.png')) mimeType = 'image/png';
      else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg';

      callback({ data, mimeType });
    });
  });
}

app.whenReady().then(() => {
  // Register both static protocols
  registerStaticProtocol('home', path.join(__dirname, 'public'));
  registerStaticProtocol('editor', path.join(__dirname, 'build'));
  addLocalOfflineHandler(/^https:\/\/extensions\.turbowarp\.org\/.*$/, path.join(__dirname, 'TurboWarp-ExtensionsGallery'));
  addLocalOfflineHandler(/^https:\/\/extensions\.penguinmod\.com\/$/, path.join(__dirname, 'PenguinMod-ExtensionsGallery'));
  addLocalOfflineHandler(/^https:\/\/(?:sharkpool-sp\.github\.io\/SharkPools-Extensions.*|sharkpools-extensions\.vercel\.app\/.*|raw\.githubusercontent\.com\/SharkPool-SP\/SharkPools-Extensions\/refs\/heads\/main\/.*)$/, path.join(__dirname, 'SharkPools-Extensions'))
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    // Allows sending cookies for iframe origins
    callback({ requestHeaders: details.requestHeaders });
  });
  // Create main window
  createWindow('home://index.html');
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
      nodeIntegration: false,
      contextIsolation: true,
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

  mainWindow.webContents.on("did-finish-load", () => {
    const url = mainWindow.webContents.getURL();
    //console.log(url, url === "home://index.html/");
    if (url === "home://index.html/") mainWindow.webContents.executeJavaScript(`for (const a of document.querySelectorAll('a[href="https://studio.penguinmod.com/editor.html"]')) { a.href = "editor://editor.html"; a.target = "_self"; }`)
  })

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

  ipcMain.on('electron-prompt-sync', (event, { message, defaultValue }) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    let result = null;

    const promptWindow = new BrowserWindow({
      width: 400,
      height: 150,
      parent,
      modal: true,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#ffffff',
      resizable: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    const escapeHtml = s =>
      String(s ?? '').replace(/[&<>"'`]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])
      );

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">

    <style>

    html, body {
      margin: 0;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: transparent;
    }

    .wrapper {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 14px;
      box-sizing: border-box;
    }

    .dialog {
      width: 100%;
      background: white;
      border-radius: 12px;
      padding: 18px;
      box-sizing: border-box;
    }

    .message {
      font-size: 14px;
      margin-bottom: 14px;
      line-height: 1.45;
      max-height: 90px;
      overflow: auto;
    }

    /* scrollbar only visible when needed */
    .message::-webkit-scrollbar {
      width: 8px;
    }

    .message::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.2);
      border-radius: 4px;
    }

    input {
      width: 100%;
      padding: 8px 10px;
      font-size: 14px;
      border-radius: 6px;
      border: 1px solid #ccc;
      margin-bottom: 18px;
      box-sizing: border-box;
    }

    input:focus {
      outline: none;
      border-color: #007aff;
      box-shadow: 0 0 0 2px rgba(0,122,255,0.25);
    }

    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    button {
      font-size: 13px;
      padding: 6px 14px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
    }

    #cancel {
    background: #f1f1f1;
    }

    #cancel:hover {
    background: #e4e4e4;
    }

    #ok {
    background: #007aff;
    color: white;
    }

    #ok:hover {
    background: #0062cc;
    }

    </style>
    </head>

    <body>

    <div class="wrapper">
    <div class="dialog">

    <div class="message">${escapeHtml(message)}</div>

    <input id="input" value="${escapeHtml(defaultValue)}">

    <div class="buttons">
    <button id="cancel">Cancel</button>
    <button id="ok">OK</button>
    </div>

    </div>
    </div>

    <script>
    const { ipcRenderer } = require('electron');

    const input = document.getElementById('input');
    const ok = document.getElementById('ok');
    const cancel = document.getElementById('cancel');

    ok.onclick = () => ipcRenderer.send('electron-prompt-done-sync', input.value);
    cancel.onclick = () => ipcRenderer.send('electron-prompt-done-sync', null);

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') ok.click();
      if (e.key === 'Escape') cancel.click();
    });

      input.focus();
      input.select();
      </script>

      </body>
      </html>
      `;

    ipcMain.once('electron-prompt-done-sync', (ev, val) => {
      result = val;
      try { promptWindow.destroy(); } catch { }
      event.returnValue = result;
    });

    promptWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    promptWindow.once('ready-to-show', () => promptWindow.show());
  });

  //
  // Handle pages that try to prevent unload (beforeunload)
  // We do NOT automatically call event.preventDefault() here because
  // you said you want the user to decide — the preload will route
  // confirm/prompt/alert into main dialogs so the user still sees UI.
  //
  let isUnloadDialogOpen = false;

  mainWindow.webContents.on('will-prevent-unload', (event) => {
    if (isUnloadDialogOpen) {
      console.log('[main] will-prevent-unload fired, but dialog already open — skipping');
      return;
    }

    isUnloadDialogOpen = true;

    const { dialog } = require('electron');
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Leave', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'The page is trying to prevent unload. Do you want to leave?',
      detail: 'Any unsaved changes may be lost.'
    });

    isUnloadDialogOpen = false;

    if (choice === 0) {
      // allow unload
      event.preventDefault();
    }
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
            createWindow('index.html');
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
      try { mainWindow.destroy(); } catch (_) { }
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
        createWindow("home://index.html");
      }
    }, 1500);
  });

  // Normal close lifecycle
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load URL
  console.log('[main] loading', startFile);
  mainWindow.loadURL(startFile, {userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}).catch(err => {
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
    createWindow('home://index.html');
    return;
  }

  try {
    console.log('[main] safe reload requested');
    wc.reloadIgnoringCache();
  } catch (e) {
    console.error('[main] reload failed:', e);
    try { mainWindow.loadURL(`home://index.html`, {userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}); } catch (e2) { console.error(e2); }
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
