import { registerRule } from './rule-engine';
import { formatNumber } from '../lib/format';
import type { Insight, VectorConfig } from '../lib/types';

registerRule('collection-status', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    if (info.status === 'red') {
      insights.push({ level: 'critical', category: 'collection', collection: name, title: 'Collection status: red', detail: 'Collection is in a critical state. Immediate investigation required.' });
    } else if (info.status === 'yellow') {
      insights.push({ level: 'warning', category: 'collection', collection: name, title: 'Collection status: yellow', detail: 'Some shards may be partially available or the optimizer is actively working.' });
    }
  }
  return insights;
});

registerRule('optimizer-error', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const opt = info.optimizer_status;
    if (opt && typeof opt === 'object' && 'error' in opt) {
      insights.push({ level: 'critical', category: 'optimizer', collection: name, title: 'Optimizer error', detail: `${opt.error}. May indicate disk full or corrupted segments.` });
    } else if (opt === 'indexing') {
      insights.push({ level: 'info', category: 'optimizer', collection: name, title: 'Optimizer actively indexing', detail: 'Indexing in progress. Search latency may be elevated until optimization completes.' });
    }
  }
  return insights;
});

registerRule('update-queue-backlog', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const queueLen = info.update_queue?.length || 0;
    if (queueLen > 100) {
      insights.push({ level: 'warning', category: 'optimizer', collection: name, title: `Large update queue: ${queueLen} pending`, detail: 'Write operations are queuing up. Optimizer may be overloaded.' });
    }
  }
  return insights;
});

function getVectorEntries(vectors: Record<string, VectorConfig> | VectorConfig): [boolean, VectorConfig[]] {
  if ('size' in vectors && typeof vectors.size === 'number') return [false, [vectors as VectorConfig]];
  return [true, Object.values(vectors as Record<string, VectorConfig>)];
}

registerRule('no-quantization', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const quant = info.config?.quantization_config;
    const points = info.points_count || 0;
    if (!quant && points > 10000) {
      const [, entries] = getVectorEntries(info.config.params.vectors);
      const totalDims = entries.reduce((sum, v) => sum + (v.size || 0), 0);
      const estMemMB = Math.round((points * totalDims * 4) / (1024 * 1024));
      insights.push({ level: 'performance', category: 'config', collection: name, title: 'Quantization not enabled', detail: `With ${formatNumber(points)} points and ${totalDims}d total dimensions, estimated raw vector memory is ~${formatNumber(estMemMB)} MB. Scalar quantization (int8) can reduce this by 4x.` });
    }
  }
  return insights;
});

registerRule('always-ram-quantization', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const quant = info.config?.quantization_config;
    if (quant?.scalar?.always_ram && (info.points_count || 0) > 1000000) {
      insights.push({ level: 'info', category: 'memory', collection: name, title: 'Quantized vectors kept in RAM (always_ram: true)', detail: 'Keeps quantized vectors in resident memory for fast search. Monitor RSSAnon to ensure it stays below 80% of total RAM.' });
    }
  }
  return insights;
});

registerRule('no-payload-indexes', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    if (Object.keys(info.payload_schema || {}).length === 0 && (info.points_count || 0) > 0) {
      insights.push({ level: 'performance', category: 'config', collection: name, title: 'No payload indexes defined', detail: 'If you use filtered search, create payload indexes on filter fields. Without indexes, filtered queries scan all points.' });
    }
  }
  return insights;
});

registerRule('high-segment-count', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const segs = info.segments_count || 0;
    if (segs > 50) {
      insights.push({ level: 'warning', category: 'optimizer', collection: name, title: `High segment count: ${segs}`, detail: 'Too many segments slow searches. Optimizer may not have finished merging after bulk uploads.' });
    } else if (segs > 20) {
      insights.push({ level: 'info', category: 'optimizer', collection: name, title: `Moderate segment count: ${segs}`, detail: 'Segment count is somewhat elevated. The optimizer may still be merging.' });
    }
  }
  return insights;
});

registerRule('no-replication', (ctx) => {
  const insights: Insight[] = [];
  const peerCount = Object.keys(ctx.cluster?.peers || {}).length;
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const rf = info.config?.params?.replication_factor ?? 1;
    if (rf <= 1 && peerCount > 1) {
      insights.push({ level: 'warning', category: 'replication', collection: name, title: 'No replication (replication_factor: 1)', detail: `Cluster has ${peerCount} nodes but data is not replicated. Consider replication_factor: 2+ for production.` });
    } else if (rf <= 1) {
      insights.push({ level: 'info', category: 'replication', collection: name, title: 'Single node, no replication', detail: 'Running with replication_factor: 1. No redundancy - a node failure means data loss.' });
    }
  }
  return insights;
});

registerRule('indexing-progress', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const points = info.points_count || 0;
    const indexed = info.indexed_vectors_count || 0;
    const [, entries] = getVectorEntries(info.config.params.vectors);
    const denseCount = entries.length;
    if (points > 0 && denseCount > 0) {
      const expected = points * denseCount;
      if (indexed > 0 && indexed < expected * 0.9) {
        const pct = ((indexed / expected) * 100).toFixed(1);
        insights.push({ level: 'info', category: 'indexing', collection: name, title: `Indexing in progress: ${pct}%`, detail: `${formatNumber(indexed)} / ${formatNumber(expected)} expected indexed vectors.` });
      }
    }
  }
  return insights;
});

registerRule('hnsw-on-disk', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    if (info.config?.hnsw_config?.on_disk) {
      insights.push({ level: 'info', category: 'config', collection: name, title: 'HNSW index on disk (global)', detail: 'HNSW graph is stored on disk. Good for multi-tenant, but adds latency for high-throughput searches.' });
    }
  }
  return insights;
});

registerRule('sparse-vectors-in-memory', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const sparse = info.config?.params?.sparse_vectors || {};
    const sparseNames = Object.keys(sparse);
    if (sparseNames.length > 0 && (info.points_count || 0) > 500000) {
      const inMemory = sparseNames.filter(sn => !sparse[sn]?.index?.on_disk);
      if (inMemory.length > 0) {
        insights.push({ level: 'info', category: 'memory', collection: name, title: `${inMemory.length} sparse vector index(es) in memory`, detail: `Sparse vectors "${inMemory.join('", "')}" are in memory. Consider moving to disk for large datasets.` });
      }
    }
  }
  return insights;
});

registerRule('prevent-unoptimized-disabled', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    if (!info.config?.optimizer_config?.prevent_unoptimized && (info.points_count || 0) > 100000) {
      insights.push({ level: 'performance', category: 'optimizer', collection: name, title: 'prevent_unoptimized is disabled', detail: 'During bulk uploads, large unindexed segments may degrade search performance. Enable prevent_unoptimized.' });
    }
  }
  return insights;
});

registerRule('vectors-storage-strategy', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const [isNamed, entries] = getVectorEntries(info.config.params.vectors);
    if (!isNamed) continue;
    const totalDims = entries.reduce((s, v) => s + (v.size || 0), 0);
    const allOnDisk = entries.length > 0 && entries.every(v => v.on_disk);
    const noneOnDisk = entries.every(v => !v.on_disk);
    if (allOnDisk && (info.points_count || 0) > 0) {
      insights.push({ level: 'info', category: 'config', collection: name, title: 'All dense vectors stored on disk', detail: 'Vectors are read via mmap. Ensure enough free RAM for the working set.' });
    } else if (noneOnDisk && totalDims > 1024 && (info.points_count || 0) > 1000000) {
      insights.push({ level: 'performance', category: 'memory', collection: name, title: 'High-dimensional vectors in memory', detail: `${totalDims} total dimensions in memory. Consider on_disk: true + quantization.` });
    }
  }
  return insights;
});

registerRule('empty-collection', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (info && info.points_count === 0) {
      insights.push({ level: 'info', category: 'config', collection: name, title: 'Collection is empty', detail: 'Zero points. If unused, consider removing to reduce overhead.' });
    }
  }
  return insights;
});

// Payload index on_disk is non-default (default is false = in-memory).
// Surface it so operators see the tradeoff consciously.
registerRule('payload-index-on-disk', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const schema = info.payload_schema || {};
    const onDiskFields = Object.entries(schema)
      .filter(([, s]) => s.params?.on_disk === true)
      .map(([field]) => field);
    if (onDiskFields.length === 0) continue;

    const list = onDiskFields.slice(0, 4).join(', ') + (onDiskFields.length > 4 ? `, +${onDiskFields.length - 4} more` : '');
    insights.push({
      level: 'info',
      category: 'config',
      collection: name,
      title: `${onDiskFields.length} payload index${onDiskFields.length === 1 ? '' : 'es'} stored on disk`,
      detail: `Fields: ${list}. on_disk is non-default (default: in-memory). Trades RAM for disk I/O on filter queries — good when the collection has many large payload indexes, but adds latency when cache is cold.`,
    });
  }
  return insights;
});

// Payload index with enable_hnsw: false — means the field won't get
// extra HNSW edges for filtering. Usually unintentional.
registerRule('payload-index-hnsw-disabled', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const schema = info.payload_schema || {};
    const disabledFields = Object.entries(schema)
      .filter(([, s]) => s.params?.enable_hnsw === false)
      .map(([field]) => field);
    if (disabledFields.length === 0) continue;

    const list = disabledFields.slice(0, 4).join(', ') + (disabledFields.length > 4 ? `, +${disabledFields.length - 4} more` : '');
    insights.push({
      level: 'performance',
      category: 'config',
      collection: name,
      title: `${disabledFields.length} payload index${disabledFields.length === 1 ? '' : 'es'} with HNSW disabled`,
      detail: `Fields: ${list}. enable_hnsw is false, so filtered searches on these fields will not benefit from HNSW shortcuts. Re-enable unless you intentionally excluded them.`,
    });
  }
  return insights;
});
