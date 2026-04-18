import type { DashboardData } from '../../lib/types';
import { formatBytes, formatDuration } from '../../lib/format';
import { SummaryStats } from '../SummaryStats';

export function OverviewTab({ data }: { data: DashboardData }) {
  const app = data.telemetry?.app;
  const sys = app?.system;
  const features = app?.features || {};
  const mem = data.telemetry?.memory;
  const ramBytes = sys?.ram_size ? sys.ram_size * 1024 : null;

  const startup = app?.startup ? new Date(app.startup).toLocaleString() : 'N/A';
  const uptime = app?.startup ? formatDuration(Date.now() - new Date(app.startup).getTime()) : 'N/A';

  const memItems = [
    { name: 'Resident', bytes: mem?.resident_bytes, color: '#e94560', desc: 'Physical memory used' },
    { name: 'Active', bytes: mem?.active_bytes, color: '#60a5fa', desc: 'Actively used memory' },
    { name: 'Allocated', bytes: mem?.allocated_bytes, color: '#4ade80', desc: 'Heap allocations' },
    { name: 'Metadata', bytes: mem?.metadata_bytes, color: '#fbbf24', desc: 'Allocator metadata' },
    { name: 'Retained', bytes: mem?.retained_bytes, color: '#8b5cf6', desc: 'Retained by allocator' },
  ];
  const maxBytes = ramBytes || Math.max(...memItems.map(i => i.bytes || 0), 1);

  return (
    <>
      <SummaryStats data={data} />
      <div className="grid-2">
      <div className="card">
        <h2>System Information</h2>
        <table className="info-table">
          <tbody>
            <tr><td>Version</td><td>{app?.version || 'N/A'}</td></tr>
            <tr><td>Distribution</td><td>{sys?.distribution || 'N/A'} {sys?.distribution_version || ''}</td></tr>
            <tr><td>CPU Cores</td><td>{sys?.cores || 'N/A'}</td></tr>
            <tr><td>CPU Flags</td><td>{sys?.cpu_flags || 'N/A'}</td></tr>
            <tr><td>RAM</td><td>{sys?.ram_size ? formatBytes(sys.ram_size * 1024) : 'N/A'}</td></tr>
            <tr><td>Disk</td><td>{sys?.disk_size ? formatBytes(sys.disk_size * 1024) : 'N/A'}</td></tr>
            <tr><td>Docker</td><td>{sys?.is_docker ? 'Yes' : 'No'}</td></tr>
            <tr><td>GPU</td><td>{features.gpu ? 'Enabled' : 'Disabled'}</td></tr>
            <tr><td>RocksDB</td><td>{features.rocksdb ? 'Enabled' : 'Disabled'}</td></tr>
            <tr><td>Recovery Mode</td><td>{features.recovery_mode ? 'Yes' : 'No'}</td></tr>
            <tr><td>JWT RBAC</td><td>{app?.jwt_rbac ? 'Enabled' : 'Disabled'}</td></tr>
            <tr><td>Started</td><td>{startup}</td></tr>
            <tr><td>Uptime</td><td>{uptime}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Memory Usage</h2>
        {ramBytes && (
          <div className="memory-bar-container" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="memory-bar-label"><span className="name">Total RAM</span><span className="value">{formatBytes(ramBytes)}</span></div>
            <div className="memory-bar"><div className="memory-bar-fill" style={{ width: '100%', background: 'rgba(255,255,255,0.15)' }} /></div>
          </div>
        )}
        {memItems.map(item => {
          const pct = ((item.bytes || 0) / maxBytes * 100).toFixed(1);
          return (
            <div key={item.name} className="memory-bar-container">
              <div className="memory-bar-label">
                <span className="name">{item.name} <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>{item.desc}</span></span>
                <span className="value">{item.bytes ? formatBytes(item.bytes) : 'N/A'}</span>
              </div>
              <div className="memory-bar"><div className="memory-bar-fill" style={{ width: `${pct}%`, background: item.color }} /></div>
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}
