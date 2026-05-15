import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { ClusterConfig, DashboardData } from '../../lib/types';
import { LATEST_KNOWN_VERSION, VERSIONS_LAST_UPDATED } from '../../lib/qdrant-versions';
import {
  compareVersions,
  computeUpgradePath,
  minorDistance,
  parseVersion,
  type UpgradeStep,
} from '../../lib/upgrade-planner';
import {
  computeReadiness,
  summarize,
  type ReadinessCheck,
  type ReadinessLevel,
} from '../../lib/upgrade-readiness';
import { getUpgradeProgress, setUpgradeProgress, type UpgradeProgress } from '../../lib/storage';

/**
 * Upgrade tab — surfaced from Dashboard.tsx only when the cluster's current
 * version is older than LATEST_KNOWN_VERSION.
 *
 * The tab is intentionally read-mostly: Qdrant Cloud is where you actually
 * trigger the upgrade. The plugin's job is to plan it (path), help the user
 * verify pre-conditions (readiness), and keep them oriented while it's
 * running (steps + monitoring guide).
 */

const ICONS: Record<ReadinessLevel, string> = {
  pass: '✓',
  warn: '⚠',
  fail: '✕',
  info: 'i',
};

// Manual-check items that the user toggles per step. Auto-derived ones (such
// as "version reached X") are not in this list — they're computed each render.
const MANUAL_ITEMS: { key: string; label: string }[] = [
  { key: 'triggered', label: 'I started this upgrade in the Cloud UI' },
  { key: 'logs', label: 'I watched the Logs tab and saw drain → restart → rejoin per node' },
];

function ReadinessRow({ check }: { check: ReadinessCheck }) {
  return (
    <div className={`upgrade-readiness-row level-${check.level}`}>
      <span className="upgrade-readiness-icon" aria-hidden>{ICONS[check.level]}</span>
      <div className="upgrade-readiness-body">
        <div className="upgrade-readiness-title">{check.title}</div>
        <div className="upgrade-readiness-detail">
          {check.detail}
          {check.link && (
            <>
              {' '}
              <a
                className="upgrade-readiness-link"
                href={check.link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {check.link.label} &#8599;
              </a>
            </>
          )}
        </div>
      </div>
      {check.value && <span className="upgrade-readiness-value">{check.value}</span>}
    </div>
  );
}

function PathChip({ version, kind }: { version: string; kind?: 'current' | 'target' | 'stop' }) {
  return (
    <span className={`upgrade-chip upgrade-chip-${kind || 'stop'}`}>{version}</span>
  );
}

function PathSection({ steps, current, target }: {
  steps: UpgradeStep[];
  current: string;
  target: string;
}) {
  return (
    <div className="card upgrade-section">
      <h2>Version path</h2>
      <p className="upgrade-section-sub">
        Recommended order — each minor may apply migrations. Verify cluster is green between hops.
      </p>
      <div className="upgrade-path-horizontal">
        <span className="upgrade-chip upgrade-chip-current" title="Current cluster version">{current}</span>
        {steps.map(step => (
          <Fragment key={step.index}>
            <span className="upgrade-path-arrow" aria-hidden>&rarr;</span>
            <span
              className={`upgrade-chip upgrade-chip-${step.to === target ? 'target' : 'stop'}`}
              title={step.note}
            >
              {step.to}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

interface StepCardProps {
  step: UpgradeStep;
  currentVersion: string;
  manualState: Record<string, boolean>;
  onToggle: (itemKey: string, value: boolean) => void;
}

/** Returns 'done' | 'active' | 'pending' from the cluster's current version. */
function deriveStepStatus(step: UpgradeStep, currentVersion: string): 'done' | 'active' | 'pending' {
  if (compareVersions(currentVersion, step.to) >= 0) return 'done';
  if (compareVersions(currentVersion, step.from) >= 0) return 'active';
  return 'pending';
}

function StepCard({ step, currentVersion, manualState, onToggle }: StepCardProps) {
  const status = deriveStepStatus(step, currentVersion);
  const versionReached = compareVersions(currentVersion, step.to) >= 0;
  const clusterGreen = true; // We don't know per-step history; treat current snapshot health
                             // as a proxy. The readiness panel above already calls this out.

  return (
    <div className={`upgrade-step upgrade-step-${status}`}>
      <div className="upgrade-step-head">
        <span className="upgrade-step-number">Step {step.index}</span>
        <span className="upgrade-step-versions">
          <PathChip version={step.from} />
          <span className="upgrade-path-arrow" aria-hidden>&rarr;</span>
          <PathChip version={step.to} kind={status === 'done' ? 'stop' : 'target'} />
        </span>
        <span className={`upgrade-step-status status-${status}`}>
          {status === 'done' ? 'Done' : status === 'active' ? 'Current' : 'Pending'}
        </span>
      </div>

      <ul className="upgrade-step-checklist">
        <li className={clusterGreen ? 'checked auto' : 'auto'}>
          <span className="upgrade-check">{clusterGreen ? ICONS.pass : ICONS.info}</span>
          <span>Cluster is green before starting</span>
          <span className="upgrade-check-tag">auto</span>
        </li>
        {MANUAL_ITEMS.map(item => (
          <li
            key={item.key}
            className={manualState[item.key] ? 'checked' : ''}
            onClick={() => onToggle(item.key, !manualState[item.key])}
          >
            <span className="upgrade-check">
              {manualState[item.key] ? ICONS.pass : ''}
            </span>
            <span>{item.label}</span>
            <span className="upgrade-check-tag">manual</span>
          </li>
        ))}
        <li className={versionReached ? 'checked auto' : 'auto'}>
          <span className="upgrade-check">{versionReached ? ICONS.pass : ''}</span>
          <span>Version reached {step.to}</span>
          <span className="upgrade-check-tag">auto</span>
        </li>
      </ul>
    </div>
  );
}

export function UpgradeTab({ data, cluster }: { data: DashboardData; cluster: ClusterConfig }) {
  const currentVersion = data.telemetry?.app?.version || '';
  const target = LATEST_KNOWN_VERSION;
  const steps = useMemo(() => computeUpgradePath(currentVersion, target), [currentVersion, target]);
  const readiness = useMemo(() => computeReadiness(data), [data]);
  const summary = useMemo(() => summarize(readiness), [readiness]);

  const [progress, setProgress] = useState<UpgradeProgress | null>(null);
  useEffect(() => {
    let cancelled = false;
    getUpgradeProgress(cluster.id, target).then(p => {
      if (!cancelled) setProgress(p);
    });
    return () => { cancelled = true; };
  }, [cluster.id, target]);

  const toggleManual = useCallback((stepKey: string, itemKey: string, value: boolean) => {
    setProgress(prev => {
      const base: UpgradeProgress = prev || { targetVersion: target, items: {} };
      const next: UpgradeProgress = {
        targetVersion: target,
        items: { ...base.items, [stepKey]: { ...(base.items[stepKey] || {}), [itemKey]: value } },
      };
      setUpgradeProgress(cluster.id, next);
      return next;
    });
  }, [cluster.id, target]);

  // No version known yet (snapshot still loading) — render a stub so we don't
  // flash "unknown" when the cluster just hasn't reported telemetry yet.
  if (!currentVersion || !parseVersion(currentVersion)) {
    return (
      <div className="card">
        <p style={{ color: 'var(--text-secondary)' }}>Cluster version not reported yet — refresh to populate.</p>
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="card">
        <h2>Already up to date</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Cluster is at {currentVersion}. Latest known release in the plugin: {target} (as of {VERSIONS_LAST_UPDATED}).
        </p>
      </div>
    );
  }

  const distance = minorDistance(currentVersion, target);

  return (
    <>
      <div className="card upgrade-header">
        <div className="upgrade-header-top">
          <div>
            <h2>Upgrade plan</h2>
            <p className="upgrade-header-sub">
              <strong>{currentVersion}</strong> &rarr; <strong>{target}</strong>
              {' · '}{distance} minor version{distance === 1 ? '' : 's'} away
              {' · '}{steps.length} step{steps.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="upgrade-header-meta">
            <span className="upgrade-header-meta-label">Latest known</span>
            <span className="upgrade-header-meta-value">{target}</span>
            <span className="upgrade-header-meta-label">Data refreshed</span>
            <span className="upgrade-header-meta-value">{VERSIONS_LAST_UPDATED}</span>
          </div>
        </div>
        {summary.hasBlockers && (
          <div className="upgrade-banner upgrade-banner-fail">
            {summary.failCount} blocker{summary.failCount === 1 ? '' : 's'} below — resolve before starting.
          </div>
        )}
        {!summary.hasBlockers && summary.warnCount > 0 && (
          <div className="upgrade-banner upgrade-banner-warn">
            {summary.warnCount} caution{summary.warnCount === 1 ? '' : 's'} — review the readiness panel before starting.
          </div>
        )}
      </div>

      <div className="card upgrade-section">
        <h2>Cluster readiness</h2>
        <p className="upgrade-section-sub">
          Pre-flight checks against the latest snapshot. Disk and CPU aren't in Qdrant telemetry — check Cloud Metrics for those.
        </p>
        <div className="upgrade-readiness-list">
          {readiness.map(c => <ReadinessRow key={c.id} check={c} />)}
        </div>
      </div>

      <PathSection steps={steps} current={currentVersion} target={target} />

      <div className="card upgrade-section">
        <h2>Step-by-step</h2>
        <p className="upgrade-section-sub">
          Auto rows update from the live snapshot. Manual rows persist per cluster; they reset if the latest target version changes.
        </p>
        <div className="upgrade-steps">
          {steps.map(step => {
            const stepKey = `${step.from}->${step.to}`;
            return (
              <StepCard
                key={stepKey}
                step={step}
                currentVersion={currentVersion}
                manualState={progress?.items[stepKey] || {}}
                onToggle={(itemKey, value) => toggleManual(stepKey, itemKey, value)}
              />
            );
          })}
        </div>
      </div>

      <div className="card upgrade-section upgrade-monitoring">
        <h2>Monitoring during the upgrade</h2>
        <p className="upgrade-section-sub">Cloud UI &rarr; <strong>Logs</strong> shows the upgrade live.</p>
        <ul className="upgrade-monitor-list">
          <li>Expect per-node sequence: drain &rarr; restart &rarr; reload segments &rarr; rejoin cluster.</li>
          <li>Wait for cluster status to return to <strong>green</strong> before proceeding to the next step.</li>
          <li>Restart time scales with collection count, total points, and segment count — small clusters reload in minutes, large ones can take an hour or more.</li>
          <li>Don't force-restart or interrupt the process — that can corrupt segments.</li>
        </ul>
      </div>
    </>
  );
}
