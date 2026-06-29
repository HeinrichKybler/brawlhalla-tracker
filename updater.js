const { autoUpdater } = require('electron-updater');

// Auto-update přes GitHub Releases. Volat z main.js jen když app.isPackaged.
// onDownloaded(info) se zavolá, až je nová verze stažená a připravená k instalaci.
function initAutoUpdate(onDownloaded) {
  autoUpdater.disableDifferentialDownload = true; // diff download se zasekává → vždy plný installer
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;        // fallback: instalace při ukončení z tray
  autoUpdater.on('error', e => console.error('[updater]', e && e.message));
  autoUpdater.on('update-available', i => console.log('[updater] update available', i && i.version));
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'));
  autoUpdater.on('update-downloaded', i => {
    console.log('[updater] downloaded', i && i.version);
    if (onDownloaded) onDownloaded(i);
  });
  autoUpdater.checkForUpdates().catch(e => console.error('[updater]', e && e.message));
  // periodická kontrola (app běží dlouho v tray) — každých 6 h
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

module.exports = { initAutoUpdate, autoUpdater };
