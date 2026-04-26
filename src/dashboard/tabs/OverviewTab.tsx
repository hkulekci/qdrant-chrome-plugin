import { useState } from 'react';
import type { ClusterConfig, ClusterRefreshState, DashboardData, MetricsHistorySample } from '../../lib/types';
import { formatBytes, formatDuration, formatNumber } from '../../lib/format';
import { SummaryStats } from '../SummaryStats';
import { Sparkline } from '../Sparkline';
import { ConfirmDialog } from '../ConfirmDialog';
import { DEFAULT_CACHED_FREQUENCY_MINUTES, resolveFrequencyMinutes } from '../../lib/cache-config';

const FREQUENCY_PRESETS = [1, 5, 15, 30, 60];

interface MetricCardProps {
  title: string;
  value: string;
  delta?: { text: string; sign: 'pos' | 'neg' | 'neutral' };
  values: number[];
  labels: string[];
  format: (v: number) => string;
  color?: string;
}

function MetricCard({ title, value, delta, values, labels, format, color }: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-card-title">{title}</div>
      <div className="metric-card-value">{value}</div>
      {delta && (
        <div className={`metric-card-delta ${delta.sign}`}>{delta.text}</div>
      )}
      <Sparkline
        values={values}
        labels={labels}
        format={format}
        color={color}
        height={36}
      />
    </div>
  );
}

export function OverviewTab({
  data, history, capturedAt, refreshState, cluster, onUpdateCluster, onClearCache,
}: {
  data: DashboardData;
  history: MetricsHistorySample[];
  capturedAt: string | null;
  refreshState: ClusterRefreshState | null;
  cluster: ClusterConfig | null;
  onUpdateCluster: (updates: Partial<ClusterConfig>) => Promise<void>;
  onClearCache: () => Promise<void>;
}) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const app = data.telemetry?.app;
  const sys = app?.system;
  const features = app?.features || {};
  const mem = data.telemetry?.memory;
  const ramBytes = sys?.ram_size ? sys.ram_size * 1024 : null;

  const startup = app?.startup ? new Date(app.startup).toLocaleString() : 'N/A';
  const uptime = app?.startup ? formatDuration(Date.now() - new Date(app.startup).getTime()) : 'N/A';
  const firstSample = history[0];
  const latestSample = history[history.length - 1];
  const historyWindow = firstSample && latestSample
    ? formatDuration(new Date(latestSample.capturedAt).getTime() - new Date(firstSample.capturedAt).getTime())
    : 'N/A';
  const collectionsOf = (s?: MetricsHistorySample) => s?.totalCollections ?? s?.collections.length ?? 0;
  const shardsOf = (s?: MetricsHistorySample) => s?.totalShards ?? 0;
  const pointDelta = firstSample && latestSample ? latestSample.totalPoints - firstSample.totalPoints : 0;
  const indexedDelta = firstSample && latestSample ? latestSample.totalIndexedVectors - firstSample.totalIndexedVectors : 0;
  const collectionsDelta = collectionsOf(latestSample) - collectionsOf(firstSample);
  const shardsDelta = shardsOf(latestSample) - shardsOf(firstSample);
  const progressNow = latestSample && latestSample.totalPoints > 0
    ? (latestSample.totalIndexedVectors / latestSample.totalPoints) * 100
    : null;
  const progressFirst = firstSample && firstSample.totalPoints > 0
    ? (firstSample.totalIndexedVectors / firstSample.totalPoints) * 100
    : null;
  const progressDelta = progressNow != null && progressFirst != null ? progressNow - progressFirst : 0;
  const sparkLabels = history.map(h => new Date(h.capturedAt).toLocaleTimeString());
  const lastFailedAt = refreshState?.lastError ? refreshState.lastAttemptAt : null;

  const fmtSignedInt = (n: number) => `${n >= 0 ? '+' : ''}${formatNumber(n)}`;
  const fmtSignedPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)} pp`;
  const sign = (n: number): 'pos' | 'neg' | 'neutral' => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'neutral');

  const memItems = [
    { name: 'Resident', bytes: mem?.resident_bytes, color: '#e94560', desc: 'Physical memory used' },
    { name: 'Active', bytes: mem?.active_bytes, color: '#60a5fa', desc: 'Actively used memory' },
    { name: 'Allocated', bytes: mem?.allocated_bytes, color: '#4ade80', desc: 'Heap allocations' },
    { name: 'Metadata', bytes: mem?.metadata_bytes, color: '#fbbf24', desc: 'Allocator metadata' },
    { name: 'Retained', bytes: mem?.retained_bytes, color: '#8b5cf6', desc: 'Retained by allocator' },
  ];
  const maxBytes = ramBytes || Math.max(...memItems.map(i => i.bytes || 0), 1);

  return (
    <>
      <SummaryStats data={data} />
      <div className="grid-2">
      <div className="card">
        <h2>System Information</h2>
        <table className="info-table">
          <tbody>
            <tr><td>Version</td><td>{app?.version || 'N/A'}</td></tr>
            <tr><td>Distribution</td><td>{sys?.distribution || 'N/A'} {sys?.distribution_version || ''}</td></tr>
            <tr><td>CPU Cores</td><td>{sys?.cores || 'N/A'}</td></tr>
            <tr><td>CPU Flags</td><td>{sys?.cpu_flags || 'N/A'}</td></tr>
            <tr><td>RAM</td><td>{sys?.ram_size ? formatBytes(sys.ram_size * 1024) : 'N/A'}</td></tr>
            <tr><td>Disk</td><td>{sys?.disk_size ? formatBytes(sys.disk_size * 1024) : 'N/A'}</td></tr>
            <tr><td>Docker</td><td>{sys?.is_docker ? 'Yes' : 'No'}</td></tr>
            <tr><td>GPU</td><td>{features.gpu ? 'Enabled' : 'Disabled'}</td></tr>
            <tr><td>RocksDB</td><td>{features.rocksdb ? 'Enabled' : 'Disabled'}</td></tr>
            <tr><td>Recovery Mode</td><td>{features.recovery_mode ? 'Yes' : 'No'}</td></tr>
            <tr><td>JWT RBAC</td><td>{app?.jwt_rbac ? 'Enabled' : 'Disabled'}</td></tr>
            <tr><td>Started</td><td>{startup}</td></tr>
            <tr><td>Uptime</td><td>{uptime}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Memory Usage</h2>
        {ramBytes && (
          <div className="memory-bar-container" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="memory-bar-label"><span className="name">Total RAM</span><span className="value">{formatBytes(ramBytes)}</span></div>
            <div className="memory-bar"><div className="memory-bar-fill" style={{ width: '100%', background: 'rgba(255,255,255,0.15)' }} /></div>
          </div>
        )}
        {memItems.map(item => {
          const pct = ((item.bytes || 0) / maxBytes * 100).toFixed(1);
          return (
            <div key={item.name} className="memory-bar-container">
              <div className="memory-bar-label">
                <span className="name">{item.name} <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>{item.desc}</span></span>
                <span className="value">{item.bytes ? formatBytes(item.bytes) : 'N/A'}</span>
              </div>
              <div className="memory-bar"><div className="memory-bar-fill" style={{ width: `${pct}%`, background: item.color }} /></div>
            </div>
          );
        })}
      </div>
      <div className="card">
        <div className="card-header-row card-header-row-tight">
          <h2>Cached Monitoring</h2>
          {cluster && (
            <label className="card-inline-control" title="How often the background worker fetches this cluster">
              <span>Refresh</span>
              <select
                value={resolveFrequencyMinutes(cluster.cachedFrequencyMinutes)}
                onChange={e => { void onUpdateCluster({ cachedFrequencyMinutes: Number(e.target.value) || DEFAULT_CACHED_FREQUENCY_MINUTES }); }}
              >
                {FREQUENCY_PRESETS.map(n => (
                  <option key={n} value={n}>{n === 60 ? '1 h' : `${n} min`}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <ConfirmDialog
          open={showClearConfirm}
          title="Clear cached monitoring data?"
          destructive
          busy={clearing}
          confirmLabel="Clear cache"
          cancelLabel="Cancel"
          onCancel={() => setShowClearConfirm(false)}
          onConfirm={async () => {
            setClearing(true);
            try {
              await onClearCache();
              setShowClearConfirm(false);
            } finally {
              setClearing(false);
            }
          }}
          message={
            <>
              <p>This drops everything the background worker has cached for this cluster:</p>
              <ul>
                <li>The latest dashboard snapshot</li>
                <li>{history.length} metric history sample{history.length === 1 ? '' : 's'}</li>
                <li>Last refresh state &amp; error</li>
              </ul>
              <p>Sparklines reset and a fresh fetch starts immediately afterwards. Other clusters are not affected.</p>
            </>
          }
        />

        {history.length > 1 && latestSample ? (
          <div className="metric-cards metric-cards-top">
            <MetricCard
              title="Total points"
              value={formatNumber(latestSample.totalPoints)}
              delta={{ text: `${fmtSignedInt(pointDelta)} in ${historyWindow}`, sign: sign(pointDelta) }}
              values={history.map(h => h.totalPoints)}
              labels={sparkLabels}
              format={formatNumber}
              color="var(--accent)"
            />
            <MetricCard
              title="Indexed vectors"
              value={formatNumber(latestSample.totalIndexedVectors)}
              delta={{ text: `${fmtSignedInt(indexedDelta)} in ${historyWindow}`, sign: sign(indexedDelta) }}
              values={history.map(h => h.totalIndexedVectors)}
              labels={sparkLabels}
              format={formatNumber}
              color="var(--info)"
            />
            <MetricCard
              title="Indexing progress"
              value={progressNow != null ? `${progressNow.toFixed(1)}%` : 'N/A'}
              delta={progressNow != null && progressFirst != null
                ? { text: fmtSignedPct(progressDelta), sign: sign(progressDelta) }
                : undefined}
              values={history.map(h => h.totalPoints > 0 ? (h.totalIndexedVectors / h.totalPoints) * 100 : 0)}
              labels={sparkLabels}
              format={(v) => `${v.toFixed(1)}%`}
              color="var(--perf)"
            />
            <MetricCard
              title="Collections"
              value={formatNumber(collectionsOf(latestSample))}
              delta={{ text: collectionsDelta === 0 ? 'unchanged' : `${fmtSignedInt(collectionsDelta)} in ${historyWindow}`, sign: sign(collectionsDelta) }}
              values={history.map(h => collectionsOf(h))}
              labels={sparkLabels}
              format={formatNumber}
              color="var(--warning)"
            />
            <MetricCard
              title="Total shards"
              value={formatNumber(shardsOf(latestSample))}
              delta={{ text: shardsDelta === 0 ? 'unchanged' : `${fmtSignedInt(shardsDelta)} in ${historyWindow}`, sign: sign(shardsDelta) }}
              values={history.map(h => shardsOf(h))}
              labels={sparkLabels}
              format={formatNumber}
              color="var(--success)"
            />
          </div>
        ) : (
          <p className="cached-monitoring-empty">Waiting for another sample to render charts&hellip;</p>
        )}

        {refreshState?.lastError && (
          <div className="cache-error-banner" role="alert">
            <svg className="cache-error-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div className="cache-error-content">
              <div className="cache-error-title">
                Last refresh failed{lastFailedAt ? ` at ${new Date(lastFailedAt).toLocaleString()}` : ''}
              </div>
              <div className="cache-error-message">{refreshState.lastError}</div>
            </div>
          </div>
        )}

        <div className="card-footer cache-footer">
          <div className="cache-meta-text">
            {capturedAt
              ? <span>Snapshot <strong>{new Date(capturedAt).toLocaleString()}</strong></span>
              : <span>No snapshot yet</span>}
            <span className="cache-meta-sep">&middot;</span>
            <span><strong>{history.length}</strong> sample{history.length === 1 ? '' : 's'}</span>
            {history.length > 1 && (
              <>
                <span className="cache-meta-sep">&middot;</span>
                <span><strong>{historyWindow}</strong> window</span>
              </>
            )}
          </div>
          <button
            type="button"
            className="card-clear-btn"
            onClick={() => setShowClearConfirm(true)}
            disabled={history.length === 0 && !capturedAt}
            title="Drop the cached snapshot and metric history for this cluster"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
            </svg>
            <span>Clear cache</span>
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
