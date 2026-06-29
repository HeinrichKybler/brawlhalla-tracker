const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { uIOhook, UiohookKey } = require('uiohook-napi');

function loadEnv() {
  for (const base of [__dirname, process.resourcesPath || '', process.cwd()]) {
    const p = path.join(base, '.env');
    try {
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      return;
    } catch (_) { /* ignore */ }
  }
}
loadEnv();

const db = require('./db');
const api = require('./api');
const ocr = require('./ocr');
const { initAutoUpdate } = require('./updater');

let panelWin, dashWin, tray, ocrRunning = false;
app.isQuitting = false;

function createPanel() {
  const displays = screen.getAllDisplays();
  const ext = displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) || displays[0];
  panelWin = new BrowserWindow({
    x: ext.bounds.x + 20,
    y: ext.bounds.y + 20,
    width: 360,
    height: 660,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  panelWin.loadFile(path.join(__dirname, 'windows', 'panel.html'));
  panelWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); panelWin.hide(); } });
}

function openDashboard() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.show(); dashWin.focus(); return; }
  dashWin = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  dashWin.loadFile(path.join(__dirname, 'windows', 'dashboard.html'));
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Brawlhalla Tracker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Otevřít dashboard', click: openDashboard },
    { type: 'separator' },
    { label: 'Ukončit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', openDashboard);
}

let triggerKeycode = UiohookKey.J;

// název klávesy ("J", "F8", i "Alt+J" → bere se poslední token) → uiohook keycode
function keyNameToCode(name) {
  const key = String(name || 'J').trim().toUpperCase().split('+').pop();
  return UiohookKey[key] != null ? UiohookKey[key] : UiohookKey.J;
}
function refreshTriggerKey() {
  triggerKeycode = keyNameToCode(db.getSetting('hotkey') || 'J');
}

// pasivní global hook: stisk klávesy J jen poslouchá, NEblokuje (J dál normálně píše).
// Trigger jen bez modifikátorů (ne Shift+J, ne Ctrl+J, ne Alt+J).
function startHook() {
  refreshTriggerKey();
  uIOhook.on('keydown', e => {
    if (e.keycode === triggerKeycode && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      runOcr();
    }
  });
  uIOhook.start();
}

async function lookupSelf() {
  const myName = db.getSetting('my_name');
  if (!myName) return null;
  const p = await api.searchPlayer(myName);
  if (!p) return null;
  const ranked = await api.getPlayerRanked(p.id);
  return { id: p.id, elo: ranked.rating };
}

async function runOcr() {
  if (ocrRunning) return;
  ocrRunning = true;
  try {
    const myName = db.getSetting('my_name') || '';
    const res = await ocr.run(myName);
    if (res && res.opponent) {
      const p = await api.searchPlayer(res.opponent);
      if (p) {
        const [ranked, all, legends, self] = await Promise.all([
          api.getPlayerRanked(p.id),
          api.getPlayerAll(p.id),
          api.getLegends().catch(() => []),
          lookupSelf().catch(() => null)
        ]);
        const weaponMap = {};
        for (const l of legends) weaponMap[l.legend_id] = [l.weapon_one, l.weapon_two];
        if (panelWin && !panelWin.isDestroyed()) {
          panelWin.showInactive();
          panelWin.webContents.send('panel:data', {
            opponent: p.username,
            opponentLegend: res.opponentLegend,
            ranked, all, weaponMap,
            myElo: self ? self.elo : null,
            oppElo: ranked.rating,
            season: parseInt(db.getSetting('season') || '1', 10)
          });
        }
      }
    }
  } catch (e) {
    console.error('[ocr]', e.message);
  }
  ocrRunning = false;
}

app.whenReady().then(() => {
  db.init();
  createPanel();
  openDashboard();
  createTray();
  startHook();
  if (app.isPackaged) initAutoUpdate(); // kontrola aktuálnosti při každém startu
});

app.on('will-quit', () => { try { uIOhook.stop(); } catch (_) {} });
// app žije v systray i po zavření oken — žádný quit zde
app.on('window-all-closed', () => { });

ipcMain.handle('db:matches', () => db.getMatches());
ipcMain.handle('settings:get', (e, k) => db.getSetting(k));
ipcMain.handle('settings:set', (e, k, v) => { db.setSetting(k, v); if (k === 'hotkey') refreshTriggerKey(); });
ipcMain.handle('titles:update', async () => { await require('./titles').forceUpdate(); return true; });

// dashboard: po uložení jména → potvrzení nebo chyba
ipcMain.handle('player:lookup', async (e, name) => {
  const p = await api.searchPlayer(name);
  if (!p) throw new Error('not found');
  const ranked = await api.getPlayerRanked(p.id);
  return { username: p.username, rating: ranked.rating, tier: ranked.tier };
});

ipcMain.on('match:result', (e, m) => {
  db.saveMatch({
    timestamp: Date.now(),
    result: m.result,
    my_elo: m.my_elo,
    opponent_elo: m.opponent_elo,
    season: m.season
  });
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('refresh');
});
