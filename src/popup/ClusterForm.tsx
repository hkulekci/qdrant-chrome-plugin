import { useState } from 'react';
import type { ClusterConfig } from '../lib/types';
import { QdrantApi } from '../lib/qdrant-api';
import { DEFAULT_CACHED_FREQUENCY_MINUTES, MIN_CACHED_FREQUENCY_MINUTES, MAX_CACHED_FREQUENCY_MINUTES } from '../lib/cache-config';

interface Props {
  initial: ClusterConfig | null;
  onSave: (data: { name: string; url: string; apiKey: string; cachedFrequencyMinutes: number }) => void;
  onCancel: () => void;
}

export function ClusterForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name || '');
  const [url, setUrl] = useState(initial?.url || '');
  const [apiKey, setApiKey] = useState(initial?.apiKey || '');
  const [frequency, setFrequency] = useState<number>(initial?.cachedFrequencyMinutes ?? DEFAULT_CACHED_FREQUENCY_MINUTES);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    if (!url) { setError('Please enter a URL'); return; }
    setError(''); setSuccess(''); setTesting(true);
    try {
      const api = new QdrantApi(url, apiKey);
      const ok = await api.healthz();
      if (ok) {
        try {
          const tel = await api.getTelemetry();
          setSuccess(`Connected! Qdrant v${tel.app?.version || 'unknown'}`);
        } catch {
          setSuccess('Connected!');
        }
      } else {
        setError('Connection failed: server returned an error');
      }
    } catch (e) {
      setError(`Connection failed: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url) { setError('Name and URL are required'); return; }
    const clamped = Math.min(MAX_CACHED_FREQUENCY_MINUTES, Math.max(MIN_CACHED_FREQUENCY_MINUTES, Math.round(frequency)));
    onSave({ name, url, apiKey, cachedFrequencyMinutes: clamped });
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>{initial ? 'Edit Cluster' : 'Add Cluster'}</h2>
      <div className="form-field">
        <label>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="My Cluster" required />
      </div>
      <div className="form-field">
        <label>URL</label>
        <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xyz.cloud.qdrant.io" required />
      </div>
      <div className="form-field">
        <label>API Key</label>
        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="your-api-key" />
      </div>
      <div className="form-field">
        <label>
          Background refresh
          <span className="form-field-hint"> &mdash; how often to fetch this cluster (min)</span>
        </label>
        <input
          type="number"
          min={MIN_CACHED_FREQUENCY_MINUTES}
          max={MAX_CACHED_FREQUENCY_MINUTES}
          step={1}
          value={frequency}
          onChange={e => setFrequency(Number(e.target.value) || DEFAULT_CACHED_FREQUENCY_MINUTES)}
        />
      </div>
      {error && <div className="form-error">{error}</div>}
      {success && <div className="form-success">{success}</div>}
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-test" onClick={handleTest} disabled={testing}>{testing ? 'Testing...' : 'Test'}</button>
        <button type="submit" className="btn btn-primary">Save</button>
      </div>
    </form>
  );
}
