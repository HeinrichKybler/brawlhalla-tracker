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

let panelWin, overlayWin, dashWin, tray, splashWin = null, gameTimer = null, overlayTimer = null;
let ocrRunning = false, gameRunning = false, updateReady = false;
app.isQuitting = false;

// --- splash (fotka na pár vteřin při startu) ---
function createSplash() {
  splashWin = new BrowserWindow({
    width: 320, height: 300,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, center: true, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  splashWin.loadFile(path.join(__dirname, 'windows', 'splash.html'));
  splashWin.once('ready-to-show', () => { if (splashWin && !splashWin.isDestroyed()) splashWin.show(); });
}
function closeSplash() {
  if (splashWin && !splashWin.isDestroyed()) splashWin.close();
  splashWin = null;
}

// nainstaluj stažený update jakmile appka není zaneprázdněná hrou (app jinak nikdy nekončí)
function maybeInstallUpdate() {
  if (!updateReady || gameRunning) return;
  app.isQuitting = true;
  try { autoUpdater.quitAndInstall(true, true); } catch (e) { console.error('[updater]', e && e.message); }
}

// zvětšení celého UI (text + ikony) — okna mají místa dost; rozměry níže jsou už poškálované
const ZOOM = { panel: 1.25, overlay: 1.2, dashboard: 1.25 };
function applyZoom(win, factor) {
  win.webContents.on('did-finish-load', () => { try { win.webContents.setZoomFactor(factor); } catch (_) {} });
}

// --- panel na druhém monitoru (na výšku) ---
function createPanel() {
  const displays = screen.getAllDisplays();
  const ext = displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) || displays[0];
  panelWin = new BrowserWindow({
    x: ext.bounds.x + 20, y: ext.bounds.y + 20,
    width: 300, height: 820, // 240×660 * zoom 1.25
    frame: false, skipTaskbar: true, alwaysOnTop: false, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  applyZoom(panelWin, ZOOM.panel);
  panelWin.loadFile(path.join(__dirname, 'windows', 'panel.html'));
  panelWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); panelWin.hide(); } });
}

// --- overlay na hlavním monitoru (na šířku, Alt+T) ---
function createOverlay() {
  const prim = screen.getPrimaryDisplay();
  const W = Math.min(1200, prim.bounds.width - 80), H = 235; // výška zvětšena kvůli zoomu
  overlayWin = new BrowserWindow({
    x: Math.round(prim.bounds.x + (prim.bounds.width - W) / 2),
    y: Math.round(prim.bounds.y + (prim.bounds.height - H) / 2),
    width: W, height: H,
    frame: false, transparent: true, skipTaskbar: true, alwaysOnTop: true,
    focusable: false, resizable: false, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  applyZoom(overlayWin, ZOOM.overlay);
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
  if (dashWin && !dashWin.isDestroyed()) {
    if (dashWin.isMinimized()) dashWin.restore();
    dashWin.show(); dashWin.focus(); return;
  }
  dashWin = new BrowserWindow({
    width: 1360, height: 900, // větší okno, obsah zvětšen zoomem
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  applyZoom(dashWin, ZOOM.dashboard);
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
  // Autostart vypnut — appku spouštím ručně. Vyčistí i dříve nastavený login item.
  try { app.setLoginItemSettings({ openAtLogin: false }); } catch (_) {}
}

const numOrNull = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

// bez API klíče: profil „já" z ručně zadaných hodnot (Nastavení) místo mock dat
function manualSelf() {
  const name = db.getSetting('my_name');
  if (!name) return null;
  let raw = [];
  try { raw = JSON.parse(db.getSetting('manual_legends') || '[]'); } catch (_) {}
  const legends = raw.map(l => {
    const games = +l.games || 0, wins = +l.wins || 0;
    return { id: api.legendIdByName(l.name), name: l.name, games, wins, winrate: games ? wins / games : 0 };
  });
  const ranked = {
    rating: numOrNull(db.getSetting('manual_rating')),
    peak_rating: numOrNull(db.getSetting('manual_peak')),
    tier: db.getSetting('manual_tier') || '',
    legends
  };
  const all = { legends: legends.map(l => ({ id: l.id, name: l.name, games: l.games, wins: l.wins, t1: 0, t2: 0 })) };
  return { name, ranked, all };
}

async function gatherSelf() {
  if (!process.env.BH_API_KEY) return manualSelf();
  const myName = db.getSetting('my_name');
  if (!myName) return null;
  const p = await api.searchPlayer(myName);
  if (!p) return null;
  const [ranked, all] = await Promise.all([api.getPlayerRanked(p.id), api.getPlayerAll(p.id)]);
  return { name: p.username, ranked, all };
}

// kompletní profil hráče pro dashboard (základní info + legendy + zbraně + guilda)
async function buildProfile(name) {
  const p = await api.searchPlayer(name);
  if (!p) return null;
  const [ranked, all, legendsStatic] = await Promise.all([
    api.getPlayerRanked(p.id),
    api.getPlayerAll(p.id),
    api.getLegends().catch(() => [])
  ]);
  const weaponMap = {};
  for (const l of legendsStatic) weaponMap[l.legend_id] = [l.weapon_one, l.weapon_two];
  const legends = (all.legends || []).map(l => {
    const w = weaponMap[l.id] || api.WEAPON_MAP[l.id] || [];
    return {
      id: l.id, name: l.name, games: l.games, wins: l.wins, kos: l.kos, damage: l.damage,
      t1: l.t1, t2: l.t2, w1: w[0] || '', w2: w[1] || ''
    };
  });
  const weapons = api.computeWeaponStats(all.legends, weaponMap);
  const topLegend = legends.slice().sort((a, b) => b.games - a.games)[0] || null;
  return {
    brawlhalla_id: p.id,
    name: p.username,
    rating: ranked.rating, peak_rating: ranked.peak_rating, tier: ranked.tier,
    region: ranked.region || '',
    wins: ranked.wins || 0, games: ranked.games || 0,
    clan: all.clan || null,
    totalKos: all.totalKos || 0, totalDamage: all.totalDamage || 0,
    topLegend: topLegend ? { id: topLegend.id, name: topLegend.name, games: topLegend.games } : null,
    topWeapon: weapons[0] ? { name: weapons[0].weapon } : null,
    legends, weapons, weaponMap
  };
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

// single-instance: druhé spuštění (dvojklik na zástupce) neotevře nový proces
// (jinak by v tray naskočila druhá ikona) — jen otevře/zaostří dashboard
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => openDashboard());
  app.whenReady().then(() => {
    createSplash();
    db.init();
    createPanel();
    createOverlay();
    createTray();
    startHook();
    setupAutostart();
    startGameWatcher();
    if (app.isPackaged) initAutoUpdate(() => { updateReady = true; maybeInstallUpdate(); });
    // splash na ~2,5 s, pak se rovnou otevře dashboard (ne jen běh na pozadí)
    setTimeout(() => { closeSplash(); openDashboard(); }, 2500);
  });
}

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

// dashboard: vyhledávání hráče → našeptávač (historie + živý výsledek z API/mocku)
ipcMain.handle('search:suggest', async (e, q) => {
  const history = db.getSearchHistory(q, 6);
  let players = [];
  try {
    const p = await api.searchPlayer(q);
    if (p && p.username) players = [{ name: p.username, id: p.id }];
  } catch (_) { /* API mimo */ }
  return { history, players };
});

// dashboard: kompletní profil hráče (uloží i do historie hledání)
ipcMain.handle('player:profile', async (e, name) => {
  const prof = await buildProfile(name);
  if (!prof) throw new Error('not found');
  db.addSearch(name, 'player');
  return prof;
});

// dashboard: profil guildy (guildy se do historie neukládají — nelze je hledat podle jména)
ipcMain.handle('clan:get', async (e, clanId) => api.getClan(clanId));

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
