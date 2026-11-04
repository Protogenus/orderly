import { useCallback, useEffect, useState } from 'react';
import type { InboxBuckets, Order, OrderStatus } from '../../../shared/types.js';
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, canTransition } from '../../../shared/constants.js';
import { formatCents } from '../../../shared/format.js';
import { useToast, errMsg } from '../components/Toast';
import { EmptyState, StatusPill } from '../components/ui';

type Row = Order & { item_count: number };

const BOARD_COLUMNS: OrderStatus[] = ['new', 'confirmed', 'awaiting_production', 'in_production', 'ready_to_fulfill', 'packing', 'on_hold'];

function isOverdue(o: Row): boolean {
  if (!o.requested_date) return false;
  return o.requested_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function OrderCard({ order, onOpen }: { order: Row; onOpen: (id: string) => void }) {
  const overdue = isOverdue(order);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/order-id', order.id);
        e.dataTransfer.setData('text/order-status', order.status);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen(order.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(order.id); }}
      tabIndex={0}
      role="button"
      aria-label={`Order ${order.order_number}`}
      style={{
        border: `1px solid ${overdue ? 'var(--danger)' : 'var(--border)'}`,
        borderLeft: overdue ? '4px solid var(--danger)' : undefined,
        background: overdue ? 'var(--danger-soft)' : 'var(--surface)',
        borderRadius: 8,
        padding: 8,
        marginBottom: 6,
        cursor: 'grab',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <strong className="mono">{order.order_number}</strong>
        <span className="num">{formatCents(order.grand_total_cents)}</span>
      </div>
      <div style={{ color: 'var(--muted)', marginTop: 2 }}>{order.customer_name ?? 'No customer'} · {order.item_count} item{order.item_count === 1 ? '' : 's'}</div>
      {order.requested_date && (
        <div style={{ marginTop: 2, color: overdue ? 'var(--danger)' : 'var(--muted)', fontWeight: overdue ? 700 : 400 }}>
          {overdue ? '⚠ Overdue: ' : 'Due: '}{order.requested_date}
        </div>
      )}
    </div>
  );
}

export function InboxPage({ onOpenOrder }: { onOpenOrder: (id: string) => void }) {
  const { notify, notifyError } = useToast();
  const [buckets, setBuckets] = useState<InboxBuckets | null>(null);
  const [boardOrders, setBoardOrders] = useState<Row[]>([]);
  const [view, setView] = useState<'table' | 'board'>('table');
  const [bucketFilter, setBucketFilter] = useState<keyof InboxBuckets | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState<OrderStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, list] = await Promise.all([
        window.orderly.getInbox(),
        window.orderly.listOrders({ statuses: BOARD_COLUMNS, limit: 500 }),
      ]);
      setBuckets(b);
      setBoardOrders(list.rows);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    load();
  }, [load]);

  async function dropOn(status: OrderStatus, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/order-id');
    const from = e.dataTransfer.getData('text/order-status') as OrderStatus;
    if (!id || from === status) return;
    if (!canTransition(from, status)) {
      notifyError(`Cannot move an order from "${ORDER_STATUS_LABELS[from]}" to "${ORDER_STATUS_LABELS[status]}".`);
      return;
    }
    try {
      await window.orderly.setOrderStatus(id, status, 'Moved from inbox board.');
      notify(`Order moved to ${ORDER_STATUS_LABELS[status]}.`);
      load();
    } catch (err) {
      notifyError(errMsg(err));
    }
  }

  const bucketCards: { key: keyof InboxBuckets; label: string; tone: 'pink' | 'amber' | 'sky' | 'gray' }[] = [
    { key: 'unreviewed', label: 'Unreviewed', tone: 'sky' },
    { key: 'needs_attention', label: 'Needs attention', tone: 'pink' },
    { key: 'missing_info', label: 'Missing info', tone: 'amber' },
    { key: 'payment_issues', label: 'Payment issues', tone: 'amber' },
    { key: 'approaching_due', label: 'Due soon', tone: 'pink' },
  ];

  const tableRows: Row[] = bucketFilter && buckets ? buckets[bucketFilter] : boardOrders.filter((o) => o.status === 'new' || o.status === 'draft');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-sub">Incoming demand — review, triage, and move orders forward.</p>
        </div>
        <div className="btn-row" role="tablist" aria-label="Inbox view">
          <button className={view === 'table' ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setView('table')} role="tab" aria-selected={view === 'table'}>Table</button>
          <button className={view === 'board' ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setView('board')} role="tab" aria-selected={view === 'board'}>Board</button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : !buckets ? (
        <EmptyState title="Inbox unavailable" body="Could not load the inbox. Try again." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {bucketCards.map((b) => (
              <button
                key={b.key}
                className="btn btn-sm"
                style={bucketFilter === b.key ? { borderColor: 'var(--ink)', fontWeight: 700 } : undefined}
                onClick={() => { setBucketFilter(bucketFilter === b.key ? null : b.key); setView('table'); }}
              >
                {b.label} <StatusPill tone={b.tone}>{buckets[b.key].length}</StatusPill>
              </button>
            ))}
            {bucketFilter && (
              <button className="btn btn-sm" onClick={() => setBucketFilter(null)}>Clear filter ✕</button>
            )}
          </div>

          {view === 'table' ? (
            tableRows.length === 0 ? (
              <EmptyState
                title={bucketFilter ? 'Nothing here' : 'Inbox zero'}
                body={bucketFilter ? 'No orders match this filter right now.' : 'No new or draft orders waiting. New orders will appear here for triage.'}
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Items</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th>Requested</th><th>Source</th></tr></thead>
                  <tbody>
                    {tableRows.map((o) => (
                      <tr key={o.id} onClick={() => onOpenOrder(o.id)} style={{ cursor: 'pointer' }} tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') onOpenOrder(o.id); }}>
                        <td className="mono" style={{ fontWeight: 600 }}>{o.order_number}</td>
                        <td>{o.customer_name ?? <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                        <td>{o.order_date}</td>
                        <td>{o.item_count}</td>
                        <td className="num">{formatCents(o.grand_total_cents)}</td>
                        <td><StatusPill tone={o.status === 'new' ? 'sky' : 'gray'}>{ORDER_STATUS_LABELS[o.status]}</StatusPill></td>
                        <td style={{ color: isOverdue(o) ? 'var(--danger)' : undefined, fontWeight: isOverdue(o) ? 700 : undefined }}>
                          {o.requested_date ?? '—'}
                        </td>
                        <td style={{ color: 'var(--muted)' }}>{o.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
              {BOARD_COLUMNS.map((status) => {
                const col = boardOrders.filter((o) => o.status === status);
                return (
                  <div
                    key={status}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(status); }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => dropOn(status, e)}
                    style={{
                      flex: '0 0 240px',
                      background: dragOver === status ? 'var(--sky-soft)' : 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: 8,
                      minHeight: 200,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 8 }}>
                      {ORDER_STATUS_LABELS[status]} ({col.length})
                    </div>
                    {col.map((o) => <OrderCard key={o.id} order={o} onOpen={onOpenOrder} />)}
                    {col.length === 0 && <div style={{ color: 'var(--faint)', fontSize: 12 }}>Drop orders here</div>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
