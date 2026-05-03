import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { DashboardData, TelemetrySegment, TelemetryLocalShard, Telemetry, PeerMapping } from '../../lib/types';
import { formatNumber, formatBytes } from '../../lib/format';
import { buildPeerMapping } from '../../lib/peer-mapping';

// Build segment index: collection -> shardId -> peerId -> TelemetryLocalShard
function buildSegIndex(data: DashboardData): Record<string, Record<number, Record<string, TelemetryLocalShard>>> {
  const idx: Record<string, Record<number, Record<string, TelemetryLocalShard>>> = {};
  const allTels: [string, Telemetry][] = data.nodeTelemetry && Object.keys(data.nodeTelemetry).length > 0
    ? Object.entries(data.nodeTelemetry)
    : data.telemetry ? [[data.cluster?.peer_id?.toString() || 'local', data.telemetry]] : [];

  for (const [peerId, nodeTel] of allTels) {
    for (const coll of (nodeTel?.collections?.collections || [])) {
      if (!idx[coll.id]) idx[coll.id] = {};
      for (const shard of (coll.shards || [])) {
        if (!idx[coll.id][shard.id]) idx[coll.id][shard.id] = {};
        if (shard.local) idx[coll.id][shard.id][peerId] = shard.local;
      }
    }
  }
  return idx;
}

// Segment box component with click popup
function SegmentBox({ seg, popupId, activePopup, setActivePopup }: {
  seg: TelemetrySegment; popupId: string;
  activePopup: string | null; setActivePopup: (id: string | null) => void;
}) {
  const info = seg.info;
  const cfg = seg.config || {};
  const sType = info.segment_type || 'plain';
  const isAppendable = info.is_appendable;
  const bgColor = isAppendable ? 'var(--success)' : '#666';
  const borderColor = sType === 'indexed' ? 'var(--success)' : sType === 'special' ? 'var(--info)' : 'var(--warning)';

  const storageTypes = Object.values(cfg.vector_data || {}).map(v => v.storage_type).filter(Boolean);
  const indexTypes = Object.values(cfg.vector_data || {}).map(v => v.index?.type).filter(Boolean);
  const payloadType = cfg.payload_storage_type?.type || '';

  const isOpen = activePopup === popupId;
  const boxRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; placement: 'above' | 'below' } | null>(null);

  // Position the portal-rendered popup near the box, flipping if it would overflow.
  useLayoutEffect(() => {
    if (!isOpen) { setPos(null); return; }
    const place = () => {
      const box = boxRef.current?.getBoundingClientRect();
      const popup = popupRef.current?.getBoundingClientRect();
      if (!box) return;
      const margin = 8;
      const popupH = popup?.height ?? 200;
      const popupW = popup?.width ?? 240;
      const aboveTop = box.top - popupH - margin;
      const placement: 'above' | 'below' = aboveTop >= 8 ? 'above' : 'below';
      const top = placement === 'above' ? aboveTop : box.bottom + margin;
      let left = box.left + box.width / 2 - popupW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - popupW - 8));
      setPos({ left, top, placement });
    };
    place();
    // Re-measure once the popup has rendered (so popup.height is accurate).
    const raf = requestAnimationFrame(place);
    const onScrollResize = () => setActivePopup(null);
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [isOpen, setActivePopup]);

  return (
    <div ref={boxRef} className="seg-box" style={{ background: bgColor, borderColor }} onClick={e => { e.stopPropagation(); setActivePopup(isOpen ? null : popupId); }}>
      {isOpen && createPortal(
        <div
          ref={popupRef}
          className="seg-popup"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="seg-popup-title">{sType}</div>
          <div className="seg-popup-row">Appendable: {isAppendable ? <span style={{ color: 'var(--success)' }}>yes</span> : 'no'}</div>
          <div className="seg-popup-row">Points: {formatNumber(info.num_points)}</div>
          <div className="seg-popup-row">Vectors: {formatNumber(info.num_vectors)}</div>
          {info.num_deleted_vectors > 0 && <div className="seg-popup-row" style={{ color: 'var(--error)' }}>Deleted: {formatNumber(info.num_deleted_vectors)}</div>}
          <div className="seg-popup-row">Vec: {formatBytes(info.vectors_size_bytes)} | Payload: {formatBytes(info.payloads_size_bytes)}</div>
          {storageTypes.length > 0 && <div className="seg-popup-row">Storage: {storageTypes.join(', ')}</div>}
          {indexTypes.length > 0 && <div className="seg-popup-row">Index: {indexTypes.join(', ')}</div>}
          {payloadType && <div className="seg-popup-row">Payload storage: {payloadType}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Segment detail card
function SegmentCard({ seg, index }: { seg: TelemetrySegment; index: number }) {
  const info = seg.info;
  const cfg = seg.config || {};
  const sType = info.segment_type || 'unknown';
  const typeClass = sType === 'indexed' ? 'indexed' : 'plain';

  const tags: string[] = [];
  for (const vecCfg of Object.values(cfg.vector_data || {})) {
    if (vecCfg.storage_type) tags.push(vecCfg.storage_type);
    if (vecCfg.index?.type) tags.push(`idx:${vecCfg.index.type}`);
    if (vecCfg.quantization_config) tags.push('quantized');
  }
  if (cfg.payload_storage_type?.type) tags.push(`payload:${cfg.payload_storage_type.type}`);
  if (info.is_appendable) tags.push('appendable');

  const totalVecs = (info.num_vectors || 0) + (info.num_deleted_vectors || 0);
  const deletedPct = totalVecs > 0 ? ((info.num_deleted_vectors / totalVecs) * 100).toFixed(1) : '0';
  const deletedWarn = Number(deletedPct) > 20;

  return (
    <div className="segment-card">
      <div className="segment-card-header">
        <div>
          <span className={`segment-type-badge ${typeClass}`}>{sType}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: 6 }}>#{index}</span>
        </div>
        <span className="segment-uuid">{info.uuid?.slice(0, 12) || ''}...</span>
      </div>
      <div className="segment-stats">
        <div className="segment-stat"><span className="s-label">Points</span><span className="s-value">{formatNumber(info.num_points)}</span></div>
        <div className="segment-stat"><span className="s-label">Vectors</span><span className="s-value">{formatNumber(info.num_vectors)}</span></div>
        <div className="segment-stat"><span className="s-label">Indexed</span><span className="s-value">{formatNumber(info.num_indexed_vectors)}</span></div>
        <div className="segment-stat"><span className="s-label">Deleted</span><span className={`s-value ${deletedWarn ? 'warn' : ''}`}>{formatNumber(info.num_deleted_vectors)}{deletedWarn ? ` (${deletedPct}%)` : ''}</span></div>
        <div className="segment-stat"><span className="s-label">Vec Size</span><span className="s-value">{formatBytes(info.vectors_size_bytes)}</span></div>
        <div className="segment-stat"><span className="s-label">Payload</span><span className="s-value">{formatBytes(info.payloads_size_bytes)}</span></div>
        <div className="segment-stat"><span className="s-label">RAM</span><span className="s-value">{formatBytes(info.ram_usage_bytes)}</span></div>
        <div className="segment-stat"><span className="s-label">Disk</span><span className="s-value">{formatBytes(info.disk_usage_bytes)}</span></div>
      </div>
      <div className="segment-storage-tags">
        {tags.map((tag, i) => <span key={i} className="storage-tag">{tag}</span>)}
      </div>
    </div>
  );
}

// Shard cell in the matrix
function ShardCell({ nodeInfo, segments, cellId, pm, pid, activePopup, setActivePopup, expandedDetails, toggleDetails }: {
  nodeInfo: { type: string; state: string; points: number } | null;
  segments: TelemetrySegment[];
  cellId: string; pm: PeerMapping; pid: string;
  activePopup: string | null; setActivePopup: (id: string | null) => void;
  expandedDetails: Set<string>; toggleDetails: (id: string) => void;
}) {
  if (!nodeInfo) return <div className="shard-cell empty"><span style={{ opacity: 0.3 }}>-</span></div>;

  const stateLC = (nodeInfo.state || '').toLowerCase();
  let cellClass = 'empty';
  if (stateLC === 'active') cellClass = 'active';
  else if (['partial', 'initializing', 'partialsnapshotrecovery'].includes(stateLC)) cellClass = 'partial';
  else if (stateLC === 'dead') cellClass = 'dead';

  const sorted = [...segments].sort((a, b) => {
    const ord: Record<string, number> = { indexed: 0, plain: 1, special: 2 };
    const diff = (ord[a.info?.segment_type] ?? 3) - (ord[b.info?.segment_type] ?? 3);
    return diff !== 0 ? diff : (b.info?.num_points || 0) - (a.info?.num_points || 0);
  });

  let segTotalPts = 0;
  for (const s of sorted) segTotalPts += s.info?.num_points || 0;

  return (
    <div className={`shard-cell ${cellClass}`}>
      <span className={`state ${cellClass}`}>{nodeInfo.state || '?'}</span>
      <span className="points">{formatNumber(nodeInfo.points)} pts</span>
      <span className="shard-cell-type">{nodeInfo.type}</span>
      {sorted.length > 0 && (
        <div className="seg-area">
          <div className="seg-info-line">
            <span>{sorted.length} segments</span>
            <span>{formatNumber(segTotalPts)} pts</span>
          </div>
          <div className="seg-boxes">
            {sorted.map((seg, idx) => (
              <SegmentBox key={idx} seg={seg} popupId={`${cellId}-${idx}`} activePopup={activePopup} setActivePopup={setActivePopup} />
            ))}
          </div>
          <button className="seg-details-btn" onClick={() => toggleDetails(cellId)}>Segments Details</button>
        </div>
      )}
    </div>
  );
}

// Collection shard matrix
function CollectionShardMatrix({ collName, data, segIndex, pm }: {
  collName: string; data: DashboardData;
  segIndex: Record<number, Record<string, TelemetryLocalShard>>;
  pm: PeerMapping;
}) {
  const [activePopup, setActivePopup] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleDetails = useCallback((id: string) => {
    setExpandedDetails(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  // Close popups on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !(e.target as Element)?.closest('.seg-box')) setActivePopup(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const detail = data.collectionDetails[collName];
  const clusterData = detail?.cluster;
  const config = detail?.info?.config?.params;
  const currentPeerId = data.cluster?.peer_id?.toString();

  // Build shard info from multiple sources
  // Rule: local data always wins over remote. Never overwrite local with remote.
  const shardInfo: Record<number, { nodes: Record<string, { type: string; state: string; points: number }>; shard_key?: string }> = {};

  function addShardNode(shardId: number, peerId: string, info: { type: string; state: string; points: number }, shardKey?: string) {
    if (!shardInfo[shardId]) shardInfo[shardId] = { nodes: {}, shard_key: shardKey };
    if (!shardInfo[shardId].shard_key && shardKey) shardInfo[shardId].shard_key = shardKey;

    const existing = shardInfo[shardId].nodes[peerId];
    // Never overwrite local with remote
    if (existing?.type === 'local' && info.type === 'remote') return;
    // Local always wins, or update if not yet set
    if (!existing || info.type === 'local') {
      shardInfo[shardId].nodes[peerId] = info;
    }
  }

  // Source 1: telemetry from all nodes (most reliable - each node knows its own local shards)
  const allTels: [string, typeof data.telemetry][] = data.nodeTelemetry && Object.keys(data.nodeTelemetry).length > 0
    ? Object.entries(data.nodeTelemetry) : data.telemetry ? [[currentPeerId || 'local', data.telemetry]] : [];

  for (const [telPeerId, tel] of allTels) {
    if (!tel) continue;
    for (const coll of (tel.collections?.collections || [])) {
      if (coll.id !== collName) continue;
      for (const shard of (coll.shards || [])) {
        // This node's own local shard - most accurate data
        if (shard.local) {
          addShardNode(shard.id, telPeerId, {
            type: 'local',
            state: shard.replicate_states?.[telPeerId] || 'Active',
            points: shard.local.num_points || 0,
          }, shard.key || undefined);
        }

        // replicate_states tells us about ALL peers for this shard
        for (const [peerId, state] of Object.entries(shard.replicate_states || {})) {
          if (peerId === telPeerId) continue; // Already handled above via local
          addShardNode(shard.id, peerId, { type: 'remote', state, points: 0 }, shard.key || undefined);
        }
      }
    }
  }

  // Source 2: /collections/{name}/cluster endpoint (supplements with points_count for remote shards)
  if (clusterData) {
    const clusterEndpointPeerId = clusterData.peer_id?.toString() || currentPeerId || 'local';
    for (const shard of (clusterData.local_shards || [])) {
      addShardNode(shard.shard_id, clusterEndpointPeerId, {
        type: 'local', state: shard.state, points: shard.points_count,
      }, shard.shard_key);
    }
    for (const shard of (clusterData.remote_shards || [])) {
      const rpid = shard.peer_id?.toString();
      if (rpid) {
        // Only update points if we don't have local data for this peer
        const existing = shardInfo[shard.shard_id]?.nodes[rpid];
        if (!existing || existing.type === 'remote') {
          addShardNode(shard.shard_id, rpid, {
            type: 'remote', state: shard.state, points: shard.points_count,
          }, shard.shard_key);
        }
      }
    }
  }

  if (Object.keys(shardInfo).length === 0) {
    return <div className="collection-card"><span className="collection-name">{collName}</span><p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>No shard data available.</p></div>;
  }

  const shardIds = Object.keys(shardInfo).map(Number).sort((a, b) => a - b);

  // Collect all peer IDs: from cluster peers + from shard data (in case cluster endpoint is incomplete)
  const peerSet = new Set(pm.allPeerIds);
  for (const sid of shardIds) {
    for (const pid of Object.keys(shardInfo[sid].nodes)) peerSet.add(pid);
  }
  const allPeers = [...peerSet].sort((a, b) => {
    const la = pm.getLabel(a);
    const lb = pm.getLabel(b);
    // Extract number from "Node X" for numeric sort
    const na = la.match(/(\d+)/)?.[1];
    const nb = lb.match(/(\d+)/)?.[1];
    if (na && nb) return Number(na) - Number(nb);
    return la.localeCompare(lb);
  });

  // Stats
  let totalPoints = 0, totalSegments = 0, indexedSegs = 0, plainSegs = 0, mmapCount = 0, totalVecSize = 0, totalPayloadSize = 0;
  const ptsCounted = new Set<number>();
  for (const sid of shardIds) {
    for (const [pid, ni] of Object.entries(shardInfo[sid].nodes)) {
      if (ni.type === 'local' && !ptsCounted.has(sid)) { totalPoints += ni.points || 0; ptsCounted.add(sid); }
    }
    const st = segIndex[sid] || {};
    for (const local of Object.values(st)) {
      for (const seg of (local.segments || [])) {
        totalSegments++;
        if (seg.info?.segment_type === 'indexed') indexedSegs++; else plainSegs++;
        totalVecSize += seg.info?.vectors_size_bytes || 0;
        totalPayloadSize += seg.info?.payloads_size_bytes || 0;
        const stypes = Object.values(seg.config?.vector_data || {}).map(v => v.storage_type);
        if (stypes.some(t => t?.toLowerCase().includes('mmap'))) mmapCount++;
      }
    }
  }

  return (
    <div className="collection-card shard-dist-card" ref={containerRef}>
      <div className="shard-dist-title-bar">
        <span className="collection-name">{collName}</span>
        <div className="collection-meta">
          <span className="meta-tag"><span className="label">Shards:</span><span className="val">{shardIds.length}</span></span>
          <span className="meta-tag"><span className="label">Replication:</span><span className="val">{config?.replication_factor || '?'}</span></span>
          <span className="meta-tag"><span className="label">Points:</span><span className="val">{formatNumber(totalPoints)}</span></span>
          <span className="meta-tag"><span className="label">Segments:</span><span className="val">{totalSegments}</span></span>
        </div>
      </div>
      <div className="shard-dist-stats">
        <div className="shard-dist-stat"><div className="shard-dist-stat-value" style={{ color: 'var(--success)' }}>{indexedSegs}</div><div className="shard-dist-stat-label">Indexed Segments</div></div>
        <div className="shard-dist-stat"><div className="shard-dist-stat-value" style={{ color: 'var(--warning)' }}>{plainSegs}</div><div className="shard-dist-stat-label">Plain Segments</div></div>
        <div className="shard-dist-stat"><div className="shard-dist-stat-value" style={{ color: 'var(--info)' }}>{mmapCount}</div><div className="shard-dist-stat-label">Mmap Vector Storage</div></div>
        <div className="shard-dist-stat"><div className="shard-dist-stat-value" style={{ color: '#8b5cf6' }}>{formatBytes(totalVecSize)}</div><div className="shard-dist-stat-label">Total Vector Size</div></div>
        <div className="shard-dist-stat"><div className="shard-dist-stat-value" style={{ color: '#06b6d4' }}>{formatBytes(totalPayloadSize)}</div><div className="shard-dist-stat-label">Total Payload Size</div></div>
      </div>
      <div className="shard-matrix" style={{ gridTemplateColumns: `auto repeat(${allPeers.length}, 1fr)` }}>
        <div className="header">Shard</div>
        {allPeers.map(pid => (
          <div key={pid} className="header" style={{ color: pm.getColor(pid) }}>{pm.getLabel(pid)}{pid === currentPeerId ? ' *' : ''}</div>
        ))}
        {shardIds.map(sid => {
          const sd = shardInfo[sid];
          const shardSegs = segIndex[sid] || {};
          return (
            <ShardRow key={sid} shardId={sid} shardKey={sd.shard_key} nodes={sd.nodes} segments={shardSegs}
              allPeers={allPeers} collName={collName} pm={pm}
              activePopup={activePopup} setActivePopup={setActivePopup}
              expandedDetails={expandedDetails} toggleDetails={toggleDetails} />
          );
        })}
      </div>
    </div>
  );
}

// One shard row in the matrix + its detail panels
function ShardRow({ shardId, shardKey, nodes, segments, allPeers, collName, pm, activePopup, setActivePopup, expandedDetails, toggleDetails }: {
  shardId: number; shardKey?: string;
  nodes: Record<string, { type: string; state: string; points: number }>;
  segments: Record<string, TelemetryLocalShard>;
  allPeers: string[]; collName: string; pm: PeerMapping;
  activePopup: string | null; setActivePopup: (id: string | null) => void;
  expandedDetails: Set<string>; toggleDetails: (id: string) => void;
}) {
  const idPrefix = collName.replace(/[^a-zA-Z0-9]/g, '_');

  return (
    <>
      <div className="shard-label">
        Shard {shardId}
        {shardKey && <span className="shard-key"> ({String(shardKey)})</span>}
      </div>
      {allPeers.map(pid => {
        const cellId = `seg-${idPrefix}-${shardId}-${pid}`;
        return (
          <ShardCell key={pid} nodeInfo={nodes[pid] || null} segments={segments[pid]?.segments || []}
            cellId={cellId} pm={pm} pid={pid}
            activePopup={activePopup} setActivePopup={setActivePopup}
            expandedDetails={expandedDetails} toggleDetails={toggleDetails} />
        );
      })}
      {/* Segment detail panels */}
      {allPeers.map(pid => {
        const cellId = `seg-${idPrefix}-${shardId}-${pid}`;
        const segs = segments[pid]?.segments || [];
        if (segs.length === 0 || !expandedDetails.has(cellId)) return null;
        return (
          <div key={`det-${pid}`} className="seg-details-panel" style={{ gridColumn: '1 / -1' }}>
            <div className="seg-details-header">
              <span style={{ fontWeight: 600, color: pm.getColor(pid) }}>{pm.getLabel(pid)}</span>
              <span style={{ color: 'var(--text-secondary)' }}>Shard {shardId} - {segs.length} segments</span>
            </div>
            <div className="segment-grid">
              {segs.map((seg, idx) => <SegmentCard key={idx} seg={seg} index={idx} />)}
            </div>
          </div>
        );
      })}
    </>
  );
}

// Main tab component
export function ShardsTab({ data }: { data: DashboardData }) {
  const pm = buildPeerMapping(data.cluster);
  const segIndex = buildSegIndex(data);

  if (data.collections.length === 0) return <div className="card"><p style={{ color: 'var(--text-secondary)' }}>No collections.</p></div>;

  return (
    <>
      {data.collections.map(name => (
        <CollectionShardMatrix key={name} collName={name} data={data} segIndex={segIndex[name] || {}} pm={pm} />
      ))}
    </>
  );
}
