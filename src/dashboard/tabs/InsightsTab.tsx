import { useMemo, useState } from 'react';
import type { Insight, InsightLevel, InsightsFilter } from '../../lib/types';
import { DEFAULT_INSIGHTS_FILTER } from '../../lib/types';
import { AskAIDialog } from '../AskAIDialog';

const ICONS: Record<InsightLevel, string> = {
  critical: '\u26d4',
  warning: '\u26a0\ufe0f',
  performance: '\u26a1',
  info: '\u2139\ufe0f',
};

const LEVEL_LABEL: Record<InsightLevel, string> = {
  critical: 'Critical',
  warning: 'Warning',
  performance: 'Performance',
  info: 'Info',
};

const ALL_LEVELS: InsightLevel[] = ['critical', 'warning', 'performance', 'info'];

function InsightItem({ insight, onAsk }: { insight: Insight; onAsk: (ins: Insight) => void }) {
  return (
    <div className={`insight-item ${insight.level}`}>
      <span className="insight-icon">{ICONS[insight.level]}</span>
      <div className="insight-content">
        <div className="insight-title">
          {insight.collection && <span className="insight-scope">{insight.collection}</span>}
          {insight.shard !== undefined && <span className="insight-scope">shard {insight.shard}</span>}
          {insight.title}
          <span className={`insight-category-badge ${insight.category}`}>{insight.category}</span>
        </div>
        <div className="insight-detail">{insight.detail}</div>
      </div>
      <button
        className="insight-ask-ai"
        onClick={() => onAsk(insight)}
        title="Ask an AI about this insight"
      >
        <span className="ask-ai-sparkle">\u2728</span>
        <span className="ask-ai-text">Ask AI</span>
      </button>
    </div>
  );
}

interface Props {
  insights: Insight[];
  filter: InsightsFilter;
  onFilterChange: (filter: InsightsFilter) => void;
  collections: string[];
}

export function InsightsTab({ insights, filter, onFilterChange, collections }: Props) {
  const [asking, setAsking] = useState<Insight | null>(null);
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of insights) set.add(i.category);
    return Array.from(set).sort();
  }, [insights]);

  const filtered = useMemo(() => {
    return insights.filter(i => {
      if (filter.levels.length > 0 && !filter.levels.includes(i.level)) return false;
      if (filter.collection && i.collection !== filter.collection) return false;
      if (filter.category && i.category !== filter.category) return false;
      return true;
    });
  }, [insights, filter]);

  const toggleLevel = (level: InsightLevel) => {
    const next = filter.levels.includes(level)
      ? filter.levels.filter(l => l !== level)
      : [...filter.levels, level];
    onFilterChange({ ...filter, levels: next });
  };

  const clearFilters = () => onFilterChange(DEFAULT_INSIGHTS_FILTER);

  const isFiltered = filter.levels.length < ALL_LEVELS.length
    || filter.collection !== null
    || filter.category !== null;

  const grouped = useMemo(() => {
    if (filter.group === 'flat') return null;
    const groups: Record<string, Insight[]> = {};
    for (const ins of filtered) {
      const key = filter.group === 'collection'
        ? (ins.collection || '_cluster')
        : ins.level;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ins);
    }
    return groups;
  }, [filtered, filter.group]);

  if (insights.length === 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--text-secondary)' }}>No insights detected. Your cluster is looking healthy.</p>
      </div>
    );
  }

  const groupOrder: string[] = filter.group === 'severity'
    ? ALL_LEVELS
    : filter.group === 'collection'
      ? ['_cluster', ...collections]
      : [];

  return (
    <>
      <div className="insights-filter-bar">
        <div className="insights-filter-row">
          <div className="insights-filter-group">
            <span className="insights-filter-label">Severity</span>
            <div className="insights-level-pills">
              {ALL_LEVELS.map(level => {
                const active = filter.levels.includes(level);
                return (
                  <button
                    key={level}
                    className={`insights-level-pill ${level} ${active ? 'active' : ''}`}
                    onClick={() => toggleLevel(level)}
                  >
                    {ICONS[level]} {LEVEL_LABEL[level]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="insights-filter-group">
            <span className="insights-filter-label">Collection</span>
            <select
              className="insights-select"
              value={filter.collection ?? ''}
              onChange={(e) => onFilterChange({ ...filter, collection: e.target.value || null })}
            >
              <option value="">All collections</option>
              <option value="_cluster">Cluster-wide only</option>
              {collections.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="insights-filter-group">
            <span className="insights-filter-label">Category</span>
            <select
              className="insights-select"
              value={filter.category ?? ''}
              onChange={(e) => onFilterChange({ ...filter, category: e.target.value || null })}
            >
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="insights-filter-group">
            <span className="insights-filter-label">Group by</span>
            <div className="insights-group-toggle">
              {(['severity', 'collection', 'flat'] as const).map(g => (
                <button
                  key={g}
                  className={filter.group === g ? 'active' : ''}
                  onClick={() => onFilterChange({ ...filter, group: g })}
                >
                  {g === 'flat' ? 'None' : g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {isFiltered && (
            <button className="insights-clear-btn" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        <div className="insights-filter-summary">
          Showing <strong>{filtered.length}</strong> of {insights.length} insight{insights.length === 1 ? '' : 's'}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>No insights match the current filters.</p>
        </div>
      ) : filter.group === 'flat' || !grouped ? (
        <div className="insights-list">
          {filtered.map((ins, i) => <InsightItem key={i} insight={ins} onAsk={setAsking} />)}
        </div>
      ) : (
        groupOrder
          .filter(k => grouped[k]?.length > 0)
          .concat(Object.keys(grouped).filter(k => !groupOrder.includes(k)))
          .map(key => (
            <div key={key} className="insights-group">
              <div className="insights-group-header">
                <span className="insights-group-title">
                  {key === '_cluster' ? 'Cluster-wide' : filter.group === 'severity' ? LEVEL_LABEL[key as InsightLevel] : key}
                </span>
                <span className="insights-group-count">{grouped[key].length}</span>
              </div>
              <div className="insights-list">
                {grouped[key].map((ins, i) => <InsightItem key={i} insight={ins} onAsk={setAsking} />)}
              </div>
            </div>
          ))
      )}
      <AskAIDialog insight={asking} onClose={() => setAsking(null)} />
    </>
  );
}
