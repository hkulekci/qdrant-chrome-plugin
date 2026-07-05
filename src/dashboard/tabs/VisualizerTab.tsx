import { useMemo, useState } from 'react';
import type { ClusterConfig, DashboardData, VectorConfig } from '../../lib/types';
import { QdrantApi } from '../../lib/qdrant-api';
import { buildVizGraph, type VizGraph } from '../../lib/hnsw';
import { VisualizerCanvas } from '../viz/VisualizerCanvas';

const MAX_SAMPLE = 2000;

/** List named dense vectors for a collection, or [undefined] for a single
 *  unnamed vector, plus the per-name HNSW params. */
function vectorOptions(vectors: Record<string, VectorConfig> | VectorConfig | undefined) {
  if (!vectors) return [{ name: undefined as string | undefined, cfg: undefined as VectorConfig | undefined }];
  if (typeof (vectors as VectorConfig).size === 'number') {
    return [{ name: undefined, cfg: vectors as VectorConfig }];
  }
  return Object.entries(vectors as Record<string, VectorConfig>).map(([name, cfg]) => ({ name, cfg }));
}

export function VisualizerTab({ data, cluster }: { data: DashboardData; cluster: ClusterConfig }) {
  const [collection, setCollection] = useState(data.collections[0] || '');
  const [vectorName, setVectorName] = useState<string | undefined>(undefined);
  const [sampleSize, setSampleSize] = useState(300);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<VizGraph | null>(null);
  const [buildToken, setBuildToken] = useState(0);

  const info = data.collectionDetails[collection]?.info;
  const vecOpts = useMemo(() => vectorOptions(info?.config?.params?.vectors), [info]);
  const pointCount = info?.points_count;

  const build = async () => {
    setError(null);
    setLoading(true);
    setGraph(null);
    try {
      const api = new QdrantApi(cluster.url, cluster.apiKey);
      const points = await api.scrollPoints(collection, { limit: sampleSize, vectorName });
      if (points.length === 0) {
        throw new Error('No dense vectors returned. The collection may be empty, store vectors on disk without returning them, or use only sparse vectors.');
      }

      // Prefer the selected vector's HNSW params, falling back to the global config.
      const chosen = vecOpts.find(v => v.name === vectorName);
      const hnsw = chosen?.cfg?.hnsw_config ?? info?.config?.hnsw_config;
      const built = buildVizGraph(
        points.map(p => ({ pointId: p.id, vector: p.vector })),
        { m: hnsw?.m, efConstruction: hnsw?.ef_construct, seed: 1 },
      );
      setGraph(built);
      setBuildToken(t => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>HNSW Visualizer</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
          Samples real vectors from a collection and reconstructs an HNSW graph client-side using that
          collection's own <code>m</code> / <code>ef_construct</code>, then animates a nearest-neighbour
          search over it. Qdrant does not expose its internal graph edges, so this is an independent
          reconstruction — same algorithm, same parameters, same vectors.
        </p>

        <div className="viz-form">
          <label>
            Collection
            <select value={collection} onChange={e => { setCollection(e.target.value); setVectorName(undefined); setGraph(null); }}>
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

          <button className="btn btn-refresh" onClick={build} disabled={loading || !collection}>
            {loading ? 'Building…' : 'Build graph'}
          </button>
        </div>

        <p className="viz-hint" style={{ marginBottom: 0 }}>
          {typeof pointCount === 'number' && <>Collection has {pointCount.toLocaleString()} points. </>}
          A sample of up to {MAX_SAMPLE} is used to keep in-browser graph construction fast.
        </p>

        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {graph && (
        <div className="card">
          <div className="viz-meta">
            <span className="meta-tag"><span className="label">Nodes:</span><span className="val">{graph.nodes.length}</span></span>
            <span className="meta-tag"><span className="label">m:</span><span className="val">{graph.params.m}</span></span>
            <span className="meta-tag"><span className="label">m₀:</span><span className="val">{graph.params.m0}</span></span>
            <span className="meta-tag"><span className="label">ef_construct:</span><span className="val">{graph.params.efConstruction}</span></span>
          </div>
          <VisualizerCanvas key={buildToken} graph={graph} />
          <p className="viz-credit">
            Visualization engine adapted from{' '}
            <a href="https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer" target="_blank" rel="noopener noreferrer">
              VectorLens by Manik Bodamwad
            </a>{' '}(MIT).
          </p>
        </div>
      )}
    </>
  );
}
