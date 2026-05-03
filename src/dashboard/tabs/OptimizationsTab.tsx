import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  DashboardData,
  ClusterConfig,
  CollectionOptimizations,
  OptimizationTask,
  OptimizationProgress,
  OptimizationSegment,
} from '../../lib/types';
import { formatNumber, formatDuration } from '../../lib/format';
import { QdrantApi } from '../../lib/qdrant-api';

const REFRESH_MS = 3000;

type StageStatus = 'done' | 'running' | 'queued';

function getStageStatus(p: OptimizationProgress): StageStatus {
  if (!p.started_at) return 'queued';
  if (p.finished_at) return 'done';
  return 'running';
}

// Stage duration in milliseconds. For running stages use now - started_at.
function stageDurationMs(p: OptimizationProgress, nowMs: number): number | null {
  if (typeof p.duration_sec === 'number' && p.duration_sec > 0) return p.duration_sec * 1000;
  if (!p.started_at) return null;
  const started = Date.parse(p.started_at);
  if (isNaN(started)) return null;
  if (p.finished_at) {
    const finished = Date.parse(p.finished_at);
    return isNaN(finished) ? null : finished - started;
  }
  return Math.max(0, nowMs - started);
}

// Walk the tree and return the deepest currently-running leaf.
function findCurrentStage(
  p: OptimizationProgress,
): OptimizationProgress | null {
  const children = (p.children || []).filter(Boolean) as OptimizationProgress[];
  for (const c of children) {
    if (getStageStatus(c) === 'running') {
      const deeper = findCurrentStage(c);
      return deeper || c;
    }
  }
  return getStageStatus(p) === 'running' ? p : null;
}

function shortUuid(uuid: string | undefined): string {
  if (!uuid) return '';
  if (uuid.length <= 12) return uuid;
  return `${uuid.slice(0, 8)}…${uuid.slice(-4)}`;
}

function formatUtcTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // YYYY-MM-DD HH:mm:ss UTC
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function SegmentChips({ segments }: { segments: OptimizationSegment[] }) {
  if (!segments?.length) return null;
  const shown = segments.slice(0, 4);
  const extra = segments.length - shown.length;
  return (
    <div className="opt-segments">
      {shown.map((s) => (
        <span key={s.uuid} className="opt-segment-chip" title={`${s.uuid} · ${formatNumber(s.points_count)} points`}>
          {(s.uuid || '').slice(0, 8)}
          <span className="opt-segment-points">{formatNumber(s.points_count)}</span>
        </span>
      ))}
      {extra > 0 && <span className="opt-segment-more">+{extra} more</span>}
    </div>
  );
}

// Recursive tree row for the stage timeline.
function StageRow({ stage, depth, nowMs }: { stage: OptimizationProgress; depth: number; nowMs: number }) {
  const status = getStageStatus(stage);
  const durMs = stageDurationMs(stage, nowMs);
  const hasTotal = typeof stage.total === 'number' && stage.total > 0;
  const hasDoneOnly = !hasTotal && typeof stage.done === 'number' && stage.done > 0;
  const pct = hasTotal ? (stage.done / stage.total) * 100 : 0;
  const children = (stage.children || []).filter(Boolean) as OptimizationProgress[];
  const displayName = stage.name && stage.name.length > 0 ? stage.name : '(unnamed)';
  const isRoot = depth === 0;

  return (
    <>
      <div className={`opt-stage-row ${status}${isRoot ? ' root' : ''}`}>
        <span className="opt-stage-indent" style={{ width: `${depth * 16}px` }} />
        <span className={`opt-stage-icon ${status}`} aria-hidden>
          {status === 'done' ? '✓' : status === 'running' ? '⏳' : '○'}
        </span>
        <span className={`opt-stage-name ${isRoot ? 'is-root' : ''}`}>{displayName}</span>
        <span className="opt-stage-meta">
          {hasTotal && (
            <span className={`opt-stage-progress ${status === 'running' ? 'running' : ''}`}>
              {formatNumber(stage.done)}/{formatNumber(stage.total)} ({pct.toFixed(1)}%)
            </span>
          )}
          {hasDoneOnly && (
            <span className={`opt-stage-progress ${status === 'running' ? 'running' : ''}`}>
              {formatNumber(stage.done)} done
            </span>
          )}
          {durMs != null ? (
            <span className={`opt-stage-duration ${status}`}>{formatDuration(durMs)}</span>
          ) : (
            <span className="opt-stage-duration queued">queued</span>
          )}
        </span>
      </div>
      {children.map((c, i) => (
        <StageRow key={`${c.name || ''}-${i}`} stage={c} depth={depth + 1} nowMs={nowMs} />
      ))}
    </>
  );
}

function RunningTaskCard({ task, nowMs }: { task: OptimizationTask; nowMs: number }) {
  const [timelineOpen, setTimelineOpen] = useState(true);
  const root = task.progress;
  const elapsedMs = stageDurationMs(root, nowMs);
  const current = findCurrentStage(root);
  const currentDurMs = current ? stageDurationMs(current, nowMs) : null;
  const totalSegPts = (task.segments || []).reduce((s, x) => s + (x.points_count || 0), 0);
  const segCount = task.segments?.length || 0;

  return (
    <div className="opt-task running">
      <div className="opt-task-top">
        <div className="opt-task-badges">
          <span className="opt-badge optimizer">{task.optimizer}</span>
          <span className="opt-badge status">{task.status}</span>
        </div>
        <span className="opt-task-uuid" title={task.uuid}>{shortUuid(task.uuid)}</span>
      </div>

      <div className="opt-task-meta">
        {segCount === 1 ? (
          <span><span className="m-label">Segment:</span> <span className="m-mono">{shortUuid(task.segments[0].uuid)}</span> ({formatNumber(task.segments[0].points_count)} pts)</span>
        ) : segCount > 0 ? (
          <span><span className="m-label">Segments:</span> {segCount} ({formatNumber(totalSegPts)} pts total)</span>
        ) : null}
        <span><span className="m-label">Total points:</span> <strong>{formatNumber(totalSegPts)}</strong></span>
        {root?.started_at && <span><span className="m-label">Started:</span> {formatUtcTimestamp(root.started_at)}</span>}
        {elapsedMs != null && <span><span className="m-label">Elapsed:</span> <strong>{formatDuration(elapsedMs)}</strong></span>}
      </div>

      {current && (
        <div className="opt-current-banner">
          <div className="opt-current-line">
            <span className="opt-current-tag">CURRENT</span>
            <span className="opt-current-name">{current.name || '(unnamed)'}</span>
            <span className="opt-current-elapsed">{currentDurMs != null ? formatDuration(currentDurMs) : '—'} in stage</span>
          </div>
          {typeof current.done === 'number' && current.done > 0 && (
            <div className="opt-current-sub">
              {formatNumber(current.done)}{typeof current.total === 'number' && current.total > 0 ? `/${formatNumber(current.total)} (${((current.done / current.total) * 100).toFixed(1)}%)` : ' done so far'}
            </div>
          )}
        </div>
      )}

      <button className="opt-timeline-toggle" onClick={() => setTimelineOpen(!timelineOpen)}>
        <span className="opt-timeline-caret">{timelineOpen ? '◂' : '▸'}</span> Stage timeline
      </button>
      {timelineOpen && root && (
        <div className="opt-stage-tree">
          <StageRow stage={root} depth={0} nowMs={nowMs} />
        </div>
      )}
    </div>
  );
}

function CompletedTaskCard({ task }: { task: OptimizationTask }) {
  const duration = task.progress?.duration_sec ?? 0;
  const started = task.progress?.started_at ? new Date(task.progress.started_at).toLocaleTimeString() : '';
  const finished = task.progress?.finished_at ? new Date(task.progress.finished_at).toLocaleTimeString() : '';
  return (
    <div className="opt-task completed">
      <div className="opt-task-top">
        <div className="opt-task-badges">
          <span className="opt-badge optimizer">{task.optimizer}</span>
          <span className="opt-badge status done">{task.status}</span>
        </div>
        <span className="opt-task-uuid" title={task.uuid}>{shortUuid(task.uuid)}</span>
      </div>
      <div className="opt-task-meta">
        {started && <span><span className="m-label">Started:</span> {started}</span>}
        {finished && <span><span className="m-label">Finished:</span> {finished}</span>}
        {duration > 0 && <span><span className="m-label">Duration:</span> <strong>{formatDuration(duration * 1000)}</strong></span>}
        <span><span className="m-label">Segments:</span> {task.segments?.length || 0}</span>
      </div>
      <SegmentChips segments={task.segments} />
    </div>
  );
}

function Section({ title, count, accent, defaultOpen, children }: { title: string; count: number; accent: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0 && !defaultOpen) {
    return (
      <div className="opt-section empty">
        <span className={`opt-section-dot ${accent}`} />
        <span className="opt-section-title">{title}</span>
        <span className="opt-section-count">0</span>
      </div>
    );
  }
  return (
    <div className={`opt-section ${open ? 'open' : ''}`}>
      <button className="opt-section-header" onClick={() => setOpen(!open)}>
        <span className={`opt-section-dot ${accent}`} />
        <span className="opt-section-title">{title}</span>
        <span className="opt-section-count">{count}</span>
        <span className="opt-section-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="opt-section-body">{children}</div>}
    </div>
  );
}

function CollectionOptimizationsCard({ name, data, nowMs }: { name: string; data: CollectionOptimizations | null | { error: string }; nowMs: number }) {
  if (!data) {
    return (
      <div className="opt-collection-card loading-card">
        <div className="opt-collection-header">
          <span className="collection-name">{name}</span>
          <span className="opt-collection-status muted">Loading…</span>
        </div>
      </div>
    );
  }
  if ('error' in data) {
    return (
      <div className="opt-collection-card error-card">
        <div className="opt-collection-header">
          <span className="collection-name">{name}</span>
          <span className="opt-collection-status error">Unavailable</span>
        </div>
        <p className="opt-collection-error">{data.error}</p>
      </div>
    );
  }

  const running = data.running || [];
  const queued = data.queued || [];
  const completed = data.completed || [];
  const summary = data.summary || { queued_optimizations: 0, queued_segments: 0, queued_points: 0, idle_segments: 0 };
  const idleSegs = data.idle_segments || [];
  const isBusy = running.length > 0 || summary.queued_optimizations > 0;

  return (
    <div className={`opt-collection-card ${isBusy ? 'busy' : 'idle'}`}>
      <div className="opt-collection-header">
        <span className="collection-name">{name}</span>
        <div className="opt-collection-stats">
          {running.length > 0 && (
            <span className="opt-stat running">
              <span className="opt-pulse-dot" />
              {running.length} running
            </span>
          )}
          {summary.queued_optimizations > 0 && (
            <span className="opt-stat queued">
              {summary.queued_optimizations} queued · {formatNumber(summary.queued_points)} pts
            </span>
          )}
          <span className="opt-stat completed">
            {completed.length} completed
          </span>
          <span className="opt-stat idle">
            {summary.idle_segments} idle seg{summary.idle_segments === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {!isBusy && running.length === 0 && completed.length === 0 && (
        <p className="opt-idle-notice">No optimization activity. {summary.idle_segments > 0 ? `${summary.idle_segments} segment${summary.idle_segments === 1 ? '' : 's'} currently idle.` : ''}</p>
      )}

      {running.length > 0 && (
        <Section title="Running" count={running.length} accent="info" defaultOpen>
          <div className="opt-task-list">
            {running.map((t) => <RunningTaskCard key={t.uuid} task={t} nowMs={nowMs} />)}
          </div>
        </Section>
      )}

      {queued.length > 0 && (
        <Section title="Queued" count={queued.length} accent="warning" defaultOpen={false}>
          <div className="opt-queue-list">
            {queued.map((q, i) => (
              <div key={`${q.optimizer}-${i}`} className="opt-queue-item">
                <span className="opt-queue-optimizer">{q.optimizer}</span>
                <span className="opt-queue-sep">·</span>
                <span>{q.segments.length} segment{q.segments.length === 1 ? '' : 's'}</span>
                <SegmentChips segments={q.segments} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {completed.length > 0 && (
        <Section title="Completed" count={completed.length} accent="success" defaultOpen={false}>
          <div className="opt-task-list">
            {completed.map((t) => <CompletedTaskCard key={t.uuid} task={t} />)}
          </div>
        </Section>
      )}

      {idleSegs.length > 0 && (
        <Section title="Idle Segments" count={idleSegs.length} accent="muted" defaultOpen={false}>
          <SegmentChips segments={idleSegs} />
        </Section>
      )}
    </div>
  );
}

type OptData = CollectionOptimizations | { error: string };

export function OptimizationsTab({ data, cluster }: { data: DashboardData; cluster: ClusterConfig | null }) {
  const [optsByCollection, setOptsByCollection] = useState<Record<string, OptData>>({});
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState<'all' | 'busy'>('all');
  const [lastFetched, setLastFetched] = useState<string>('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const timerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  const fetchAll = useCallback(async () => {
    if (!cluster || data.collections.length === 0) return;
    setLoading(true);
    const api = new QdrantApi(cluster.url, cluster.apiKey);
    const results = await Promise.all(
      data.collections.map(async (name) => {
        try {
          const res = await api.getCollectionOptimizations(name);
          return [name, res] as const;
        } catch (e) {
          return [name, { error: (e as Error).message }] as const;
        }
      }),
    );
    const next: Record<string, OptData> = {};
    for (const [name, res] of results) next[name] = res;
    setOptsByCollection(next);
    setLastFetched(new Date().toLocaleTimeString());
    setLoading(false);
  }, [cluster?.url, cluster?.apiKey, data.collections]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = window.setInterval(fetchAll, REFRESH_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [autoRefresh, fetchAll]);

  // 1s ticker so elapsed/in-stage durations feel live between fetches.
  useEffect(() => {
    tickRef.current = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, []);

  const totalRunning = Object.values(optsByCollection).reduce((sum, d) => {
    if (!d || 'error' in d) return sum;
    return sum + (d.running?.length || 0);
  }, 0);

  const totalQueued = Object.values(optsByCollection).reduce((sum, d) => {
    if (!d || 'error' in d) return sum;
    return sum + (d.summary?.queued_optimizations || 0);
  }, 0);

  const displayedCollections = filter === 'busy'
    ? data.collections.filter((name) => {
        const d = optsByCollection[name];
        if (!d || 'error' in d) return false;
        return (d.running?.length || 0) > 0 || (d.summary?.queued_optimizations || 0) > 0;
      })
    : data.collections;

  if (data.collections.length === 0) {
    return <div className="card"><p style={{ color: 'var(--text-secondary)' }}>No collections found.</p></div>;
  }

  return (
    <>
      <div className="opt-toolbar">
        <div className="opt-toolbar-stats">
          <span className="opt-toolbar-stat">
            <span className="opt-pulse-dot" style={{ visibility: totalRunning > 0 ? 'visible' : 'hidden' }} />
            <strong>{totalRunning}</strong> running
          </span>
          <span className="opt-toolbar-stat"><strong>{totalQueued}</strong> queued</span>
          <span className="opt-toolbar-stat muted">across {data.collections.length} collection{data.collections.length === 1 ? '' : 's'}</span>
        </div>
        <div className="opt-toolbar-controls">
          <div className="opt-filter-toggle">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
            <button className={filter === 'busy' ? 'active' : ''} onClick={() => setFilter('busy')}>Busy only</button>
          </div>
          <label className="opt-auto-refresh">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh ({REFRESH_MS / 1000}s)
          </label>
          <button className="btn btn-refresh" onClick={fetchAll} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {lastFetched && <span className="last-updated">Updated: {lastFetched}</span>}
        </div>
      </div>

      {displayedCollections.length === 0 ? (
        <div className="card"><p style={{ color: 'var(--text-secondary)' }}>No collections with active optimizations. Switch to "All" to see everything.</p></div>
      ) : (
        displayedCollections.map((name) => (
          <CollectionOptimizationsCard key={name} name={name} data={optsByCollection[name] || null} nowMs={nowMs} />
        ))
      )}
    </>
  );
}
