// electron-main.js
const { app, BrowserWindow, ipcMain, dialog, session, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');

// 1. REGISTER PRIVILEGED SCHEMES (Must happen BEFORE app.whenReady)
protocol.registerSchemesAsPrivileged([
  { scheme: 'home', privileges: { standard: true, secure: true, allowServiceWorkers: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'editor', privileges: { standard: true, secure: true, allowServiceWorkers: true, supportFetchAPI: true, corsEnabled: true } }
]);

let mainWindow = null;
let isQuitting = false;

const PRELOAD_PATH = path.join(__dirname, 'preload.js');

const folders = {
  home: path.join(__dirname, 'public'),
  editor: path.join(__dirname, 'build'),
  turbowarp: path.join(__dirname, 'TurboWarp-ExtensionsGallery'),
  penguinmod: path.join(__dirname, 'PenguinMod-ExtensionsGallery'),
  sharkpools: path.join(__dirname, 'SharkPools-Extensions')
};

// Map URLs to local folders for offline serving
function getLocalFile(url) {
  const parsed = new URL(url);

  if (/^https:\/\/extensions\.turbowarp\.org\/.*$/.test(url)) {
    return path.join(folders.turbowarp, parsed.pathname.replace(/^\/+/, ''));
  }
  if (/^https:\/\/extensions\.penguinmod\.com\/$/.test(url)) {
    return path.join(folders.penguinmod, parsed.pathname.replace(/^\/+/, ''));
  }
  if (/^https:\/\/sharkpool-sp\.github\.io\/SharkPools-Extensions.*$/.test(url)) {
    const localPath = parsed.pathname.replace(/^\/SharkPools-Extensions\/?/, '');
    return path.join(folders.sharkpools, localPath);
  }
  if (/^https:\/\/sharkpools-extensions\.vercel\.app\/.*$/.test(url)) {
    return path.join(folders.sharkpools, parsed.pathname.replace(/^\/+/, ''));
  }
  if (/^https:\/\/raw\.githubusercontent\.com\/SharkPool-SP\/SharkPools-Extensions\/refs\/heads\/main\/.*$/.test(url)) {
    return path.join(folders.sharkpools, parsed.pathname.replace(/^\/SharkPools-Extensions\/refs\/heads\/main\/?/, ''));
  }

  return null;
}

// Helper to natively handle custom protocol directory serving
function setupCustomProtocol(scheme, baseDir, defaultFile = 'index.html') {
  protocol.handle(scheme, async (request) => {
    try {
      const url = new URL(request.url);

      // Support both scheme://- and scheme:// filenames seamlessly
      let combinedPath = url.host && url.host !== '-' ? path.join(url.host, url.pathname) : url.pathname;
      combinedPath = combinedPath.replace(/^\/+/, '');

      // Default to root file if path is empty
      if (!combinedPath) {
        combinedPath = defaultFile;
      }

      let filePath = path.join(baseDir, combinedPath);
      const ext = path.extname(combinedPath);
      const isAsset = ext && ext !== '.html';

      // Smart SPA Routing: If a file doesn't exist, only fall back to HTML if it isn't a broken JS/CSS asset
      if (!fs.existsSync(filePath)) {
        if (!isAsset) {
          filePath = path.join(baseDir, defaultFile);
        } else {
          return new Response('Not Found', { status: 404 });
        }
      }

      return net.fetch('file://' + filePath);
    } catch (err) {
      console.error(`[protocol:${scheme}] Failed to serve:`, err);
      return new Response('Internal Server Error', { status: 500 });
    }
  });
}

// App ready
app.whenReady().then(() => {
  // Set up native custom protocols
  setupCustomProtocol('home', folders.home, 'index.html');
  setupCustomProtocol('editor', folders.editor, 'editor.html');

  // Intercept https requests for offline/local overrides
  protocol.handle('https', (request) => {
    const filePath = getLocalFile(request.url);
    if (filePath) {
      return net.fetch('file://' + filePath);
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });

  // Fix X-Frame-Options headers
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders;
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    callback({ responseHeaders: headers });
  });

  // Modify headers for YouTube Embeds & Cookies
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders, url } = details;

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.host === "www.youtube.com" || parsedUrl.host === "www.youtube-nocookie.com") {
        requestHeaders['Origin'] = 'https://penguinmod.com';
        requestHeaders['Referer'] = 'https://penguinmod.com/';
      }
    } catch (_) {}

    callback({ requestHeaders });
  });

  createWindow();
});

// Create main window
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.destroy(); } catch {}
    mainWindow = null;
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true, // Ensured protection tier activation
      sandbox: false,
      preload: PRELOAD_PATH,
      webSecurity: false
    }
  });

  // Load the home protocol directly
  mainWindow.loadURL('home://-');

  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    const prefix = `[renderer:${sourceId}:${line}]`;
    if (level >= 2) console.error(prefix, message);
    else console.log(prefix, message);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const url = mainWindow.webContents.getURL();
    if (url.startsWith("home://")) {
      mainWindow.webContents.executeJavaScript(`
        const observer = new MutationObserver(() => {
          for (const a of document.querySelectorAll('a[href="https://studio.penguinmod.com/editor.html"]')) {
            a.href = "editor://-";
            a.target = "_self";
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        for (const a of document.querySelectorAll('a[href="https://studio.penguinmod.com/editor.html"]')) {
          a.href = "editor://-";
          a.target = "_self";
        }
      `);
    }
  });

  setupDialogs();

  mainWindow.on('closed', () => mainWindow = null);

  mainWindow.webContents.on('render-process-gone', () => createWindow());
  mainWindow.webContents.on('crashed', () => createWindow());
  mainWindow.on('unresponsive', () => {
    try { mainWindow.webContents.reloadIgnoringCache(); } catch {}
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) return;
      try { mainWindow.destroy(); } catch {}
      createWindow();
    }, 1500);
  });
}

// IPC reload
ipcMain.on('renderer-request-reload', () => {
  if (isQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.reloadIgnoringCache(); } catch (_) {}
});

app.on('before-quit', () => {
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
});

app.on('window-all-closed', () => app.quit());

process.on('uncaughtException', err => console.error('[main] uncaughtException:', err));
process.on('unhandledRejection', reason => console.error('[main] unhandledRejection:', reason));

function setupDialogs() {
  ipcMain.on('electron-alert', (event, message, opts = {}) => {
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
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    const escapeHtml = s => String(s ?? '').replace(/[&<>"'`]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])
    );

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><style>
    html, body { margin:0; height:100%; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: transparent; }
    .wrapper { height:100%; display:flex; align-items:center; justify-content:center; padding:14px; box-sizing:border-box; }
    .dialog { width:100%; background:white; border-radius:12px; padding:18px; box-sizing:border-box; }
    .message { font-size:14px; margin-bottom:14px; line-height:1.45; max-height:90px; overflow:auto; }
    input { width:100%; padding:8px 10px; font-size:14px; border-radius:6px; border:1px solid #ccc; margin-bottom:18px; box-sizing:border-box; }
    input:focus { outline:none; border-color:#007aff; box-shadow:0 0 0 2px rgba(0,122,255,0.25); }
    .buttons { display:flex; justify-content:flex-end; gap:10px; }
    button { font-size:13px; padding:6px 14px; border-radius:6px; border:none; cursor:pointer; }
    #cancel { background:#f1f1f1; } #cancel:hover { background:#e4e4e4; }
    #ok { background:#007aff; color:white; } #ok:hover { background:#0062cc; }
    </style></head>
    <body>
    <div class="wrapper"><div class="dialog">
    <div class="message">${escapeHtml(message)}</div>
    <input id="input" value="${escapeHtml(defaultValue)}">
    <div class="buttons">
    <button id="cancel">Cancel</button>
    <button id="ok">OK</button>
    </div>
    </div></div>
    <script>
    const { ipcRenderer } = require('electron');
    const input = document.getElementById('input');
    const ok = document.getElementById('ok');
    const cancel = document.getElementById('cancel');
    ok.onclick = () => ipcRenderer.send('electron-prompt-done-sync', input.value);
    cancel.onclick = () => ipcRenderer.send('electron-prompt-done-sync', null);
    input.addEventListener('keydown', e => { if(e.key==='Enter') ok.click(); if(e.key==='Escape') cancel.click(); });
    input.focus(); input.select();
    </script>
    </body></html>`;

    ipcMain.once('electron-prompt-done-sync', (ev, val) => {
      result = val;
      try { promptWindow.destroy(); } catch {}
      event.returnValue = result;
    });

    promptWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    promptWindow.once('ready-to-show', () => promptWindow.show());
  });
}
