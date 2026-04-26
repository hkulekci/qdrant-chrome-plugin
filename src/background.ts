import { QdrantApi } from './lib/qdrant-api';
import * as storage from './lib/storage';

const REFRESH_ALARM_NAME = 'qdrant-background-refresh';
const REFRESH_PERIOD_MINUTES = 5;

interface PendingUpdate {
  version: string;
  detectedAt: string;
  previousVersion: string;
}

async function refreshCluster(clusterId: string, url: string, apiKey?: string): Promise<void> {
  const attemptedAt = new Date().toISOString();
  try {
    const api = new QdrantApi(url, apiKey);
    const data = await api.getDashboardData();
    await storage.saveDashboardSnapshot(clusterId, data, attemptedAt);
  } catch (error) {
    await storage.recordClusterRefreshFailure(clusterId, (error as Error).message, attemptedAt);
  }
}

async function refreshAllClusters(): Promise<void> {
  const clusters = await storage.getClusters();
  await Promise.all(clusters.map(cluster => refreshCluster(cluster.id, cluster.url, cluster.apiKey)));
}

function scheduleBackgroundRefresh(): void {
  chrome.alarms.create(REFRESH_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: REFRESH_PERIOD_MINUTES,
  });
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
  scheduleBackgroundRefresh();
  await refreshAllClusters();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleBackgroundRefresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM_NAME) {
    void refreshAllClusters();
  }
});
