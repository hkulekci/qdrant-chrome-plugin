import type { ClusterInfo, PeerMapping } from './types';

/** Palette of 50 visually distinct colors. A peer's color is derived from a
 *  hash of its peer_id (see `colorForPeer`), not from enumeration order, so a
 *  given peer keeps the same color across refreshes and sessions even when the
 *  cluster API returns peers in a different order. */
const NODE_COLORS = [
  '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ec4899',
  '#6366f1', '#84cc16', '#f97316', '#ef4444', '#14b8a6',
  '#a855f7', '#0ea5e9', '#eab308', '#22c55e', '#f43f5e',
  '#3b82f6', '#65a30d', '#fb923c', '#dc2626', '#0d9488',
  '#9333ea', '#0284c7', '#ca8a04', '#16a34a', '#e11d48',
  '#2563eb', '#4d7c0f', '#ea580c', '#b91c1c', '#0f766e',
  '#7c3aed', '#0369a1', '#a16207', '#15803d', '#be123c',
  '#1d4ed8', '#3f6212', '#c2410c', '#991b1b', '#115e59',
  '#6d28d9', '#075985', '#854d0e', '#166534', '#9f1239',
  '#1e40af', '#365314', '#9a3412', '#7f1d1d', '#134e4a',
];

/** Stable, order-independent index into NODE_COLORS for a peer id.
 *  djb2 string hash so the same id always maps to the same color. */
function colorForPeer(pid: string): string {
  let hash = 5381;
  for (let i = 0; i < pid.length; i++) {
    hash = ((hash << 5) + hash + pid.charCodeAt(i)) >>> 0;
  }
  return NODE_COLORS[hash % NODE_COLORS.length];
}

export function buildPeerMapping(cluster: ClusterInfo | null | undefined): PeerMapping {
  const peers = cluster?.peers || {};
  const allPeerIds = Object.keys(peers);
  const peerLabels: Record<string, string> = {};

  allPeerIds.forEach((pid, idx) => {
    const uri = peers[pid]?.uri || '';
    const nodeMatch = uri.match(/-(\d+)\./);
    peerLabels[pid] = nodeMatch ? `Node ${nodeMatch[1]}` : `Peer ${idx}`;
  });

  return {
    allPeerIds,
    nodeColors: NODE_COLORS,
    getLabel: (pid: string) => peerLabels[pid] || `Peer ${pid.slice(-6)}`,
    getColor: (pid: string) => colorForPeer(pid),
  };
}
