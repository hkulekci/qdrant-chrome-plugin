/**
 * Constants for the background snapshot cache. Centralised so the popup form,
 * the background alarm gating, and the storage budget logic stay in sync.
 */

/** Minimum allowed refresh interval per cluster (minutes). */
export const MIN_CACHED_FREQUENCY_MINUTES = 1;

/** Maximum allowed refresh interval per cluster (minutes). */
export const MAX_CACHED_FREQUENCY_MINUTES = 60;

/** Default refresh interval applied to clusters without an explicit setting. */
export const DEFAULT_CACHED_FREQUENCY_MINUTES = 5;

/**
 * How often the alarm itself fires. The alarm wakes once a minute and decides
 * which clusters are due based on their per-cluster frequency.
 */
export const ALARM_PERIOD_MINUTES = 1;

/**
 * Soft upper bound on total bytes the extension keeps in chrome.storage.local.
 * Chrome's hard quota for unprivileged extensions is ~5 MB; we stay safely
 * below that so we never reach a write rejection from the runtime.
 */
export const STORAGE_BUDGET_BYTES = 4_000_000;

/**
 * Resolves the effective refresh interval for a cluster, applying the floor
 * and the default fallback for legacy entries.
 */
export function resolveFrequencyMinutes(value: number | undefined): number {
  const v = value ?? DEFAULT_CACHED_FREQUENCY_MINUTES;
  return Math.max(MIN_CACHED_FREQUENCY_MINUTES, Math.min(MAX_CACHED_FREQUENCY_MINUTES, v));
}
