// Qdrant default configuration values
// Used to highlight non-default settings in the UI

export const DEFAULTS = {
  hnsw: {
    m: 16,
    ef_construct: 100,
    full_scan_threshold: 10000,
    max_indexing_threads: 0,
    on_disk: false,
  },
  optimizer: {
    deleted_threshold: 0.2,
    vacuum_min_vector_number: 1000,
    default_segment_number: 0,
    max_segment_size: null as number | null,
    memmap_threshold: null as number | null,
    indexing_threshold: 10000,
    flush_interval_sec: 5,
    max_optimization_threads: null as number | null,
    prevent_unoptimized: null as boolean | null,
  },
  params: {
    shard_number: 1,
    replication_factor: 1,
    write_consistency_factor: 1,
    on_disk_payload: true,
  },
  wal: {
    wal_capacity_mb: 32,
    wal_segments_ahead: 0,
  },
  payload_index: {
    on_disk: false,
    is_tenant: false,
    is_principal: false,
    enable_hnsw: true,
  },
} as const;

// Check if a value differs from default
// Returns true if the value is non-default
export function isNonDefault(value: unknown, defaultValue: unknown): boolean {
  if (value === undefined || value === null) {
    return defaultValue !== undefined && defaultValue !== null;
  }
  return value !== defaultValue;
}
