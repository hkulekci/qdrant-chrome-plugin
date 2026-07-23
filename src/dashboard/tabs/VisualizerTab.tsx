import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClusterConfig, DashboardData, VectorConfig } from '../../lib/types';
import { QdrantApi } from '../../lib/qdrant-api';
import { buildVizGraph, type VizGraph } from '../../lib/hnsw';
import { VisualizerCanvas } from '../viz/VisualizerCanvas';

const MAX_SAMPLE = 2000;
const MAX_GRAPHS = 5;

/** One built graph kept on the page, with the config it was built from so the
 *  user can compare how different HNSW settings behave on the same real data. */
interface BuiltGraph {
  id: number;
  graph: VizGraph;
  collection: string;
  vectorName?: string;
  sampleSize: number;
}

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
  const [graphs, setGraphs] = useState<BuiltGraph[]>([]);
  const nextIdRef = useRef(1);

  const info = data.collectionDetails[collection]?.info;
  const vecOpts = useMemo(() => vectorOptions(info?.config?.params?.vectors), [info]);
  const pointCount = info?.points_count;

  // The collection's real HNSW params for the chosen vector — used as the
  // starting point, but the user can override them to see the speed effect.
  const collHnsw = useMemo(() => {
    const chosen = vecOpts.find(v => v.name === vectorName);
    return chosen?.cfg?.hnsw_config ?? info?.config?.hnsw_config;
  }, [vecOpts, vectorName, info]);

  const [m, setM] = useState(16);
  const [efConstruct, setEfConstruct] = useState(100);

  // Reset the overrides to the collection's real values whenever the selected
  // collection/vector changes.
  useEffect(() => {
    setM(collHnsw?.m ?? 16);
    setEfConstruct(collHnsw?.ef_construct ?? 100);
  }, [collHnsw]);

  const build = async () => {
    setError(null);
    setLoading(true);
    try {
      const api = new QdrantApi(cluster.url, cluster.apiKey);
      const points = await api.scrollPoints(collection, { limit: sampleSize, vectorName });
      if (points.length === 0) {
        throw new Error('No dense vectors returned. The collection may be empty, store vectors on disk without returning them, or use only sparse vectors.');
      }

      const built = buildVizGraph(
        points.map(p => ({ pointId: p.id, vector: p.vector })),
        { m, efConstruction: efConstruct, seed: 1 },
      );
      const entry: BuiltGraph = { id: nextIdRef.current++, graph: built, collection, vectorName, sampleSize };
      // Newest on top; keep at most MAX_GRAPHS so the page stays comparable.
      setGraphs(prev => [entry, ...prev].slice(0, MAX_GRAPHS));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const removeGraph = (id: number) => setGraphs(prev => prev.filter(g => g.id !== id));

  return (
    <>
      <div className="card">
        <h2>HNSW Visualizer</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
          Samples real vectors from a collection and reconstructs an HNSW graph client-side, then animates
          a nearest-neighbour search over it. <code>m</code> and <code>ef_construct</code> default to the
          collection's own values but are editable — change them and rebuild to watch how they affect search
          cost (the <b>Evaluated</b> count and the number of edges lit up per hop). Qdrant does not expose its
          internal graph edges, so this is an independent reconstruction — same algorithm, same vectors.
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

          <label title="Connections per node. Higher m = more neighbours checked per hop = better recall but slower search.">
            m {collHnsw?.m != null && <span className="viz-default">(coll: {collHnsw.m})</span>}
            <input
              type="number" min={2} max={128} value={m}
              onChange={e => setM(Math.max(2, Math.min(128, Number(e.target.value) || 2)))}
            />
          </label>

          <label title="Candidate pool size while building the graph. Higher ef_construct = better-connected graph = faster, more accurate search (but slower build).">
            ef_construct {collHnsw?.ef_construct != null && <span className="viz-default">(coll: {collHnsw.ef_construct})</span>}
            <input
              type="number" min={4} max={1000} value={efConstruct}
              onChange={e => setEfConstruct(Math.max(4, Math.min(1000, Number(e.target.value) || 4)))}
            />
          </label>

          <button className="btn btn-refresh" onClick={build} disabled={loading || !collection}>
            {loading ? 'Building…' : 'Build graph'}
          </button>
        </div>

        <p className="viz-hint" style={{ marginBottom: 0 }}>
          {typeof pointCount === 'number' && <>Collection has {pointCount.toLocaleString()} points. </>}
          A sample of up to {MAX_SAMPLE} is used to keep in-browser graph construction fast.
          Each build is added on top; up to {MAX_GRAPHS} are kept so you can compare configs side by side.
        </p>

        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {graphs.map((g, idx) => (
        <div className="card" key={g.id}>
          <div className="viz-card-head">
            <div className="viz-meta">
              <span className="meta-tag"><span className="label">#</span><span className="val">{g.id}</span></span>
              <span className="meta-tag"><span className="label">Collection:</span><span className="val">{g.collection}{g.vectorName ? ` · ${g.vectorName}` : ''}</span></span>
              <span className="meta-tag"><span className="label">Nodes:</span><span className="val">{g.graph.nodes.length}</span></span>
              <span className="meta-tag"><span className="label">m:</span><span className="val">{g.graph.params.m}</span></span>
              <span className="meta-tag"><span className="label">m₀:</span><span className="val">{g.graph.params.m0}</span></span>
              <span className="meta-tag"><span className="label">ef_construct:</span><span className="val">{g.graph.params.efConstruction}</span></span>
              {idx === 0 && <span className="status-badge green">newest</span>}
            </div>
            <button className="btn btn-secondary viz-remove" onClick={() => removeGraph(g.id)} title="Remove this graph">✕</button>
          </div>
          <VisualizerCanvas graph={g.graph} />
        </div>
      ))}

      {graphs.length > 0 && (
        <p className="viz-credit">
          Visualization engine adapted from{' '}
          <a href="https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer" target="_blank" rel="noopener noreferrer">
            VectorLens by Manik Bodamwad
          </a>{' '}(MIT).
        </p>
      )}
    </>
  );
}
