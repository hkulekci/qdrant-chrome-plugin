import { QdrantApi } from './lib/qdrant-api';
import * as storage from './lib/storage';
import { ALARM_PERIOD_MINUTES, resolveFrequencyMinutes } from './lib/cache-config';

const REFRESH_ALARM_NAME = 'qdrant-background-refresh';

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

/**
 * Refresh only the clusters that are due according to their per-cluster
 * cachedFrequencyMinutes. The alarm fires every minute, but each cluster
 * is gated by its own interval (with a hard 1-minute floor enforced by
 * resolveFrequencyMinutes).
 */
async function refreshDueClusters(): Promise<void> {
  const now = Date.now();
  const clusters = await storage.getClusters();
  const states = await Promise.all(clusters.map(c => storage.getClusterRefreshState(c.id)));

  const due = clusters.filter((cluster, i) => {
    const intervalMs = resolveFrequencyMinutes(cluster.cachedFrequencyMinutes) * 60 * 1000;
    const lastSuccess = states[i]?.lastSuccessAt;
    if (!lastSuccess) return true; // never refreshed → run now
    return now - new Date(lastSuccess).getTime() >= intervalMs;
  });

  await Promise.all(due.map(c => refreshCluster(c.id, c.url, c.apiKey)));
}

function scheduleBackgroundRefresh(): void {
  chrome.alarms.create(REFRESH_ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES,
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
  await refreshDueClusters();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleBackgroundRefresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM_NAME) {
    void refreshDueClusters();
  }
});
