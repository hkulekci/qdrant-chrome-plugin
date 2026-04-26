import { useState, useEffect } from 'react';
import type { ClusterConfig, ClusterRefreshState } from '../lib/types';
import { QdrantApi } from '../lib/qdrant-api';

interface Props {
  clusters: ClusterConfig[];
  refreshStates: Record<string, ClusterRefreshState>;
  onEdit: (c: ClusterConfig) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}

function formatRefreshState(state?: ClusterRefreshState): string {
  if (!state?.lastSuccessAt) return 'No cached snapshot yet';
  return `Cached ${new Date(state.lastSuccessAt).toLocaleString()}`;
}

export function ClusterList({ clusters, refreshStates, onEdit, onDelete, onOpen }: Props) {
  const [health, setHealth] = useState<Record<string, 'checking' | 'online' | 'offline'>>({});

  useEffect(() => {
    const initial: Record<string, 'checking' | 'online' | 'offline'> = {};
    clusters.forEach(c => { initial[c.id] = 'checking'; });
    setHealth(initial);

    clusters.forEach(async (c) => {
      try {
        const api = new QdrantApi(c.url, c.apiKey);
        const ok = await api.healthz();
        setHealth(h => ({ ...h, [c.id]: ok ? 'online' : 'offline' }));
      } catch {
        setHealth(h => ({ ...h, [c.id]: 'offline' }));
      }
    });
  }, [clusters]);

  if (clusters.length === 0) {
    return (
      <div className="empty-state">
        <p>No clusters configured</p>
        <p className="hint">Click + to add your first cluster</p>
      </div>
    );
  }

  return (
    <div className="cluster-list">
      {clusters.map(c => (
        <div key={c.id} className="cluster-item">
          <div className={`cluster-status-dot ${health[c.id] || 'checking'}`} />
          <div className="cluster-item-info" onClick={() => onOpen(c.id)}>
            <div className="cluster-item-name">{c.name}</div>
            <div className="cluster-item-url">{c.url}</div>
            <div className="cluster-item-cache">{formatRefreshState(refreshStates[c.id])}</div>
          </div>
          <div className="cluster-item-actions">
            <button className="edit-btn" onClick={(e) => { e.stopPropagation(); onEdit(c); }} title="Edit">&#9998;</button>
            <button className="delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }} title="Delete">&#10005;</button>
          </div>
        </div>
      ))}
    </div>
  );
}
