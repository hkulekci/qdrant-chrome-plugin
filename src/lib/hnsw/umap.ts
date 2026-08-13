// UMAP projection — an alternative to the PCA layout in project.ts.
//
// PCA is linear: it keeps the two highest-variance directions, which shows
// global structure but distorts local neighbourhoods (a point's true nearest
// neighbours can land far apart on the map). UMAP instead optimises to keep
// each point's high-dimensional nearest neighbours close in 2D, so "close on
// the map ≈ real neighbour" holds far better — at the cost of being slower.
//
// umap-js is pure JavaScript (no wasm, no eval), so it runs under the strict
// MV3 content-security policy. It is loaded on demand (dynamic import) so the
// dashboard bundle stays small until the user actually picks UMAP.

import { mkRng } from './rng';
import { CANVAS, MAX_CLUSTERS, kmeans, scaleToCanvas, type Layout } from './project';

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 1 : 1 - dot / denom;
}

const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));

interface UmapOpts {
  seed?: number;
  onProgress?: (fraction: number) => void;
}

/**
 * Project `embeddings` to an (x, y, cluster) layout with UMAP. Runs the
 * optimisation in small batches, yielding to the event loop between them so a
 * loading overlay stays live and the UI does not freeze. `seed` keeps results
 * reproducible for the same sample.
 */
export async function projectUMAP(embeddings: number[][], opts: UmapOpts = {}): Promise<Layout[]> {
  const n = embeddings.length;
  if (n === 0) return [];
  const cx = (CANVAS.minX + CANVAS.maxX) / 2, cy = (CANVAS.minY + CANVAS.maxY) / 2;
  if (n < 3) return embeddings.map(() => ({ x: cx, y: cy, cluster: 0 }));

  const { UMAP } = await import('umap-js');
  const rng = mkRng(opts.seed ?? 1);
  // Neighbourhood size scales gently with sample size; clamped to a sane range.
  const nNeighbors = Math.max(5, Math.min(30, Math.floor(Math.sqrt(n))));

  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.min(nNeighbors, n - 1),
    minDist: 0.1,
    random: rng,
    distanceFn: cosineDistance,
  });

  const epochs = umap.initializeFit(embeddings);
  for (let e = 0; e < epochs; e++) {
    umap.step();
    if (e % 15 === 0) { opts.onProgress?.(e / epochs); await yieldToUI(); }
  }
  opts.onProgress?.(1);

  const emb = umap.getEmbedding();
  const xs = scaleToCanvas(emb.map(p => p[0]), CANVAS.minX, CANVAS.maxX);
  const ys = scaleToCanvas(emb.map(p => p[1]), CANVAS.minY, CANVAS.maxY);
  const points = xs.map((x, i) => ({ x, y: ys[i] }));
  const clusters = kmeans(points, Math.min(MAX_CLUSTERS, n), rng);
  return points.map((p, i) => ({ x: p.x, y: p.y, cluster: clusters[i] }));
}
