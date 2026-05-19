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
  mainBtn.innerHTML = '⚙️';
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
  <strong id="settings-title-node" style="font-size:14px;">App Settings</strong>
  <button id="hide-settings-ui-btn" style="background:none; border:none; font-size:14px; cursor:pointer; color:#999;">✕</button>
  </div>
  <hr id="settings-hr-node" style="border:0; margin:2px 0;">
  <div id="settings-label-node" style="font-size:13px;">
  <label style="display:block; margin-bottom:6px; font-weight:500;">Default Startup Page:</label>
  <select id="startup-page-select" style="width:100%; padding:6px; border-radius:6px; outline:none; transition: background 0.2s ease, color 0.2s ease;">
  <option value="home">Home Page (home://-)</option>
  <option value="editor">Editor Page (editor://-)</option>
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
