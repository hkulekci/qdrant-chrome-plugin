// HNSW similarity + vector helpers.
//
// Ported to TypeScript from VectorLens (HNSW Vector Search Visualizer)
// by Manik Bodamwad — https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer
// Licensed under the MIT License. See NOTICE for the retained copyright.

/** Cosine similarity. When both inputs are unit-norm this reduces to the dot
 *  product, which is what the build/search engine relies on — so callers should
 *  pass vectors that have already been run through {@link normalize}. */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Full cosine similarity that does not assume unit-norm inputs. Used by the
 *  live math inspector, which shows the raw dot product and norms. */
export function cosineComponents(a: number[], b: number[]) {
  let dot = 0, nq = 0, np = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nq += a[i] * a[i];
    np += b[i] * b[i];
  }
  nq = Math.sqrt(nq);
  np = Math.sqrt(np);
  const sim = nq > 0 && np > 0 ? dot / (nq * np) : 0;
  return { dotProduct: dot, normQ: nq, normP: np, simLive: sim };
}

/** Return a unit-length copy of `v`. */
export function normalize(v: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  return v.map(x => x / (norm + 1e-9));
}
