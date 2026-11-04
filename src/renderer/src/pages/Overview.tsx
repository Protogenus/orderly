import { useCallback, useEffect, useState } from 'react';
import type { DashboardStats } from '../../../shared/types.js';
import { ORDER_STATUS_LABELS } from '../../../shared/constants.js';
import { useToast, errMsg } from '../components/Toast';
import { EmptyState } from '../components/ui';

type RangePreset = 'today' | 'week' | 'month' | 'custom';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(p: RangePreset, custom: { from: string; to: string }): { from: string; to: string } {
  const now = new Date();
  if (p === 'today') return { from: iso(now), to: iso(now) };
  if (p === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { from: iso(d), to: iso(now) };
  }
  if (p === 'month') {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    return { from: iso(d), to: iso(now) };
  }
  return custom;
}

function Tile({ label, value, tone, onClick }: { label: string; value: number; tone?: 'danger' | 'sage'; onClick?: () => void }) {
  return (
    <button
      className="card"
      onClick={onClick}
      disabled={!onClick}
      style={{
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        borderLeft: tone === 'danger' && value > 0 ? '4px solid var(--danger)' : undefined,
        padding: '10px 12px',
      }}
    >
      <div className="num" style={{ fontSize: 26, color: tone === 'danger' && value > 0 ? 'var(--danger)' : undefined }}>
        {value}
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>{label}</div>
    </button>
  );
}

export function OverviewPage({ onGo }: { onGo: (page: 'inbox' | 'fulfillment' | 'production' | 'orders') => void }) {
  const { notifyError } = useToast();
  const [preset, setPreset] = useState<RangePreset>('week');
  const [custom, setCustom] = useState(() => {
    const t = iso(new Date());
    return { from: t, to: t };
  });
  const [stats, setStats] = useState<DashboardStats | null>(null);

  const load = useCallback(async () => {
    const r = presetRange(preset, custom);
    try {
      setStats(await window.orderly.getDashboardStats(r.from, r.to));
    } catch (e) {
      notifyError(errMsg(e));
    }
  }, [preset, custom, notifyError]);

  useEffect(() => {
    void load();
  }, [load]);

  const r = presetRange(preset, custom);
  return (
    <div>
      <div className="page-head">
        <h1>Overview</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {(['today', 'week', 'month', 'custom'] as RangePreset[]).map((p) => (
            <button
              key={p}
              className={preset === p ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              onClick={() => setPreset(p)}
            >
              {p === 'today' ? 'Today' : p === 'week' ? '7 days' : p === 'month' ? '30 days' : 'Custom'}
            </button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" className="input" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From date" />
              <input type="date" className="input" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To date" />
            </>
          )}
        </div>
      </div>

      {!stats ? (
        <EmptyState title="Loading…" body="Reading live figures from the database." />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            <Tile label="Open orders" value={stats.open_orders} onClick={() => onGo('inbox')} />
            <Tile label="Awaiting processing" value={stats.awaiting_processing} onClick={() => onGo('inbox')} />
            <Tile label="Awaiting production" value={stats.awaiting_production} onClick={() => onGo('production')} />
            <Tile label="Ready for packing" value={stats.ready_for_packing} onClick={() => onGo('fulfillment')} />
            <Tile label="Awaiting shipment" value={stats.awaiting_shipment} onClick={() => onGo('fulfillment')} />
            <Tile label="Overdue" value={stats.overdue_orders} tone="danger" onClick={() => onGo('inbox')} />
            <Tile label={`Completed (${r.from === r.to ? 'today' : 'in range'})`} value={stats.completed_recent} tone="sage" onClick={() => onGo('orders')} />
          </div>

          <h2 style={{ margin: '18px 0 8px', fontSize: 15 }}>Recent activity</h2>
          {stats.recent_activity.length === 0 ? (
            <EmptyState title="No activity in this range" body="Status changes will appear here." />
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Moved to</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_activity.map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{a.order_number}</td>
                      <td>{ORDER_STATUS_LABELS[a.to_status] ?? a.to_status}</td>
                      <td style={{ color: 'var(--muted)' }}>{a.created_at.replace('T', ' ').slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
