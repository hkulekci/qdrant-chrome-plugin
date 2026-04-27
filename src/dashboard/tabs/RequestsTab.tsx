import type { DashboardData } from '../../lib/types';
import { formatNumber } from '../../lib/format';

interface Row {
  protocol: string;
  endpoint: string;
  status: string;
  count: number;
  avg_duration_micros: number;
  min_duration_micros: number;
  max_duration_micros: number;
  total_duration_micros: number;
  last_responded: string;
}

export function RequestsTab({ data }: { data: DashboardData }) {
  const rest = data.telemetry?.requests?.rest?.responses || {};
  const grpc = data.telemetry?.requests?.grpc?.responses || {};

  const rows: Row[] = [];
  for (const [endpoint, statuses] of Object.entries(rest)) {
    for (const [status, stats] of Object.entries(statuses)) {
      rows.push({ protocol: 'REST', endpoint, status, ...stats });
    }
  }
  for (const [endpoint, statuses] of Object.entries(grpc)) {
    for (const [status, stats] of Object.entries(statuses)) {
      rows.push({ protocol: 'gRPC', endpoint, status, ...stats });
    }
  }
  rows.sort((a, b) => (b.count || 0) - (a.count || 0));

  return (
    <div className="card">
      <h2>REST & gRPC Request Statistics</h2>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>No request data available</p>
      ) : (
        <div className="requests-table-wrap">
          <table className="requests-table">
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Count</th>
                <th style={{ textAlign: 'right' }}>Avg (us)</th>
                <th style={{ textAlign: 'right' }}>Min (us)</th>
                <th style={{ textAlign: 'right' }}>Max (us)</th>
                <th style={{ textAlign: 'right' }}>Total (ms)</th>
                <th>Last Response</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const statusClass = r.status.startsWith('2') ? 'green' : r.status.startsWith('4') ? 'yellow' : 'red';
                const lastResp = r.last_responded ? new Date(r.last_responded).toLocaleString() : 'N/A';
                return (
                  <tr key={i}>
                    <td className="proto">{r.protocol}</td>
                    <td className="endpoint" title={r.endpoint}>{r.endpoint}</td>
                    <td><span className={`status-badge ${statusClass}`}>{r.status}</span></td>
                    <td className="number">{formatNumber(r.count)}</td>
                    <td className="number">{r.avg_duration_micros?.toFixed(1) ?? 'N/A'}</td>
                    <td className="number">{r.min_duration_micros ?? 'N/A'}</td>
                    <td className="number">{r.max_duration_micros ?? 'N/A'}</td>
                    <td className="number">{r.total_duration_micros ? (r.total_duration_micros / 1000).toFixed(1) : 'N/A'}</td>
                    <td className="last-response" title={lastResp}>{lastResp}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
