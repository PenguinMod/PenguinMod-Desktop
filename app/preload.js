// preload.js
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// =========================================================================
// 1. SECURE IPC DIALOG CHANNELS (Exposed only to the Preload isolation layer)
// =========================================================================
function sendSync(channel, payload) {
  try {
    return ipcRenderer.sendSync(channel, payload);
  } catch (err) {
    console.error('[preload] sync ipc failed', channel, err);
    return null;
  }
}

// Track callback safely inside the preload execution context
const themeTracker = { callback: null };

// =========================================================================
// 2. EXPOSE EXPLICIT METHODS (Websites cannot alter these native functions)
// =========================================================================
contextBridge.exposeInMainWorld('__electronInternalBridge', {
  alert: (msg) => sendSync('electron-alert', String(msg ?? '')),
  confirm: (msg) => !!sendSync('electron-confirm', String(msg ?? '')),
  prompt: (msg, def) => sendSync('electron-prompt-sync', { message: msg, defaultValue: def }),

  // This notifies our preload script when the user changes themes on the website
  notifyThemeChanged: (isDark) => {
    if (typeof themeTracker.callback === 'function') {
      themeTracker.callback(isDark);
    }
  }
});

contextBridge.exposeInMainWorld('__electronUpdaterBridge', {
  checkForUpdate: () => ipcRenderer.invoke('manual-check-update')
});

// =========================================================================
// 3. SECURE MAIN WORLD INJECTION & UI INITIALIZATION
// =========================================================================
window.addEventListener('DOMContentLoaded', async () => {

  // ── A. FLOATING SETTINGS UI ELEMENTS CREATION ───────────────────────────
  const currentSetting = await ipcRenderer.invoke('get-startup-setting');

  // Create UI Container - Locked to button size so dragging is stable
  const container = document.createElement('div');
  container.id = 'electron-settings-floating-ui';
  container.style.cssText = `
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 50px;
  height: 50px;
  z-index: 999999;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  user-select: none;
  `;

  // Main floating button
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
  position: absolute;
  bottom: 60px;
  right: 0;
  border-radius: 12px;
  padding: 16px;
  display: none;
  flex-direction: column;
  gap: 12px;
  width: 220px;
  background: #ffffff; /* Default safety background */
  color: #333333;      /* FIX: Explicit default dark text so it doesn't inherit website styles */
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  transition: background 0.2s ease, border-color 0.2s ease;
  `;

  panel.innerHTML = `
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <strong id="settings-title-node" style="font-size:14px;">Desktop Settings</strong>
    <button id="hide-settings-ui-btn" style="background:none; border:none; font-size:14px; cursor:pointer; color:#999;">✕</button>
  </div>
  <hr id="settings-hr-node" style="border:0; margin:2px 0; border-top: 1px solid rgba(0,0,0,0.1);">
  <div id="settings-label-node" style="font-size:13px;">
    <label style="display:block; margin-bottom:6px; font-weight:500;">Default Startup Page:</label>
    <select id="startup-page-select" style="width:100%; padding:6px; border-radius:6px; outline:none; transition: background 0.2s ease, color 0.2s ease;">
      <option value="home">PenguinMod Home Page</option>
      <option value="editor">PenguinMod Editor</option>
    </select>
  </div>
  `;

  const updateBtn = document.createElement('button');
  updateBtn.textContent = 'Check for Update';
  updateBtn.style.cssText = `padding: 6px 12px; border-radius: 6px; border: none; background: #00c3ff; color: #f0f0f0; cursor: pointer;`;
  panel.appendChild(updateBtn);

  container.appendChild(panel);
  container.appendChild(mainBtn);
  document.body.appendChild(container);

  // ── B. DRAG / POINTER EVENTS LOGIC ───────────────────────────────────────
  let isDragging = false;
  let didDrag = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  mainBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; 
    isDragging = true;
    didDrag = false;
    mainBtn.setPointerCapture(e.pointerId);
    mainBtn.style.cursor = 'grabbing';

    const rect = container.getBoundingClientRect();
    container.style.right  = 'auto';
    container.style.bottom = 'auto';
    container.style.left   = rect.left + 'px';
    container.style.top    = rect.top  + 'px';

    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
  });

  mainBtn.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    didDrag = true;

    let newLeft = e.clientX - dragOffsetX;
    let newTop  = e.clientY - dragOffsetY;

    const btnSize = 50;
    newLeft = Math.max(0, Math.min(window.innerWidth  - btnSize, newLeft));
    newTop  = Math.max(0, Math.min(window.innerHeight - btnSize, newTop));

    container.style.left = newLeft + 'px';
    container.style.top  = newTop  + 'px';
  });

  mainBtn.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    mainBtn.style.cursor = 'grab';
    if (!didDrag) {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }
  });

  mainBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.remove();
  });

  // ── C. BUTTON CONNECTIONS & ATTRIBUTES ───────────────────────────────────
  updateBtn.addEventListener('click', async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = 'Checking...';
    try {
      const result = await ipcRenderer.invoke('manual-check-update');
      sendSync('electron-alert', result.message);
    } catch (err) {
      console.error('[Update Error]', err);
    }
    updateBtn.textContent = 'Check for Update';
    updateBtn.disabled = false;
  });

  const hrNode = panel.querySelector('#settings-hr-node');
  const selectNode = panel.querySelector('#startup-page-select');

  selectNode.value = currentSetting || 'home';
  selectNode.addEventListener('change', (e) => {
    ipcRenderer.send('set-startup-setting', e.target.value);
  });

  panel.querySelector('#hide-settings-ui-btn').addEventListener('click', () => {
    container.style.display = 'none';
  });

  // ── D. REGISTER THEME TRACKER CALLBACK ───────────────────────────────────
  // This must be assigned BEFORE executeJavaScript runs below!
  themeTracker.callback = (isDark) => {
    panel.style.background = isDark ? '#1e1e1e' : '#ffffff';
    panel.style.color = isDark ? '#f0f0f0' : '#333333';
    hrNode.style.borderTop = isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)';
    updateBtn.style.background = isDark ? "#009CCC" : "#00c3ff";
    updateBtn.style.color = '#f0f0f0';
  };

  // ── E. SECURE MAIN WORLD INJECTION (Triggers dispatchTheme safely) ────────
  webFrame.executeJavaScript(`
  (() => {
    window.alert = (msg) => window.__electronInternalBridge.alert(msg);
    window.confirm = (msg) => window.__electronInternalBridge.confirm(msg);
    window.prompt = (msg, def) => window.__electronInternalBridge.prompt(msg, def);

    const dispatchTheme = () => {
      const homeDark = localStorage.getItem('darkmode') === 'true';
      const editorTheme = localStorage.getItem('tw:theme') === 'dark';
      window.__electronInternalBridge.notifyThemeChanged(homeDark || editorTheme);
    };

    window.addEventListener('storage', dispatchTheme);
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      originalSetItem.apply(this, arguments);
      if (key === 'darkmode' || key === 'tw:theme') dispatchTheme();
    };

    // Immediately update preload script configuration now that components are ready
    dispatchTheme();
  })();
  `);

  // ── F. TARGET BLANK BYPASS OVERRIDE ──────────────────────────────────────
  const enforceSelfTarget = () => {
    const anchors = document.getElementsByTagName('a');
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      try {
        if (!a.href) continue;
        const url = new URL(a.href, window.location.href);
        const isPenguinHome = url.host === 'penguinmod.com' || url.protocol === 'home:';
        const isPenguinEditor = url.host === 'studio.penguinmod.com' || url.protocol === 'editor:';

        if (isPenguinHome || isPenguinEditor) {
          if (a.getAttribute('target') !== '_self') {
            a.setAttribute('target', '_self');
          }
        }
      } catch (err) {}
    }
  };

  enforceSelfTarget();

  const anchorObserver = new MutationObserver((mutations) => {
    let shouldRun = false;
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        shouldRun = true;
        break;
      } else if (m.type === 'attributes' && m.attributeName === 'target') {
        shouldRun = true;
        break;
      }
    }
    if (shouldRun) enforceSelfTarget();
  });

  anchorObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['target', 'href']
  });

  // ── G. UPDATE PROGRESS OVERLAY ───────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'electron-update-overlay';
  overlay.style.cssText = `
  display: none;
  position: fixed;
  inset: 0;
  z-index: 9999999;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(4px);
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  overlay.innerHTML = `
  <div id="update-card" style="background: #1c1c1e; color: #f0f0f0; border-radius: 16px; padding: 28px 32px; width: 420px; max-width: 90vw; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px;">
    <div style="font-size:16px; font-weight:600;" id="update-phase-label">Preparing update...</div>
    <div style="font-size: 11px; color: #8e8e93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-variant-numeric: tabular-nums;">PenguinMod Desktop will restart when done</div>
    <div style="background: #3a3a3c; border-radius: 999px; height: 8px; overflow: hidden; width: 100%;"><div id="update-bar" style="height: 100%; width: 0%; background: #007aff; border-radius: 999px; transition: width 0.15s ease;"></div></div>
    <div style="display:flex; justify-content:space-between; font-size:12px; color:#aeaeb2;"><span id="update-pct-label">0%</span><span id="update-indeterminate" style="display:none;">●</span></div>
    <div id="update-status" style="font-size: 11px; color: #8e8e93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-variant-numeric: tabular-nums;">Starting...</div>
  </div>
  `;

  document.body.appendChild(overlay);

  const updateBar = overlay.querySelector('#update-bar');
  const updatePhaseLabel = overlay.querySelector('#update-phase-label');
  const updatePctLabel = overlay.querySelector('#update-pct-label');
  const updateStatus = overlay.querySelector('#update-status');
  const updateIndeterminate = overlay.querySelector('#update-indeterminate');

  let dotTimer = null;
  function startIndeterminate() {
    const dots = ['●', '○', '●', '○'];
    let idx = 0;
    updateIndeterminate.style.display = 'inline';
    updatePctLabel.style.display = 'none';
    dotTimer = setInterval(() => {
      updateIndeterminate.textContent = dots[idx++ % dots.length];
    }, 400);
  }
  function stopIndeterminate() {
    clearInterval(dotTimer);
    dotTimer = null;
    updateIndeterminate.style.display = 'none';
    updatePctLabel.style.display = 'inline';
  }

  ipcRenderer.on('update-progress', (_event, { phase, percent, status }) => {
    overlay.style.display = 'flex';
    updatePhaseLabel.textContent = phase === 'download' ? 'Downloading update…' : 'Extracting files…';

    if (percent < 0) {
      updateBar.style.width = '100%';
      updateBar.style.animation = 'none';
      updateBar.style.background = 'linear-gradient(90deg, #007aff 0%, #5ac8fa 50%, #007aff 100%)';
      updateBar.style.backgroundSize = '200% 100%';
      updateBar.style.transition = 'none';
      if (!dotTimer) startIndeterminate();
    } else {
      if (dotTimer) stopIndeterminate();
      updateBar.style.background = phase === 'download' ? '#007aff' : '#34c759';
      updateBar.style.width = `${percent}%`;
      updatePctLabel.textContent = `${percent}%`;
    }
    updateStatus.textContent = status;
  });
});
