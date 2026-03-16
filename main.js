const { app, BrowserWindow, Menu, protocol, net, ipcMain, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { autoUpdater } = require("electron-updater");

// Fix for fetch APIs in the browser with our custom scheme
protocol.registerSchemesAsPrivileged([
    { scheme: 'pm', privileges: { standard: true, supportFetchAPI: true, secure: true, bypassCSP: true, corsEnabled: true } }
]);

// Set the App identity for Windows taskbar support
app.name = "PenguinMod Desktop";
// Using the productName for AppUserModelId helps Windows associate the icon correctly
app.setAppUserModelId("PenguinMod Desktop");

let mainWindow = null;
let pendingDeepLink = null;

function findDeepLinkUrl(argv) {
    if (!Array.isArray(argv)) return null;
    return argv.find(arg => typeof arg === "string" && arg.startsWith("pm://")) || null;
}

function handleDeepLink(url) {
    if (!url || !mainWindow) return;
    // Only allow our custom scheme.
    if (!url.startsWith("pm://")) return;

    try {
        mainWindow.loadURL(url);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    } catch (err) {
        console.error("Failed to handle deep link:", err);
    }
}

function createWindow() {
    protocol.handle('pm', async (request) => {
        let url = new URL(request.url);
        let pathname = decodeURIComponent(url.pathname);
        let filename = pathname.split('/').pop();

        async function createCorsResponse(responsePromise) {
            try {
                let response = await responsePromise;
                let headers = new Headers(response.headers);
                headers.set("Access-Control-Allow-Origin", "*");
                headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS");

                // CRITICAL FIX: Ensure assets have correct content types.
                // net.fetch on file:/// sometimes maps assets to application/octet-stream 
                // which causes breakage for images and refused execution for scripts.
                const ext = filename ? filename.toLowerCase() : '';
                if (ext.endsWith('.svg')) {
                    headers.set('Content-Type', 'image/svg+xml');
                } else if (ext.endsWith('.png')) {
                    headers.set('Content-Type', 'image/png');
                } else if (ext.endsWith('.js')) {
                    headers.set('Content-Type', 'application/javascript');
                } else if (ext.endsWith('.css')) {
                    headers.set('Content-Type', 'text/css');
                } else if (ext.endsWith('.html')) {
                    headers.set('Content-Type', 'text/html');
                } else if (ext.endsWith('.json')) {
                    headers.set('Content-Type', 'application/json');
                } else if (ext.endsWith('.woff2')) {
                    headers.set('Content-Type', 'font/woff2');
                } else if (ext.endsWith('.woff')) {
                    headers.set('Content-Type', 'font/woff');
                } else if (ext.endsWith('.ttf')) {
                    headers.set('Content-Type', 'font/ttf');
                } else if (ext.endsWith('.otf')) {
                    headers.set('Content-Type', 'font/otf');
                } else if (ext.endsWith('.ico')) {
                    headers.set('Content-Type', 'image/x-icon');
                } else if (ext.endsWith('.cur')) {
                    headers.set('Content-Type', 'image/x-icon');
                } else if (ext.endsWith('.mp3')) {
                    headers.set('Content-Type', 'audio/mpeg');
                } else if (ext.endsWith('.wav')) {
                    headers.set('Content-Type', 'audio/wav');
                }

                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: headers
                });
            } catch (err) {
                console.error("pm protocol fetch error:", err);
                return new Response("Error", { status: 500 });
            }
        }

        // Root index.html fallback
        if (pathname === "/index.html" || pathname === "/") {
            return createCorsResponse(net.fetch(pathToFileURL(path.join(__dirname, 'index.html')).href));
        }

        // Editor index.html
        if (pathname === "/editor/index.html") {
            return createCorsResponse(net.fetch(pathToFileURL(path.join(__dirname, 'editor', 'index.html')).href));
        }

        // Maps missing assets into index_files downloaded by Chrome 
        let indexFilesPath = path.join(__dirname, 'editor', 'index_files', filename);
        if (filename && fs.existsSync(indexFilesPath)) {
            return createCorsResponse(net.fetch(pathToFileURL(indexFilesPath).href));
        }

        // Checks if file is present locally (e.g., style.css or script.js at root)
        // Fix Windows path injection issue by stripping leading slash
        let localRelativePath = pathname.startsWith('/') ? pathname.substring(1) : pathname;
        let finalPath = path.join(__dirname, localRelativePath);

        if (fs.existsSync(finalPath) && fs.statSync(finalPath).isFile()) {
            return createCorsResponse(net.fetch(pathToFileURL(finalPath).href));
        }

        // If not found locally, route everything else to actual PM Studio
        // Fix: Assets are often at root /static/ even if the page is in /editor/
        let proxyPath = pathname;
        if (proxyPath.startsWith('/editor/static/') || proxyPath.startsWith('/editor/assets/')) {
            proxyPath = proxyPath.replace('/editor/', '/');
        }

        let proxyUrl = "https://studio.penguinmod.com" + proxyPath + url.search;
        return createCorsResponse(net.fetch(proxyUrl));
    });

    const iconPath = path.resolve(__dirname, 'logo.png');
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: iconPath,
        title: "PenguinMod Desktop",
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: false
        }
    });

    // Explicitly set the icon again for the window
    if (fs.existsSync(iconPath)) {
        win.setIcon(iconPath);
    }

    mainWindow = win;

    // Confirmation dialog on close
    win.on('close', async (event) => {
        if (app.quitting) return;

        event.preventDefault();

        try {
            // Check if project is dirty (PenguinMod adds * to title)
            const title = win.getTitle();
            const isDirty = title.includes('*');

            const { response } = await dialog.showMessageBox(win, {
                type: isDirty ? 'warning' : 'question',
                buttons: ['Yes', 'No'],
                title: isDirty ? 'Unsaved Changes' : 'Confirm',
                message: isDirty
                    ? 'There are unsaved changes. Are you really sure you want to quit? Your progress will be lost.'
                    : 'Are you sure you want to close PenguinMod Desktop?',
                defaultId: 1,
                cancelId: 1
            });

            if (response === 0) {
                app.quitting = true;
                // Force destroy to bypass renderer-side beforeunload prompts
                win.destroy();
                app.quit();
            }
        } catch (err) {
            console.error("Error during close confirmation:", err);
            app.quitting = true;
            win.destroy();
            app.quit();
        }
    });

    // remove default menu when in editor, but keep it for home page/browsing
    win.webContents.on('did-navigate', (event, url) => {
        if (url.includes("/editor/index.html")) {
            Menu.setApplicationMenu(null);
        } else {
            // Keep or restore default menu for browsing
            const template = [
                {
                    label: 'Home',
                    click: () => win.loadURL("pm://localhost/index.html")
                }
            ];
            const menu = Menu.buildFromTemplate(template);
            Menu.setApplicationMenu(menu);
        }
    });

    // Load local home screen
    win.loadURL("pm://localhost/index.html");

    win.webContents.on("will-navigate", (event, url) => {
        if (url.includes("studio.penguinmod.com/editor") && !url.includes("localhost")) {
            event.preventDefault();
            win.loadURL("pm://localhost/editor/index.html");
        }
    });

    // Injects a floating back button into penguinmod.com pages
    win.webContents.on('did-finish-load', () => {
        const url = win.webContents.getURL();
        // Only inject on actual penguinmod.com pages, NOT the editor and NOT the home screen
        if (url.includes("penguinmod.com") && !url.includes("localhost") && !url.includes("/editor/")) {
            win.webContents.executeJavaScript(`
                (function() {
                    if (document.getElementById('pm-desktop-back')) return;
                    const btn = document.createElement('div');
                    btn.id = 'pm-desktop-back';
                    btn.innerHTML = '← Back';
                    Object.assign(btn.style, {
                        position: 'fixed',
                        bottom: '20px',
                        left: '20px',
                        padding: '10px 20px',
                        background: '#00c3ff',
                        color: 'white',
                        borderRadius: '50px',
                        cursor: 'pointer',
                        zIndex: '999999',
                        fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
                        fontWeight: 'bold',
                        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                        transition: 'transform 0.2s ease'
                    });
                    btn.onmouseenter = () => btn.style.transform = 'scale(1.1)';
                    btn.onmouseleave = () => btn.style.transform = 'scale(1)';
                    btn.onclick = () => {
                        window.history.back();
                    };
                    document.body.appendChild(btn);
                })();
            `);
        }
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.includes("studio.penguinmod.com/editor")) {
            win.loadURL("pm://localhost/editor/index.html");
            return { action: "deny" };
        }
        return { action: "allow" };
    });

    if (pendingDeepLink) {
        handleDeepLink(pendingDeepLink);
        pendingDeepLink = null;
    }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on("second-instance", (event, commandLine) => {
        const deepLink = findDeepLinkUrl(commandLine);
        if (deepLink) {
            handleDeepLink(deepLink);
        } else if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
});

app.whenReady().then(() => {
    // Register pm:// at the OS level so browsers can launch the app.
    if (app.isPackaged) {
        app.setAsDefaultProtocolClient("pm");
    } else {
        // On Windows in dev, you must pass the Electron binary and app path.
        const appPath = path.resolve(process.argv[1]);
        app.setAsDefaultProtocolClient("pm", process.execPath, [appPath]);
    }

    pendingDeepLink = findDeepLinkUrl(process.argv);
    createWindow();

    // AutoUpdater configuration
    autoUpdater.autoDownload = false; // We will ask the user first
    
    // Fallback to explicitly telling it where to look if app-update.yml has issues
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'PenguinMod',
        repo: 'PenguinMod-Desktop'
    });

    if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch(err => console.error("Update check failed:", err));
    }
});

autoUpdater.on("update-available", (info) => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) of PenguinMod Desktop is available. Do you want to download and install it now?`,
        buttons: ['Yes', 'Later']
    }).then((result) => {
        if (result.response === 0) {
            autoUpdater.downloadUpdate();
        }
    });
});

autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'The update has been downloaded. The application will now restart to apply it.',
        buttons: ['Restart and Install']
    }).then(() => {
        autoUpdater.quitAndInstall();
    });
});

autoUpdater.on("error", (err) => {
    console.error("AutoUpdater error:", err);
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
