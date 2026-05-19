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

// --- FLOATING SETTINGS BUTTON INJECTION ---
window.addEventListener('DOMContentLoaded', async () => {
  // Helper to determine the theme state based on structural values passed out of Main World
  function getThemeColors(isDark) {
    return {
      bg: isDark ? '#1e1e1e' : '#ffffff',
      text: isDark ? '#f0f0f0' : '#333333',
      border: isDark ? '#3d3d3d' : '#e5e5e5',
      selectBg: isDark ? '#2d2d2d' : '#ffffff',
      selectText: isDark ? '#ffffff' : '#333333',
      selectBorder: isDark ? '#555555' : '#ccc',
      hr: isDark ? '#2a2a2a' : '#eee'
    };
  }

  // Extract initial condition safely from Main World
  let initialDark = false;
  try {
    initialDark = await webFrame.executeJavaScript(`
    (() => {
      const homeDark = localStorage.getItem('darkmode');
      const editorTheme = localStorage.getItem('tw:theme');
      return (homeDark === 'true' || editorTheme === 'dark');
    })()
    `);
  } catch (err) {
    console.error('[preload] Initial theme lookup failed:', err);
  }

  const currentSetting = await ipcRenderer.invoke('get-startup-setting');

  // Create UI Container
  const container = document.createElement('div');
  container.id = 'electron-settings-floating-ui';
  container.style.cssText = `
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  user-select: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  `;

  // Main floating button (Shadow removed)
  const mainBtn = document.createElement('button');
  mainBtn.innerHTML = '<svg class="svg-icon" style="width: 1em;height: 1em;vertical-align: middle;fill: currentColor;overflow: hidden;" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M512.085333 661.333333a149.333333 149.333333 0 0 1-149.333333-149.333333 149.333333 149.333333 0 0 1 149.333333-149.333333 149.333333 149.333333 0 0 1 149.333334 149.333333 149.333333 149.333333 0 0 1-149.333334 149.333333m317.013334-107.946666c1.706667-13.653333 2.986667-27.306667 2.986666-41.386667s-1.28-28.16-2.986666-42.666667l90.026666-69.546666c8.106667-6.4 10.24-17.92 5.12-27.306667l-85.333333-147.626667c-5.12-9.386667-16.64-13.226667-26.026667-9.386666l-106.24 42.666666c-22.186667-16.64-45.226667-31.146667-72.106666-41.813333l-15.786667-113.066667a21.589333 21.589333 0 0 0-21.333333-17.92h-170.666667c-10.666667 0-19.626667 7.68-21.333333 17.92l-15.786667 113.066667c-26.88 10.666667-49.92 25.173333-72.106667 41.813333l-106.24-42.666666c-9.386667-3.84-20.906667 0-26.026666 9.386666l-85.333334 147.626667c-5.546667 9.386667-2.986667 20.906667 5.12 27.306667L195.072 469.333333c-1.706667 14.506667-2.986667 28.586667-2.986667 42.666667s1.28 27.733333 2.986667 41.386667l-90.026667 70.826666c-8.106667 6.4-10.666667 17.92-5.12 27.306667l85.333334 147.626667c5.12 9.386667 16.64 12.8 26.026666 9.386666l106.24-43.093333c22.186667 17.066667 45.226667 31.573333 72.106667 42.24l15.786667 113.066667c1.706667 10.24 10.666667 17.92 21.333333 17.92h170.666667c10.666667 0 19.626667-7.68 21.333333-17.92l15.786667-113.066667c26.88-11.093333 49.92-25.173333 72.106666-42.24l106.24 43.093333c9.386667 3.413333 20.906667 0 26.026667-9.386666l85.333333-147.626667c5.12-9.386667 2.986667-20.906667-5.12-27.306667z" fill="#FFFFFF" /></svg>';
  mainBtn.style.cssText = `
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: #007aff;
  color: white;
  font-size: 22px;
  border: none;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s ease;
  `;

  // Settings menu panel layout
  const panel = document.createElement('div');
  panel.style.cssText = `
  border-radius: 12px;
  padding: 16px;
  display: none;
  flex-direction: column;
  gap: 12px;
  width: 220px;
  transition: background 0.2s ease, border-color 0.2s ease;
  `;

  panel.innerHTML = `
  <div style="display:flex; justify-content:space-between; align-items:center;">
  <strong id="settings-title-node" style="font-size:14px;">Desktop Settings</strong>
  <button id="hide-settings-ui-btn" style="background:none; border:none; font-size:14px; cursor:pointer; color:#999;">✕</button>
  </div>
  <hr id="settings-hr-node" style="border:0; margin:2px 0;">
  <div id="settings-label-node" style="font-size:13px;">
  <label style="display:block; margin-bottom:6px; font-weight:500;">Default Startup Page:</label>
  <select id="startup-page-select" style="width:100%; padding:6px; border-radius:6px; outline:none; transition: background 0.2s ease, color 0.2s ease;">
  <option value="home">PenguinMod Editor</option>
  <option value="editor">PenguinMod Home Page</option>
  </select>
  </div>
  `;

  container.appendChild(panel);
  container.appendChild(mainBtn);
  document.body.appendChild(container);

  // Structural nodes referencing styling locations
  const titleNode = panel.querySelector('#settings-title-node');
  const hrNode = panel.querySelector('#settings-hr-node');
  const labelNode = panel.querySelector('#settings-label-node');
  const selectNode = panel.querySelector('#startup-page-select');

  // Unified function to handle rendering theme updates on demand
  function applyTheme(isDark) {
    const palette = getThemeColors(isDark);
    panel.style.background = palette.bg;
    panel.style.borderColor = palette.border;
    panel.style.borderStyle = 'solid';
    panel.style.borderWidth = '1px';

    titleNode.style.color = palette.text;
    labelNode.style.color = palette.text;
    hrNode.style.borderTop = `1px solid ${palette.hr}`;

    selectNode.style.background = palette.selectBg;
    selectNode.style.color = palette.selectText;
    selectNode.style.borderColor = palette.selectBorder;
  }

  // Apply default state computed above
  applyTheme(initialDark);
  selectNode.value = currentSetting || 'home';

  // --- REAL-TIME LIVE LOCALSTORAGE DETECTOR ---
  // Expose an internal callback inside isolated context, then monitor the window object storage events
  contextBridge.exposeInMainWorld('__electronThemeTrackerBridge', {
    onThemeChanged: (isDark) => applyTheme(isDark)
  });

  webFrame.executeJavaScript(`
  (() => {
    window.addEventListener('storage', (e) => {
      if (e.key === 'darkmode' || e.key === 'tw:theme') {
        const homeDark = localStorage.getItem('darkmode');
        const editorTheme = localStorage.getItem('tw:theme');
        const isDark = (homeDark === 'true' || editorTheme === 'dark');
        if (window.__electronThemeTrackerBridge) {
          window.__electronThemeTrackerBridge.onThemeChanged(isDark);
        }
      }
    });

    // Monkey patch setItem to track changes made programmatically within the same tab context
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      originalSetItem.apply(this, arguments);
      if (key === 'darkmode' || key === 'tw:theme') {
        const homeDark = localStorage.getItem('darkmode');
        const editorTheme = localStorage.getItem('tw:theme');
        const isDark = (homeDark === 'true' || editorTheme === 'dark');
        if (window.__electronThemeTrackerBridge) {
          window.__electronThemeTrackerBridge.onThemeChanged(isDark);
        }
      }
    };
  })();
  `);

  // Setting modifications
  selectNode.addEventListener('change', (e) => {
    ipcRenderer.send('set-startup-setting', e.target.value);
  });

  // Open settings interaction
  mainBtn.addEventListener('click', (e) => {
    if (isDragging) return;
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });

  // Right-click to completely delete elements
  mainBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    container.remove();
  });

  panel.querySelector('#hide-settings-ui-btn').addEventListener('click', () => {
    container.style.display = 'none';
  });

  // Draggable Mechanics
  let isDragging = false;
  let startX, startY, initialRight, initialBottom;

  mainBtn.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Left click only
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;

    const computed = window.getComputedStyle(container);
    initialRight = parseInt(computed.right, 10);
    initialBottom = parseInt(computed.bottom, 10);

    mainBtn.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });

  function onMouseMove(e) {
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      isDragging = true;
    }

    if (isDragging) {
      container.style.right = `${initialRight - deltaX}px`;
      container.style.bottom = `${initialBottom - deltaY}px`;
    }
  }

  function onMouseUp() {
    mainBtn.style.cursor = 'grab';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
});
