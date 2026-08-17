/**
 * Known Qdrant release stops used by the upgrade planner.
 *
 * ───── MAINTAINERS ─────
 * This file is generated. Do not edit by hand — run `npm run update-versions`
 * (or let the scheduled GitHub Action do it). It is regenerated from the live
 * releases at https://github.com/qdrant/qdrant/releases.
 *
 * The upgrade planner uses these stops as the "rest points" on the recommended
 * incremental path (current minor's last patch → each intermediate minor's
 * last patch → target).
 *
 * Source of truth: https://github.com/qdrant/qdrant/releases
 */

/** Latest patch known for each `1.<minor>` line. */
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
  18: '1.18.3',
  19: '1.19.0',
};

/** The newest release the plugin knows about. The default upgrade target. */
export const LATEST_KNOWN_VERSION = '1.19.0';

/** When this file was last regenerated — surfaced in the UI so users can tell
 *  whether the version data is fresh. */
export const VERSIONS_LAST_UPDATED = '2026-08-17';
