interface PendingUpdate {
  version: string;
  detectedAt: string;
  previousVersion: string;
}

chrome.runtime.onUpdateAvailable.addListener(async (details) => {
  const manifest = chrome.runtime.getManifest();
  const pending: PendingUpdate = {
    version: details.version,
    detectedAt: new Date().toISOString(),
    previousVersion: manifest.version,
  };
  await chrome.storage.local.set({ pendingUpdate: pending });
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update' || details.reason === 'install') {
    await chrome.storage.local.remove('pendingUpdate');
  }
});
