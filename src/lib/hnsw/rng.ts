// Small seeded PRNG so a given collection sample always builds the same graph
// (deterministic layer assignment + k-means seeding). Mulberry32.
//
// Ported to TypeScript from VectorLens (HNSW Vector Search Visualizer)
// by Manik Bodamwad — https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer
// Licensed under the MIT License. See NOTICE.

export function mkRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
