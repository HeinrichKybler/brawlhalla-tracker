const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
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
const { initAutoUpdate, autoUpdater } = require('./updater');

let panelWin, overlayWin, dashWin, tray, gameTimer = null, overlayTimer = null;
let ocrRunning = false, gameRunning = false, updateReady = false;
app.isQuitting = false;

// nainstaluj stažený update jakmile appka není zaneprázdněná hrou (app jinak nikdy nekončí)
function maybeInstallUpdate() {
  if (!updateReady || gameRunning) return;
  app.isQuitting = true;
  try { autoUpdater.quitAndInstall(true, true); } catch (e) { console.error('[updater]', e && e.message); }
}

// --- panel na druhém monitoru (na výšku) ---
function createPanel() {
  const displays = screen.getAllDisplays();
  const ext = displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) || displays[0];
  panelWin = new BrowserWindow({
    x: ext.bounds.x + 20, y: ext.bounds.y + 20,
    width: 240, height: 660,
    frame: false, skipTaskbar: true, alwaysOnTop: false, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  panelWin.loadFile(path.join(__dirname, 'windows', 'panel.html'));
  panelWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); panelWin.hide(); } });
}

// --- overlay na hlavním monitoru (na šířku, Alt+T) ---
function createOverlay() {
  const prim = screen.getPrimaryDisplay();
  const W = Math.min(1100, prim.bounds.width - 80), H = 190;
  overlayWin = new BrowserWindow({
    x: Math.round(prim.bounds.x + (prim.bounds.width - W) / 2),
    y: Math.round(prim.bounds.y + (prim.bounds.height - H) / 2),
    width: W, height: H,
    frame: false, transparent: true, skipTaskbar: true, alwaysOnTop: true,
    focusable: false, resizable: false, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadFile(path.join(__dirname, 'windows', 'overlay.html'));
  overlayWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); overlayWin.hide(); } });
}

function togglePanel() {
  if (!panelWin || panelWin.isDestroyed()) return;
  if (panelWin.isVisible()) panelWin.hide(); else panelWin.showInactive();
}
function showOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) createOverlay();
  overlayWin.showInactive();
  if (overlayTimer) clearTimeout(overlayTimer);
  overlayTimer = setTimeout(hideOverlay, 30000); // auto-skrytí po 30 s
}
function hideOverlay() {
  if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
}
function toggleOverlay() {
  if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) hideOverlay();
  else showOverlay();
}

function broadcast(channel, payload) {
  for (const w of [panelWin, overlayWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function openDashboard() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.show(); dashWin.focus(); return; }
  dashWin = new BrowserWindow({
    width: 1180, height: 820,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  dashWin.loadFile(path.join(__dirname, 'windows', 'dashboard.html'));
}
function toggleDashboard() {
  if (dashWin && !dashWin.isDestroyed() && dashWin.isVisible()) dashWin.hide();
  else openDashboard();
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

// --- hotkeys přes pasivní hook (neblokují klávesy) ---
let triggerKeycode = UiohookKey.J;
function keyNameToCode(name) {
  const key = String(name || 'J').trim().toUpperCase().split('+').pop();
  return UiohookKey[key] != null ? UiohookKey[key] : UiohookKey.J;
}
function refreshTriggerKey() {
  triggerKeycode = keyNameToCode(db.getSetting('hotkey') || 'J');
}
function startHook() {
  refreshTriggerKey();
  uIOhook.on('keydown', e => {
    const noMods = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    if (e.keycode === triggerKeycode && noMods) { runOcr(); return; }
    if (e.keycode === UiohookKey.T && e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { toggleOverlay(); return; }
    if (e.keycode === UiohookKey.T && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) { togglePanel(); return; }
    if (e.keycode === UiohookKey.B && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) { toggleDashboard(); return; }
  });
  uIOhook.start();
}

// --- watcher hry: app aktivní jen když běží Brawlhalla ---
function checkGame() {
  exec('tasklist /FI "IMAGENAME eq Brawlhalla.exe" /NH', { windowsHide: true }, (err, stdout) => {
    const running = !err && /brawlhalla\.exe/i.test(stdout);
    if (running !== gameRunning) { gameRunning = running; onGameState(running); }
  });
}
function onGameState(running) {
  if (!running) {
    if (panelWin && !panelWin.isDestroyed()) panelWin.hide();
    hideOverlay();
    maybeInstallUpdate(); // hra zavřená → vhodná chvíle nainstalovat čekající update
  }
}
function startGameWatcher() {
  checkGame();
  gameTimer = setInterval(checkGame, 5000);
}

function setupAutostart() {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [] }); } catch (_) {}
}

async function gatherSelf() {
  const myName = db.getSetting('my_name');
  if (!myName) return null;
  const p = await api.searchPlayer(myName);
  if (!p) return null;
  const [ranked, all] = await Promise.all([api.getPlayerRanked(p.id), api.getPlayerAll(p.id)]);
  return { name: p.username, ranked, all };
}

async function runOcr() {
  if (ocrRunning) return;
  if (app.isPackaged && !gameRunning) return; // aktivní jen při hře (v devu povoleno pro test)
  ocrRunning = true;
  broadcast('panel:status', 'loading');
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
          gatherSelf().catch(() => null)
        ]);
        const weaponMap = {};
        for (const l of legends) weaponMap[l.legend_id] = [l.weapon_one, l.weapon_two];
        const payload = {
          opponent: p.username,
          opponentLegend: res.opponentLegend,
          ranked, all, weaponMap,
          me: self,
          myElo: self ? self.ranked.rating : null,
          oppElo: ranked.rating,
          season: parseInt(db.getSetting('season') || '1', 10),
          mapName: ''
        };
        if (panelWin && !panelWin.isDestroyed()) panelWin.showInactive(); // auto-open i když byl skrytý
        broadcast('panel:data', payload);
      } else {
        broadcast('panel:status', 'error');
      }
    } else {
      broadcast('panel:status', 'error');
    }
  } catch (e) {
    console.error('[ocr]', e.message);
    broadcast('panel:status', 'error');
  }
  ocrRunning = false;
}

app.whenReady().then(() => {
  db.init();
  createPanel();
  createOverlay();
  createTray();
  startHook();
  setupAutostart();
  startGameWatcher();
  if (app.isPackaged) initAutoUpdate(() => { updateReady = true; maybeInstallUpdate(); });
});

app.on('will-quit', () => { if (gameTimer) clearInterval(gameTimer); try { uIOhook.stop(); } catch (_) {} });
// app žije v systray i po zavření oken — žádný quit zde
app.on('window-all-closed', () => { });

ipcMain.handle('db:matches', () => db.getMatches());
ipcMain.handle('settings:get', (e, k) => db.getSetting(k));
ipcMain.handle('settings:set', (e, k, v) => { db.setSetting(k, v); if (k === 'hotkey') refreshTriggerKey(); });
ipcMain.handle('titles:update', async () => { await require('./titles').forceUpdate(); return true; });
ipcMain.handle('api:status', () => !!process.env.BH_API_KEY);
ipcMain.on('hide-overlay', hideOverlay);

// dashboard: profilová karta (moje staty)
ipcMain.handle('me:stats', async () => {
  const self = await gatherSelf().catch(() => null);
  if (!self) return null;
  return {
    name: self.name,
    region: db.getSetting('region') || '',
    season: parseInt(db.getSetting('season') || '1', 10),
    rating: self.ranked.rating,
    peak_rating: self.ranked.peak_rating,
    tier: self.ranked.tier,
    legends: self.ranked.legends
  };
});

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
