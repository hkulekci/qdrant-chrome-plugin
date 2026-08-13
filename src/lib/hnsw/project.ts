// Layout projection for real vectors.
//
// The upstream visualiser generated its own 2D positions when it synthesised
// data. Real Qdrant vectors are high-dimensional and carry no 2D coordinates,
// so we derive a layout here: PCA (top two principal components via power
// iteration) maps every vector to an (x, y) on the canvas, and a small k-means
// assigns each point to one of up to 10 clusters, which the renderer turns into
// z-depth so the graph reads as 3D.
//
// This module is original to this plugin (not part of the ported engine).

import { mkRng } from './rng';

export const CANVAS = { minX: 60, maxX: 940, minY: 60, maxY: 740 };
export const MAX_CLUSTERS = 10;

export interface Layout {
  x: number;
  y: number;
  cluster: number;
}

function meanVector(data: number[][]): number[] {
  const dim = data[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of data) for (let i = 0; i < dim; i++) mean[i] += v[i];
  for (let i = 0; i < dim; i++) mean[i] /= data.length;
  return mean;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalizeInPlace(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Dominant eigenvector of the covariance of `centered` via power iteration. */
function powerIteration(centered: number[][], rng: () => number, iters = 40): number[] {
  const dim = centered[0].length;
  let v = normalizeInPlace(Array.from({ length: dim }, () => rng() - 0.5));
  for (let it = 0; it < iters; it++) {
    const next = new Array(dim).fill(0);
    for (const row of centered) {
      const proj = dot(row, v);
      for (let i = 0; i < dim; i++) next[i] += proj * row[i];
    }
    normalizeInPlace(next);
    v = next;
  }
  return v;
}

/** Remove the component along `axis` from every row (deflation for next PC). */
function deflate(centered: number[][], axis: number[]): void {
  for (const row of centered) {
    const proj = dot(row, axis);
    for (let i = 0; i < row.length; i++) row[i] -= proj * axis[i];
  }
}

export function scaleToCanvas(values: number[], min: number, max: number): number[] {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  return values.map(v => min + ((v - lo) / span) * (max - min));
}

/** Deterministic k-means over the 2D projection; returns a cluster id per point. */
export function kmeans(points: { x: number; y: number }[], k: number, rng: () => number): number[] {
  const n = points.length;
  const centers: { x: number; y: number }[] = [];
  const used = new Set<number>();
  while (centers.length < k && used.size < n) {
    const idx = Math.floor(rng() * n);
    if (used.has(idx)) continue;
    used.add(idx);
    centers.push({ ...points[idx] });
  }
  const assign = new Array(n).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dx = points[i].x - centers[c].x, dy = points[i].y - centers[c].y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
    }
    const sum = centers.map(() => ({ x: 0, y: 0, n: 0 }));
    for (let i = 0; i < n; i++) { const a = assign[i]; sum[a].x += points[i].x; sum[a].y += points[i].y; sum[a].n++; }
    for (let c = 0; c < centers.length; c++) {
      if (sum[c].n > 0) { centers[c].x = sum[c].x / sum[c].n; centers[c].y = sum[c].y / sum[c].n; }
    }
  }
  return assign;
}

/**
 * Compute an (x, y, cluster) layout for `embeddings` (each already normalised).
 * `seed` keeps the layout stable for the same sample.
 */
export function projectLayout(embeddings: number[][], seed = 1): Layout[] {
  const n = embeddings.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: (CANVAS.minX + CANVAS.maxX) / 2, y: (CANVAS.minY + CANVAS.maxY) / 2, cluster: 0 }];

  const rng = mkRng(seed);
  const mean = meanVector(embeddings);
  const centered = embeddings.map(v => v.map((x, i) => x - mean[i]));

  const pc1 = powerIteration(centered, rng);
  deflate(centered, pc1);
  const pc2 = powerIteration(centered, rng);

  // Project against the ORIGINAL centered data, not the deflated copy.
  const recentered = embeddings.map(v => v.map((x, i) => x - mean[i]));
  const xs = scaleToCanvas(recentered.map(r => dot(r, pc1)), CANVAS.minX, CANVAS.maxX);
  const ys = scaleToCanvas(recentered.map(r => dot(r, pc2)), CANVAS.minY, CANVAS.maxY);

  const points = xs.map((x, i) => ({ x, y: ys[i] }));
  const k = Math.min(MAX_CLUSTERS, n);
  const clusters = kmeans(points, k, rng);

  return points.map((p, i) => ({ x: p.x, y: p.y, cluster: clusters[i] }));
}
