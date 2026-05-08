import type { CollectionInfo } from './types';

/**
 * Multi-tenancy strategy detected purely from a collection's config.
 * Strict: only structural signals (is_tenant / is_principal / sharding_method
 * / HNSW m / payload_m) count. We do not guess tenant fields by name.
 *
 * References:
 *   https://qdrant.tech/articles/multitenancy/
 *   https://kulekci.medium.com/multi-tenant-vector-search-in-practice-building-a-shared-knowledge-base-with-qdrant-7b7928ba00fe
 */
export type MultiTenancyStrategy =
  /** No structural multi-tenancy signals found. */
  | 'none'
  /** is_tenant=true payload index + HNSW tuned for per-tenant graphs (m=0 and/or payload_m>0). */
  | 'payload-optimized'
  /** is_tenant=true payload index, but HNSW left at default (global graph still built). */
  | 'payload-tenant-flag'
  /** sharding_method=custom + at least one is_tenant=true payload index. */
  | 'custom-shard-optimized'
  /** sharding_method=custom but no is_tenant payload index — shard isolation only. */
  | 'custom-shard';

export interface MultiTenancyAnalysis {
  strategy: MultiTenancyStrategy;
  /** Field names where is_tenant=true. */
  tenantFields: string[];
  /** Field names where is_principal=true. */
  principalFields: string[];
  /** Whether the collection uses sharding_method=custom. */
  customSharding: boolean;
  /** HNSW global m (graph). */
  globalM: number | null;
  /** HNSW payload_m (per-tenant sub-graph edges). */
  payloadM: number | null;
  /** Hybrid = tenant-optimized AND global graph still useful (m>0 + payload_m>0). */
  hybridGraph: boolean;
}

export function analyzeMultiTenancy(info: CollectionInfo): MultiTenancyAnalysis {
  const schema = info.payload_schema || {};
  const tenantFields: string[] = [];
  const principalFields: string[] = [];
  for (const [field, entry] of Object.entries(schema)) {
    const p = entry.params || {};
    if (p.is_tenant) tenantFields.push(field);
    if (p.is_principal) principalFields.push(field);
  }

  const params = info.config?.params;
  const customSharding = params?.sharding_method === 'custom';

  const hnsw = info.config?.hnsw_config;
  const globalM = hnsw && typeof hnsw.m === 'number' ? hnsw.m : null;
  const payloadM = hnsw && typeof hnsw.payload_m === 'number' ? hnsw.payload_m : null;

  const tenantOptimized = (globalM === 0) || (payloadM != null && payloadM > 0);
  const hybridGraph = (globalM != null && globalM > 0) && (payloadM != null && payloadM > 0);

  let strategy: MultiTenancyStrategy = 'none';
  if (customSharding && tenantFields.length > 0) {
    strategy = 'custom-shard-optimized';
  } else if (customSharding) {
    strategy = 'custom-shard';
  } else if (tenantFields.length > 0 && tenantOptimized) {
    strategy = 'payload-optimized';
  } else if (tenantFields.length > 0) {
    strategy = 'payload-tenant-flag';
  }

  return {
    strategy,
    tenantFields,
    principalFields,
    customSharding,
    globalM,
    payloadM,
    hybridGraph,
  };
}

export function strategyLabel(strategy: MultiTenancyStrategy): string {
  switch (strategy) {
    case 'payload-optimized': return 'Multi-tenant (optimized)';
    case 'payload-tenant-flag': return 'Multi-tenant (basic)';
    case 'custom-shard-optimized': return 'Multi-tenant (sharded + tenant)';
    case 'custom-shard': return 'Custom sharding';
    case 'none': return '';
  }
}

export function strategyShortLabel(strategy: MultiTenancyStrategy): string {
  switch (strategy) {
    case 'payload-optimized': return 'tenant-opt';
    case 'payload-tenant-flag': return 'tenant';
    case 'custom-shard-optimized': return 'sharded+tenant';
    case 'custom-shard': return 'sharded';
    case 'none': return '';
  }
}

/** Strategy → CSS modifier suffix used by the badge styles. */
export function strategyTone(strategy: MultiTenancyStrategy): 'optimal' | 'partial' | 'shard' | 'none' {
  switch (strategy) {
    case 'payload-optimized':
    case 'custom-shard-optimized':
      return 'optimal';
    case 'payload-tenant-flag':
      return 'partial';
    case 'custom-shard':
      return 'shard';
    case 'none':
      return 'none';
  }
}
