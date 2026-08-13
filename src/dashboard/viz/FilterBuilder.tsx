import type { ScatterPoint } from './VectorScatter';

// A single facet value with its occurrence count.
export interface FacetValue { value: string | number | boolean; count: number; }

// A payload field turned into a filterable facet. `source` distinguishes exact
// server-side facet counts (Qdrant Facet API) from approximate counts derived
// from the loaded sample when no facetable payload index is available.
export interface FieldFacet {
  field: string;
  render: 'chips' | 'range';
  typeLabel: string;
  indexed: boolean;
  source: 'server' | 'sample';
  values: FacetValue[];       // for chips
  distinctCount: number;
  min?: number;               // for range
  max?: number;
}

// One filter condition, keyed to a field (at most one condition per field).
export type FilterCond =
  | { field: string; kind: 'match'; values: (string | number | boolean)[] }
  | { field: string; kind: 'range'; gte: number | null; lte: number | null };

const CHIP_LIMIT = 16;          // value chips shown per categorical facet
const NUMERIC_CHIP_MAX = 12;    // numeric field with ≤ this many distinct → chips
const TEXT_FACET_MAX = 60;      // skip free-text fields with more distinct values

/** Fallback facets derived from the loaded sample, used only when the
 *  collection has no facetable payload index (so the native Facet API can't
 *  serve exact counts). Counts are approximate — they reflect this sample. */
export function computeFacets(points: ScatterPoint[], indexed: Set<string>): FieldFacet[] {
  interface Acc {
    counts: Map<string, FacetValue>;
    numeric: number; bool: number; total: number; min: number; max: number;
  }
  const map = new Map<string, Acc>();
  for (const p of points) {
    if (!p.payload) continue;
    for (const [k, v] of Object.entries(p.payload)) {
      if (v === null || v === undefined) continue;
      const t = typeof v;
      if (t !== 'string' && t !== 'number' && t !== 'boolean') continue;
      let e = map.get(k);
      if (!e) { e = { counts: new Map(), numeric: 0, bool: 0, total: 0, min: Infinity, max: -Infinity }; map.set(k, e); }
      e.total++;
      if (t === 'number') { e.numeric++; const n = v as number; if (n < e.min) e.min = n; if (n > e.max) e.max = n; }
      else if (t === 'boolean') e.bool++;
      const key = String(v);
      const c = e.counts.get(key);
      if (c) c.count++; else e.counts.set(key, { value: v as string | number | boolean, count: 1 });
    }
  }

  const facets: FieldFacet[] = [];
  for (const [field, e] of map) {
    const distinctCount = e.counts.size;
    const isBool = e.bool > e.total * 0.5;
    const isNum = !isBool && e.numeric > e.total * 0.5;
    if (!isBool && !isNum && distinctCount > TEXT_FACET_MAX) continue; // free-text: poor facet
    const asRange = isNum && distinctCount > NUMERIC_CHIP_MAX;
    const values = [...e.counts.values()].sort((a, b) => b.count - a.count).slice(0, CHIP_LIMIT);
    facets.push({
      field,
      render: asRange ? 'range' : 'chips',
      typeLabel: isBool ? 'bool' : isNum ? 'number' : `text · ${distinctCount}`,
      indexed: indexed.has(field),
      source: 'sample',
      values, distinctCount,
      min: isNum ? e.min : undefined,
      max: isNum ? e.max : undefined,
    });
  }
  facets.sort((a, b) => (Number(b.indexed) - Number(a.indexed)) || a.distinctCount - b.distinctCount);
  return facets;
}

/** Translate the condition list into a Qdrant `filter` object (all conditions
 *  combined with `must`). Returns undefined when there is nothing to filter. */
export function toQdrantFilter(conds: FilterCond[]): Record<string, unknown> | undefined {
  const must: Record<string, unknown>[] = [];
  for (const c of conds) {
    if (c.kind === 'match') {
      if (!c.values.length) continue;
      must.push(c.values.length === 1
        ? { key: c.field, match: { value: c.values[0] } }
        : { key: c.field, match: { any: c.values } });
    } else {
      const range: Record<string, number> = {};
      if (c.gte != null) range.gte = c.gte;
      if (c.lte != null) range.lte = c.lte;
      if (Object.keys(range).length) must.push({ key: c.field, range });
    }
  }
  return must.length ? { must } : undefined;
}

/** Client-side predicate mirroring the Qdrant filter, for instant on-map dim
 *  feedback in the moment before the server re-query lands. */
export function matchesFilter(payload: Record<string, unknown> | null, conds: FilterCond[]): boolean {
  if (!conds.length) return true;
  for (const c of conds) {
    const raw = payload?.[c.field];
    if (c.kind === 'match') {
      if (!c.values.length) continue;
      const vals = c.values.map(String);
      const hit = Array.isArray(raw)
        ? raw.some(x => vals.includes(String(x)))
        : raw != null && vals.includes(String(raw));
      if (!hit) return false;
    } else {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return false;
      if (c.gte != null && n < c.gte) return false;
      if (c.lte != null && n > c.lte) return false;
    }
  }
  return true;
}

function matchValues(conds: FilterCond[], field: string): (string | number | boolean)[] {
  const c = conds.find(x => x.field === field);
  return c && c.kind === 'match' ? c.values : [];
}
function rangeOf(conds: FilterCond[], field: string): { gte: number | null; lte: number | null } {
  const c = conds.find(x => x.field === field);
  return c && c.kind === 'range' ? { gte: c.gte, lte: c.lte } : { gte: null, lte: null };
}

interface Props {
  facets: FieldFacet[];
  conds: FilterCond[];
  onChange: (conds: FilterCond[]) => void;
  onClear: () => void;
  loading: boolean;           // facet counts refreshing
  filtering: boolean;         // map re-query in flight
  matchCount: number;
  total: number;
  hint: string | null;        // e.g. "no payload index" fallback note
}

export function FilterBuilder({ facets, conds, onChange, onClear, loading, filtering, matchCount, total, hint }: Props) {
  const setFieldCond = (field: string, cond: FilterCond | null) => {
    const rest = conds.filter(c => c.field !== field);
    onChange(cond ? [...rest, cond] : rest);
  };

  const toggleMatch = (field: string, value: string | number | boolean) => {
    const cur = matchValues(conds, field);
    const key = String(value);
    const next = cur.some(v => String(v) === key) ? cur.filter(v => String(v) !== key) : [...cur, value];
    setFieldCond(field, next.length ? { field, kind: 'match', values: next } : null);
  };

  const setRange = (field: string, gte: number | null, lte: number | null) => {
    setFieldCond(field, gte == null && lte == null ? null : { field, kind: 'range', gte, lte });
  };

  const activeFields = new Set(conds.map(c => c.field));
  const source = facets[0]?.source;

  return (
    <details className="vec-filters" open={facets.length > 0}>
      <summary>
        <span className="vec-filters-title">🔍 Filters</span>
        <span className="vec-filters-meta">
          {conds.length > 0
            ? <><b>{conds.length}</b> active{filtering ? ' · querying…' : <> · <b>{matchCount.toLocaleString()}</b> / {total.toLocaleString()} in view</>}</>
            : <>facet the collection, click a value to filter live</>}
          {source === 'server' && <span className="vec-facet-source live" title="Exact counts from Qdrant Facet API">live</span>}
          {source === 'sample' && <span className="vec-facet-source" title="Approximate counts from the loaded sample">sample</span>}
          {loading && <span className="vec-facet-source">↻</span>}
        </span>
        <span className="vec-filters-caret">▸</span>
      </summary>

      <div className="vec-filters-body">
        {facets.length === 0 && (
          <div className="vec-filter-empty">No facetable payload fields in this collection.</div>
        )}
        {hint && <div className="vec-filter-warn">{hint}</div>}

        <div className="vec-facets">
          {facets.map(f => {
            const sel = matchValues(conds, f.field);
            const r = rangeOf(conds, f.field);
            return (
              <div key={f.field} className={`vec-facet ${activeFields.has(f.field) ? 'active' : ''}`}>
                <div className="vec-facet-head">
                  <span className="vec-facet-name" title={f.field}>{f.field}</span>
                  {f.indexed
                    ? <span className="vec-facet-badge idx" title="Payload-indexed — exact server facets">idx</span>
                    : <span className="vec-facet-badge" title="Not indexed — counts approximated from the sample">~</span>}
                  <span className="vec-facet-type">{f.typeLabel}</span>
                </div>

                {f.render === 'chips' ? (
                  <div className="vec-chips">
                    {f.values.map(v => {
                      const on = sel.some(s => String(s) === String(v.value));
                      return (
                        <button
                          key={String(v.value)}
                          className={`vec-chip ${on ? 'on' : ''}`}
                          onClick={() => toggleMatch(f.field, v.value)}
                          title={`${v.value} — ${v.count.toLocaleString()}`}
                        >
                          <span className="vec-chip-label">{String(v.value)}</span>
                          <span className="vec-chip-count">{v.count.toLocaleString()}</span>
                        </button>
                      );
                    })}
                    {f.distinctCount > f.values.length && (
                      <span className="vec-chip-more">+{(f.distinctCount - f.values.length).toLocaleString()}</span>
                    )}
                  </div>
                ) : (
                  <div className="vec-range">
                    <input
                      type="number" placeholder={f.min != null ? `min ${f.min}` : 'min'}
                      value={r.gte ?? ''}
                      onChange={e => setRange(f.field, e.target.value === '' ? null : Number(e.target.value), r.lte)}
                    />
                    <span className="vec-range-dash">–</span>
                    <input
                      type="number" placeholder={f.max != null ? `max ${f.max}` : 'max'}
                      value={r.lte ?? ''}
                      onChange={e => setRange(f.field, r.gte, e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {conds.length > 0 && (
          <div className="vec-filter-actions">
            <button className="btn btn-secondary" onClick={onClear} disabled={filtering}>Clear all</button>
            <span className="vec-filter-note">
              Clicking a value filters the map live — Qdrant re-samples the matching subset and re-projects it.
              Other facets update to counts within your current filter.
            </span>
          </div>
        )}
      </div>
    </details>
  );
}
