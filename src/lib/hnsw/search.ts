// HNSW query-time traversal, producing an ordered list of animation `steps`.
//
// Faithful port of the search stage from VectorLens (HNSW Vector Search
// Visualizer) by Manik Bodamwad —
// https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer (MIT).

import { cosineSim } from './similarity';
import type { BuildNode } from './build';

class PriorityQueue<T> {
  private data: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}
  push(val: T) { this.data.push(val); this.up(this.data.length - 1); }
  pop(): T | null {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const bottom = this.data.pop()!;
    if (this.data.length > 0) { this.data[0] = bottom; this.down(0); }
    return top;
  }
  peek(): T | null { return this.data.length > 0 ? this.data[0] : null; }
  get size() { return this.data.length; }
  private up(i: number) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.compare(this.data[i], this.data[p]) < 0) {
        [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
        i = p;
      } else break;
    }
  }
  private down(i: number) {
    const len = this.data.length;
    for (;;) {
      const left = 2 * i + 1, right = 2 * i + 2;
      let best = i;
      if (left < len && this.compare(this.data[left], this.data[best]) < 0) best = left;
      if (right < len && this.compare(this.data[right], this.data[best]) < 0) best = right;
      if (best !== i) { [this.data[i], this.data[best]] = [this.data[best], this.data[i]]; i = best; }
      else break;
    }
  }
}

export type StepType = 'entry' | 'drop' | 'evaluate' | 'hop' | 'result';

export interface SearchStep {
  nodeId: number;
  sim: number;
  type: StepType;
  layer?: number;
  hop?: number;
  isHit?: boolean;
  /** The node being expanded — the source end of the edge this step traverses.
   *  Present on `evaluate`/`hop` steps so the animation can light up the edge. */
  from?: number;
}

export interface SearchResult {
  steps: SearchStep[];
  results: number[];
  nodesEvaluated: number;
  nodesSkipped: number;
  computeSaved: number;
  topSim: number;
}

export interface GraphState {
  nodes: BuildNode[];
  ep: number;
  maxLayer: number;
}

/**
 * Simulate HNSW traversal. No shortcuts — a real priority-queue based
 * multi-layer search. `queryEmbedding` must be unit-normalised.
 */
export function runHNSWSearch(queryEmbedding: number[], graph: GraphState, k = 5): SearchResult {
  const steps: SearchStep[] = [];
  const seen = new Set<number>();

  const { nodes, ep, maxLayer } = graph;
  const n = nodes.length;
  if (n === 0) return { steps, results: [], nodesEvaluated: 0, nodesSkipped: 0, computeSaved: 0, topSim: 0 };

  let currObj = ep;
  let currSim = cosineSim(queryEmbedding, nodes[currObj].embedding);
  seen.add(currObj);

  // ── Coarse search down to layer 1 ──
  for (let lc = maxLayer; lc >= 1; lc--) {
    let changed = true;
    steps.push({ nodeId: currObj, sim: round(currSim), type: lc === maxLayer ? 'entry' : 'drop', layer: lc, hop: steps.length });
    while (changed) {
      changed = false;
      const source = currObj;
      for (const neighbor of nodes[source].friends[lc] || []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        const sim = cosineSim(queryEmbedding, nodes[neighbor].embedding);
        const isHit = sim > currSim;
        steps.push({ nodeId: neighbor, sim: round(sim), type: 'evaluate', layer: lc, hop: steps.length, isHit, from: source });
        if (isHit) {
          currSim = sim;
          currObj = neighbor;
          changed = true;
          steps.push({ nodeId: neighbor, sim: round(currSim), type: 'hop', layer: lc, hop: steps.length, from: source });
        }
      }
    }
  }

  // ── Layer 0: fine search using priority queues ──
  const efSearch = Math.max(k, 32);
  const W = new PriorityQueue<{ id: number; sim: number }>((a, b) => a.sim - b.sim); // worst kept on top
  const C = new PriorityQueue<{ id: number; sim: number }>((a, b) => b.sim - a.sim); // best to explore on top

  W.push({ id: currObj, sim: currSim });
  C.push({ id: currObj, sim: currSim });
  steps.push({ nodeId: currObj, sim: round(currSim), type: maxLayer === 0 ? 'entry' : 'drop', layer: 0, hop: steps.length });

  let bestSimFound = currSim;

  while (C.size > 0) {
    const c = C.pop()!;
    const f = W.peek()!;
    if (c.sim < f.sim) break;

    for (const neighbor of nodes[c.id].friends[0] || []) {
      if (seen.has(neighbor)) continue;
      seen.add(neighbor);

      const sim = cosineSim(queryEmbedding, nodes[neighbor].embedding);
      const worst = W.peek()!;
      const isHit = W.size < efSearch || sim > worst.sim;
      steps.push({ nodeId: neighbor, sim: round(sim), type: 'evaluate', layer: 0, hop: steps.length, isHit, from: c.id });

      if (W.size < efSearch || sim > worst.sim) {
        C.push({ id: neighbor, sim });
        W.push({ id: neighbor, sim });
        if (W.size > efSearch) W.pop();
        if (sim > bestSimFound) {
          bestSimFound = sim;
          steps.push({ nodeId: neighbor, sim: round(sim), type: 'hop', layer: 0, hop: steps.length, from: c.id });
        }
      }
    }
  }

  // ── Collect top K ──
  const collected: { id: number; sim: number }[] = [];
  while (W.size > 0) collected.push(W.pop()!);
  collected.reverse();
  const topK = collected.slice(0, k);
  topK.forEach(r => steps.push({ nodeId: r.id, sim: round(r.sim), type: 'result' }));

  return {
    steps,
    results: topK.map(r => r.id),
    nodesEvaluated: seen.size,
    nodesSkipped: n - seen.size,
    computeSaved: round((1 - seen.size / n) * 100, 1),
    topSim: round(topK[0]?.sim ?? 0),
  };
}

function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
