import { useState, useEffect } from 'react';
import type { ClusterConfig } from '../lib/types';
import * as storage from '../lib/storage';
import { ClusterList } from './ClusterList';
import { ClusterForm } from './ClusterForm';
import { UpdateBanner } from '../components/UpdateBanner';

export function Popup() {
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editing, setEditing] = useState<ClusterConfig | null>(null);

  const loadClusters = async () => {
    setClusters(await storage.getClusters());
  };

  useEffect(() => { loadClusters(); }, []);

  const handleAdd = () => { setEditing(null); setView('form'); };
  const handleEdit = (c: ClusterConfig) => { setEditing(c); setView('form'); };
  const handleCancel = () => { setView('list'); setEditing(null); };

  const handleSave = async (data: { name: string; url: string; apiKey: string }) => {
    if (editing) {
      await storage.updateCluster(editing.id, data);
    } else {
      await storage.addCluster(data);
    }
    await loadClusters();
    setView('list');
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    await storage.removeCluster(id);
    await loadClusters();
  };

  const handleOpen = (id: string) => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`src/dashboard.html?cluster=${id}`) });
  };

  return (
    <div className="popup">
      <UpdateBanner compact />
      <div className="header">
        <h1>Qdrant Clusters</h1>
        {view === 'list' && <button className="btn-icon" onClick={handleAdd} title="Add Cluster">+</button>}
      </div>
      {view === 'list' ? (
        <ClusterList clusters={clusters} onEdit={handleEdit} onDelete={handleDelete} onOpen={handleOpen} />
      ) : (
        <ClusterForm initial={editing} onSave={handleSave} onCancel={handleCancel} />
      )}
    </div>
  );
}
