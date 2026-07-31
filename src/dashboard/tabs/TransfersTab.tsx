import type {
  DashboardData, ShardTransfer, Telemetry, ReshardingState, ReshardingClusterMeta, PeerMapping,
} from '../../lib/types';
import { buildPeerMapping } from '../../lib/peer-mapping';
import { formatDuration, formatNumber } from '../../lib/format';
import { CopyButton } from '../CopyButton';

/** One resharding operation with everything we can correlate about it: the
 *  per-collection state, the richer cluster-manager metadata (stage + which
 *  shards/replicas are migrating), and the live record-transfer(s) feeding it. */
interface ReshardingOp {
  collection: string;
  state: ReshardingState;
  meta?: ReshardingClusterMeta;
  transfers: (ShardTransfer & { collection: string })[];
}

function reshardMetaFor(tel: Telemetry | undefined, collection: string): ReshardingClusterMeta | undefined {
  const meta = tel?.cluster?.metadata;
  if (!meta) return undefined;
  const entry = meta[`_cluster_manager/resharding/collections/${collection}`];
  return entry && typeof entry === 'object' ? (entry as ReshardingClusterMeta) : undefined;
}

function collectTransfers(data: DashboardData) {
  const transfers: (ShardTransfer & { collection: string })[] = [];
  const resharding: ReshardingOp[] = [];
  const seen = new Set<string>();
  const reshardSeen = new Set<string>();

  const allTels: [string, Telemetry][] = data.nodeTelemetry && Object.keys(data.nodeTelemetry).length > 0
    ? Object.entries(data.nodeTelemetry)
    : data.telemetry ? [[data.cluster?.peer_id?.toString() || 'local', data.telemetry]] : [];

  for (const [, nodeTel] of allTels) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      for (const t of (coll.transfers || [])) {
        const key = `${coll.id}-${t.shard_id}-${t.to_shard_id ?? ''}-${t.from}-${t.to}`;
        if (!seen.has(key)) { seen.add(key); transfers.push({ collection: coll.id, ...t }); }
      }
      for (const r of (coll.resharding || [])) {
        const key = `${coll.id}-${r.uuid ?? JSON.stringify(r)}`;
        if (!reshardSeen.has(key)) {
          reshardSeen.add(key);
          resharding.push({ collection: coll.id, state: r, meta: reshardMetaFor(nodeTel, coll.id), transfers: [] });
        }
      }
    }
  }

  // Attach the record-transfer(s) driving each resharding op. A resharding
  // transfer moves records into the new shard (to_shard_id), so match on the
  // op's shard id against either endpoint of the transfer.
  for (const op of resharding) {
    op.transfers = transfers.filter(t =>
      t.collection === op.collection &&
      /reshard/i.test(t.method || '') &&
      (t.to_shard_id === op.state.shard_id || t.shard_id === op.state.shard_id));
  }
  return { transfers, resharding };
}

/** Pull "(done/total)" and "ETA: Ns" out of a transfer comment for a progress bar. */
function parseReshardProgress(comment?: string): { done: number; total: number; etaSec: number | null } | null {
  if (!comment) return null;
  const rec = /\((\d+)\s*\/\s*(\d+)\)/.exec(comment);
  if (!rec) return null;
  const done = Number(rec[1]);
  const total = Number(rec[2]);
  if (!total) return null;
  const eta = /ETA:\s*([\d.]+)\s*s/i.exec(comment);
  return { done, total, etaSec: eta ? Number(eta[1]) : null };
}

function shardChips(ids: number[] | undefined) {
  if (!ids || ids.length === 0) return <span className="reshard-none">—</span>;
  return <>{ids.map(id => <span key={id} className="reshard-chip">{id}</span>)}</>;
}

/** Build the `restart_transfer` request the user can copy into the Qdrant
 *  REST API. Restarting as `snapshot` is the reliable recovery for a stuck
 *  or slow stream-record sync. */
function restartRequest(t: ShardTransfer & { collection: string }): string {
  const body = {
    restart_transfer: {
      from_peer_id: t.from,
      to_peer_id: t.to,
      shard_id: t.shard_id,
      method: 'snapshot',
    },
  };
  return `POST /collections/${t.collection}/cluster\n${JSON.stringify(body, null, 2)}`;
}

function ReshardingCard({ op, pm }: { op: ReshardingOp; pm: PeerMapping }) {
  const { state, meta } = op;
  const stage = meta?.stage;
  const peerLabel = pm.getLabel(String(state.peer_id));

  return (
    <div className="transfer-card reshard-card">
      <div className="transfer-header">
        <span className="meta-tag"><span className="label">Collection:</span><span className="val">{op.collection}</span></span>
        <span className={`status-badge ${state.direction === 'up' ? 'green' : 'yellow'}`}>
          {state.direction === 'up' ? '▲ scale up' : state.direction === 'down' ? '▼ scale down' : state.direction}
        </span>
        <span className="meta-tag"><span className="label">New shard:</span><span className="val">{state.shard_id}</span></span>
        {state.shard_key && <span className="meta-tag"><span className="label">Key:</span><span className="val">{String(state.shard_key)}</span></span>}
        <span className="meta-tag">
          <span className="label">Peer:</span>
          <span className="val" style={{ color: pm.getColor(String(state.peer_id)) }}>{peerLabel}</span>
        </span>
      </div>

      {stage && (
        <div className="reshard-stages">
          <span className="reshard-stage-label">Stage</span>
          <span className="reshard-stage active"><span className="reshard-stage-dot" />{stage}</span>
        </div>
      )}

      {meta && (
        <div className="reshard-grid">
          <div className="reshard-row"><span className="reshard-key">Relevant shards</span><span className="reshard-vals">{shardChips(meta.relevant_shards)}</span></div>
          <div className="reshard-row"><span className="reshard-key">Shards migrating</span><span className="reshard-vals">{shardChips(meta.shards_migrating)}</span></div>
          <div className="reshard-row"><span className="reshard-key">Shards migrated</span><span className="reshard-vals">{shardChips(meta.shards_migrated)}</span></div>
          <div className="reshard-row"><span className="reshard-key">Replicas migrating</span><span className="reshard-vals">{shardChips(meta.replicas_migrating)}</span></div>
          <div className="reshard-row"><span className="reshard-key">Replicas migrated</span><span className="reshard-vals">{shardChips(meta.replicas_migrated)}</span></div>
          <div className="reshard-row"><span className="reshard-key">Replicas deleted</span><span className="reshard-vals">{shardChips(meta.replicas_deleted)}</span></div>
        </div>
      )}

      {op.transfers.map((t, i) => {
        const prog = parseReshardProgress(t.comment);
        const pct = prog ? Math.min(100, (prog.done / prog.total) * 100) : null;
        return (
          <div key={i} className="reshard-transfer">
            <div className="reshard-transfer-head">
              <span>Migrating shard {t.shard_id}{t.to_shard_id != null ? ` → ${t.to_shard_id}` : ''}</span>
              <span className="reshard-transfer-peers">
                <span style={{ color: pm.getColor(String(t.from)) }}>{pm.getLabel(String(t.from))}</span>
                <span className="arrow"> → </span>
                <span style={{ color: pm.getColor(String(t.to)) }}>{pm.getLabel(String(t.to))}</span>
              </span>
            </div>
            {pct != null && (
              <>
                <div className="reshard-bar"><div className="reshard-bar-fill" style={{ width: `${pct}%` }} /></div>
                <div className="reshard-progress-meta">
                  <span>{formatNumber(prog!.done)} / {formatNumber(prog!.total)} records ({pct.toFixed(1)}%)</span>
                  {prog!.etaSec != null && <span>ETA {formatDuration(prog!.etaSec * 1000)}</span>}
                </div>
              </>
            )}
            {t.comment && <div className="transfer-comment">{t.comment}</div>}
          </div>
        );
      })}

      <details className="reshard-raw">
        <summary>Raw state</summary>
        <pre>{JSON.stringify(meta ?? state, null, 2)}</pre>
      </details>
    </div>
  );
}

export function TransfersTab({ data }: { data: DashboardData }) {
  const pm = buildPeerMapping(data.cluster);
  const { transfers, resharding } = collectTransfers(data);

  return (
    <>
      <div className="card">
        <h2>Shard Transfers</h2>
        {transfers.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No active shard transfers.</p>
        ) : (
          transfers.map((t, i) => {
            // Restarting as a snapshot only helps a `stream_records` sync that
            // is stuck or slow. It is pointless when the transfer is already a
            // `snapshot`, and not applicable to `wal_delta`.
            const canRestartAsSnapshot = t.method === 'stream_records';
            const req = restartRequest(t);
            return (
              <div key={i} className="transfer-card">
                <div className="transfer-header">
                  <span className="meta-tag"><span className="label">Collection:</span><span className="val">{t.collection}</span></span>
                  <span className="meta-tag"><span className="label">Shard:</span><span className="val">{t.shard_id}</span></span>
                  <span className="transfer-arrow">
                    <span className="peer-endpoint">
                      <span className="peer-label" style={{ color: pm.getColor(String(t.from)) }}>{pm.getLabel(String(t.from))}</span>
                      <span className="peer-id" title={`from_peer_id: ${t.from}`}>{t.from}</span>
                    </span>
                    <span className="arrow">&rarr;</span>
                    <span className="peer-endpoint">
                      <span className="peer-label" style={{ color: pm.getColor(String(t.to)) }}>{pm.getLabel(String(t.to))}</span>
                      <span className="peer-id" title={`to_peer_id: ${t.to}`}>{t.to}</span>
                    </span>
                  </span>
                  <span className="meta-tag"><span className="val">{t.method || '?'}</span></span>
                  {t.sync && <span className="status-badge green">sync</span>}
                </div>
                {t.comment && <div className="transfer-comment">{t.comment}</div>}
                {canRestartAsSnapshot && (
                  <details className="transfer-restart">
                    <summary>Restart as snapshot</summary>
                    <p className="transfer-restart-hint">
                      Copy and send this to the Qdrant REST API to restart the transfer using the
                      snapshot method — useful when a stream sync is stuck or slow.
                    </p>
                    <div className="code-block">
                      <CopyButton text={req} />
                      <pre>{req}</pre>
                    </div>
                  </details>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="card">
        <h2>Resharding Operations</h2>
        {resharding.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No active resharding operations.</p>
        ) : (
          resharding.map((op, i) => <ReshardingCard key={i} op={op} pm={pm} />)
        )}
      </div>
    </>
  );
}
