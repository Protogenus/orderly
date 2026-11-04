import { useCallback, useEffect, useState } from 'react';
import type { Order, OrderFilters, OrderStatus, OrderStatusEvent } from '../../../shared/types.js';
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, PRIORITY_LABELS } from '../../../shared/constants.js';
import { formatCents } from '../../../shared/format.js';
import { useToast, errMsg } from '../components/Toast';
import { ConfirmDialog, EmptyState, StatusPill } from '../components/ui';
import { Field, TextInput, TextArea, Select, MoneyInput, Money } from '../components/forms';
import { OrderEditor } from './OrderEditor';

type Row = Order & { item_count: number };

function statusTone(s: OrderStatus): 'sage' | 'amber' | 'pink' | 'sky' | 'gray' | 'danger' {
  switch (s) {
    case 'completed': case 'delivered': return 'sage';
    case 'shipped': return 'sky';
    case 'canceled': return 'gray';
    case 'on_hold': return 'amber';
    case 'draft': return 'gray';
    default: return 'pink';
  }
}

function isOverdue(o: Row): boolean {
  if (!o.requested_date) return false;
  if (['completed', 'canceled', 'delivered'].includes(o.status)) return false;
  return o.requested_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function OrderDetail({ order, onChanged, onBack }: { order: Order; onChanged: (o: Order) => void; onBack: () => void }) {
  const { notify, notifyError } = useToast();
  const [history, setHistory] = useState<OrderStatusEvent[]>([]);
  const [notes, setNotes] = useState<{ id: string; kind: string; body: string; created_at: string }[]>([]);
  const [payments, setPayments] = useState<{ id: string; amount_cents: number; method: string | null; reference: string | null; paid_at: string; note: string | null }[]>([]);
  const [nextStatus, setNextStatus] = useState<OrderStatus | ''>('');
  const [statusNote, setStatusNote] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteKind, setNoteKind] = useState<'internal' | 'customer'>('internal');
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [fulfillments, setFulfillments] = useState<import('../../../shared/types.js').FulfillmentDetail[]>([]);

  const load = useCallback(async () => {
    try {
      const [h, n, p, f] = await Promise.all([
        window.orderly.getStatusHistory(order.id),
        window.orderly.listNotes(order.id),
        window.orderly.listPayments(order.id),
        window.orderly.getFulfillmentsForOrder(order.id),
      ]);
      setHistory(h);
      setNotes(n);
      setPayments(p);
      setFulfillments(f);
    } catch (e) {
      notifyError(errMsg(e));
    }
  }, [order.id, notifyError]);

  useEffect(() => {
    load();
  }, [load]);

  const transitions = ORDER_TRANSITIONS[order.status];
  const editable = !['canceled', 'completed'].includes(order.status);

  async function advance() {
    if (!nextStatus) return;
    try {
      const o = await window.orderly.setOrderStatus(order.id, nextStatus, statusNote || undefined);
      setNextStatus('');
      setStatusNote('');
      onChanged(o);
      notify(`Order moved to ${ORDER_STATUS_LABELS[nextStatus]}.`);
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function cancel() {
    setConfirmCancel(false);
    try {
      const o = await window.orderly.cancelOrder(order.id, cancelNote || undefined);
      onChanged(o);
      notify('Order canceled.');
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function duplicate() {
    try {
      const o = await window.orderly.duplicateOrder(order.id);
      notify(`Duplicated as ${o.order_number}.`);
      onChanged(o);
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function archive() {
    setConfirmArchive(false);
    try {
      const o = await window.orderly.archiveOrder(order.id, !order.archived);
      onChanged(o);
      notify(order.archived ? 'Order unarchived.' : 'Order archived.');
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function addNote() {
    if (!noteBody.trim()) return;
    try {
      await window.orderly.addNote(order.id, { kind: noteKind, body: noteBody.trim() });
      setNoteBody('');
      notify('Note added.');
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function addPayment() {
    if (payAmount <= 0) {
      notifyError('Enter a payment amount greater than zero.');
      return;
    }
    try {
      const r = await window.orderly.addPayment(order.id, {
        amount_cents: payAmount,
        method: payMethod || null,
        paid_at: new Date().toISOString().slice(0, 10),
      });
      setPayAmount(0);
      setPayMethod('');
      onChanged(r.order);
      notify('Payment recorded.');
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 6 }}>← All orders</button>
          <h1 className="page-title mono">{order.order_number}</h1>
          <p className="page-sub">
            {order.customer_name ?? 'No customer'} · {order.order_date} · {order.source}
            {isOverdue(order as Row) && <> · <StatusPill tone="danger">Overdue</StatusPill></>}
          </p>
        </div>
        <div className="btn-row">
          <StatusPill tone={statusTone(order.status)}>{ORDER_STATUS_LABELS[order.status]}</StatusPill>
          <StatusPill tone={order.priority === 'urgent' ? 'danger' : order.priority === 'high' ? 'amber' : 'gray'}>
            {PRIORITY_LABELS[order.priority]}
          </StatusPill>
        </div>
      </div>

      <div className="card">
        <h3>Move this order</h3>
        <div className="btn-row">
          <Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as OrderStatus | '')} aria-label="Next status" disabled={transitions.length === 0}>
            <option value="">— Choose next status —</option>
            {transitions.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
          </Select>
          <TextInput value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="Note (optional)" style={{ flex: 1 }} aria-label="Status note" />
          <button className="btn btn-primary btn-sm" onClick={advance} disabled={!nextStatus}>Apply</button>
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          {editable && <button className="btn btn-sm" onClick={duplicate}>Duplicate</button>}
          {editable && <button className="btn btn-sm" onClick={() => setConfirmCancel(true)}>Cancel order</button>}
          <button className="btn btn-sm" onClick={() => setConfirmArchive(true)}>{order.archived ? 'Unarchive' : 'Archive'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          <div className="card">
            <h3>Items ({order.items.length})</h3>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th style={{ textAlign: 'right' }}>Unit</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.description}{i.requires_production && <div><StatusPill tone="amber">Production</StatusPill></div>}</td>
                      <td className="mono" style={{ color: 'var(--muted)' }}>{i.sku ?? '—'}</td>
                      <td>{i.quantity}</td>
                      <td className="num">{formatCents(i.unit_price_cents)}</td>
                      <td className="num">{formatCents(i.line_total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>History</h3>
            {history.length === 0 ? <p style={{ color: 'var(--muted)' }}>No events.</p> : (
              <div style={{ fontSize: 12 }}>
                {history.map((h) => (
                  <div key={h.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <strong>{h.from_status ? ORDER_STATUS_LABELS[h.from_status as OrderStatus] + ' → ' : ''}{ORDER_STATUS_LABELS[h.to_status as OrderStatus]}</strong>
                    <span style={{ color: 'var(--muted)' }}> · {new Date(h.created_at).toLocaleString()}</span>
                    {h.note && <div style={{ color: 'var(--ink)' }}>{h.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Notes</h3>
            <div className="btn-row" style={{ marginBottom: 8 }}>
              <Select value={noteKind} onChange={(e) => setNoteKind(e.target.value as 'internal' | 'customer')} aria-label="Note kind">
                <option value="internal">Internal</option><option value="customer">Customer-facing</option>
              </Select>
              <TextInput value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Add a note…" style={{ flex: 1 }} aria-label="Note text" />
              <button className="btn btn-sm btn-primary" onClick={addNote}>Add</button>
            </div>
            {notes.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 12 }}>No notes yet.</p> : notes.map((n) => (
              <div key={n.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <StatusPill tone={n.kind === 'internal' ? 'gray' : 'sky'}>{n.kind}</StatusPill>{' '}
                <span style={{ color: 'var(--muted)' }}>{new Date(n.created_at).toLocaleString()}</span>
                <div>{n.body}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: '0 1 340px', minWidth: 300 }}>
          <div className="card">
            <h3>Financials</h3>
            <dl className="kv">
              <dt>Subtotal</dt><dd className="num"><Money cents={order.subtotal_cents} /></dd>
              <dt>Discount</dt><dd className="num">−<Money cents={order.discount_cents} /></dd>
              <dt>Shipping</dt><dd className="num"><Money cents={order.shipping_cents} /></dd>
              <dt>Tax</dt><dd className="num"><Money cents={order.tax_cents} /></dd>
              <dt><strong>Total</strong></dt><dd className="num"><strong><Money cents={order.grand_total_cents} /></strong></dd>
              <dt>Paid</dt><dd className="num"><Money cents={order.paid_cents} /></dd>
              <dt><strong>Balance</strong></dt><dd className="num"><strong><Money cents={order.balance_cents} /></strong></dd>
              <dt>Payment</dt><dd>{order.payment_status}</dd>
            </dl>
            {editable && (
              <>
                <hr className="divider" />
                <h3>Record payment</h3>
                <div className="btn-row">
                  <MoneyInput cents={payAmount} onChange={setPayAmount} ariaLabel="Payment amount" />
                  <TextInput value={payMethod} onChange={(e) => setPayMethod(e.target.value)} placeholder="Method" style={{ width: 100 }} aria-label="Payment method" />
                  <button className="btn btn-sm btn-primary" onClick={addPayment}>Record</button>
                </div>
                <p className="hint" style={{ fontSize: 11, color: 'var(--muted)' }}>Informational only — Orderly never processes payments.</p>
              </>
            )}
            {payments.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {payments.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{p.paid_at}{p.method ? ` · ${p.method}` : ''}{p.reference ? ` · ${p.reference}` : ''}</span>
                    <span className="num">{formatCents(p.amount_cents)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Fulfillment ({fulfillments.length})</h3>
            {fulfillments.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Nothing packed yet. Use the Fulfillment workspace to pack and ship.</p>
            ) : (
              fulfillments.map((f) => (
                <div key={f.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <StatusPill tone={f.status === 'shipped' ? 'sage' : f.status === 'ready_to_ship' ? 'sky' : 'amber'}>
                    {f.status.replace(/_/g, ' ')}
                  </StatusPill>{' '}
                  {f.items.reduce((s, i) => s + i.quantity_packed, 0)} item(s) packed
                  {f.shipment?.tracking_number && <span className="mono" style={{ color: 'var(--muted)' }}> · {f.shipment.tracking_number}</span>}
                </div>
              ))
            )}
          </div>

          <div className="card">
            <h3>Shipping</h3>
            {order.ship_line1 ? (
              <div style={{ fontSize: 13 }}>
                {order.ship_recipient && <div><strong>{order.ship_recipient}</strong></div>}
                <div>{order.ship_line1}</div>
                {order.ship_line2 && <div>{order.ship_line2}</div>}
                <div>{[order.ship_city, order.ship_state, order.ship_postal].filter(Boolean).join(', ')}</div>
                {order.ship_country && <div>{order.ship_country}</div>}
                {order.ship_method && <div style={{ marginTop: 4, color: 'var(--muted)' }}>Via {order.ship_method}</div>}
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>No shipping address recorded.</p>
            )}
          </div>

          {(order.internal_notes || order.customer_notes || order.tags.length > 0 || order.requested_date) && (
            <div className="card">
              <h3>Details</h3>
              <dl className="kv">
                {order.requested_date && <><dt>Requested</dt><dd>{order.requested_date}</dd></>}
                {order.tags.length > 0 && <><dt>Tags</dt><dd>{order.tags.join(', ')}</dd></>}
              </dl>
              {order.internal_notes && <div style={{ marginTop: 6, fontSize: 12 }}><strong>Internal:</strong> {order.internal_notes}</div>}
              {order.customer_notes && <div style={{ marginTop: 6, fontSize: 12 }}><strong>Customer:</strong> {order.customer_notes}</div>}
            </div>
          )}
        </div>
      </div>

      {confirmCancel && (
        <ConfirmDialog
          title="Cancel order"
          body={`Cancel order ${order.order_number}? This keeps the record and its history. Line items already in production or shipped should be handled first.`}
          confirmLabel="Cancel order"
          danger
          onConfirm={cancel}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
      {confirmArchive && (
        <ConfirmDialog
          title={order.archived ? 'Unarchive order' : 'Archive order'}
          body={order.archived ? `Restore ${order.order_number} to the active list?` : `Archive ${order.order_number}? It will be hidden from the active list but kept in history and reports.`}
          confirmLabel={order.archived ? 'Unarchive' : 'Archive'}
          onConfirm={archive}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
    </div>
  );
}

export function OrdersPage({ openRequest, onOpenConsumed }: { openRequest?: string | null; onOpenConsumed?: () => void }) {
  const { notify, notifyError } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<OrderFilters['sort']>('order_date');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'detail' | 'new' | 'edit'>('list');
  const [selected, setSelected] = useState<Order | null>(null);

  const load = useCallback(async () => {
    try {
      const filters: OrderFilters = {
        search: search || undefined,
        statuses: statusFilter ? [statusFilter as OrderStatus] : undefined,
        overdue: overdueOnly || undefined,
        include_archived: showArchived || undefined,
        sort, dir, limit: 200,
      };
      const r = await window.orderly.listOrders(filters);
      setRows(r.rows);
      setTotal(r.total);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, overdueOnly, showArchived, sort, dir, notifyError]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load]);

  // Deep link: open a specific order (e.g. from the inbox).
  useEffect(() => {
    if (openRequest) {
      open(openRequest);
      onOpenConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  async function open(id: string) {
    try {
      const o = await window.orderly.getOrder(id);
      setSelected(o);
      setView('detail');
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  function toggleSort(col: NonNullable<OrderFilters['sort']>) {
    if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(col);
      setDir('desc');
    }
  }

  const th = (label: string, col: NonNullable<OrderFilters['sort']>, alignRight = false) => (
    <th onClick={() => toggleSort(col)} style={alignRight ? { textAlign: 'right' } : undefined}>
      {label}{sort === col ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  if (view === 'new') {
    return (
      <div className="page">
        <div className="page-head"><div><h1 className="page-title">New order</h1></div></div>
        <OrderEditor
          onSaved={(o) => {
            notify(`Order ${o.order_number} created.`);
            setSelected(o);
            setView('detail');
            load();
          }}
          onCancel={() => setView('list')}
        />
      </div>
    );
  }

  if (view === 'edit' && selected) {
    return (
      <div className="page">
        <div className="page-head"><div><h1 className="page-title">Edit {selected.order_number}</h1></div></div>
        <OrderEditor
          initial={selected}
          onSaved={(o) => {
            notify('Order updated.');
            setSelected(o);
            setView('detail');
            load();
          }}
          onCancel={() => setView('detail')}
        />
      </div>
    );
  }

  if (view === 'detail' && selected) {
    return (
      <div className="page">
        <OrderDetail
          order={selected}
          onBack={() => { setView('list'); setSelected(null); load(); }}
          onChanged={(o) => { setSelected(o); load(); }}
        />
        <div className="btn-row no-print" style={{ marginTop: 12 }}>
          {![ 'canceled', 'completed'].includes(selected.status) && (
            <button className="btn" onClick={() => setView('edit')}>Edit order</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-sub">{total} order{total === 1 ? '' : 's'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setView('new')}>New order</button>
      </div>

      <div className="toolbar">
        <TextInput className="search-input" placeholder="Search number, customer, notes…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search orders" />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {(Object.keys(ORDER_TRANSITIONS) as OrderStatus[]).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
        </Select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No orders found"
          body={search || statusFilter ? 'Try clearing the filters.' : 'Create your first order to get started. Orders move through a 12-state lifecycle with full history.'}
          actionLabel={search || statusFilter ? undefined : 'New order'}
          onAction={search || statusFilter ? undefined : () => setView('new')}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr>
              {th('Order', 'order_number')}
              <th>Customer</th>
              {th('Date', 'order_date')}
              <th>Items</th>
              {th('Total', 'grand_total_cents', true)}
              <th>Status</th>
              {th('Requested', 'requested_date')}
              <th>Source</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} onClick={() => open(o.id)} style={{ cursor: 'pointer' }} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') open(o.id); }}>
                  <td className="mono" style={{ fontWeight: 600 }}>{o.order_number}</td>
                  <td>{o.customer_name ?? <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td>{o.order_date}</td>
                  <td>{o.item_count}</td>
                  <td className="num">{formatCents(o.grand_total_cents)}</td>
                  <td><StatusPill tone={statusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</StatusPill></td>
                  <td style={{ color: isOverdue(o) ? 'var(--danger)' : undefined, fontWeight: isOverdue(o) ? 700 : undefined }}>
                    {o.requested_date ?? '—'}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{o.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
