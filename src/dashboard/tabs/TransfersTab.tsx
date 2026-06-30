import type { DashboardData, ShardTransfer, Telemetry } from '../../lib/types';
import { buildPeerMapping } from '../../lib/peer-mapping';
import { CopyButton } from '../CopyButton';

function collectTransfers(data: DashboardData) {
  const transfers: (ShardTransfer & { collection: string })[] = [];
  const resharding: { collection: string; data: unknown }[] = [];
  const seen = new Set<string>();

  const allTels: [string, Telemetry][] = data.nodeTelemetry && Object.keys(data.nodeTelemetry).length > 0
    ? Object.entries(data.nodeTelemetry)
    : data.telemetry ? [[data.cluster?.peer_id?.toString() || 'local', data.telemetry]] : [];

  for (const [, nodeTel] of allTels) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      for (const t of (coll.transfers || [])) {
        const key = `${coll.id}-${t.shard_id}-${t.from}-${t.to}`;
        if (!seen.has(key)) { seen.add(key); transfers.push({ collection: coll.id, ...t }); }
      }
      for (const r of (coll.resharding || [])) {
        const key = `${coll.id}-${JSON.stringify(r)}`;
        if (!seen.has(key)) { seen.add(key); resharding.push({ collection: coll.id, data: r }); }
      }
    }
  }
  return { transfers, resharding };
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
          resharding.map((r, i) => (
            <div key={i} className="transfer-card">
              <div className="transfer-header">
                <span className="meta-tag"><span className="label">Collection:</span><span className="val">{r.collection}</span></span>
              </div>
              <pre style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.data, null, 2)}</pre>
            </div>
          ))
        )}
      </div>
    </>
  );
}
