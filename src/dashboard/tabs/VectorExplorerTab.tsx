import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClusterConfig, DashboardData, VectorConfig, PayloadSchemaEntry } from '../../lib/types';
import { QdrantApi } from '../../lib/qdrant-api';
import { projectLayout } from '../../lib/hnsw/project';
import { VectorScatter, type ScatterPoint, type FocusResult, type RegionLabel } from '../viz/VectorScatter';
import { FilterBuilder, computeFacets, matchesFilter, toQdrantFilter, type FilterCond, type FieldFacet, type FacetValue } from '../viz/FilterBuilder';
import { VisualizerTab } from './VisualizerTab';

const MAX_SAMPLE = 4000;
const DEFAULT_SAMPLE = 800;
const CLUSTER_FIELD = '__cluster__';
const MAX_LEGEND = 24;

const PALETTE = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185',
  '#22d3ee', '#a3e635', '#f97316', '#e879f9', '#2dd4bf', '#facc15',
  '#818cf8', '#4ade80', '#f87171', '#38bdf8', '#c084fc', '#fca5a5',
];

const NO_LABEL = '__none__';

// Compact multilingual stop-word list (English + Turkish, since collections here
// are often Turkish) so region labels surface meaningful, distinctive terms.
const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'was', 'one', 'our', 'out',
  'has', 'had', 'how', 'new', 'now', 'see', 'two', 'its', 'let', 'use', 'with', 'this', 'that', 'from',
  'have', 'were', 'they', 'them', 'then', 'than', 'will', 'your', 'what', 'when', 'which', 'their',
  'there', 'would', 'about', 'into', 'over', 'also', 'such', 'only', 'some', 'more', 'most', 'other',
  'been', 'being', 'because', 'could', 'should', 'these', 'those', 'after', 'before', 'while', 'where',
  'here', 'very', 'just', 'like', 'each', 'much', 'many', 'make', 'made', 'used', 'using', 'both', 'same',
  've', 'bir', 'için', 'çok', 'ama', 'veya', 'ile', 'gibi', 'daha', 'olarak', 'olan', 'var', 'yok',
  'ise', 'ancak', 'fakat', 'hem', 'şey', 'kadar', 'sonra', 'önce', 'göre', 'her', 'hiç', 'tüm', 'bazı',
  'değil', 'oldu', 'olur', 'oluyor', 'bunu', 'şunu', 'onu', 'biz', 'siz', 'onlar', 'ben', 'sen',
]);

function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const t of s.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (t.length >= 3 && t.length <= 24 && !STOPWORDS.has(t) && !/^\d+$/.test(t)) out.push(t);
  }
  return out;
}

/** Distinctive terms per cluster via a TF-IDF-like score: a term ranks high when
 *  it appears in many of a cluster's points but in few points overall. */
function computeRegionLabels(points: ScatterPoint[], field: string): RegionLabel[] {
  const N = points.length;
  if (!N) return [];
  const perPoint: string[][] = points.map(p => {
    const v = p.payload?.[field];
    return typeof v === 'string' ? [...new Set(tokenize(v))] : [];
  });
  const globalDf = new Map<string, number>();
  for (const toks of perPoint) for (const t of toks) globalDf.set(t, (globalDf.get(t) || 0) + 1);

  const clusters = new Map<number, number[]>();
  points.forEach((p, i) => {
    const arr = clusters.get(p.cluster);
    if (arr) arr.push(i); else clusters.set(p.cluster, [i]);
  });

  const labels: RegionLabel[] = [];
  for (const [cluster, idxs] of clusters) {
    const tf = new Map<string, number>();
    for (const i of idxs) for (const t of perPoint[i]) tf.set(t, (tf.get(t) || 0) + 1);
    const scored = [...tf.entries()]
      .map(([t, f]) => ({ t, score: (f / idxs.length) * Math.log(N / (globalDf.get(t) || 1)) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3).map(s => s.t);
    if (!top.length) continue;
    let cx = 0, cy = 0;
    for (const i of idxs) { cx += points[i].nx; cy += points[i].ny; }
    labels.push({ cluster, nx: cx / idxs.length, ny: cy / idxs.length, text: top.join(' · ') });
  }
  return labels;
}

interface LegendEntry { label: string; color: string; count: number; }
interface LoadedData { points: ScatterPoint[]; vectors: number[][]; fields: string[]; textFields: string[]; }

// Payload index types Qdrant can facet: countable ones yield exact value
// counts via the Facet API; range ones are filtered with a numeric min/max.
const FACET_COUNTABLE = new Set(['keyword', 'integer', 'uuid', 'bool']);
const FACET_RANGE = new Set(['float', 'datetime']);

interface FacetField { field: string; type: string; }

function schemaType(entry: PayloadSchemaEntry): string {
  return (entry.data_type || entry.params?.type || '').toLowerCase();
}

/** Payload fields with a facetable index, read from the collection schema. */
function facetableFields(schema: Record<string, PayloadSchemaEntry> | undefined): FacetField[] {
  if (!schema) return [];
  const out: FacetField[] = [];
  for (const [field, e] of Object.entries(schema)) {
    const type = schemaType(e);
    if (FACET_COUNTABLE.has(type) || FACET_RANGE.has(type)) out.push({ field, type });
  }
  return out;
}

/** Turn server facet hits (+ range-only fields) into builder facets. */
function buildServerFacets(fields: FacetField[], hits: Record<string, FacetValue[]>): FieldFacet[] {
  const out: FieldFacet[] = [];
  for (const f of fields) {
    if (FACET_RANGE.has(f.type)) {
      out.push({ field: f.field, render: 'range', typeLabel: f.type, indexed: true, source: 'server', values: [], distinctCount: 0 });
      continue;
    }
    const vs = hits[f.field];
    if (vs && vs.length) {
      out.push({ field: f.field, render: 'chips', typeLabel: f.type, indexed: true, source: 'server', values: vs, distinctCount: vs.length });
    }
  }
  return out;
}

/** List named dense vectors, or [undefined] for a single unnamed vector. */
function vectorOptions(vectors: Record<string, VectorConfig> | VectorConfig | undefined) {
  if (!vectors) return [{ name: undefined as string | undefined, cfg: undefined as VectorConfig | undefined }];
  if (typeof (vectors as VectorConfig).size === 'number') return [{ name: undefined, cfg: vectors as VectorConfig }];
  return Object.entries(vectors as Record<string, VectorConfig>).map(([name, cfg]) => ({ name, cfg }));
}

function isPrimitive(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v);
  const s = String(v);
  return s.length > 60 ? s.slice(0, 59) + '…' : s;
}

/** Assign each point a colour by cluster id or by a payload field's value. */
function buildColors(points: ScatterPoint[], field: string): { colors: string[]; legend: LegendEntry[] } {
  const counts = new Map<string, number>();
  const valueOf = (p: ScatterPoint): string =>
    field === CLUSTER_FIELD ? `Cluster ${p.cluster}` : fmt(p.payload?.[field]);

  const order: string[] = [];
  for (const p of points) {
    const key = valueOf(p);
    if (!counts.has(key)) order.push(key);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Most frequent values get the first, most-distinct palette slots.
  const ranked = [...order].sort((a, b) => (counts.get(b)! - counts.get(a)!));
  const colorFor = new Map<string, string>();
  ranked.forEach((k, i) => colorFor.set(k, PALETTE[i % PALETTE.length]));

  const colors = points.map(p => colorFor.get(valueOf(p)) || '#8b93a7');
  const legend = ranked.slice(0, MAX_LEGEND).map(k => ({ label: k, color: colorFor.get(k)!, count: counts.get(k)! }));
  return { colors, legend };
}

export function VectorExplorerTab({ data, cluster }: { data: DashboardData; cluster: ClusterConfig }) {
  const [collection, setCollection] = useState(data.collections[0] || '');
  const [vectorName, setVectorName] = useState<string | undefined>(undefined);
  const [sampleSize, setSampleSize] = useState(DEFAULT_SAMPLE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loaded, setLoaded] = useState<LoadedData | null>(null);
  const [colorField, setColorField] = useState<string>(CLUSTER_FIELD);
  const [labelField, setLabelField] = useState<string>(NO_LABEL);
  const [lassoMode, setLassoMode] = useState(false);
  const [resetToken, setResetToken] = useState(0);

  const [focus, setFocus] = useState<FocusResult | null>(null);
  const [lassoSel, setLassoSel] = useState<number[]>([]);
  const [filter, setFilter] = useState<FilterCond[]>([]);
  const [serverFacets, setServerFacets] = useState<Record<string, FacetValue[]>>({});
  const [facetLoading, setFacetLoading] = useState(false);
  const [facetUnavailable, setFacetUnavailable] = useState(false);

  const info = data.collectionDetails[collection]?.info;
  const vecOpts = useMemo(() => vectorOptions(info?.config?.params?.vectors), [info]);
  const pointCount = info?.points_count;

  // Fields backed by a Qdrant payload index — cheap and always filterable.
  const indexedFields = useMemo(
    () => new Set(Object.keys(info?.payload_schema || {})),
    [info],
  );
  // Facetable payload indexes (keyword/integer/uuid/bool → value counts,
  // float/datetime → range), read from the collection's payload schema.
  const facetFields = useMemo(() => facetableFields(info?.payload_schema), [info]);

  // Facets shown in the builder: prefer exact server-side facet counts; fall
  // back to approximate counts derived from the sample when no facetable
  // payload index exists (or the Facet API is unavailable).
  const facets = useMemo<FieldFacet[]>(() => {
    const server = buildServerFacets(facetFields, serverFacets);
    if (server.length) return server;
    return loaded ? computeFacets(loaded.points, indexedFields) : [];
  }, [facetFields, serverFacets, loaded, indexedFields]);
  const filterHint =
    facetFields.length === 0
      ? 'This collection has no facetable payload index — counts below are approximated from the loaded sample. Add a keyword/integer payload index for exact, whole-collection facets.'
      : facetUnavailable
        ? 'Qdrant Facet API returned nothing (needs Qdrant ≥ 1.12). Counts may be approximated from the loaded sample.'
        : null;

  // Instant client-side dim while the server re-query is in flight: which
  // sampled points match the current filter. null → scatter at full strength.
  const activeMask = useMemo(
    () => (loaded && filter.length ? loaded.points.map(p => matchesFilter(p.payload, filter)) : null),
    [loaded, filter],
  );
  const matchCount = activeMask ? activeMask.reduce((n, m) => n + (m ? 1 : 0), 0) : (loaded?.points.length ?? 0);

  const { colors, legend } = useMemo(
    () => (loaded ? buildColors(loaded.points, colorField) : { colors: [], legend: [] }),
    [loaded, colorField],
  );

  const labels = useMemo(
    () => (loaded && labelField !== NO_LABEL ? computeRegionLabels(loaded.points, labelField) : []),
    [loaded, labelField],
  );
  // Same region names the map shows, keyed by cluster id, so the legend can
  // label clusters with their auto-derived topic instead of a bare number.
  const labelByCluster = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of labels) m.set(l.cluster, l.text);
    return m;
  }, [labels]);

  // The filter last pushed to the server, so the auto-apply effect fires only
  // on genuine changes (and not on the reset that initial load performs).
  const appliedRef = useRef('[]');

  // Refresh exact facet counts. Each field is faceted under the OTHER active
  // conditions (not its own) so its full option list stays visible — standard
  // faceted-search behaviour.
  const loadFacets = async (activeFilter: FilterCond[]) => {
    const countable = facetFields.filter(f => FACET_COUNTABLE.has(f.type));
    if (!countable.length) { setServerFacets({}); setFacetUnavailable(facetFields.length > 0); return; }
    setFacetLoading(true);
    try {
      const api = new QdrantApi(cluster.url, cluster.apiKey);
      const results = await Promise.all(countable.map(async f => {
        const other = activeFilter.filter(c => c.field !== f.field);
        try {
          return [f.field, await api.facet(collection, { key: f.field, limit: 24, filter: toQdrantFilter(other) })] as const;
        } catch {
          return [f.field, null] as const;
        }
      }));
      const hits: Record<string, FacetValue[]> = {};
      let anyOk = false;
      for (const [field, h] of results) if (h) { hits[field] = h; anyOk = true; }
      setServerFacets(hits);
      setFacetUnavailable(!anyOk);
    } finally {
      setFacetLoading(false);
    }
  };

  // Core loader. `serverConds` narrows the sample server-side via a Qdrant
  // filter; `isRefilter` keeps the user's colour/label/filter choices instead
  // of resetting them, so drilling into a subset feels continuous.
  const runLoad = async (serverConds: FilterCond[], isRefilter: boolean) => {
    setError(null);
    setLoading(true);
    try {
      const api = new QdrantApi(cluster.url, cluster.apiKey);
      const qfilter = serverConds.length ? toQdrantFilter(serverConds) : undefined;
      const raw = await api.scrollPointsWithPayload(collection, { limit: sampleSize, vectorName, filter: qfilter });
      if (raw.length === 0) {
        throw new Error(isRefilter
          ? 'No points in the collection match this filter. Try relaxing a condition.'
          : 'No dense vectors returned. The collection may be empty, keep vectors on disk without returning them, or use only sparse vectors.');
      }
      const vectors = raw.map(p => p.vector);
      const layout = projectLayout(vectors);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const l of layout) {
        if (l.x < minX) minX = l.x; if (l.x > maxX) maxX = l.x;
        if (l.y < minY) minY = l.y; if (l.y > maxY) maxY = l.y;
      }
      const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
      const points: ScatterPoint[] = raw.map((p, i) => ({
        id: p.id,
        nx: (layout[i].x - minX) / spanX,
        ny: (layout[i].y - minY) / spanY,
        cluster: layout[i].cluster,
        payload: p.payload,
      }));

      // Payload fields usable for colouring: any top-level key seen as a primitive.
      // Text fields (for region labels): string-valued keys, ranked by average
      // length so the most "texty" field is the default label source.
      const fieldSet = new Set<string>();
      const textLen = new Map<string, { sum: number; n: number }>();
      for (const p of raw) {
        if (!p.payload) continue;
        for (const [k, v] of Object.entries(p.payload)) {
          if (isPrimitive(v)) fieldSet.add(k);
          if (typeof v === 'string' && v.trim().length > 0) {
            const e = textLen.get(k) || { sum: 0, n: 0 };
            e.sum += v.length; e.n += 1; textLen.set(k, e);
          }
        }
      }
      const textFields = [...textLen.entries()]
        .sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)
        .map(e => e[0]);

      const fields = [...fieldSet].sort();
      setLoaded({ points, vectors, fields, textFields });
      if (isRefilter) {
        // Keep the user's view choices; drop a colour/label field only if the
        // narrowed subset no longer carries it.
        setColorField(c => (c === CLUSTER_FIELD || fields.includes(c) ? c : CLUSTER_FIELD));
        setLabelField(l => (l === NO_LABEL || textFields.includes(l) ? l : (textFields[0] ?? NO_LABEL)));
      } else {
        setColorField(CLUSTER_FIELD);
        setLabelField(textFields[0] ?? NO_LABEL);
        setFilter([]);
      }
      appliedRef.current = JSON.stringify(serverConds);
      void loadFacets(serverConds);
      setFocus(null);
      setLassoSel([]);
      setLassoMode(false);
      setResetToken(t => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const load = () => runLoad([], false);

  // Click-to-filter: whenever the filter changes, debounce a live server
  // re-query (fresh matching sample → re-project) plus a facet refresh.
  useEffect(() => {
    if (!loaded) return;
    const key = JSON.stringify(filter);
    if (key === appliedRef.current) return;
    const t = setTimeout(() => { runLoad(filter, true); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, loaded]);

  const points = loaded?.points ?? [];

  return (
    <>
      <div className="card">
        <h2>Vector Explorer</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
          Samples real vectors from a collection and projects them to 2D with <b>PCA</b>, so you can
          <i> see</i> the shape of your embedding space. Colour points by cluster or by a payload field,
          hover for details, <b>click a point</b> to light up its nearest neighbours (cosine), or toggle
          <b> Lasso</b> to select a whole region. Drag to pan, scroll to zoom. Use <b>Filters</b> to facet the
          sample and run a <b>Qdrant query</b> on any matching subset — so you can explore how a sub-population
          is distributed, or drill into a rare slice at full detail.
        </p>

        <div className="viz-form">
          <label>
            Collection
            <select value={collection} onChange={e => { setCollection(e.target.value); setVectorName(undefined); }}>
              {data.collections.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          {vecOpts.length > 1 && (
            <label>
              Vector
              <select value={vectorName ?? ''} onChange={e => setVectorName(e.target.value || undefined)}>
                {vecOpts.map(v => <option key={v.name} value={v.name}>{v.name}{v.cfg ? ` (${v.cfg.size}d)` : ''}</option>)}
              </select>
            </label>
          )}

          <label>
            Sample size
            <input
              type="number" min={10} max={MAX_SAMPLE} value={sampleSize}
              onChange={e => setSampleSize(Math.max(10, Math.min(MAX_SAMPLE, Number(e.target.value) || 0)))}
            />
          </label>

          <button className="btn btn-refresh" onClick={load} disabled={loading || !collection}>
            {loading ? 'Loading…' : 'Load & project'}
          </button>
        </div>

        <p className="viz-hint" style={{ marginBottom: 0 }}>
          {typeof pointCount === 'number' && <>Collection has {pointCount.toLocaleString()} points. </>}
          A sample of up to {MAX_SAMPLE.toLocaleString()} is projected client-side. PCA is fast and stable;
          it shows global structure well (UMAP for finer local clusters is a planned follow-up).
        </p>

        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {loaded && (
        <div className="card">
          <div className="vec-toolbar">
            <label className="vec-inline">
              Colour by
              <select value={colorField} onChange={e => setColorField(e.target.value)}>
                <option value={CLUSTER_FIELD}>Cluster (PCA k-means)</option>
                {loaded.fields.map(f => <option key={f} value={f}>payload · {f}</option>)}
              </select>
            </label>
            {loaded.textFields.length > 0 && (
              <label className="vec-inline">
                Label by
                <select value={labelField} onChange={e => setLabelField(e.target.value)}>
                  <option value={NO_LABEL}>No labels</option>
                  {loaded.textFields.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            )}
            <button
              className={`btn btn-secondary vec-lasso ${lassoMode ? 'active' : ''}`}
              onClick={() => setLassoMode(m => !m)}
              title="Draw a freehand region to select points"
            >
              ◌ Lasso{lassoMode ? ' (on)' : ''}
            </button>
            <button className="btn btn-secondary" onClick={() => setResetToken(t => t + 1)} title="Reset pan & zoom">
              Reset view
            </button>
            <span className="vec-count">{points.length.toLocaleString()} points</span>
          </div>

          <FilterBuilder
            facets={facets}
            conds={filter}
            onChange={setFilter}
            onClear={() => setFilter([])}
            loading={facetLoading}
            filtering={loading}
            matchCount={matchCount}
            total={points.length}
            hint={filterHint}
          />

          <div className="vec-layout">
            <VectorScatter
              points={points}
              colors={colors}
              vectors={loaded.vectors}
              labels={labels}
              activeMask={activeMask}
              busy={loading}
              lassoMode={lassoMode}
              resetToken={resetToken}
              onFocus={setFocus}
              onLasso={setLassoSel}
            />

            <div className="vec-side">
              {legend.length > 0 && (
                <div className="vec-legend">
                  <div className="vec-legend-title">{colorField === CLUSTER_FIELD ? 'Clusters' : colorField}</div>
                  {legend.map(l => {
                    const cm = colorField === CLUSTER_FIELD ? l.label.match(/^Cluster (\d+)$/) : null;
                    const region = cm ? labelByCluster.get(Number(cm[1])) : undefined;
                    return (
                      <div key={l.label} className="vec-legend-row" title={`${region ? region + ' — ' : ''}${l.label} — ${l.count}`}>
                        <span className="vec-dot" style={{ background: l.color }} />
                        <span className="vec-legend-label">
                          <span className="vec-legend-main">{region || l.label}</span>
                          {region && <span className="vec-legend-sub">{l.label}</span>}
                        </span>
                        <span className="vec-legend-count">{l.count}</span>
                      </div>
                    );
                  })}
                  {colorField !== CLUSTER_FIELD && legend.length >= MAX_LEGEND && (
                    <div className="vec-legend-more">+ more values</div>
                  )}
                </div>
              )}

              {focus && (
                <div className="vec-panel">
                  <div className="vec-panel-title">
                    Nearest neighbours
                    <button className="vec-clear" onClick={() => setFocus(null)}>✕</button>
                  </div>
                  <div className="vec-focus-id">id: {fmt(points[focus.index]?.id)}</div>
                  {points[focus.index]?.payload && (
                    <div className="vec-payload">
                      {Object.entries(points[focus.index].payload!).slice(0, 6).map(([k, v]) => (
                        <div key={k} className="vec-payload-row"><span>{k}</span><span>{fmt(v)}</span></div>
                      ))}
                    </div>
                  )}
                  <div className="vec-neighbors">
                    {focus.neighbors.map((n, i) => (
                      <div key={n.index} className="vec-neighbor-row">
                        <span className="vec-neighbor-rank">{i + 1}</span>
                        <span className="vec-neighbor-id">{fmt(points[n.index]?.id)}</span>
                        <span className="vec-neighbor-sim">{n.sim.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!focus && lassoSel.length > 0 && (
                <div className="vec-panel">
                  <div className="vec-panel-title">
                    {lassoSel.length} selected
                    <button className="vec-clear" onClick={() => setLassoSel([])}>✕</button>
                  </div>
                  <div className="vec-neighbors">
                    {lassoSel.slice(0, 60).map(idx => (
                      <div key={idx} className="vec-neighbor-row">
                        <span className="vec-neighbor-id">{fmt(points[idx]?.id)}</span>
                        <span className="vec-neighbor-sim">{fmt(loaded.fields.length ? points[idx]?.payload?.[loaded.fields[0]] : '')}</span>
                      </div>
                    ))}
                    {lassoSel.length > 60 && <div className="vec-legend-more">+ {lassoSel.length - 60} more</div>}
                  </div>
                </div>
              )}

              {!focus && lassoSel.length === 0 && (
                <div className="vec-panel vec-hint-panel">
                  Click a point to see its nearest neighbours, or toggle <b>Lasso</b> and draw a region to
                  inspect a cluster. Colour by a payload field to see how metadata maps onto the embedding space.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <details className="vec-edu">
        <summary>
          <span className="vec-edu-title">🎓 HNSW Graph Visualizer</span>
          <span className="vec-edu-sub">
            Educational — reconstructs an HNSW graph from real vectors and animates a nearest-neighbour
            search over it, so you can see how <code>m</code> / <code>ef_construct</code> shape the graph. Click to open.
          </span>
          <span className="vec-edu-caret">▸</span>
        </summary>
        <div className="vec-edu-body">
          <VisualizerTab data={data} cluster={cluster} />
        </div>
      </details>
    </>
  );
}
