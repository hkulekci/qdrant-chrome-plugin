import type {
  ClusterInfo,
  CollectionInfo,
  CollectionClusterInfo,
  CollectionOptimizations,
  Telemetry,
  DashboardData,
  QdrantResponse,
} from './types';

/** Pull a plain number[] out of a scroll point's `vector`, which can be a bare
 *  array (unnamed vector), a map of named vectors, or contain sparse entries. */
function extractDenseVector(vector: unknown, preferredName?: string): number[] | null {
  if (Array.isArray(vector) && typeof vector[0] === 'number') return vector as number[];
  if (vector && typeof vector === 'object') {
    const map = vector as Record<string, unknown>;
    if (preferredName && Array.isArray(map[preferredName])) return map[preferredName] as number[];
    for (const val of Object.values(map)) {
      if (Array.isArray(val) && typeof val[0] === 'number') return val as number[];
    }
  }
  return null;
}

export class QdrantApi {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey || '';
  }

  private async _fetch<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['api-key'] = this.apiKey;

    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json() as Promise<T>;
  }

  private async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['api-key'] = this.apiKey;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      let msg = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errBody = await response.json();
        if (errBody?.status?.error) msg += ` - ${errBody.status.error}`;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    return response.json() as Promise<T>;
  }

  async healthz(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/healthz`, {
        headers: this.apiKey ? { 'api-key': this.apiKey } : {},
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getCluster(): Promise<ClusterInfo> {
    const data = await this._fetch<QdrantResponse<ClusterInfo>>('/cluster');
    return data.result;
  }

  async getCollections(): Promise<string[]> {
    const data = await this._fetch<QdrantResponse<{ collections: { name: string }[] }>>('/collections');
    return data.result.collections.map(c => c.name);
  }

  async getCollection(name: string): Promise<CollectionInfo> {
    const data = await this._fetch<QdrantResponse<CollectionInfo>>(`/collections/${encodeURIComponent(name)}`);
    return data.result;
  }

  async getCollectionCluster(name: string): Promise<CollectionClusterInfo> {
    const data = await this._fetch<QdrantResponse<CollectionClusterInfo>>(`/collections/${encodeURIComponent(name)}/cluster`);
    return data.result;
  }

  async getTelemetry(): Promise<Telemetry> {
    const data = await this._fetch<QdrantResponse<Telemetry>>('/telemetry?details_level=10');
    return data.result;
  }

  // Sample points (with their dense vectors) for the HNSW visualizer. Qdrant
  // does not expose its internal graph edges, so the visualizer reconstructs a
  // graph client-side from these real vectors.
  async scrollPoints(
    name: string,
    opts: { limit: number; vectorName?: string },
  ): Promise<{ id: string | number; vector: number[] }[]> {
    const withVector = opts.vectorName ? [opts.vectorName] : true;
    const data = await this._request<QdrantResponse<{ points: { id: string | number; vector: unknown }[] }>>(
      'POST',
      `/collections/${encodeURIComponent(name)}/points/scroll`,
      { limit: opts.limit, with_vector: withVector, with_payload: false },
    );

    const out: { id: string | number; vector: number[] }[] = [];
    for (const p of data.result.points || []) {
      const vec = extractDenseVector(p.vector, opts.vectorName);
      if (vec) out.push({ id: p.id, vector: vec });
    }
    return out;
  }

  async getCollectionOptimizations(name: string): Promise<CollectionOptimizations> {
    const data = await this._fetch<QdrantResponse<CollectionOptimizations>>(
      `/collections/${encodeURIComponent(name)}/optimizations?with=queued,completed`,
    );
    return data.result;
  }

  // Triggers re-optimization by re-applying the optimizer config.
  // Qdrant processes any update to optimizers_config as a signal to re-run
  // the optimizer, merging small segments and building missing indexes.
  async optimizeCollection(name: string): Promise<void> {
    await this._request<QdrantResponse<boolean>>(
      'PATCH',
      `/collections/${encodeURIComponent(name)}`,
      { optimizers_config: {} },
    );
  }

  // Collect telemetry from all nodes behind a load balancer
  private async collectAllNodeTelemetry(peerCount: number): Promise<Record<string, Telemetry>> {
    const byId: Record<string, Telemetry> = {};
    const maxAttempts = Math.max(peerCount * 3, 6);
    const batchSize = Math.min(peerCount, 4);

    for (let attempt = 0; attempt < maxAttempts && Object.keys(byId).length < peerCount; attempt += batchSize) {
      const remaining = Math.min(batchSize, maxAttempts - attempt);
      const batch: Promise<Telemetry | null>[] = [];
      for (let i = 0; i < remaining; i++) {
        batch.push(this.getTelemetry().catch(() => null));
      }
      const results = await Promise.all(batch);
      for (const tel of results) {
        if (tel?.id && !byId[tel.id]) {
          byId[tel.id] = tel;
          if (Object.keys(byId).length >= peerCount) break;
        }
      }
    }

    return byId;
  }

  // Map telemetry id -> peer_id using cluster.status.peer_id inside telemetry
  private static mapTelemetryToNodes(telemetryById: Record<string, Telemetry>): Record<string, Telemetry> {
    const nodeTelemetry: Record<string, Telemetry> = {};
    for (const [telId, tel] of Object.entries(telemetryById)) {
      const peerId = tel.cluster?.status?.peer_id?.toString();
      nodeTelemetry[peerId || telId] = tel;
    }
    return nodeTelemetry;
  }

  async getDashboardData(): Promise<DashboardData> {
    const [cluster, collections] = await Promise.all([
      this.getCluster(),
      this.getCollections(),
    ]);

    const peerCount = cluster?.peers ? Object.keys(cluster.peers).length : 1;

    const collectionDetails: DashboardData['collectionDetails'] = {};
    const [, telemetryById] = await Promise.all([
      Promise.all(
        collections.map(async (name) => {
          try {
            const [info, clusterInfo] = await Promise.all([
              this.getCollection(name),
              this.getCollectionCluster(name).catch(() => undefined),
            ]);
            collectionDetails[name] = { info, cluster: clusterInfo };
          } catch (e) {
            collectionDetails[name] = { error: (e as Error).message };
          }
        })
      ),
      this.collectAllNodeTelemetry(peerCount),
    ]);

    const nodeTelemetry = QdrantApi.mapTelemetryToNodes(telemetryById);
    const telemetry = Object.values(nodeTelemetry)[0] || null;

    console.log(`Telemetry collected from ${Object.keys(nodeTelemetry).length}/${peerCount} nodes`);

    return { cluster, collections, collectionDetails, telemetry, nodeTelemetry };
  }
}
