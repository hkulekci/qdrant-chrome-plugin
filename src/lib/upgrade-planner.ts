import { LATEST_PATCH_BY_MINOR } from './qdrant-versions';

/**
 * Pure functions for parsing/comparing Qdrant versions and computing the
 * recommended incremental upgrade path. No side effects, no data fetching.
 *
 * Reference: https://qdrant.tech/documentation/cloud/cluster-upgrade/
 *   Recommended path is "current → last patch of current minor → last patch
 *   of each intermediate minor → target". Skipping minors is unsupported
 *   because each minor may ship migrations.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Tail after the third number (e.g. "-rc.1"). Preserved but ignored in compare. */
  suffix?: string;
}

export type UpgradeStepKind =
  /** Bump the patch on the current minor to reach its latest patch. */
  | 'patch-up'
  /** Cross from one minor's latest patch to the next minor's latest patch. */
  | 'minor'
  /** Final hop into the target version. */
  | 'final';

export interface UpgradeStep {
  index: number;
  from: string;
  to: string;
  kind: UpgradeStepKind;
  note: string;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(.*)?$/;

export function parseVersion(v: string): ParsedVersion | null {
  if (!v) return null;
  const cleaned = v.trim().replace(/^v/, '');
  const m = VERSION_RE.exec(cleaned);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    suffix: m[4] || undefined,
  };
}

/** Returns -1 / 0 / +1 for a<b / a==b / a>b. Suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

/**
 * Compute the ordered sequence of hops from `current` to `target`.
 *
 * Rules:
 *   - If current ≥ target, returns [].
 *   - Same-minor jump: a single 'final' step current → target.
 *   - Cross-minor: insert a 'patch-up' to the current minor's last patch
 *     (only if current isn't already at it), then 'minor' hops to each
 *     intermediate minor's last patch, then a 'final' hop to target.
 *   - Unknown intermediate minors (missing from LATEST_PATCH_BY_MINOR) are
 *     skipped — the planner crosses them implicitly inside the next step.
 */
export function computeUpgradePath(current: string, target: string): UpgradeStep[] {
  const c = parseVersion(current);
  const t = parseVersion(target);
  if (!c || !t) return [];
  if (compareVersions(current, target) >= 0) return [];

  // Build the ordered list of intermediate "rest points" (excluding `current`,
  // including `target`). Each is the last patch of an intermediate minor.
  const stops: string[] = [];

  // Patch-up on current minor when more minors remain.
  if (c.minor < t.minor) {
    const lastOfCurrent = LATEST_PATCH_BY_MINOR[c.minor];
    if (lastOfCurrent && compareVersions(current, lastOfCurrent) < 0) {
      stops.push(lastOfCurrent);
    }
  }

  // Last patch of each intermediate minor.
  for (let m = c.minor + 1; m < t.minor; m++) {
    const lastPatch = LATEST_PATCH_BY_MINOR[m];
    if (lastPatch) stops.push(lastPatch);
  }

  // The target itself is always the final stop.
  stops.push(target);

  // Walk the stops and produce steps. Skip stops that don't advance.
  const steps: UpgradeStep[] = [];
  let cursor = current;
  for (const stop of stops) {
    if (compareVersions(cursor, stop) >= 0) continue;
    const cFrom = parseVersion(cursor)!;
    const cTo = parseVersion(stop)!;
    const kind: UpgradeStepKind =
      stop === target ? 'final'
        : cFrom.minor === cTo.minor ? 'patch-up'
          : 'minor';
    steps.push({
      index: steps.length + 1,
      from: cursor,
      to: stop,
      kind,
      note:
        kind === 'patch-up'
          ? 'Bring current minor to its latest patch first'
          : kind === 'minor'
            ? `Hop to ${cTo.major}.${cTo.minor}.x — applies any migrations for the new minor`
            : 'Final hop to target version',
    });
    cursor = stop;
  }
  return steps;
}

/** Convenience: total minor versions between current and target. */
export function minorDistance(current: string, target: string): number {
  const c = parseVersion(current);
  const t = parseVersion(target);
  if (!c || !t) return 0;
  return Math.max(0, t.minor - c.minor);
}
