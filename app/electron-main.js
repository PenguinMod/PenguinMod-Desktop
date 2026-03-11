// electron-main.js

const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let isQuitting = false;

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

      // IMPORTANT: net.fetch needs a valid file:// URL
      const fileUrl = `file://${filePath}`;
      return net.fetch(fileUrl);

    } catch (err) {
      console.error('[app://] handler error:', err);
      return new Response('Protocol error', { status: 500 });
    }
  });

  createWindow(process.argv[2] || 'index.html');
});
function createWindow(startFile) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on('will-prevent-unload', (event) => {
  const { dialog } = require('electron');

  const result = dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    buttons: ['Leave', 'Stay'],
    defaultId: 1,
    cancelId: 1,
    message: 'You have unsaved changes. Leave anyway?'
  });

  if (result === 0) {
    // allow close
    event.preventDefault();
  }
});

  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    const prefix = `[renderer:${sourceId}:${line}]`;
    if (level >= 2) console.error(`${prefix} ${message}`);
    else console.log(`${prefix} ${message}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // NOTE: always use triple-slash form
  const startUrl = `app:///${startFile}`;
  console.log('[main] loading', startUrl);

  mainWindow.loadURL(startUrl).catch(err => {
    console.error('[main] loadURL failed:', err);
  });
}

ipcMain.on('renderer-request-reload', () => {
  if (isQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  console.log('[main] safe reload requested');
  try {
    mainWindow.webContents.reloadIgnoringCache();
  } catch (e) {
    console.error('[main] reload failed:', e);
  }
});

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

process.on('uncaughtException', err => {
  console.error('[main] uncaughtException:', err);
});

process.on('unhandledRejection', reason => {
  console.error('[main] unhandledRejection:', reason);
});
