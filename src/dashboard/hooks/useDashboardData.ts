import { useState, useCallback, useEffect } from 'react';
import type { DashboardData, ClusterConfig, ClusterRefreshState, MetricsHistorySample } from '../../lib/types';
import { QdrantApi } from '../../lib/qdrant-api';
import * as storage from '../../lib/storage';

interface UseDashboardDataResult {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  capturedAt: string | null;
  history: MetricsHistorySample[];
  refreshState: ClusterRefreshState | null;
  refresh: () => void;
  /** Drops cached snapshot/history/state for the active cluster, then
   *  triggers a fresh fetch so the UI is repopulated immediately. */
  clearCache: () => Promise<void>;
}

export function useDashboardData(cluster: ClusterConfig | null): UseDashboardDataResult {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<MetricsHistorySample[]>([]);
  const [refreshState, setRefreshState] = useState<ClusterRefreshState | null>(null);

  const loadCachedData = useCallback(async () => {
    if (!cluster) {
      setData(null);
      setCapturedAt(null);
      setHistory([]);
      setRefreshState(null);
      return;
    }

    const [snapshot, storedHistory, storedRefreshState] = await Promise.all([
      storage.getDashboardSnapshot(cluster.id),
      storage.getMetricsHistory(cluster.id),
      storage.getClusterRefreshState(cluster.id),
    ]);

    if (snapshot) {
      setData(snapshot.data);
      setCapturedAt(snapshot.capturedAt);
    } else {
      setData(null);
      setCapturedAt(null);
    }
    setHistory(storedHistory);
    setRefreshState(storedRefreshState);
  }, [cluster?.id]);

  useEffect(() => {
    void loadCachedData();
  }, [loadCachedData]);

  const refresh = useCallback(async () => {
    if (!cluster) return;
    setLoading(true);
    setError(null);
    try {
      const api = new QdrantApi(cluster.url, cluster.apiKey);
      const result = await api.getDashboardData();
      const snapshot = await storage.saveDashboardSnapshot(cluster.id, result);
      const storedHistory = await storage.getMetricsHistory(cluster.id);
      const storedRefreshState = await storage.getClusterRefreshState(cluster.id);
      setData(result);
      setCapturedAt(snapshot.capturedAt);
      setHistory(storedHistory);
      setRefreshState(storedRefreshState);
    } catch (e) {
      const message = (e as Error).message;
      await storage.recordClusterRefreshFailure(cluster.id, message);
      setRefreshState(await storage.getClusterRefreshState(cluster.id));
      setError(`Failed to load live data: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [cluster?.id, cluster?.url, cluster?.apiKey]);

  const clearCache = useCallback(async () => {
    if (!cluster) return;
    await storage.clearClusterCache(cluster.id);
    // Reset local state so the UI doesn't keep showing stale numbers
    // between the clear and the subsequent refresh's response.
    setData(null);
    setCapturedAt(null);
    setHistory([]);
    setRefreshState(null);
    setError(null);
    await refresh();
  }, [cluster?.id, refresh]);

  return { data, loading, error, capturedAt, history, refreshState, refresh, clearCache };
}
