/**
 * Known Qdrant release stops used by the upgrade planner.
 *
 * ───── MAINTAINERS ─────
 * Every time a new Qdrant minor or patch is released, update this file.
 * Two things change:
 *
 *   1. LATEST_PATCH_BY_MINOR — bump the patch entry for the newly released minor.
 *   2. LATEST_KNOWN_VERSION  — set to the very latest patch.
 *
 * The upgrade planner uses these stops as the "rest points" on the recommended
 * incremental path (current minor's last patch → each intermediate minor's
 * last patch → target). Out-of-date entries mean the planner suggests a
 * stale path; missing minors are silently skipped, which can shorten the
 * suggested path. Either case is non-fatal but degrades the recommendation.
 *
 * Source of truth: https://github.com/qdrant/qdrant/releases
 */

/** Latest patch known for each `1.<minor>` line.
 *  Derived from https://github.com/qdrant/qdrant/releases. */
export const LATEST_PATCH_BY_MINOR: Record<number, string> = {
  0: '1.0.3',
  1: '1.1.3',
  2: '1.2.2',
  3: '1.3.2',
  4: '1.4.1',
  5: '1.5.1',
  6: '1.6.1',
  7: '1.7.4',
  8: '1.8.4',
  9: '1.9.7',
  10: '1.10.1',
  11: '1.11.5',
  12: '1.12.6',
  13: '1.13.6',
  14: '1.14.1',
  15: '1.15.5',
  16: '1.16.3',
  17: '1.17.1',
  18: '1.18.0',
};

/** The newest release the plugin knows about. The default upgrade target. */
export const LATEST_KNOWN_VERSION = '1.18.0';

/** When this file was last touched — surfaced in the UI so users can tell
 *  whether the version data is fresh. Update alongside the version entries. */
export const VERSIONS_LAST_UPDATED = '2026-05-14';
