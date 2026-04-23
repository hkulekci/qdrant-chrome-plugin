import type { DashboardData, MetricsHistorySample } from './types';

export function createMetricsSample(
  clusterId: string,
  capturedAt: string,
  data: DashboardData,
): MetricsHistorySample {
  let totalPoints = 0;
  let totalVectors = 0;
  let hasVectorCounts = false;
  let totalIndexedVectors = 0;
  let totalSegments = 0;

  const collections = data.collections.flatMap((collection) => {
    const info = data.collectionDetails[collection]?.info;
    if (!info) return [];

    totalPoints += info.points_count || 0;
    totalIndexedVectors += info.indexed_vectors_count || 0;
    totalSegments += info.segments_count || 0;

    const vectors = typeof info.vectors_count === 'number' ? info.vectors_count : null;
    if (vectors !== null) {
      totalVectors += vectors;
      hasVectorCounts = true;
    }

    return [{
      collection,
      status: info.status || 'unknown',
      points: info.points_count || 0,
      vectors,
      indexedVectors: info.indexed_vectors_count || 0,
      segments: info.segments_count || 0,
    }];
  });

  return {
    clusterId,
    capturedAt,
    qdrantUp: 1,
    totalPoints,
    totalVectors: hasVectorCounts ? totalVectors : null,
    totalIndexedVectors,
    totalSegments,
    collections,
  };
}
