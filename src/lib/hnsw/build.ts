// Client-side HNSW index construction.
//
// This is a faithful port of the index-build stage from VectorLens
// (HNSW Vector Search Visualizer) by Manik Bodamwad —
// https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer (MIT).
// The original built a graph over synthetic embeddings; here it is generalised
// into a pure function so it can be run over REAL vectors pulled from a Qdrant
// collection, using that collection's own `m` / `ef_construct` parameters.
//
// NOTE: Qdrant does not expose the edges of its internal HNSW index through the
// REST API, so this is not Qdrant's actual graph. It is an independent
// reconstruction that runs the same algorithm, with the same parameters, over
// the same vectors — a faithful, educational approximation of what Qdrant built.

import { cosineSim } from './similarity';

export interface BuildNode {
  /** Array index — also the id used by edges and search steps. */
  id: number;
  embedding: number[];
  /** friends[layer] = neighbour ids at that layer. */
  friends: number[][];
  /** Top layer this node participates in. */
  layer: number;
}

export interface BuildResult {
  nodes: BuildNode[];
  /** De-duplicated layer-0 edges, for drawing the base graph. */
  edges: { from: number; to: number }[];
  /** Entry point id. */
  ep: number;
  maxLayer: number;
}

export interface BuildParams {
  /** Upper-layer max connections (Qdrant `m`). */
  m: number;
  /** Layer-0 max connections (Qdrant uses 2*m). */
  m0: number;
  /** Candidate pool size during construction (Qdrant `ef_construct`). */
  efConstruction: number;
  /** Deterministic uniform RNG in [0,1) for layer assignment. */
  rng: () => number;
}

/** Greedy layer search returning the `ef` best candidates, sorted best-first. */
function searchLayer(
  qEmb: number[],
  epId: number,
  ef: number,
  layer: number,
  nodes: BuildNode[],
): { id: number; sim: number }[] {
  const seen = new Set<number>([epId]);
  const candidates = [{ id: epId, sim: cosineSim(qEmb, nodes[epId].embedding) }];
  const results = [...candidates];

  while (candidates.length > 0) {
    candidates.sort((a, b) => b.sim - a.sim);
    const c = candidates.shift()!;

    results.sort((a, b) => b.sim - a.sim);
    const f = results[results.length - 1]; // worst kept
    if (c.sim < f.sim) break;

    const neighbors = nodes[c.id].friends[layer] || [];
    for (const nId of neighbors) {
      if (seen.has(nId)) continue;
      seen.add(nId);

      const sim = cosineSim(qEmb, nodes[nId].embedding);
      results.sort((a, b) => b.sim - a.sim);
      const worst = results[results.length - 1];

      if (results.length < ef || sim > worst.sim) {
        candidates.push({ id: nId, sim });
        results.push({ id: nId, sim });
        if (results.length > ef) {
          results.sort((a, b) => b.sim - a.sim);
          results.pop();
        }
      }
    }
  }
  results.sort((a, b) => b.sim - a.sim);
  return results;
}

/** Keep only the M closest neighbours of `node` at `layer`. */
function pruneConnections(node: BuildNode, layer: number, mMax: number, nodes: BuildNode[]): number[] {
  const sims = node.friends[layer].map(id => ({ id, sim: cosineSim(node.embedding, nodes[id].embedding) }));
  sims.sort((a, b) => b.sim - a.sim);
  return sims.slice(0, mMax).map(s => s.id);
}

/**
 * Build an HNSW graph over `embeddings` (which must be unit-normalised).
 * Returns the per-node adjacency, layer-0 edge list, and the entry point.
 */
export function buildIndex(embeddings: number[][], params: BuildParams): BuildResult {
  const { m, m0, efConstruction, rng } = params;
  const mL = 1 / Math.log(Math.max(m, 2));

  const nodes: BuildNode[] = embeddings.map((embedding, id) => {
    const l = Math.floor(-Math.log(rng() + 0.0001) * mL);
    const friends: number[][] = [];
    for (let i = 0; i <= l; i++) friends[i] = [];
    return { id, embedding, friends, layer: l };
  });

  let ep = -1;
  let maxLayer = -1;
  const flatEdges: { from: number; to: number }[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const q = nodes[i];

    if (ep === -1) {
      ep = i;
      maxLayer = q.layer;
      continue;
    }

    let currObj = ep;
    let currSim = cosineSim(q.embedding, nodes[currObj].embedding);

    // Coarse descent through the upper layers.
    for (let lc = maxLayer; lc > q.layer; lc--) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const neighbor of nodes[currObj].friends[lc] || []) {
          const sim = cosineSim(q.embedding, nodes[neighbor].embedding);
          if (sim > currSim) { currSim = sim; currObj = neighbor; changed = true; }
        }
      }
    }

    // Connect at every layer from min(maxLayer, q.layer) down to 0.
    for (let lc = Math.min(maxLayer, q.layer); lc >= 0; lc--) {
      const W = searchLayer(q.embedding, currObj, efConstruction, lc, nodes);
      const mMax = lc === 0 ? m0 : m;
      const neighbors = W.slice(0, mMax).map(w => w.id);

      for (const neighborId of neighbors) {
        q.friends[lc].push(neighborId);
        nodes[neighborId].friends[lc].push(q.id);

        if (lc === 0) {
          flatEdges.push({ from: Math.min(q.id, neighborId), to: Math.max(q.id, neighborId) });
        }
        if (nodes[neighborId].friends[lc].length > mMax) {
          nodes[neighborId].friends[lc] = pruneConnections(nodes[neighborId], lc, mMax, nodes);
        }
      }
      if (W.length > 0) currObj = W[0].id;
    }

    if (q.layer > maxLayer) { ep = i; maxLayer = q.layer; }
  }

  const edges: { from: number; to: number }[] = [];
  const edgeSet = new Set<string>();
  for (const e of flatEdges) {
    const hash = `${e.from}-${e.to}`;
    if (!edgeSet.has(hash)) { edgeSet.add(hash); edges.push(e); }
  }

  return { nodes, edges, ep: Math.max(ep, 0), maxLayer: Math.max(maxLayer, 0) };
}
