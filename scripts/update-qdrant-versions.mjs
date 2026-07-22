// Regenerates src/lib/qdrant-versions.ts from the live qdrant/qdrant releases.
//
// Run locally with `npm run update-versions`, or let the scheduled GitHub
// Action (.github/workflows/update-versions.yml) run it and commit any change.
//
// It fetches every published (non-prerelease) release, keeps the highest patch
// per `1.<minor>` line, and writes the version stops used by the upgrade
// planner. Requires Node 18+ (global fetch). Set GITHUB_TOKEN to raise the
// unauthenticated API rate limit (the workflow passes it automatically).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/qdrant-versions.ts');
const RELEASES_URL = 'https://api.github.com/repos/qdrant/qdrant/releases';

/** Parse "v1.18.3" / "1.18.3" -> [1, 18, 3], or null if not a clean semver. */
function parse(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmp(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

async function fetchReleases() {
  const headers = { 'User-Agent': 'qdrant-chrome-plugin-version-updater', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${RELEASES_URL}?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

function buildData(releases) {
  // minor -> highest [major, minor, patch] seen on that line
  const byMinor = new Map();
  let latest = null;

  for (const rel of releases) {
    if (rel.draft || rel.prerelease) continue;
    const v = parse(rel.tag_name || '');
    if (!v) continue;
    const [, minor] = v;
    if (!byMinor.has(minor) || cmp(v, byMinor.get(minor)) > 0) byMinor.set(minor, v);
    if (!latest || cmp(v, latest) > 0) latest = v;
  }

  if (!latest) throw new Error('No stable Qdrant releases found — aborting to avoid clobbering the file.');

  const minors = [...byMinor.keys()].sort((a, b) => a - b);
  const patchLines = minors
    .map(m => `  ${m}: '${byMinor.get(m).join('.')}',`)
    .join('\n');

  return { patchLines, latest: latest.join('.') };
}

function render({ patchLines, latest }, today) {
  return `/**
 * Known Qdrant release stops used by the upgrade planner.
 *
 * ───── MAINTAINERS ─────
 * This file is generated. Do not edit by hand — run \`npm run update-versions\`
 * (or let the scheduled GitHub Action do it). It is regenerated from the live
 * releases at https://github.com/qdrant/qdrant/releases.
 *
 * The upgrade planner uses these stops as the "rest points" on the recommended
 * incremental path (current minor's last patch → each intermediate minor's
 * last patch → target).
 *
 * Source of truth: https://github.com/qdrant/qdrant/releases
 */

/** Latest patch known for each \`1.<minor>\` line. */
export const LATEST_PATCH_BY_MINOR: Record<number, string> = {
${patchLines}
};

/** The newest release the plugin knows about. The default upgrade target. */
export const LATEST_KNOWN_VERSION = '${latest}';

/** When this file was last regenerated — surfaced in the UI so users can tell
 *  whether the version data is fresh. */
export const VERSIONS_LAST_UPDATED = '${today}';
`;
}

const releases = await fetchReleases();
const data = buildData(releases);
const today = new Date().toISOString().slice(0, 10);
writeFileSync(OUT, render(data, today));
console.log(`Updated ${OUT}\n  latest: ${data.latest}\n  minors: ${data.patchLines.split('\n').length}`);
