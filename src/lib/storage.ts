import type {
  CachedDashboardSnapshot,
  ClusterConfig,
  ClusterRefreshState,
  DashboardData,
  MetricsHistorySample,
} from './types';
import { createMetricsSample } from './metrics';
import { STORAGE_BUDGET_BYTES } from './cache-config';

const SNAPSHOT_PREFIX = 'dashboardSnapshot:';
const REFRESH_STATE_PREFIX = 'clusterRefreshState:';
const HISTORY_PREFIX = 'metricsHistory:';
const MAX_HISTORY_SAMPLES = 288;

function jsonByteSize(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

export async function getClusters(): Promise<ClusterConfig[]> {
  const data = await chrome.storage.local.get('clusters') as { clusters?: ClusterConfig[] };
  return data.clusters || [];
}

export async function saveClusters(clusters: ClusterConfig[]): Promise<void> {
  await chrome.storage.local.set({ clusters });
}

export async function addCluster(cluster: Omit<ClusterConfig, 'id' | 'addedAt'>): Promise<ClusterConfig> {
  const clusters = await getClusters();
  const newCluster: ClusterConfig = {
    ...cluster,
    id: crypto.randomUUID(),
    addedAt: new Date().toISOString(),
  };
  clusters.push(newCluster);
  await saveClusters(clusters);
  return newCluster;
}

export async function updateCluster(id: string, updates: Partial<ClusterConfig>): Promise<ClusterConfig> {
  const clusters = await getClusters();
  const index = clusters.findIndex(c => c.id === id);
  if (index === -1) throw new Error('Cluster not found');
  clusters[index] = { ...clusters[index], ...updates };
  await saveClusters(clusters);
  return clusters[index];
}

export async function removeCluster(id: string): Promise<void> {
  const clusters = await getClusters();
  await saveClusters(clusters.filter(c => c.id !== id));
  await chrome.storage.local.remove([
    `${SNAPSHOT_PREFIX}${id}`,
    `${REFRESH_STATE_PREFIX}${id}`,
    `${HISTORY_PREFIX}${id}`,
  ]);
}

export async function getDashboardSnapshot(clusterId: string): Promise<CachedDashboardSnapshot | null> {
  const key = `${SNAPSHOT_PREFIX}${clusterId}`;
  const data = await chrome.storage.local.get(key) as Record<string, CachedDashboardSnapshot | undefined>;
  return data[key] || null;
}

export async function saveDashboardSnapshot(clusterId: string, data: DashboardData, capturedAt = new Date().toISOString()): Promise<CachedDashboardSnapshot> {
  const snapshot: CachedDashboardSnapshot = { clusterId, capturedAt, data };
  await chrome.storage.local.set({ [`${SNAPSHOT_PREFIX}${clusterId}`]: snapshot });
  await setClusterRefreshState({ clusterId, lastAttemptAt: capturedAt, lastSuccessAt: capturedAt });
  await appendMetricsHistorySample(createMetricsSample(clusterId, capturedAt, data));
  return snapshot;
}

export async function getClusterRefreshState(clusterId: string): Promise<ClusterRefreshState | null> {
  const key = `${REFRESH_STATE_PREFIX}${clusterId}`;
  const data = await chrome.storage.local.get(key) as Record<string, ClusterRefreshState | undefined>;
  return data[key] || null;
}

export async function setClusterRefreshState(state: ClusterRefreshState): Promise<void> {
  await chrome.storage.local.set({ [`${REFRESH_STATE_PREFIX}${state.clusterId}`]: state });
}

/**
 * Drops the snapshot, refresh state, and metrics history for one cluster.
 * The cluster config itself is preserved — caller usually triggers a fresh
 * refresh right after to repopulate.
 */
export async function clearClusterCache(clusterId: string): Promise<void> {
  await chrome.storage.local.remove([
    `${SNAPSHOT_PREFIX}${clusterId}`,
    `${REFRESH_STATE_PREFIX}${clusterId}`,
    `${HISTORY_PREFIX}${clusterId}`,
  ]);
}

export async function recordClusterRefreshFailure(clusterId: string, error: string, attemptedAt = new Date().toISOString()): Promise<void> {
  const previous = await getClusterRefreshState(clusterId);
  await setClusterRefreshState({
    clusterId,
    lastAttemptAt: attemptedAt,
    lastSuccessAt: previous?.lastSuccessAt,
    lastError: error,
  });
}

export async function getMetricsHistory(clusterId: string): Promise<MetricsHistorySample[]> {
  const key = `${HISTORY_PREFIX}${clusterId}`;
  const data = await chrome.storage.local.get(key) as Record<string, MetricsHistorySample[] | undefined>;
  return data[key] || [];
}

/**
 * Appends a metrics sample, then enforces both the hard sample-count cap
 * (MAX_HISTORY_SAMPLES) and the soft storage byte budget (STORAGE_BUDGET_BYTES).
 *
 * Byte enforcement reads the live total via getBytesInUse so the budget
 * accounts for snapshots, refresh state, and other clusters' histories — not
 * just this cluster's series. When the projected total would exceed the
 * budget, we drop the oldest samples from THIS cluster's history (FIFO)
 * until it fits or only the new sample remains.
 */
export async function appendMetricsHistorySample(sample: MetricsHistorySample): Promise<void> {
  const key = `${HISTORY_PREFIX}${sample.clusterId}`;
  const oldHistory = await getMetricsHistory(sample.clusterId);
  let nextHistory = [...oldHistory, sample].slice(-MAX_HISTORY_SAMPLES);

  const totalBytesBefore = await chrome.storage.local.getBytesInUse(null);
  const oldKeyBytes = oldHistory.length === 0 ? 0 : jsonByteSize(oldHistory);
  let projected = totalBytesBefore - oldKeyBytes + jsonByteSize(nextHistory);

  while (projected > STORAGE_BUDGET_BYTES && nextHistory.length > 1) {
    nextHistory = nextHistory.slice(1);
    projected = totalBytesBefore - oldKeyBytes + jsonByteSize(nextHistory);
  }

  await chrome.storage.local.set({ [key]: nextHistory });
}
