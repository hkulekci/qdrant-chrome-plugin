import type { DashboardData } from './types';

/**
 * Pre-upgrade readiness checks derived from the dashboard snapshot.
 *
 * These run against whatever the plugin already has, so they're a check on
 * cluster *health* and *shape* — not on every operational constraint. Disk
 * usage and live CPU aren't in Qdrant's telemetry, so those surface as `info`
 * with a pointer to the Cloud Metrics dashboard rather than a numeric check.
 */

export type ReadinessLevel = 'pass' | 'warn' | 'fail' | 'info';

export interface ReadinessCheck {
  id: string;
  /** Short label rendered as the row title. */
  title: string;
  /** Severity / sentiment. Drives icon + color in the UI. */
  level: ReadinessLevel;
  /** One short sentence shown under the title. */
  detail: string;
  /** Optional measured value rendered on the right (e.g. "76%", "3 peers"). */
  value?: string;
  /** Optional external link rendered as a small "↗ <label>" after the detail
   *  (e.g. point users at Cloud Metrics for things Qdrant telemetry doesn't
   *  expose). */
  link?: { href: string; label: string };
}

/** Qdrant Cloud dashboard root. We can't derive the per-cluster URL (need
 *  account id) so we link to the dashboard root and let the user navigate. */
const CLOUD_UI_URL = 'https://cloud.qdrant.io/';

const MEMORY_WARN_PCT = 70;  // mirror the HTML mockup's threshold
const MEMORY_FAIL_PCT = 85;
const PENDING_OPS_WARN = 10;

export function computeReadiness(data: DashboardData): ReadinessCheck[] {
  return [
    checkHighAvailability(data),
    checkMemoryPressure(data),
    checkReplication(data),
    checkPendingOps(data),
    checkConsensus(data),
    checkDiskUsage(),
    checkCpuUsage(),
  ];
}

function checkHighAvailability(data: DashboardData): ReadinessCheck {
  const peers = Object.keys(data.cluster?.peers || {}).length;
  if (peers <= 1) {
    return {
      id: 'ha',
      title: 'High availability',
      level: 'warn',
      detail: 'Single-node cluster — the upgrade will incur downtime. Schedule for a low-traffic window.',
      value: '1 node',
    };
  }
  return {
    id: 'ha',
    title: 'High availability',
    level: 'pass',
    detail: `${peers} nodes — Qdrant restarts them one at a time, so reads/writes can continue if replication is set up.`,
    value: `${peers} nodes`,
  };
}

function checkMemoryPressure(data: DashboardData): ReadinessCheck {
  const mem = data.telemetry?.memory;
  const sys = data.telemetry?.app?.system;
  if (!mem?.resident_bytes || !sys?.ram_size) {
    return {
      id: 'memory',
      title: 'Memory headroom',
      level: 'info',
      detail: 'Could not read memory metrics from telemetry.',
    };
  }
  const ramBytes = sys.ram_size * 1024;
  const pct = (mem.resident_bytes / ramBytes) * 100;
  const value = `${pct.toFixed(0)}% of RAM`;
  if (pct >= MEMORY_FAIL_PCT) {
    return {
      id: 'memory',
      title: 'Memory headroom',
      level: 'fail',
      detail: 'Restart pre-loads all segments. With this little headroom an OOM during reload is likely. Scale up first.',
      value,
    };
  }
  if (pct >= MEMORY_WARN_PCT) {
    return {
      id: 'memory',
      title: 'Memory headroom',
      level: 'warn',
      detail: `Above ${MEMORY_WARN_PCT}% — restart spikes are likely to push past safe limits. Consider scaling up before upgrading.`,
      value,
    };
  }
  return {
    id: 'memory',
    title: 'Memory headroom',
    level: 'pass',
    detail: `Below ${MEMORY_WARN_PCT}% — enough room for the segment reload spike during restart.`,
    value,
  };
}

function checkReplication(data: DashboardData): ReadinessCheck {
  const peers = Object.keys(data.cluster?.peers || {}).length;
  if (peers <= 1) {
    return {
      id: 'replication',
      title: 'Replication',
      level: 'info',
      detail: 'Replication is not meaningful on a single-node cluster.',
    };
  }
  const unreplicated: string[] = [];
  for (const name of data.collections) {
    const info = data.collectionDetails[name]?.info;
    if (!info) continue;
    const rf = info.config?.params?.replication_factor ?? 1;
    if (rf <= 1) unreplicated.push(name);
  }
  if (unreplicated.length === 0) {
    return {
      id: 'replication',
      title: 'Replication',
      level: 'pass',
      detail: 'All collections have replication ≥ 2 — node restarts during the upgrade stay transparent to clients.',
      value: `all rf ≥ 2`,
    };
  }
  const sample = unreplicated.slice(0, 3).join(', ') + (unreplicated.length > 3 ? `, +${unreplicated.length - 3} more` : '');
  return {
    id: 'replication',
    title: 'Replication',
    level: 'warn',
    detail: `${unreplicated.length} collection${unreplicated.length === 1 ? '' : 's'} at rf=1 (${sample}). They become unavailable while the node holding them restarts.`,
    value: `${unreplicated.length} at rf=1`,
  };
}

function checkPendingOps(data: DashboardData): ReadinessCheck {
  const pending = data.cluster?.raft_info?.pending_operations ?? 0;
  if (pending >= PENDING_OPS_WARN) {
    return {
      id: 'raft',
      title: 'Raft consensus queue',
      level: 'warn',
      detail: `${pending} pending Raft operations — consensus is backed up. Wait for it to drain before upgrading.`,
      value: `${pending} pending`,
    };
  }
  if (pending > 0) {
    return {
      id: 'raft',
      title: 'Raft consensus queue',
      level: 'info',
      detail: `${pending} pending operation${pending === 1 ? '' : 's'} — normal at low counts.`,
      value: `${pending} pending`,
    };
  }
  return {
    id: 'raft',
    title: 'Raft consensus queue',
    level: 'pass',
    detail: 'No pending Raft operations — cluster is settled.',
    value: '0 pending',
  };
}

function checkConsensus(data: DashboardData): ReadinessCheck {
  const status = data.cluster?.consensus_thread_status?.consensus_thread_status;
  if (!status) {
    return {
      id: 'consensus',
      title: 'Consensus thread',
      level: 'info',
      detail: 'Consensus thread status not reported.',
    };
  }
  if (status === 'working') {
    return {
      id: 'consensus',
      title: 'Consensus thread',
      level: 'pass',
      detail: 'Consensus thread is healthy.',
      value: 'working',
    };
  }
  return {
    id: 'consensus',
    title: 'Consensus thread',
    level: 'fail',
    detail: `Consensus thread is "${status}". Resolve before starting the upgrade — Raft is the coordination layer for the rolling restart.`,
    value: status,
  };
}

function checkDiskUsage(): ReadinessCheck {
  return {
    id: 'disk',
    title: 'Disk usage',
    level: 'info',
    detail: 'Qdrant telemetry exposes only disk capacity, not live utilization. Check Cloud Metrics — keep usage below 70% so the restart has headroom for new segments.',
    link: { href: CLOUD_UI_URL, label: 'Open Qdrant Cloud' },
  };
}

function checkCpuUsage(): ReadinessCheck {
  return {
    id: 'cpu',
    title: 'CPU usage',
    level: 'info',
    detail: 'Live CPU is not in Qdrant telemetry. Check Cloud Metrics — if sustained CPU is above 70%, scale up before upgrading.',
    link: { href: CLOUD_UI_URL, label: 'Open Qdrant Cloud' },
  };
}

/** Aggregate: are there any 'fail' (block) or 'warn' (caution) entries? */
export interface ReadinessSummary {
  failCount: number;
  warnCount: number;
  passCount: number;
  hasBlockers: boolean;
}

export function summarize(checks: ReadinessCheck[]): ReadinessSummary {
  let failCount = 0, warnCount = 0, passCount = 0;
  for (const c of checks) {
    if (c.level === 'fail') failCount++;
    else if (c.level === 'warn') warnCount++;
    else if (c.level === 'pass') passCount++;
  }
  return { failCount, warnCount, passCount, hasBlockers: failCount > 0 };
}
