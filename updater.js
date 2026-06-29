const { autoUpdater } = require('electron-updater');

// Auto-update přes GitHub Releases. Volat z main.js jen když app.isPackaged.
function initAutoUpdate() {
  autoUpdater.disableDifferentialDownload = true; // diff download se zasekává → vždy plný installer
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;        // tichá instalace při zavření
  autoUpdater.on('error', e => console.error('[updater]', e && e.message));
  autoUpdater.on('update-available', i => console.log('[updater] update available', i && i.version));
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'));
  autoUpdater.on('update-downloaded', i => console.log('[updater] downloaded', i && i.version));
  autoUpdater.checkForUpdates().catch(e => console.error('[updater]', e && e.message));
}

module.exports = { initAutoUpdate };
