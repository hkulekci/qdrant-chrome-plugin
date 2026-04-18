import { useState, useEffect } from 'react';
import type { ClusterConfig, Insight, InsightsFilter } from '../lib/types';
import { DEFAULT_INSIGHTS_FILTER } from '../lib/types';
import * as storage from '../lib/storage';
import { runRules } from '../rules';
import { useDashboardData } from './hooks/useDashboardData';
import { InsightsPanel } from './InsightsPanel';
import { OverviewTab } from './tabs/OverviewTab';
import { CollectionsTab } from './tabs/CollectionsTab';
import { ShardsTab } from './tabs/ShardsTab';
import { TransfersTab } from './tabs/TransfersTab';
import { ClusterTab } from './tabs/ClusterTab';
import { RequestsTab } from './tabs/RequestsTab';
import { OptimizationsTab } from './tabs/OptimizationsTab';
import { InsightsTab } from './tabs/InsightsTab';
import { UpdateBanner } from '../components/UpdateBanner';

type TabName = 'overview' | 'collections' | 'shards' | 'optimizations' | 'transfers' | 'cluster' | 'requests' | 'insights';

const TABS: { key: TabName; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'collections', label: 'Collections' },
  { key: 'shards', label: 'Shard Distribution' },
  { key: 'optimizations', label: 'Optimizations' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'cluster', label: 'Cluster' },
  { key: 'requests', label: 'Requests' },
  { key: 'insights', label: 'Insights' },
];

export function Dashboard() {
  const [cluster, setCluster] = useState<ClusterConfig | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>('overview');
  const [lastUpdated, setLastUpdated] = useState('');
  const [insightsFilter, setInsightsFilter] = useState<InsightsFilter>(DEFAULT_INSIGHTS_FILTER);
  const { data, loading, error, refresh } = useDashboardData(cluster);

  const navigateToInsights = (filterOverride?: Partial<InsightsFilter>) => {
    setInsightsFilter({ ...DEFAULT_INSIGHTS_FILTER, ...filterOverride });
    setActiveTab('insights');
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clusterId = params.get('cluster');
    if (!clusterId) return;

    storage.getClusters().then(clusters => {
      const found = clusters.find(c => c.id === clusterId);
      if (found) {
        setCluster(found);
        document.title = `Qdrant - ${found.name}`;
      }
    });
  }, []);

  useEffect(() => {
    if (cluster) refresh();
  }, [cluster]);

  useEffect(() => {
    if (data) setLastUpdated(new Date().toLocaleTimeString());
  }, [data]);

  const insights: Insight[] = data ? runRules(data) : [];
  const criticalCount = insights.filter(i => i.level === 'critical').length;
  const warningCount = insights.filter(i => i.level === 'warning').length;
  const version = data?.telemetry?.app?.version;
  const nodeCount = Object.keys(data?.nodeTelemetry || {}).length;
  const totalPeers = data?.cluster?.peers ? Object.keys(data.cluster.peers).length : 1;

  if (!cluster) {
    return <div className="container"><div className="error-box">No cluster specified. Open a cluster from the popup.</div></div>;
  }

  return (
    <div className="container">
      <UpdateBanner />
      <header>
        <div className="header-left">
          <h1>Qdrant Dashboard</h1>
          <span className="cluster-badge">{cluster.name}</span>
        </div>
        <div className="header-right">
          {version && <span className="version-badge">v{version}</span>}
          {data && <span className="version-badge" style={{ color: nodeCount >= totalPeers ? 'var(--success)' : 'var(--warning)' }}>{nodeCount}/{totalPeers} nodes</span>}
          {lastUpdated && <span className="last-updated">Updated: {lastUpdated}</span>}
          <a
            className="btn btn-github"
            href="https://github.com/hkulekci/qdrant-chrome-plugin"
            target="_blank"
            rel="noopener noreferrer"
            title="See something wrong? Open an issue or star the repo on GitHub"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            <span>Star on GitHub</span>
            <span className="github-hint">★</span>
          </a>
          <button className="btn btn-refresh" onClick={refresh} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>

      {loading && !data && (
        <div className="loading"><div className="spinner" /><p>Connecting to cluster...</p></div>
      )}

      {error && <div className="error-box">{error}</div>}

      {data && (
        <>
          <InsightsPanel insights={insights} onNavigate={navigateToInsights} />

          <div className="tabs">
            {TABS.map(t => {
              const isInsights = t.key === 'insights';
              return (
                <button key={t.key} className={`tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
                  {t.label}
                  {isInsights && criticalCount > 0 && (
                    <span className="tab-badge critical" title={`${criticalCount} critical`}>{criticalCount}</span>
                  )}
                  {isInsights && criticalCount === 0 && warningCount > 0 && (
                    <span className="tab-badge warning" title={`${warningCount} warning${warningCount === 1 ? '' : 's'}`}>{warningCount}</span>
                  )}
                </button>
              );
            })}
          </div>

          {activeTab === 'overview' && <OverviewTab data={data} />}
          {activeTab === 'collections' && <CollectionsTab data={data} insights={insights} cluster={cluster} onRefresh={refresh} onNavigateInsights={navigateToInsights} />}
          {activeTab === 'shards' && <ShardsTab data={data} />}
          {activeTab === 'optimizations' && <OptimizationsTab data={data} cluster={cluster} />}
          {activeTab === 'transfers' && <TransfersTab data={data} />}
          {activeTab === 'cluster' && <ClusterTab data={data} />}
          {activeTab === 'requests' && <RequestsTab data={data} />}
          {activeTab === 'insights' && <InsightsTab insights={insights} filter={insightsFilter} onFilterChange={setInsightsFilter} collections={data.collections} />}
        </>
      )}
    </div>
  );
}
