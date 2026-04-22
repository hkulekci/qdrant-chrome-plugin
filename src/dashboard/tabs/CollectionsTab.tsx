import { useState } from 'react';
import type { DashboardData, Insight, CollectionInfo, VectorConfig, ClusterConfig, InsightsFilter } from '../../lib/types';
import { DEFAULT_INSIGHTS_FILTER } from '../../lib/types';
import { formatNumber } from '../../lib/format';
import { insightsForCollection } from '../../rules';
import { DEFAULTS, isNonDefault } from '../../lib/qdrant-defaults';
import { QdrantApi } from '../../lib/qdrant-api';
import { ConfirmDialog } from '../ConfirmDialog';

// Renders a value with a marker if it differs from default
function CfgVal({ value, defaultValue, display }: { value: unknown; defaultValue: unknown; display: string | React.ReactNode }) {
  const changed = isNonDefault(value, defaultValue);
  return (
    <span>
      {display}
      {changed && (
        <span className="cfg-changed-wrap">
          <span className="cfg-changed">&#9888;</span>
          <span className="cfg-tooltip">Default: {String(defaultValue ?? 'auto')}</span>
        </span>
      )}
    </span>
  );
}

function isNamedVectors(vectors: Record<string, VectorConfig> | VectorConfig): vectors is Record<string, VectorConfig> {
  return !('size' in vectors && typeof (vectors as VectorConfig).size === 'number');
}

function OptimizerStatus({ status }: { status: string | { error: string } }) {
  if (!status) return <>N/A</>;
  if (status === 'ok') return <span style={{ color: 'var(--success)' }}>OK</span>;
  if (status === 'indexing') return <span style={{ color: 'var(--warning)' }}>Indexing...</span>;
  if (typeof status === 'object' && 'error' in status) return <span style={{ color: 'var(--error)' }}>Error</span>;
  return <>{String(status)}</>;
}

function InsightBadges({ insights, collectionName, onNavigate }: { insights: Insight[]; collectionName: string; onNavigate: (filter?: Partial<InsightsFilter>) => void }) {
  const c = insights.filter(i => i.level === 'critical').length;
  const w = insights.filter(i => i.level === 'warning').length;
  const p = insights.filter(i => i.level === 'performance').length;
  if (!c && !w && !p) return null;
  const open = (level: 'critical' | 'warning' | 'performance') => (e: React.MouseEvent) => {
    e.stopPropagation();
    onNavigate({ ...DEFAULT_INSIGHTS_FILTER, collection: collectionName, levels: [level] });
  };
  return (
    <span style={{ display: 'flex', gap: 4 }}>
      {c > 0 && <button className="insight-count-badge critical" onClick={open('critical')} title="Open Insights tab">{c} critical</button>}
      {w > 0 && <button className="insight-count-badge warning" onClick={open('warning')} title="Open Insights tab">{w} warning</button>}
      {p > 0 && <button className="insight-count-badge performance" onClick={open('performance')} title="Open Insights tab">{p} tip{p > 1 ? 's' : ''}</button>}
    </span>
  );
}

function CollectionCard({ name, info, insights, cluster, onOptimized, onNavigateInsights }: { name: string; info: CollectionInfo; insights: Insight[]; cluster: ClusterConfig | null; onOptimized: () => void; onNavigateInsights: (filter?: Partial<InsightsFilter>) => void }) {
  const [showOptimize, setShowOptimize] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizeSuccess, setOptimizeSuccess] = useState(false);

  const handleOptimize = async () => {
    if (!cluster) return;
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const api = new QdrantApi(cluster.url, cluster.apiKey);
      await api.optimizeCollection(name);
      setOptimizeSuccess(true);
      setShowOptimize(false);
      onOptimized();
      setTimeout(() => setOptimizeSuccess(false), 4000);
    } catch (e) {
      setOptimizeError((e as Error).message);
    } finally {
      setOptimizing(false);
    }
  };

  const config = info.config?.params || {} as CollectionInfo['config']['params'];
  const vectors = config.vectors || {};
  const sparseVectors = config.sparse_vectors || {};
  const hnsw = info.config?.hnsw_config;
  const optimizer = info.config?.optimizer_config;
  const wal = info.config?.wal_config;
  const quantization = info.config?.quantization_config;
  const strictMode = info.config?.strict_mode_config;
  const payloadSchema = info.payload_schema || {};
  const payloadEntries = Object.entries(payloadSchema);
  const sparseNames = Object.keys(sparseVectors);

  const statusColor = info.status === 'green' ? 'green' : info.status === 'yellow' ? 'yellow' : 'red';
  const named = isNamedVectors(vectors);
  const denseNames = named ? Object.keys(vectors) : [];
  const vectorSummary = named ? `${denseNames.length} named` : `${(vectors as VectorConfig).size}d / ${(vectors as VectorConfig).distance}`;

  let quantDisplay = 'None';
  let quantDetail = '';
  if (quantization) {
    if (quantization.scalar) { quantDisplay = `Scalar (${quantization.scalar.type})`; quantDetail = `quantile: ${quantization.scalar.quantile ?? 'default'}, always_ram: ${quantization.scalar.always_ram ?? false}`; }
    else if (quantization.product) quantDisplay = `Product (${quantization.product.compression})`;
    else if (quantization.binary) quantDisplay = 'Binary';
    else quantDisplay = 'Enabled';
  }

  return (
    <div className="collection-card">
      <div className="collection-header">
        <span className="collection-name">{name}</span>
        <div className="collection-meta">
          <span className={`status-badge ${statusColor}`}>{info.status || '?'}</span>
          <span className="meta-tag"><span className="label">Points:</span><span className="val">{formatNumber(info.points_count)}</span></span>
          <span className="meta-tag"><span className="label">Segments:</span><span className="val">{info.segments_count || 0}</span></span>
          <span className="meta-tag"><span className="label">Shards:</span><span className="val"><CfgVal value={config.shard_number} defaultValue={DEFAULTS.params.shard_number} display={config.shard_number || '?'} /></span></span>
          <span className="meta-tag"><span className="label">Replication:</span><span className="val"><CfgVal value={config.replication_factor} defaultValue={DEFAULTS.params.replication_factor} display={config.replication_factor || '?'} /></span></span>
          <span className="meta-tag"><span className="label">Dense:</span><span className="val">{vectorSummary}</span></span>
          {sparseNames.length > 0 && <span className="meta-tag"><span className="label">Sparse:</span><span className="val">{sparseNames.length}</span></span>}
          <InsightBadges insights={insights} collectionName={name} onNavigate={onNavigateInsights} />
          <button
            className="btn btn-optimize"
            onClick={() => { setOptimizeError(null); setShowOptimize(true); }}
            disabled={!cluster || optimizing}
            title="Trigger optimizer to merge segments and build indexes"
          >
            {optimizing ? 'Optimizing...' : optimizeSuccess ? 'Triggered ✓' : 'Optimize'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showOptimize}
        title={`Optimize "${name}"?`}
        destructive
        busy={optimizing}
        confirmLabel="Yes, optimize"
        cancelLabel="Cancel"
        onConfirm={handleOptimize}
        onCancel={() => setShowOptimize(false)}
        message={
          <>
            <p>This will trigger the Qdrant optimizer to re-process all shards of this collection, merging small segments and building missing indexes.</p>
            <div className="dialog-warning">
              <strong>⚠️ Heavy operation</strong>
              <ul>
                <li>Increased <strong>CPU</strong> usage while optimization runs</li>
                <li>Higher <strong>memory</strong> usage (new segments are built in parallel with old ones)</li>
                <li>Additional <strong>disk space</strong> required until old segments are freed</li>
                <li>Search latency may spike during the operation</li>
              </ul>
              <p>Particularly useful after a bulk indexing run — but avoid running it during peak traffic.</p>
            </div>
            {optimizeError && <p className="dialog-error">Error: {optimizeError}</p>}
          </>
        }
      />

      <div className="config-grid">
        <div className="config-section">
          <h3>Dense Vectors</h3>
          <table className="info-table"><tbody>
            {named ? denseNames.map(vn => {
              const v = (vectors as Record<string, VectorConfig>)[vn];
              return <tr key={vn}><td>{vn}</td><td>{v.size}d / {v.distance}{v.on_disk ? ' (on disk)' : ''}{v.hnsw_config ? ` m:${v.hnsw_config.m} ef:${v.hnsw_config.ef_construct}` : ''}</td></tr>;
            }) : <>
              <tr><td>Dimensions</td><td>{(vectors as VectorConfig).size}</td></tr>
              <tr><td>Distance</td><td>{(vectors as VectorConfig).distance}</td></tr>
            </>}
          </tbody></table>
        </div>

        {sparseNames.length > 0 && (
          <div className="config-section">
            <h3>Sparse Vectors</h3>
            <table className="info-table"><tbody>
              {sparseNames.map(sn => <tr key={sn}><td>{sn}</td><td>{sparseVectors[sn]?.index?.on_disk ? 'on disk' : 'in memory'}</td></tr>)}
            </tbody></table>
          </div>
        )}

        <div className="config-section">
          <h3>HNSW Config (global)</h3>
          <table className="info-table"><tbody>
            <tr><td>M</td><td><CfgVal value={hnsw?.m} defaultValue={DEFAULTS.hnsw.m} display={hnsw?.m ?? 'N/A'} /></td></tr>
            <tr><td>EF Construct</td><td><CfgVal value={hnsw?.ef_construct} defaultValue={DEFAULTS.hnsw.ef_construct} display={hnsw?.ef_construct ?? 'N/A'} /></td></tr>
            <tr><td>Full Scan Threshold</td><td><CfgVal value={hnsw?.full_scan_threshold} defaultValue={DEFAULTS.hnsw.full_scan_threshold} display={formatNumber(hnsw?.full_scan_threshold)} /></td></tr>
            <tr><td>On Disk</td><td><CfgVal value={hnsw?.on_disk} defaultValue={DEFAULTS.hnsw.on_disk} display={hnsw?.on_disk ? 'Yes' : 'No'} /></td></tr>
          </tbody></table>
        </div>

        <div className="config-section">
          <h3>Optimizer</h3>
          <table className="info-table"><tbody>
            <tr><td>Status</td><td><OptimizerStatus status={info.optimizer_status} /></td></tr>
            <tr><td>Indexing Threshold</td><td><CfgVal value={optimizer?.indexing_threshold} defaultValue={DEFAULTS.optimizer.indexing_threshold} display={formatNumber(optimizer?.indexing_threshold)} /></td></tr>
            <tr><td>Flush Interval</td><td><CfgVal value={optimizer?.flush_interval_sec} defaultValue={DEFAULTS.optimizer.flush_interval_sec} display={`${optimizer?.flush_interval_sec ?? 'N/A'}s`} /></td></tr>
            <tr><td>Deleted Threshold</td><td><CfgVal value={optimizer?.deleted_threshold} defaultValue={DEFAULTS.optimizer.deleted_threshold} display={optimizer?.deleted_threshold ?? 'N/A'} /></td></tr>
            <tr><td>Max Segment Size</td><td><CfgVal value={optimizer?.max_segment_size} defaultValue={DEFAULTS.optimizer.max_segment_size} display={optimizer?.max_segment_size ? formatNumber(optimizer.max_segment_size) : 'Auto'} /></td></tr>
            <tr><td>Default Segments</td><td><CfgVal value={optimizer?.default_segment_number} defaultValue={DEFAULTS.optimizer.default_segment_number} display={optimizer?.default_segment_number ?? 'Auto'} /></td></tr>
            <tr><td>Prevent Unoptimized</td><td><CfgVal value={optimizer?.prevent_unoptimized} defaultValue={DEFAULTS.optimizer.prevent_unoptimized} display={optimizer?.prevent_unoptimized ? 'Yes' : 'No'} /></td></tr>
          </tbody></table>
        </div>

        <div className="config-section">
          <h3>Storage & Quantization</h3>
          <table className="info-table"><tbody>
            <tr><td>On Disk Payload</td><td><CfgVal value={config.on_disk_payload} defaultValue={DEFAULTS.params.on_disk_payload} display={config.on_disk_payload ? 'Yes' : 'No'} /></td></tr>
            <tr><td>Quantization</td><td><CfgVal value={quantization != null} defaultValue={false} display={quantDisplay} /></td></tr>
            {quantDetail && <tr><td></td><td style={{ fontSize: '0.75rem', opacity: 0.7 }}>{quantDetail}</td></tr>}
            <tr><td>Indexed Vectors</td><td>{formatNumber(info.indexed_vectors_count)}</td></tr>
            <tr><td>WAL Capacity</td><td><CfgVal value={wal?.wal_capacity_mb} defaultValue={DEFAULTS.wal.wal_capacity_mb} display={`${wal?.wal_capacity_mb ?? 'N/A'} MB`} /></td></tr>
            <tr><td>Write Consistency</td><td><CfgVal value={config.write_consistency_factor} defaultValue={DEFAULTS.params.write_consistency_factor} display={config.write_consistency_factor ?? 'N/A'} /></td></tr>
          </tbody></table>
        </div>

        <div className="config-section">
          <h3>Payload Indexes {payloadEntries.length > 0 ? `(${payloadEntries.length})` : ''}</h3>
          {payloadEntries.length > 0 ? (
            <div className="payload-index-list">
              {payloadEntries.map(([field, schema]) => {
                const p = schema.params || {};
                const type = p.type || schema.data_type || '?';
                const hnswExplicitlyDisabled = p.enable_hnsw === false;
                const hnswExplicitlyEnabled = p.enable_hnsw === true;
                return (
                  <div key={field} className="payload-index-row">
                    <span className="payload-index-field">{field}</span>
                    <span className={`payload-index-type type-${type}`}>{type}</span>
                    <span className="payload-index-flags">
                      {p.is_tenant && <span className="payload-flag tenant" title="Tenant-optimized index (non-default)">tenant<span className="cfg-changed">&#9888;</span></span>}
                      {p.is_principal && <span className="payload-flag principal" title="Principal field for tenant routing (non-default)">principal<span className="cfg-changed">&#9888;</span></span>}
                      {p.on_disk ? (
                        <span className="payload-flag on-disk" title="Stored on disk. Default is in-memory — this trades RAM for disk I/O on filter queries.">on disk<span className="cfg-changed">&#9888;</span></span>
                      ) : (
                        <span className="payload-flag in-memory" title="Kept in memory (default)">in memory</span>
                      )}
                      {hnswExplicitlyDisabled && (
                        <span className="payload-flag hnsw-off" title="HNSW graph building disabled for this field (non-default)">HNSW off<span className="cfg-changed">&#9888;</span></span>
                      )}
                      {hnswExplicitlyEnabled && (
                        <span className="payload-flag hnsw-on" title="HNSW graph building enabled — needs payload_m > 0 (default)">HNSW on</span>
                      )}
                    </span>
                    {schema.points != null && (
                      <span className="payload-index-points">{formatNumber(schema.points)} pts</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '8px 0' }}>No payload indexes defined</p>
          )}
        </div>

        {strictMode?.enabled && (
          <div className="config-section">
            <h3>Strict Mode</h3>
            <table className="info-table"><tbody>
              <tr><td>Unindexed Filter (Read)</td><td>{strictMode.unindexed_filtering_retrieve ? 'Allow' : 'Deny'}</td></tr>
              <tr><td>Unindexed Filter (Write)</td><td>{strictMode.unindexed_filtering_update ? 'Allow' : 'Deny'}</td></tr>
              <tr><td>Max Payload Indexes</td><td>{strictMode.max_payload_index_count ?? 'N/A'}</td></tr>
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}

export function CollectionsTab({ data, insights, cluster, onRefresh, onNavigateInsights }: { data: DashboardData; insights: Insight[]; cluster: ClusterConfig | null; onRefresh: () => void; onNavigateInsights: (filter?: Partial<InsightsFilter>) => void }) {
  if (data.collections.length === 0) {
    return <div className="card"><p style={{ color: 'var(--text-secondary)' }}>No collections found</p></div>;
  }

  return (
    <>
      {data.collections.map(name => {
        const detail = data.collectionDetails[name];
        if (detail?.error) {
          return <div key={name} className="collection-card"><span className="collection-name">{name}</span><span className="status-badge red">Error</span><p style={{ color: 'var(--error)' }}>{detail.error}</p></div>;
        }
        if (!detail?.info) return null;
        return <CollectionCard key={name} name={name} info={detail.info} insights={insightsForCollection(insights, name)} cluster={cluster} onOptimized={onRefresh} onNavigateInsights={onNavigateInsights} />;
      })}
    </>
  );
}
