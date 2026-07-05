// Public entry point: turn a sample of real Qdrant vectors into a fully laid-out
// HNSW graph that the canvas renderer and the search animator can consume.

import { normalize } from './similarity';
import { buildIndex } from './build';
import { projectLayout } from './project';
import { runHNSWSearch } from './search';
import { mkRng } from './rng';
import type { GraphState, SearchResult } from './search';

export type { SearchResult, SearchStep, GraphState } from './search';

/** A point sampled from a collection, before layout/graph construction. */
export interface SamplePoint {
  /** Original Qdrant point id (uuid or number) — for display only. */
  pointId: string | number;
  vector: number[];
}

/** A graph node ready for rendering. Array index === id === edge endpoints. */
export interface VizNode {
  id: number;
  pointId: string | number;
  embedding: number[];
  friends: number[][];
  layer: number;
  x: number;
  y: number;
  cluster: number;
}

export interface VizGraph {
  nodes: VizNode[];
  edges: { from: number; to: number }[];
  ep: number;
  maxLayer: number;
  /** True HNSW parameters read from the collection, echoed for the UI. */
  params: { m: number; m0: number; efConstruction: number };
}

export interface BuildGraphOptions {
  /** Qdrant `m`. Defaults to 16 when the collection doesn't specify one. */
  m?: number;
  /** Qdrant `ef_construct`. Defaults to 100. */
  efConstruction?: number;
  /** Layout/RNG seed for reproducibility. */
  seed?: number;
}

/**
 * Build a visualisable HNSW graph from sampled vectors.
 *
 * The vectors are normalised, indexed with the collection's real `m` /
 * `ef_construct`, and given a 2D layout via PCA. The result is an independent
 * client-side reconstruction — Qdrant does not expose its own graph edges — but
 * it runs the same algorithm with the same parameters over the same data.
 */
export function buildVizGraph(points: SamplePoint[], opts: BuildGraphOptions = {}): VizGraph {
  const m = opts.m && opts.m > 0 ? opts.m : 16;
  const m0 = m * 2;
  const efConstruction = opts.efConstruction && opts.efConstruction > 0 ? opts.efConstruction : 100;
  const seed = opts.seed ?? 1;

  const embeddings = points.map(p => normalize(p.vector));
  const built = buildIndex(embeddings, { m, m0, efConstruction, rng: mkRng(seed) });
  const layout = projectLayout(embeddings, seed);

  const nodes: VizNode[] = built.nodes.map((bn, i) => ({
    id: bn.id,
    pointId: points[i].pointId,
    embedding: bn.embedding,
    friends: bn.friends,
    layer: bn.layer,
    x: layout[i].x,
    y: layout[i].y,
    cluster: layout[i].cluster,
  }));

  return { nodes, edges: built.edges, ep: built.ep, maxLayer: built.maxLayer, params: { m, m0, efConstruction } };
}

/** Run a query (unnormalised is fine) against a built graph. */
export function searchVizGraph(graph: VizGraph, queryVector: number[], k = 5): SearchResult {
  const q = normalize(queryVector);
  const state: GraphState = { nodes: graph.nodes, ep: graph.ep, maxLayer: graph.maxLayer };
  return runHNSWSearch(q, state, k);
}
