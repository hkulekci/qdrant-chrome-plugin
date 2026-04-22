// --- Cluster Config (stored in chrome.storage.local) ---

export interface ClusterConfig {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
  addedAt: string;
}

// --- Qdrant API Response Types ---

export interface QdrantResponse<T> {
  result: T;
  status: string;
  time: number;
}

export interface ClusterInfo {
  status: string;
  peer_id: number;
  peers: Record<string, { uri: string }>;
  raft_info: {
    term: number;
    commit: number;
    pending_operations: number;
    leader: number;
    role: string;
    is_voter: boolean;
  };
  consensus_thread_status: {
    consensus_thread_status: string;
    last_update: string;
  };
  message_send_failures: Record<string, unknown>;
  peer_metadata?: Record<string, { version: string }>;
}

export interface CollectionInfo {
  status: string;
  optimizer_status: string | { error: string };
  indexed_vectors_count: number;
  points_count: number;
  segments_count: number;
  config: {
    params: CollectionParams;
    hnsw_config: HnswConfig;
    optimizer_config: OptimizerConfig;
    wal_config: { wal_capacity_mb: number; wal_segments_ahead: number; wal_retain_closed: number };
    quantization_config: QuantizationConfig | null;
    strict_mode_config?: StrictModeConfig;
  };
  payload_schema: Record<string, PayloadSchemaEntry>;
  update_queue: { length: number };
}

export interface CollectionParams {
  vectors: Record<string, VectorConfig> | VectorConfig;
  sparse_vectors?: Record<string, SparseVectorConfig>;
  shard_number: number;
  replication_factor: number;
  write_consistency_factor: number;
  on_disk_payload: boolean;
}

export interface VectorConfig {
  size: number;
  distance: string;
  on_disk?: boolean;
  hnsw_config?: Partial<HnswConfig>;
}

export interface SparseVectorConfig {
  index?: { on_disk?: boolean };
}

export interface HnswConfig {
  m: number;
  ef_construct: number;
  full_scan_threshold: number;
  max_indexing_threads: number;
  on_disk: boolean;
}

export interface OptimizerConfig {
  deleted_threshold: number;
  vacuum_min_vector_number: number;
  default_segment_number: number;
  max_segment_size: number | null;
  memmap_threshold: number | null;
  indexing_threshold: number;
  flush_interval_sec: number;
  max_optimization_threads: number | null;
  prevent_unoptimized: boolean | null;
}

export interface QuantizationConfig {
  scalar?: { type: string; quantile?: number; always_ram?: boolean };
  product?: { compression: string };
  binary?: Record<string, unknown>;
}

export interface StrictModeConfig {
  enabled: boolean;
  unindexed_filtering_retrieve: boolean;
  unindexed_filtering_update: boolean;
  max_payload_index_count: number;
}

export interface PayloadSchemaEntry {
  data_type?: string;
  params?: {
    type?: string;
    is_tenant?: boolean;
    on_disk?: boolean;
    is_principal?: boolean;
    enable_hnsw?: boolean;
  };
  points?: number;
}

export interface CollectionClusterInfo {
  peer_id: number;
  shard_count: number;
  local_shards: ShardInfo[];
  remote_shards: RemoteShardInfo[];
  shard_transfers: ShardTransfer[];
}

export interface ShardInfo {
  shard_id: number;
  shard_key?: string;
  points_count: number;
  state: string;
}

export interface RemoteShardInfo extends ShardInfo {
  peer_id: number;
}

export interface ShardTransfer {
  shard_id: number;
  from: number;
  to: number;
  sync: boolean;
  method: string;
  comment?: string;
}

// --- Telemetry Types ---

export interface Telemetry {
  id: string;
  app: {
    name: string;
    version: string;
    features: Record<string, boolean>;
    runtime_features: Record<string, boolean>;
    system: SystemInfo;
    jwt_rbac: boolean;
    hide_jwt_dashboard: boolean;
    startup: string;
  };
  collections: {
    number_of_collections: number;
    collections: TelemetryCollection[];
  };
  cluster: {
    enabled: boolean;
    status: {
      number_of_peers: number;
      term: number;
      commit: number;
      pending_operations: number;
      role: string;
      is_voter: boolean;
      peer_id: number;
      consensus_thread_status: { consensus_thread_status: string; last_update: string };
    };
  };
  requests: {
    rest: { responses: Record<string, Record<string, RequestStats>> };
    grpc: { responses: Record<string, Record<string, RequestStats>> };
  };
  memory: {
    active_bytes: number;
    allocated_bytes: number;
    metadata_bytes: number;
    resident_bytes: number;
    retained_bytes: number;
  };
}

export interface SystemInfo {
  distribution: string;
  distribution_version: string;
  is_docker: boolean;
  cores: number;
  ram_size: number;
  disk_size: number;
  cpu_flags: string;
  cpu_endian: string;
}

export interface RequestStats {
  count: number;
  avg_duration_micros: number;
  min_duration_micros: number;
  max_duration_micros: number;
  total_duration_micros: number;
  last_responded: string;
}

export interface TelemetryCollection {
  id: string;
  init_time_ms: number;
  config: unknown;
  shards: TelemetryShard[];
  transfers: ShardTransfer[];
  resharding: unknown[];
}

export interface TelemetryShard {
  id: number;
  key: string | null;
  local: TelemetryLocalShard | null;
  remote: unknown[];
  replicate_states: Record<string, string>;
  partial_snapshot?: { ongoing_create_snapshot_requests: number; is_recovering: boolean; recovery_timestamp: number };
}

export interface TelemetryLocalShard {
  variant_name: string;
  status: string;
  total_optimized_points: number;
  vectors_size_bytes: number;
  payloads_size_bytes: number;
  num_points: number;
  num_vectors: number;
  segments: TelemetrySegment[];
  optimizations: {
    status: string;
    optimizations: { count: number; total_duration_micros: number; last_responded: string };
    log: unknown[];
  };
}

export interface TelemetrySegment {
  info: SegmentInfo;
  config: SegmentConfig;
  payload_field_indices: { field_name?: string }[];
}

export interface SegmentInfo {
  uuid: string;
  segment_type: string;
  num_vectors: number;
  num_points: number;
  num_indexed_vectors: number;
  num_deleted_vectors: number;
  vectors_size_bytes: number;
  payloads_size_bytes: number;
  ram_usage_bytes: number;
  disk_usage_bytes: number;
  is_appendable: boolean;
  vector_data: Record<string, { num_vectors: number; num_indexed_vectors: number; num_deleted_vectors: number }>;
}

export interface SegmentConfig {
  vector_data: Record<string, {
    size: number;
    distance: string;
    storage_type: string;
    index: { type: string; options?: unknown };
    quantization_config: unknown | null;
  }>;
  payload_storage_type: { type: string };
}

// --- Optimizations API ---

export interface OptimizationSegment {
  uuid: string;
  points_count: number;
}

export interface OptimizationProgress {
  name: string;
  started_at: string;
  finished_at?: string | null;
  duration_sec: number;
  done: number;
  total: number;
  children?: (OptimizationProgress | null)[];
}

export interface OptimizationTask {
  uuid: string;
  optimizer: string;
  status: string;
  segments: OptimizationSegment[];
  progress: OptimizationProgress;
}

export interface QueuedOptimizationTask {
  optimizer: string;
  segments: OptimizationSegment[];
}

export interface OptimizationsSummary {
  queued_optimizations: number;
  queued_segments: number;
  queued_points: number;
  idle_segments: number;
}

export interface CollectionOptimizations {
  summary: OptimizationsSummary;
  running: OptimizationTask[];
  queued: QueuedOptimizationTask[];
  completed: OptimizationTask[];
  idle_segments: OptimizationSegment[];
}

// --- Dashboard Data ---

export interface CollectionDetail {
  info?: CollectionInfo;
  cluster?: CollectionClusterInfo;
  error?: string;
}

export interface DashboardData {
  cluster: ClusterInfo;
  collections: string[];
  collectionDetails: Record<string, CollectionDetail>;
  telemetry: Telemetry | null;
  nodeTelemetry: Record<string, Telemetry>;
}

// --- Insights / Rules ---

export type InsightLevel = 'critical' | 'warning' | 'performance' | 'info';

export interface Insight {
  level: InsightLevel;
  category: string;
  title: string;
  detail: string;
  collection?: string;
  shard?: number;
  node?: string;
}

export type RuleFunction = (ctx: DashboardData) => Insight[];

export interface InsightsFilter {
  levels: InsightLevel[];
  collection: string | null;
  category: string | null;
  group: 'flat' | 'collection' | 'severity';
}

export const DEFAULT_INSIGHTS_FILTER: InsightsFilter = {
  levels: ['critical', 'warning', 'performance', 'info'],
  collection: null,
  category: null,
  group: 'severity',
};

// --- Peer Mapping Helper ---

export interface PeerMapping {
  allPeerIds: string[];
  nodeColors: string[];
  getLabel: (pid: string) => string;
  getColor: (pid: string) => string;
}
