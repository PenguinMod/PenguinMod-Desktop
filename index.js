const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const childProcess = require("child_process");
const path = require('path');

import('fix-path').then(module => {
    module();
});

const IsDeveloperMode = true;

function createWindow() {
    const win = new BrowserWindow({
        title: "PenguinMod",
        icon: "favicon.ico",
        width: 1280,
        height: 720,
        backgroundColor: "#ffffff",
        webPreferences: {
            devTools: IsDeveloperMode,
            sandbox: false,
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    win.maximize();
    win.loadFile('index.html');
    if (!IsDeveloperMode) win.removeMenu();
    return win;
}

let window = null;
app.whenReady().then(() => {
    window = createWindow();
    window.ELECTRON_ENABLE_SECURITY_WARNINGS = true;
    app.___createdWindowForUse = window;
    app.setName('PenguinMod Studio');
    app.setAppUserModelId('com.penguinmod.PenguinMod');

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            window = createWindow();
            app.___createdWindowForUse = window;
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.handle("showDialog", (_, message) => {
    return dialog.showMessageBoxSync(null, JSON.parse(message));
});
ipcMain.handle("showOpenDialog", (_, data) => {
    return dialog.showOpenDialog(null, JSON.parse(data));
});
ipcMain.handle("showSaveDialog", (_, data) => {
    return dialog.showSaveDialog(null, JSON.parse(data));
});
ipcMain.handle("setProgress", (_, precentage) => {
    return window.setProgressBar(Number(precentage));
});
ipcMain.handle("quitApp", (_, __) => {
    app.quit();
});

// TODO: we should start on a port that is not 5173 (should be exclusive to launcher so not 5174 either)
//       api needs to be able to handle that btw
let existingHomeProcess;
ipcMain.handle("beginHomeProcess", () => {
    if (existingHomeProcess) {
        existingHomeProcess.kill('SIGINT');
    }

    const extractedArchivesPath = path.resolve("./penguinmod/compilation/extractiongui");
    const homePagePath = path.join(extractedArchivesPath, 'penguinmod.github.io-develop');
    const command = `cd ${JSON.stringify(homePagePath)} && npm run start`;
    const process = childProcess.spawn(command, { shell: true });
    existingHomeProcess = process;
    
    process.stdout.on('data', (data) => {
        console.log('HOME PROCESS STDOUT;', Buffer.from(data).toString());
    });
    process.stderr.on('data', (data) => {
        console.log('HOME PROCESS STDERR;', Buffer.from(data).toString());
    });

    process.on('close', (code) => {
        console.log('HOME PROCESS CLOSED; CODE', code);
    });
});
ipcMain.handle("goToHome", () => {
    // TODO: we should not use port 5173 FIXED(?)
    window.loadURL('http://localhost:54642/');
});
app.on("window-all-closed", () => {
    if (existingHomeProcess) {
        existingHomeProcess.kill('SIGINT');
    }
});
app.on('before-quit', () => {
    if (existingHomeProcess) {
        existingHomeProcess.kill('SIGINT');
    }
});