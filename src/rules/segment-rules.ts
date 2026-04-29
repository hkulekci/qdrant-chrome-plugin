import { registerRule } from './rule-engine';
import type { DashboardData, Telemetry, Insight } from '../lib/types';

function allNodeTelemetries(ctx: DashboardData): [string, Telemetry][] {
  if (ctx.nodeTelemetry && Object.keys(ctx.nodeTelemetry).length > 0) {
    return Object.entries(ctx.nodeTelemetry);
  }
  if (ctx.telemetry) return [[ctx.cluster?.peer_id?.toString() || 'local', ctx.telemetry]];
  return [];
}

registerRule('shard-high-segment-count', (ctx) => {
  const insights: Insight[] = [];
  const checked = new Set<string>();
  for (const [peerId, nodeTel] of allNodeTelemetries(ctx)) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      for (const shard of (coll.shards || [])) {
        const key = `${coll.id}-${shard.id}`;
        if (checked.has(key)) continue;
        checked.add(key);
        const segCount = shard.local?.segments?.length;
        if (segCount && segCount > 10) {
          insights.push({ level: 'warning' as const, category: 'optimizer', collection: coll.id, shard: shard.id, node: peerId, title: `Shard ${shard.id}: ${segCount} segments`, detail: 'High per-shard segment count can slow searches. May indicate optimizer has not completed merging.' });
        }
      }
    }
  }
  return insights;
});

registerRule('deleted-vectors-ratio', (ctx) => {
  const insights: Insight[] = [];
  for (const [peerId, nodeTel] of allNodeTelemetries(ctx)) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      for (const shard of (coll.shards || [])) {
        for (const seg of (shard.local?.segments || [])) {
          const info = seg.info;
          const total = (info.num_vectors || 0) + (info.num_deleted_vectors || 0);
          if (total > 0 && info.num_deleted_vectors > 0) {
            const pct = (info.num_deleted_vectors / total) * 100;
            if (pct > 20) {
              insights.push({ level: 'warning' as const, category: 'optimizer', collection: coll.id, shard: shard.id, node: peerId, title: `High deleted vectors (${pct.toFixed(0)}%) in shard ${shard.id}`, detail: `Segment ${(info.uuid || '').slice(0, 8)}... has ${info.num_deleted_vectors} deleted vectors. Optimizer should vacuum these.` });
            }
          }
        }
      }
    }
  }
  return insights;
});

registerRule('shard-optimizer-error', (ctx) => {
  const insights: Insight[] = [];
  for (const [peerId, nodeTel] of allNodeTelemetries(ctx)) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      for (const shard of (coll.shards || [])) {
        const opt = shard.local?.optimizations;
        if (opt?.status && opt.status !== 'ok') {
          insights.push({ level: 'critical' as const, category: 'optimizer', collection: coll.id, shard: shard.id, node: peerId, title: `Optimizer issue in shard ${shard.id}`, detail: `Status: ${JSON.stringify(opt.status)}. Check logs for this node.` });
        }
      }
    }
  }
  return insights;
});

registerRule('replica-not-active', (ctx) => {
  const insights: Insight[] = [];
  const checked = new Set<string>();
  for (const [, nodeTel] of allNodeTelemetries(ctx)) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      for (const shard of (coll.shards || [])) {
        for (const [rpId, state] of Object.entries(shard.replicate_states || {})) {
          const key = `${coll.id}-${shard.id}-${rpId}`;
          if (checked.has(key)) continue;
          checked.add(key);
          if (state !== 'Active') {
            insights.push({ level: state === 'Dead' ? 'critical' as const : 'warning' as const, category: 'replication', collection: coll.id, shard: shard.id, node: rpId, title: `Replica ${state} for shard ${shard.id}`, detail: `Peer ${rpId} replica is in "${state}" state. Replication may be degraded.` });
          }
        }
      }
    }
  }
  return insights;
});

registerRule('shard-recovery-in-progress', (ctx) => {
  const insights: Insight[] = [];
  for (const [peerId, nodeTel] of allNodeTelemetries(ctx)) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      for (const shard of (coll.shards || [])) {
        if (shard.partial_snapshot?.is_recovering) {
          insights.push({ level: 'warning' as const, category: 'replication', collection: coll.id, shard: shard.id, node: peerId, title: `Shard ${shard.id} recovery in progress`, detail: 'Partial snapshot recovery is active. Shard may not be fully available.' });
        }
      }
    }
  }
  return insights;
});

// Rule: All segments in a shard are plain (none indexed).
// Skipped when the collection has fewer points than its indexing
// threshold — in that case no segment is supposed to build an HNSW
// index yet, so a plain shard is expected, not a problem.
registerRule('all-segments-plain', (ctx) => {
  const insights: Insight[] = [];
  const checked = new Set<string>();
  for (const [peerId, nodeTel] of allNodeTelemetries(ctx)) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      const collInfo = ctx.collectionDetails[coll.id]?.info;
      const collectionPoints = collInfo?.points_count ?? 0;
      const indexingThreshold = collInfo?.config?.optimizer_config?.indexing_threshold ?? 20000;
      if (collectionPoints < indexingThreshold) continue;

      for (const shard of (coll.shards || [])) {
        const key = `${coll.id}-${shard.id}`;
        if (checked.has(key)) continue;
        checked.add(key);
        const segments = shard.local?.segments || [];
        if (segments.length === 0) continue;
        const totalPoints = segments.reduce((sum, s) => sum + (s.info.num_points || 0), 0);
        if (totalPoints === 0) continue;
        const allPlain = segments.every(s => s.info.num_indexed_vectors === 0);
        if (allPlain) {
          insights.push({ level: 'warning' as const, category: 'optimizer', collection: coll.id, shard: shard.id, node: peerId, title: `Shard ${shard.id}: no indexed segments`, detail: `All ${segments.length} segment(s) with ${totalPoints.toLocaleString()} points are plain (not indexed). Search will use brute-force scan. This may indicate the optimizer is stuck.` });
        }
      }
    }
  }
  return insights;
});

// Rule: Too many small segments — optimizer may not be merging
registerRule('too-many-small-segments', (ctx) => {
  const insights: Insight[] = [];
  const checked = new Set<string>();
  const SMALL_SEGMENT_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB
  const MIN_SEGMENT_COUNT = 5;
  const SMALL_RATIO_THRESHOLD = 0.7; // 70% of segments are small

  for (const [peerId, nodeTel] of allNodeTelemetries(ctx)) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      for (const shard of (coll.shards || [])) {
        const key = `${coll.id}-${shard.id}`;
        if (checked.has(key)) continue;
        checked.add(key);
        const segments = shard.local?.segments || [];
        if (segments.length < MIN_SEGMENT_COUNT) continue;

        const segSizes = segments.map(s => (s.info.vectors_size_bytes || 0) + (s.info.payloads_size_bytes || 0));
        const smallCount = segSizes.filter(size => size < SMALL_SEGMENT_THRESHOLD_BYTES).length;
        const smallRatio = smallCount / segments.length;

        if (smallRatio >= SMALL_RATIO_THRESHOLD) {
          const avgSizeMB = (segSizes.reduce((a, b) => a + b, 0) / segments.length / (1024 * 1024)).toFixed(1);
          insights.push({ level: 'warning' as const, category: 'optimizer', collection: coll.id, shard: shard.id, node: peerId, title: `Shard ${shard.id}: ${smallCount}/${segments.length} segments are small`, detail: `${smallCount} of ${segments.length} segments are under 10 MB (avg ${avgSizeMB} MB). This may indicate segments are not being merged by the optimizer. Check optimizer config and whether new data is being inserted in many small batches.` });
        }
      }
    }
  }
  return insights;
});
