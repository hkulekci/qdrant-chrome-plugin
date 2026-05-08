import { registerRule } from './rule-engine';
import type { Insight, VectorConfig } from '../lib/types';
import { analyzeMultiTenancy } from '../lib/multi-tenancy';

// is_tenant=true is set on a payload index, but HNSW is left at the default
// (m=16, payload_m unset). The optimizer still builds one global graph that
// connects all tenants, defeating most of the win. Suggest the standard
// per-tenant tuning.
registerRule('mt-tenant-flag-without-hnsw-tuning', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const mt = analyzeMultiTenancy(info);
    if (mt.tenantFields.length === 0) continue;
    const globalM = mt.globalM;
    const payloadM = mt.payloadM;
    const tenantOptimized = globalM === 0 || (payloadM != null && payloadM > 0);
    if (tenantOptimized) continue;

    insights.push({
      level: 'performance',
      category: 'multi-tenancy',
      collection: name,
      title: `Tenant index without HNSW tuning (${mt.tenantFields.join(', ')})`,
      detail:
        'A payload index has is_tenant=true, but HNSW is left at default — the global graph is still built across all tenants. ' +
        'For pure tenant-scoped search set m=0 + payload_m=16. For hybrid (also need cross-tenant), keep a small m (e.g. 8) and add payload_m=16.',
    });
  }
  return insights;
});

// Custom sharding is enabled but no payload field is marked is_tenant=true.
// Inside each shard, queries that filter by tenant still pay full graph cost.
registerRule('mt-custom-sharding-without-tenant-flag', (ctx) => {
  const insights: Insight[] = [];
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    if (!info) continue;
    const mt = analyzeMultiTenancy(info);
    if (!mt.customSharding) continue;
    if (mt.tenantFields.length > 0) continue;

    insights.push({
      level: 'performance',
      category: 'multi-tenancy',
      collection: name,
      title: 'Custom sharding without is_tenant payload index',
      detail:
        'sharding_method=custom isolates tenants by shard, but inside a shared shard (or any shard with multiple tenants) ' +
        'searches still traverse the global HNSW graph. Add a keyword payload index with is_tenant=true on your tenant field.',
    });
  }
  return insights;
});

// Cross-collection anti-pattern: collections with a common prefix and the
// same vector configuration are usually a "one collection per tenant" shape,
// which scales poorly. Heuristic — only triggers when the family is clear.
//
// Reference: https://kulekci.medium.com/why-more-collections-might-be-killing-your-qdrant-cluster-797364cb4bbb
registerRule('mt-collection-per-tenant-anti-pattern', (ctx) => {
  if (ctx.collections.length < 3) return [];

  const sigByName: Record<string, string | null> = {};
  for (const name of ctx.collections) {
    const info = ctx.collectionDetails[name]?.info;
    sigByName[name] = info ? vectorSignature(info.config?.params?.vectors) : null;
  }

  // Group collections by (common-prefix, vector signature). A group is
  // suspicious when 3+ collections share both. We use a permissive prefix:
  // everything up to and including the last separator (-, _, .).
  const groups = new Map<string, string[]>();
  for (const name of ctx.collections) {
    const sig = sigByName[name];
    if (!sig) continue;
    const prefix = familyPrefix(name);
    if (!prefix) continue;
    const key = `${prefix}|${sig}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(name);
  }

  const insights: Insight[] = [];
  for (const [key, members] of groups.entries()) {
    if (members.length < 3) continue;
    const prefix = key.split('|')[0];
    const sample = members.slice(0, 4).join(', ') + (members.length > 4 ? `, +${members.length - 4} more` : '');
    insights.push({
      level: 'performance',
      category: 'multi-tenancy',
      title: `${members.length} collections share prefix "${prefix}" with identical vector config`,
      detail:
        `Collections: ${sample}. This shape often turns out to be one collection per tenant, which doesn't scale: ` +
        'each collection has its own segments, optimizer state, and metadata overhead. Consider consolidating into a single collection ' +
        'with a tenant payload index (is_tenant=true) — see qdrant.tech/articles/multitenancy/.',
    });
  }
  return insights;
});

// Returns a stable signature for the vectors config so we can cluster
// collections that have the "same shape" (same dimensionality, distance,
// dense vs. named). We do not consider on_disk / hnsw — those vary by
// operational tuning, not by data shape.
function vectorSignature(vectors: Record<string, VectorConfig> | VectorConfig | undefined): string | null {
  if (!vectors) return null;
  if ('size' in vectors && typeof vectors.size === 'number') {
    return `unnamed:${vectors.size}:${vectors.distance}`;
  }
  const entries = Object.entries(vectors as Record<string, VectorConfig>);
  if (entries.length === 0) return null;
  const parts = entries
    .map(([n, v]) => `${n}=${v.size}:${v.distance}`)
    .sort();
  return `named:${parts.join(',')}`;
}

// "kb_acme" → "kb_". "items-tenant-42" → "items-tenant-".
// "single" → null (no separator means we cannot infer a family).
function familyPrefix(name: string): string | null {
  const m = name.match(/^(.+?[-_.])[^-_.]+$/);
  return m ? m[1] : null;
}
