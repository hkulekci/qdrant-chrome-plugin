import type {
  CachedDashboardSnapshot,
  ClusterConfig,
  ClusterRefreshState,
  DashboardData,
  MetricsHistorySample,
} from './types';
import { createMetricsSample } from './metrics';

const SNAPSHOT_PREFIX = 'dashboardSnapshot:';
const REFRESH_STATE_PREFIX = 'clusterRefreshState:';
const HISTORY_PREFIX = 'metricsHistory:';
const MAX_HISTORY_SAMPLES = 288;

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

export async function appendMetricsHistorySample(sample: MetricsHistorySample): Promise<void> {
  const key = `${HISTORY_PREFIX}${sample.clusterId}`;
  const history = await getMetricsHistory(sample.clusterId);
  const next = [...history, sample].slice(-MAX_HISTORY_SAMPLES);
  await chrome.storage.local.set({ [key]: next });
}
