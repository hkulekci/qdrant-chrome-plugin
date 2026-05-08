import { useMemo, useState, type ReactNode } from 'react';
import type { DashboardData, Insight, CollectionInfo, VectorConfig, ClusterConfig, InsightsFilter } from '../../lib/types';
import { DEFAULT_INSIGHTS_FILTER } from '../../lib/types';
import { formatNumber } from '../../lib/format';
import { insightsForCollection } from '../../rules';
import { DEFAULTS, isNonDefault } from '../../lib/qdrant-defaults';
import { QdrantApi } from '../../lib/qdrant-api';
import { ConfirmDialog } from '../ConfirmDialog';
import {
  analyzeMultiTenancy,
  strategyLabel,
  strategyShortLabel,
  strategyTone,
  type MultiTenancyAnalysis,
} from '../../lib/multi-tenancy';

type SortKey = 'name' | 'points' | 'segments' | 'insights';

// Boolean rendered as a compact mini-badge.
function YesNo({ value }: { value: boolean | null | undefined }) {
  if (value == null) return <span className="val-muted">&mdash;</span>;
  return value
    ? <span className="val-bool yes">Yes</span>
    : <span className="val-bool no">No</span>;
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="val-muted">{children}</span>;
}

function formatDefault(v: unknown): string {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (v == null) return 'auto';
  if (typeof v === 'number') return formatNumber(v);
  return String(v);
}

/*
 * One configuration row inside a section.
 *   label    — user-facing field name
 *   hint     — explanation shown on hover (what does this param do)
 *   value    — current value (may be undefined → renders as em-dash)
 *   default  — if provided, row is marked custom when value != default
 *               and shows a small "default: X" subtitle
 *   display  — optional pre-formatted value node (overrides `value` render)
 */
function ConfigRow({
  label, hint, value, defaultValue, display,
}: {
  label: string;
  hint?: string;
  value?: unknown;
  defaultValue?: unknown;
  display?: ReactNode;
}) {
  const hasDefault = defaultValue !== undefined;
  const changed = hasDefault && isNonDefault(value, defaultValue);
  let rendered: ReactNode = display;
  if (rendered === undefined) {
    if (value == null) rendered = <Muted>&mdash;</Muted>;
    else if (typeof value === 'boolean') rendered = <YesNo value={value} />;
    else if (typeof value === 'number') rendered = formatNumber(value);
    else rendered = String(value);
  }
  return (
    <div className={`config-row ${changed ? 'is-custom' : ''}`}>
      <div className="config-row-label" title={hint || label}>
        <span className="config-row-label-text">{label}</span>
        {hint && <span className="config-row-hint-dot" aria-hidden>?</span>}
      </div>
      <div className="config-row-value">
        <span className="config-row-value-main">{rendered}</span>
        {changed && (
          <span className="config-row-default" title={`Default: ${formatDefault(defaultValue)}`}>
            default: {formatDefault(defaultValue)}
          </span>
        )}
      </div>
    </div>
  );
}

function ConfigSection({ title, icon, children, action, wide }: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  /** Span two grid columns. Useful for sections with wide rows (long
   *  field names + multiple flag pills) that wrap awkwardly otherwise. */
  wide?: boolean;
}) {
  return (
    <div className={`config-section${wide ? ' config-section-wide' : ''}`}>
      <div className="config-section-header">
        <h3>
          {icon && <span className="config-section-icon" aria-hidden>{icon}</span>}
          <span>{title}</span>
        </h3>
        {action}
      </div>
      <div className="config-rows">{children}</div>
    </div>
  );
}

function isNamedVectors(vectors: Record<string, VectorConfig> | VectorConfig): vectors is Record<string, VectorConfig> {
  return !('size' in vectors && typeof (vectors as VectorConfig).size === 'number');
}

function OptimizerStatus({ status }: { status: string | { error: string } }) {
  if (!status) return <Muted>&mdash;</Muted>;
  if (status === 'ok') return <span className="val-status ok">OK</span>;
  if (status === 'indexing') return <span className="val-status indexing">Indexing&hellip;</span>;
  if (typeof status === 'object' && 'error' in status) return <span className="val-status error">Error</span>;
  return <>{String(status)}</>;
}

function MultiTenancyBadge({ mt }: { mt: MultiTenancyAnalysis }) {
  if (mt.strategy === 'none') return null;
  const tone = strategyTone(mt.strategy);
  const label = strategyShortLabel(mt.strategy);
  const titleParts: string[] = [strategyLabel(mt.strategy)];
  if (mt.tenantFields.length > 0) titleParts.push(`tenant: ${mt.tenantFields.join(', ')}`);
  if (mt.customSharding) titleParts.push('custom sharding');
  return <span className={`mt-row-badge mt-${tone}`} title={titleParts.join(' · ')}>{label}</span>;
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
    <span className="collection-row-insights">
      {c > 0 && <button className="insight-count-badge critical" onClick={open('critical')} title="Open Insights tab">{c} critical</button>}
      {w > 0 && <button className="insight-count-badge warning" onClick={open('warning')} title="Open Insights tab">{w} warning</button>}
      {p > 0 && <button className="insight-count-badge performance" onClick={open('performance')} title="Open Insights tab">{p} tip{p > 1 ? 's' : ''}</button>}
    </span>
  );
}

function CollectionRow({
  name, info, insights, expanded, onToggle, onNavigateInsights,
}: {
  name: string;
  info: CollectionInfo;
  insights: Insight[];
  expanded: boolean;
  onToggle: () => void;
  onNavigateInsights: (filter?: Partial<InsightsFilter>) => void;
}) {
  const config = info.config?.params || {} as CollectionInfo['config']['params'];
  const vectors = config.vectors || {};
  const sparseVectors = config.sparse_vectors || {};
  const named = isNamedVectors(vectors);
  const denseNames = named ? Object.keys(vectors) : [];
  const sparseCount = Object.keys(sparseVectors).length;
  const vectorSummary = named
    ? `${denseNames.length} named`
    : `${(vectors as VectorConfig).size}d · ${(vectors as VectorConfig).distance}`;
  const statusColor = info.status === 'green' ? 'green' : info.status === 'yellow' ? 'yellow' : 'red';
  const mt = analyzeMultiTenancy(info);

  return (
    <button
      type="button"
      className={`collection-row ${expanded ? 'expanded' : ''}`}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className={`collection-row-status ${statusColor}`} title={`status: ${info.status || 'unknown'}`} />
      <span className="collection-row-name">{name}</span>
      <MultiTenancyBadge mt={mt} />
      <span className="collection-row-metric primary">
        <span className="m-val">{formatNumber(info.points_count)}</span>
        <span className="m-label">points</span>
      </span>
      <span className="collection-row-metric">
        <span className="m-val">{info.segments_count ?? 0}</span>
        <span className="m-label">seg</span>
      </span>
      <span className="collection-row-vectors">
        <span className="m-val">{vectorSummary}</span>
        {sparseCount > 0 && <span className="m-sparse">+{sparseCount} sparse</span>}
      </span>
      <InsightBadges insights={insights} collectionName={name} onNavigate={onNavigateInsights} />
      <span className="collection-row-chevron" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
    </button>
  );
}

function MultiTenancySection({ mt }: { mt: MultiTenancyAnalysis }) {
  if (mt.strategy === 'none') return null;
  const tone = strategyTone(mt.strategy);
  const label = strategyLabel(mt.strategy);

  // Per-strategy human-friendly explanation. Kept short — full guidance is in
  // the linked article. Reflects the structural signals only.
  const description: string =
    mt.strategy === 'payload-optimized'
      ? 'Tenant-aware payload index with per-tenant HNSW sub-graphs. Filtered search hops within one tenant only.'
      : mt.strategy === 'payload-tenant-flag'
        ? 'Tenant-aware payload index detected, but HNSW is left at default. The global graph is still built across all tenants.'
        : mt.strategy === 'custom-shard-optimized'
          ? 'Custom sharding combined with a tenant-aware payload index. Two layers of isolation: shard routing + per-tenant graph.'
          : 'Custom sharding without a tenant-aware payload index. Isolation is structural via shard_key only.';

  // Build the optimization signal pills. Each pill conveys one structural fact.
  const signals: { key: string; label: string; tone: 'good' | 'warn' | 'info' }[] = [];
  if (mt.tenantFields.length > 0) {
    signals.push({
      key: 'is_tenant',
      label: `is_tenant on ${mt.tenantFields.join(', ')}`,
      tone: 'good',
    });
  }
  if (mt.principalFields.length > 0) {
    signals.push({
      key: 'is_principal',
      label: `is_principal on ${mt.principalFields.join(', ')}`,
      tone: 'info',
    });
  }
  if (mt.customSharding) {
    signals.push({ key: 'sharding', label: 'sharding_method: custom', tone: 'info' });
  }
  if (mt.globalM === 0) {
    signals.push({ key: 'm0', label: 'HNSW m: 0 (per-tenant only)', tone: 'good' });
  } else if (mt.globalM != null) {
    signals.push({ key: 'mn', label: `HNSW m: ${mt.globalM}`, tone: mt.payloadM ? 'info' : 'warn' });
  }
  if (mt.payloadM != null && mt.payloadM > 0) {
    signals.push({ key: 'pm', label: `HNSW payload_m: ${mt.payloadM}`, tone: 'good' });
  } else if (mt.tenantFields.length > 0) {
    signals.push({ key: 'pm0', label: 'payload_m not set', tone: 'warn' });
  }

  return (
    <div className={`mt-section mt-section-${tone}`}>
      <div className="mt-section-head">
        <span className={`mt-row-badge mt-${tone}`}>{label}</span>
        {mt.hybridGraph && <span className="mt-hybrid-pill" title="Both global graph and per-tenant sub-graphs are built — supports cross-tenant search">hybrid graph</span>}
        <a
          className="mt-section-link"
          href="https://qdrant.tech/articles/multitenancy/"
          target="_blank"
          rel="noopener noreferrer"
          title="Qdrant Multi-tenancy article"
        >
          Learn more &rarr;
        </a>
      </div>
      <p className="mt-section-desc">{description}</p>
      <div className="mt-signal-list">
        {signals.map(s => (
          <span key={s.key} className={`mt-signal mt-signal-${s.tone}`}>{s.label}</span>
        ))}
      </div>
    </div>
  );
}

function CollectionDetail({
  name, info, cluster, onOptimized,
}: {
  name: string;
  info: CollectionInfo;
  cluster: ClusterConfig | null;
  onOptimized: () => void;
}) {
  const mt = analyzeMultiTenancy(info);
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
  const named = isNamedVectors(vectors);
  const denseNames = named ? Object.keys(vectors) : [];

  let quantDisplay = 'None';
  let quantDetail = '';
  if (quantization) {
    if (quantization.scalar) { quantDisplay = `Scalar (${quantization.scalar.type})`; quantDetail = `quantile: ${quantization.scalar.quantile ?? 'default'}, always_ram: ${quantization.scalar.always_ram ?? false}`; }
    else if (quantization.product) quantDisplay = `Product (${quantization.product.compression})`;
    else if (quantization.binary) quantDisplay = 'Binary';
    else quantDisplay = 'Enabled';
  }

  return (
    <div className="collection-detail">
      <MultiTenancySection mt={mt} />
      <div className="collection-detail-meta">
        <span className="meta-tag">
          <span className="label">Shards</span>
          <span className="val">
            {config.shard_number ?? '?'}
            {isNonDefault(config.shard_number, DEFAULTS.params.shard_number) && <span className="meta-tag-custom" title={`Default: ${DEFAULTS.params.shard_number}`} />}
          </span>
        </span>
        <span className="meta-tag">
          <span className="label">Replication</span>
          <span className="val">
            {config.replication_factor ?? '?'}
            {isNonDefault(config.replication_factor, DEFAULTS.params.replication_factor) && <span className="meta-tag-custom" title={`Default: ${DEFAULTS.params.replication_factor}`} />}
          </span>
        </span>
        <span className="meta-tag">
          <span className="label">Indexed</span>
          <span className="val">{formatNumber(info.indexed_vectors_count)}</span>
        </span>
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
              <strong>&#9888;&#65039; Heavy operation</strong>
              <ul>
                <li>Increased <strong>CPU</strong> usage while optimization runs</li>
                <li>Higher <strong>memory</strong> usage (new segments are built in parallel with old ones)</li>
                <li>Additional <strong>disk space</strong> required until old segments are freed</li>
                <li>Search latency may spike during the operation</li>
              </ul>
              <p>Particularly useful after a bulk indexing run &mdash; but avoid running it during peak traffic.</p>
            </div>
            {optimizeError && <p className="dialog-error">Error: {optimizeError}</p>}
          </>
        }
      />

      <div className="config-grid">
        <ConfigSection title={`Vectors${named ? ` (${denseNames.length} named)` : ''}`} icon="&#x25A3;">
          {named ? (
            denseNames.map(vn => {
              const v = (vectors as Record<string, VectorConfig>)[vn];
              const hints: string[] = [];
              if (v.on_disk) hints.push('on disk');
              if (v.hnsw_config) hints.push(`HNSW m:${v.hnsw_config.m} ef:${v.hnsw_config.ef_construct}`);
              return (
                <div key={vn} className="config-row">
                  <div className="config-row-label">
                    <span className="vector-name">{vn}</span>
                  </div>
                  <div className="config-row-value">
                    <span className="config-row-value-main"><span className="val-num">{v.size}d</span> &middot; {v.distance}</span>
                    {hints.length > 0 && <span className="config-row-default">{hints.join(' · ')}</span>}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="config-row">
              <div className="config-row-label">
                <span className="vector-name">default</span>
              </div>
              <div className="config-row-value">
                <span className="config-row-value-main">
                  <span className="val-num">{(vectors as VectorConfig).size}d</span> &middot; {(vectors as VectorConfig).distance}
                </span>
              </div>
            </div>
          )}
          {sparseNames.map(sn => (
            <div key={sn} className="config-row">
              <div className="config-row-label">
                <span className="vector-name sparse">{sn}</span>
                <span className="config-row-tag">sparse</span>
              </div>
              <div className="config-row-value">
                <span className="config-row-value-main">
                  <span className={`val-storage ${sparseVectors[sn]?.index?.on_disk ? 'disk' : 'memory'}`}>
                    {sparseVectors[sn]?.index?.on_disk ? 'on disk' : 'in memory'}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </ConfigSection>

        <ConfigSection title="HNSW Index" icon="&#x25CE;">
          <ConfigRow
            label="M"
            hint="Max connections per node in the HNSW graph. Higher = better recall at the cost of RAM."
            value={hnsw?.m}
            defaultValue={DEFAULTS.hnsw.m}
          />
          <ConfigRow
            label="EF Construct"
            hint="Construction-time search depth. Higher = better graph quality, slower indexing."
            value={hnsw?.ef_construct}
            defaultValue={DEFAULTS.hnsw.ef_construct}
          />
          <ConfigRow
            label="Full scan threshold"
            hint="Below this point count, search does a brute-force scan instead of using HNSW."
            value={hnsw?.full_scan_threshold}
            defaultValue={DEFAULTS.hnsw.full_scan_threshold}
          />
          <ConfigRow
            label="HNSW on disk"
            hint="Store the HNSW graph on disk instead of RAM. Trades latency for memory."
            value={hnsw?.on_disk}
            defaultValue={DEFAULTS.hnsw.on_disk}
          />
        </ConfigSection>

        <ConfigSection
          title="Optimizer"
          icon="&#x25A2;"
          action={
            <button
              className="btn btn-optimize"
              onClick={() => { setOptimizeError(null); setShowOptimize(true); }}
              disabled={!cluster || optimizing}
              title="Trigger optimizer to merge segments and build indexes"
            >
              {optimizing ? 'Optimizing\u2026' : optimizeSuccess ? 'Triggered \u2713' : 'Run optimizer'}
            </button>
          }
        >
          <ConfigRow label="Status" display={<OptimizerStatus status={info.optimizer_status} />} />
          <ConfigRow
            label="Indexing threshold"
            hint="Min points per segment before the optimizer builds an HNSW index."
            value={optimizer?.indexing_threshold}
            defaultValue={DEFAULTS.optimizer.indexing_threshold}
          />
          <ConfigRow
            label="Flush interval"
            hint="How often the WAL flushes to disk."
            value={optimizer?.flush_interval_sec}
            defaultValue={DEFAULTS.optimizer.flush_interval_sec}
            display={optimizer?.flush_interval_sec != null ? `${optimizer.flush_interval_sec}s` : <Muted>&mdash;</Muted>}
          />
          <ConfigRow
            label="Deleted threshold"
            hint="Fraction of deleted points that triggers optimizer to rebuild segments (0–1)."
            value={optimizer?.deleted_threshold}
            defaultValue={DEFAULTS.optimizer.deleted_threshold}
          />
          <ConfigRow
            label="Max segment size"
            hint="Upper bound on segment point count before it is split."
            value={optimizer?.max_segment_size}
            defaultValue={DEFAULTS.optimizer.max_segment_size}
            display={optimizer?.max_segment_size ? formatNumber(optimizer.max_segment_size) : <Muted>Auto</Muted>}
          />
          <ConfigRow
            label="Default segments"
            hint="Target number of segments per shard."
            value={optimizer?.default_segment_number}
            defaultValue={DEFAULTS.optimizer.default_segment_number}
            display={optimizer?.default_segment_number ? optimizer.default_segment_number : <Muted>Auto</Muted>}
          />
          <ConfigRow
            label="Prevent unoptimized"
            hint="Reject searches on segments that haven't been indexed yet."
            value={optimizer?.prevent_unoptimized}
            defaultValue={DEFAULTS.optimizer.prevent_unoptimized}
          />
        </ConfigSection>

        <ConfigSection title="Storage" icon="&#x25A4;">
          <ConfigRow
            label="On disk payload"
            hint="Store payload on disk instead of RAM."
            value={config.on_disk_payload}
            defaultValue={DEFAULTS.params.on_disk_payload}
          />
          <ConfigRow
            label="WAL capacity"
            hint="Size of the write-ahead log buffer."
            value={wal?.wal_capacity_mb}
            defaultValue={DEFAULTS.wal.wal_capacity_mb}
            display={wal?.wal_capacity_mb != null ? `${wal.wal_capacity_mb} MB` : <Muted>&mdash;</Muted>}
          />
          <ConfigRow
            label="Write consistency"
            hint="Number of replicas that must acknowledge a write."
            value={config.write_consistency_factor}
            defaultValue={DEFAULTS.params.write_consistency_factor}
          />
        </ConfigSection>

        <ConfigSection
          title="Quantization"
          icon="&#x25A6;"
          action={quantization ? <span className="quant-pill enabled">enabled</span> : <span className="quant-pill disabled">disabled</span>}
        >
          {quantization ? (
            <>
              <ConfigRow label="Method" display={<span className="val-strong">{quantDisplay}</span>} />
              {quantization.scalar && (
                <>
                  <ConfigRow label="Type" display={quantization.scalar.type} />
                  <ConfigRow label="Quantile" display={quantization.scalar.quantile ?? <Muted>default</Muted>} />
                  <ConfigRow label="Always in RAM" value={quantization.scalar.always_ram ?? false} />
                </>
              )}
              {quantization.product && (
                <ConfigRow label="Compression" display={quantization.product.compression} />
              )}
              {quantDetail && !quantization.scalar && (
                <ConfigRow label="Params" display={<Muted>{quantDetail}</Muted>} />
              )}
            </>
          ) : (
            <p className="config-section-empty">Not configured. Enable to reduce vector memory footprint at the cost of some recall.</p>
          )}
        </ConfigSection>

        <ConfigSection
          title={`Payload indexes${payloadEntries.length > 0 ? ` (${payloadEntries.length})` : ''}`}
          icon="&#x25A7;"
          wide
        >
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
                      {p.is_tenant && <span className="payload-flag tenant" title="Tenant-optimized index (non-default)">tenant</span>}
                      {p.is_principal && <span className="payload-flag principal" title="Principal field for tenant routing (non-default)">principal</span>}
                      {p.on_disk ? (
                        <span className="payload-flag on-disk" title="Stored on disk (non-default: default is in-memory)">on disk</span>
                      ) : (
                        <span className="payload-flag in-memory" title="Kept in memory (default)">in memory</span>
                      )}
                      {hnswExplicitlyDisabled && (
                        <span className="payload-flag hnsw-off" title="HNSW graph building disabled (non-default)">HNSW off</span>
                      )}
                      {hnswExplicitlyEnabled && (
                        <span className="payload-flag hnsw-on" title="HNSW graph building enabled (default)">HNSW on</span>
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
            <p className="config-section-empty">No payload indexes defined.</p>
          )}
        </ConfigSection>

        {strictMode?.enabled && (
          <ConfigSection title="Strict mode" icon="&#x25A8;">
            <ConfigRow label="Unindexed filter (read)" display={strictMode.unindexed_filtering_retrieve ? <span className="val-bool yes">Allow</span> : <span className="val-bool no">Deny</span>} />
            <ConfigRow label="Unindexed filter (write)" display={strictMode.unindexed_filtering_update ? <span className="val-bool yes">Allow</span> : <span className="val-bool no">Deny</span>} />
            <ConfigRow label="Max payload indexes" value={strictMode.max_payload_index_count} />
          </ConfigSection>
        )}
      </div>
    </div>
  );
}

function CollectionsToolbar({
  search, onSearch, sort, onSort, onlyInsights, onOnlyInsights,
  shown, total, allExpanded, onToggleAll,
}: {
  search: string;
  onSearch: (v: string) => void;
  sort: SortKey;
  onSort: (k: SortKey) => void;
  onlyInsights: boolean;
  onOnlyInsights: (v: boolean) => void;
  shown: number;
  total: number;
  allExpanded: boolean;
  onToggleAll: () => void;
}) {
  return (
    <div className="collections-toolbar">
      <div className="collections-toolbar-left">
        <div className="collections-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search collections..."
            aria-label="Search collections"
          />
          {search && (
            <button className="collections-search-clear" onClick={() => onSearch('')} aria-label="Clear search">&times;</button>
          )}
        </div>
        <label className="collections-filter-check">
          <input type="checkbox" checked={onlyInsights} onChange={e => onOnlyInsights(e.target.checked)} />
          <span>Only with insights</span>
        </label>
      </div>
      <div className="collections-toolbar-right">
        <label className="collections-sort">
          <span className="collections-sort-label">Sort</span>
          <select value={sort} onChange={e => onSort(e.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="points">Points (desc)</option>
            <option value="segments">Segments (desc)</option>
            <option value="insights">Insights (severity)</option>
          </select>
        </label>
        <button className="collections-expand-all" onClick={onToggleAll} type="button">
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
        <span className="collections-count">
          {shown === total ? `${total}` : `${shown} / ${total}`}
        </span>
      </div>
    </div>
  );
}

function severityScore(insights: Insight[]): number {
  return insights.reduce((acc, i) => {
    if (i.level === 'critical') return acc + 1000;
    if (i.level === 'warning') return acc + 100;
    if (i.level === 'performance') return acc + 10;
    return acc + 1;
  }, 0);
}

export function CollectionsTab({
  data, insights, cluster, onRefresh, onNavigateInsights,
}: {
  data: DashboardData;
  insights: Insight[];
  cluster: ClusterConfig | null;
  onRefresh: () => void;
  onNavigateInsights: (filter?: Partial<InsightsFilter>) => void;
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [onlyInsights, setOnlyInsights] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand collections that have critical insights on first render
    const autoOpen = new Set<string>();
    for (const i of insights) {
      if (i.level === 'critical' && i.collection) autoOpen.add(i.collection);
    }
    return autoOpen;
  });

  const enriched = useMemo(() => {
    return data.collections.map(name => {
      const detail = data.collectionDetails[name];
      const colInsights = insightsForCollection(insights, name);
      return { name, detail, insights: colInsights };
    });
  }, [data, insights]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = enriched;
    if (q) list = list.filter(c => c.name.toLowerCase().includes(q));
    if (onlyInsights) list = list.filter(c => c.insights.length > 0);
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name': return a.name.localeCompare(b.name);
        case 'points': return (b.detail?.info?.points_count ?? 0) - (a.detail?.info?.points_count ?? 0);
        case 'segments': return (b.detail?.info?.segments_count ?? 0) - (a.detail?.info?.segments_count ?? 0);
        case 'insights': return severityScore(b.insights) - severityScore(a.insights);
      }
    });
    return sorted;
  }, [enriched, search, onlyInsights, sort]);

  const allExpanded = filtered.length > 0 && filtered.every(c => expanded.has(c.name));

  const toggleOne = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) setExpanded(new Set());
    else setExpanded(new Set(filtered.map(c => c.name)));
  };

  if (data.collections.length === 0) {
    return <div className="card"><p style={{ color: 'var(--text-secondary)' }}>No collections found</p></div>;
  }

  return (
    <>
      <CollectionsToolbar
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
        onlyInsights={onlyInsights}
        onOnlyInsights={setOnlyInsights}
        shown={filtered.length}
        total={data.collections.length}
        allExpanded={allExpanded}
        onToggleAll={toggleAll}
      />

      {filtered.length === 0 ? (
        <div className="collection-empty">
          <p>No collections match the current filters.</p>
          <button className="btn btn-secondary" onClick={() => { setSearch(''); setOnlyInsights(false); }}>Clear filters</button>
        </div>
      ) : (
        <div className="collection-list">
          {filtered.map(({ name, detail, insights: colInsights }) => {
            if (detail?.error) {
              return (
                <div key={name} className="collection-card collection-error">
                  <div className="collection-row collection-row-errored">
                    <span className="collection-row-status red" />
                    <span className="collection-row-name">{name}</span>
                    <span className="status-badge red">Error</span>
                    <span className="collection-error-msg">{detail.error}</span>
                  </div>
                </div>
              );
            }
            if (!detail?.info) return null;
            const isExpanded = expanded.has(name);
            return (
              <div key={name} className={`collection-card ${isExpanded ? 'expanded' : ''}`}>
                <CollectionRow
                  name={name}
                  info={detail.info}
                  insights={colInsights}
                  expanded={isExpanded}
                  onToggle={() => toggleOne(name)}
                  onNavigateInsights={onNavigateInsights}
                />
                {isExpanded && (
                  <CollectionDetail
                    name={name}
                    info={detail.info}
                    cluster={cluster}
                    onOptimized={onRefresh}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
