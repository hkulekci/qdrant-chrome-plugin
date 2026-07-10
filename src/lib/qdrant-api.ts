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

  private async _fetch<T>(path: string, base: string = this.baseUrl): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['api-key'] = this.apiKey;

    const response = await fetch(`${base}${path}`, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json() as Promise<T>;
  }

  /** Qdrant Cloud exposes a stable public domain per node, e.g.
   *  `node-0-<cluster>.<region>.cloud.qdrant.io`, alongside the load-balanced
   *  cluster domain. Given the cluster base URL and a node ordinal, return that
   *  node's URL — or null when the base URL isn't a rewritable Cloud domain
   *  (self-hosted, or already a node-specific domain). */
  static cloudNodeUrl(baseUrl: string, index: number): string | null {
    try {
      const u = new URL(baseUrl);
      if (!u.hostname.endsWith('.cloud.qdrant.io')) return null;
      if (/^node-\d+-/.test(u.hostname)) return null;
      u.hostname = `node-${index}-${u.hostname}`;
      return u.origin;
    } catch {
      return null;
    }
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

  async getTelemetry(base?: string): Promise<Telemetry> {
    const data = await this._fetch<QdrantResponse<Telemetry>>('/telemetry?details_level=10', base);
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

  // Extract each peer's node ordinal from its cluster uri. Qdrant reports peer
  // uris like `http://qdrant-0.qdrant-headless...:6335/`; the `-0.` ordinal is
  // the same index used by the public `node-0-...` Cloud domain. Returns null
  // for a peer whose uri carries no ordinal.
  private static peerNodeIndex(uri: string | undefined): number | null {
    const m = uri?.match(/-(\d+)\./);
    return m ? parseInt(m[1], 10) : null;
  }

  // Preferred telemetry collection for Qdrant Cloud: hit each node's own public
  // domain directly (derived from the cluster peer list), so every telemetry
  // payload is genuinely from that node. Far more reliable than repeatedly
  // hitting the load balancer and hoping to land on each node. Falls back to
  // load-balancer rotation for self-hosted clusters or unrecognised URLs.
  private async collectPerNodeTelemetry(cluster: ClusterInfo): Promise<Record<string, Telemetry>> {
    const peers = cluster?.peers || {};
    const entries = Object.entries(peers).map(([pid, p]) => ({
      pid,
      index: QdrantApi.peerNodeIndex(p?.uri),
    }));

    const canPerNode =
      entries.length > 0 &&
      entries.every(e => e.index !== null) &&
      QdrantApi.cloudNodeUrl(this.baseUrl, 0) !== null;

    if (canPerNode) {
      const results = await Promise.all(
        entries.map(async ({ pid, index }) => {
          const nodeUrl = QdrantApi.cloudNodeUrl(this.baseUrl, index!);
          try {
            return { pid, tel: await this.getTelemetry(nodeUrl!) };
          } catch {
            return { pid, tel: null };
          }
        }),
      );

      const byPeer: Record<string, Telemetry> = {};
      for (const { pid, tel } of results) {
        if (tel) {
          const peerId = tel.cluster?.status?.peer_id?.toString() || pid;
          byPeer[peerId] = tel;
        }
      }
      if (Object.keys(byPeer).length > 0) return byPeer;
    }

    // Fallback: rotate through the load balancer.
    const telemetryById = await this.collectAllNodeTelemetry(Object.keys(peers).length || 1);
    return QdrantApi.mapTelemetryToNodes(telemetryById);
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
    const [, nodeTelemetry] = await Promise.all([
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
      this.collectPerNodeTelemetry(cluster),
    ]);

    const telemetry = Object.values(nodeTelemetry)[0] || null;

    console.log(`Telemetry collected from ${Object.keys(nodeTelemetry).length}/${peerCount} nodes`);

    return { cluster, collections, collectionDetails, telemetry, nodeTelemetry };
  }
}
