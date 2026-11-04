import { useCallback, useEffect, useState } from 'react';
import type { Order, ReturnRecord, ReturnStatus } from '../../../shared/types.js';
import { RETURN_STATUS_LABELS, RETURN_TRANSITIONS } from '../../../shared/constants.js';
import { useToast, errMsg } from '../components/Toast';
import { EmptyState, StatusPill } from '../components/ui';
import { Field, TextInput, TextArea, Select, Modal } from '../components/forms';

type Row = ReturnRecord & { order_number: string; customer_name: string | null };

function returnTone(s: ReturnStatus): 'sage' | 'amber' | 'pink' | 'sky' | 'gray' | 'danger' {
  switch (s) {
    case 'resolved': return 'sage';
    case 'rejected': return 'gray';
    case 'requested': return 'amber';
    default: return 'sky';
  }
}

function ReturnComposer({ orderId, onDone, onCancel }: { orderId: string; onDone: () => void; onCancel: () => void }) {
  const { notifyError } = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [selected, setSelected] = useState<Record<string, { on: boolean; qty: number; reason: string }>>({});
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.orderly.getOrder(orderId)
      .then((o) => {
        setOrder(o);
        const init: Record<string, { on: boolean; qty: number; reason: string }> = {};
        for (const i of o.items) init[i.id] = { on: false, qty: i.quantity, reason: '' };
        setSelected(init);
      })
      .catch((e) => notifyError(errMsg(e)));
  }, [orderId, notifyError]);

  async function save() {
    setError('');
    const items = Object.entries(selected)
      .filter(([, v]) => v.on)
      .map(([order_item_id, v]) => ({ order_item_id, quantity: v.qty, reason: v.reason || null }));
    if (items.length === 0) {
      setError('Select at least one item to return.');
      return;
    }
    setSaving(true);
    try {
      await window.orderly.createReturn(orderId, {
        reason: reason || null,
        internal_notes: notes || null,
        items,
      });
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (!order) return <Modal title="New return" onClose={onCancel}><p>Loading…</p></Modal>;

  return (
    <Modal title={`New return — ${order.order_number}`} onClose={onCancel} wide>
      {error && <div className="field-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table className="data">
          <thead><tr><th></th><th>Item</th><th>Ordered</th><th>Qty returning</th><th>Item reason</th></tr></thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td>
                  <input type="checkbox" checked={selected[i.id]?.on ?? false}
                    onChange={(e) => setSelected((s) => ({ ...s, [i.id]: { ...s[i.id], on: e.target.checked } }))}
                    aria-label={`Return ${i.description}`} />
                </td>
                <td>{i.description}</td>
                <td>{i.quantity}</td>
                <td>
                  <TextInput type="number" min={1} max={i.quantity} style={{ width: 80 }}
                    value={selected[i.id]?.qty ?? i.quantity}
                    disabled={!selected[i.id]?.on}
                    onChange={(e) => setSelected((s) => ({ ...s, [i.id]: { ...s[i.id], qty: parseInt(e.target.value, 10) || 0 } }))}
                    aria-label={`Return quantity for ${i.description}`} />
                </td>
                <td>
                  <TextInput value={selected[i.id]?.reason ?? ''} disabled={!selected[i.id]?.on}
                    onChange={(e) => setSelected((s) => ({ ...s, [i.id]: { ...s[i.id], reason: e.target.value } }))}
                    placeholder="Damaged, wrong size…" aria-label={`Reason for ${i.description}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid">
        <Field label="Return reason"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer's reason" /></Field>
        <Field label="Internal notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create return request'}</button>
      </div>
    </Modal>
  );
}

function ReturnDetail({ ret, onChanged, onBack }: { ret: Row; onChanged: (r: Row) => void; onBack: () => void }) {
  const { notify, notifyError } = useToast();
  const [nextStatus, setNextStatus] = useState<ReturnStatus | ''>('');
  const [refundStatus, setRefundStatus] = useState(ret.refund_status ?? '');
  const [notes, setNotes] = useState(ret.internal_notes ?? '');
  const [reason, setReason] = useState(ret.reason ?? '');
  const [replacementId, setReplacementId] = useState(ret.replacement_order_id ?? '');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderOptions, setOrderOptions] = useState<Order[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      window.orderly.listOrders({ search: orderSearch || undefined, limit: 10 })
        .then((r) => setOrderOptions(r.rows))
        .catch(() => {});
    }, orderSearch ? 250 : 0);
    return () => clearTimeout(t);
  }, [orderSearch]);

  const transitions = RETURN_TRANSITIONS[ret.status];

  async function advance() {
    if (!nextStatus) return;
    try {
      const r = await window.orderly.setReturnStatus(ret.id, nextStatus);
      setNextStatus('');
      onChanged({ ...r, order_number: ret.order_number, customer_name: ret.customer_name });
      notify(`Return marked ${RETURN_STATUS_LABELS[nextStatus]}.`);
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function saveDetails() {
    try {
      const r = await window.orderly.updateReturn(ret.id, {
        reason: reason || null,
        refund_status: refundStatus || null,
        internal_notes: notes || null,
        replacement_order_id: replacementId || null,
      });
      onChanged({ ...r, order_number: ret.order_number, customer_name: ret.customer_name });
      notify('Return updated.');
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  return (
    <div>
      <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 8 }}>← All returns</button>
      <div className="page-head">
        <div>
          <h1 className="page-title">Return for {ret.order_number}</h1>
          <p className="page-sub">{ret.customer_name ?? 'No customer'} · opened {new Date(ret.created_at).toLocaleDateString()}</p>
        </div>
        <StatusPill tone={returnTone(ret.status)}>{RETURN_STATUS_LABELS[ret.status]}</StatusPill>
      </div>

      <div className="card">
        <h3>Move this return</h3>
        <div className="btn-row">
          <Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as ReturnStatus | '')} aria-label="Next return status" disabled={transitions.length === 0}>
            <option value="">— Choose next status —</option>
            {transitions.map((s) => <option key={s} value={s}>{RETURN_STATUS_LABELS[s]}</option>)}
          </Select>
          <button className="btn btn-primary btn-sm" onClick={advance} disabled={!nextStatus}>Apply</button>
        </div>
      </div>

      <div className="card">
        <h3>Returned items</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Item</th><th>Ordered</th><th>Returning</th><th>Reason</th></tr></thead>
            <tbody>
              {ret.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.description}<div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{i.sku ?? ''}</div></td>
                  <td>{i.quantity_ordered}</td>
                  <td><strong>{i.quantity}</strong></td>
                  <td style={{ color: 'var(--muted)' }}>{i.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Details</h3>
        <div className="form-grid">
          <Field label="Return reason"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Refund status" hint="Informational only — Orderly never processes refunds.">
            <TextInput value={refundStatus} onChange={(e) => setRefundStatus(e.target.value)} placeholder="e.g. Refunded $24.00 via card on 11/05" />
          </Field>
        </div>
        <Field label="Internal notes"><TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
        <Field label="Replacement order" hint="Link a separate order that replaces the returned items.">
          <div className="btn-row">
            <Select value={replacementId} onChange={(e) => setReplacementId(e.target.value)}>
              <option value="">— None —</option>
              {orderOptions.filter((o) => o.id !== ret.order_id).map((o) => (
                <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name ?? 'no customer'}</option>
              ))}
              {ret.replacement_order_id && !orderOptions.some((o) => o.id === ret.replacement_order_id) && (
                <option value={ret.replacement_order_id}>{ret.replacement_order_id}</option>
              )}
            </Select>
            <TextInput className="search-input" placeholder="Search orders…" value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} aria-label="Search orders" />
          </div>
        </Field>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={saveDetails}>Save details</button>
        </div>
      </div>
    </div>
  );
}

export function ReturnsPage() {
  const { notify, notifyError } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderOptions, setOrderOptions] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await window.orderly.listReturns({
        status: (statusFilter || undefined) as ReturnStatus | undefined,
        search: search || undefined,
      });
      setRows(r);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, notifyError]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      window.orderly.listOrders({ search: orderSearch || undefined, limit: 10 })
        .then((r) => setOrderOptions(r.rows))
        .catch(() => {});
    }, orderSearch ? 250 : 0);
    return () => clearTimeout(t);
  }, [orderSearch]);

  async function open(id: string) {
    try {
      const r = await window.orderly.getReturn(id);
      const row = rows.find((x) => x.id === id);
      setSelected({ ...r, order_number: row?.order_number ?? '', customer_name: row?.customer_name ?? null });
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  if (selected) {
    return (
      <div className="page">
        <ReturnDetail
          ret={selected}
          onBack={() => { setSelected(null); load(); }}
          onChanged={(r) => { setSelected(r); load(); }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Returns</h1>
          <p className="page-sub">{rows.length} return{rows.length === 1 ? '' : 's'} · refunds are informational only</p>
        </div>
      </div>

      <div className="toolbar">
        <TextInput className="search-input" placeholder="Search order, customer…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search returns" />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by return status">
          <option value="">All statuses</option>
          {(Object.keys(RETURN_TRANSITIONS) as ReturnStatus[]).map((s) => <option key={s} value={s}>{RETURN_STATUS_LABELS[s]}</option>)}
        </Select>
        <span className="spacer" />
        <TextInput className="search-input" placeholder="Find order to start a return…" value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} aria-label="Find order" />
      </div>

      {orderSearch && orderOptions.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table className="data">
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {orderOptions.map((o) => (
                <tr key={o.id}>
                  <td className="mono" style={{ fontWeight: 600 }}>{o.order_number}</td>
                  <td>{o.customer_name ?? '—'}</td>
                  <td>{o.status.replace(/_/g, ' ')}</td>
                  <td><button className="btn btn-sm" onClick={() => setComposerFor(o.id)}>Start return</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No returns"
          body="When a customer sends something back, start a return from their order. Items, quantities, reasons, and resolutions are tracked against the original order."
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th>Opened</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: 'pointer' }} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') open(r.id); }}>
                  <td className="mono" style={{ fontWeight: 600 }}>{r.order_number}</td>
                  <td>{r.customer_name ?? '—'}</td>
                  <td>{r.items.reduce((s, i) => s + i.quantity, 0)}</td>
                  <td><StatusPill tone={returnTone(r.status)}>{RETURN_STATUS_LABELS[r.status]}</StatusPill></td>
                  <td style={{ color: 'var(--muted)' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {composerFor && (
        <ReturnComposer
          orderId={composerFor}
          onDone={() => { setComposerFor(null); setOrderSearch(''); load(); notify('Return request created.'); }}
          onCancel={() => setComposerFor(null)}
        />
      )}
    </div>
  );
}
