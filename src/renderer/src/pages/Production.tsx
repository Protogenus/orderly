import { useCallback, useEffect, useState } from 'react';
import type { Order, ProductionHandoff, StagepointDetection } from '../../../shared/types.js';
import { useToast, errMsg } from '../components/Toast';
import { ConfirmDialog, EmptyState, StatusPill } from '../components/ui';
import { Field, TextInput, Select, Modal } from '../components/forms';

function handoffTone(s: ProductionHandoff['status']): 'sage' | 'amber' | 'pink' | 'sky' | 'gray' | 'danger' {
  switch (s) {
    case 'completed': return 'sage';
    case 'failed': return 'danger';
    case 'in_progress': return 'sky';
    case 'accepted': return 'sky';
    case 'sent': return 'amber';
    default: return 'gray';
  }
}

function HandoffComposer({ orderId, onDone, onCancel }: { orderId: string; onDone: () => void; onCancel: () => void }) {
  const { notifyError } = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [selected, setSelected] = useState<Record<string, { on: boolean; qty: number }>>({});
  const [moveOrder, setMoveOrder] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.orderly.getOrder(orderId)
      .then((o) => {
        setOrder(o);
        const init: Record<string, { on: boolean; qty: number }> = {};
        for (const i of o.items) init[i.id] = { on: i.requires_production, qty: i.quantity };
        setSelected(init);
      })
      .catch((e) => notifyError(errMsg(e)));
  }, [orderId, notifyError]);

  async function save() {
    setError('');
    const items = Object.entries(selected)
      .filter(([, v]) => v.on)
      .map(([order_item_id, v]) => ({ order_item_id, quantity: v.qty }));
    if (items.length === 0) {
      setError('Select at least one line item for production.');
      return;
    }
    for (const it of items) {
      const oi = order?.items.find((i) => i.id === it.order_item_id);
      if (!oi || it.quantity < 1 || it.quantity > oi.quantity) {
        setError(`Quantity for "${oi?.description ?? 'item'}" must be between 1 and ${oi?.quantity ?? '?'} (ordered).`);
        return;
      }
    }
    setSaving(true);
    try {
      const h = await window.orderly.createHandoff(orderId, { items, move_order: moveOrder });
      await window.orderly.sendHandoff(h.id);
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (!order) return <Modal title="New production handoff" onClose={onCancel}><p>Loading…</p></Modal>;

  return (
    <Modal title={`Production handoff — ${order.order_number}`} onClose={onCancel} wide>
      {error && <div className="field-error" style={{ marginBottom: 8 }}>{error}</div>}
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
        Select the line items StagePoint (or your workshop) needs to manufacture. Items flagged for production are pre-selected.
      </p>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table className="data">
          <thead><tr><th></th><th>Item</th><th>Ordered</th><th>Quantity to make</th></tr></thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected[i.id]?.on ?? false}
                    onChange={(e) => setSelected((s) => ({ ...s, [i.id]: { ...s[i.id], on: e.target.checked } }))}
                    aria-label={`Include ${i.description}`}
                  />
                </td>
                <td>{i.description}<div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{i.sku ?? ''}</div></td>
                <td>{i.quantity}</td>
                <td>
                  <TextInput
                    type="number" min={1} max={i.quantity}
                    value={selected[i.id]?.qty ?? i.quantity}
                    onChange={(e) => setSelected((s) => ({ ...s, [i.id]: { ...s[i.id], qty: parseInt(e.target.value, 10) || 0 } }))}
                    style={{ width: 90 }}
                    disabled={!selected[i.id]?.on}
                    aria-label={`Quantity of ${i.description} to make`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {['new', 'confirmed'].includes(order.status) && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={moveOrder} onChange={(e) => setMoveOrder(e.target.checked)} />
          Move order to Awaiting Production
        </label>
      )}
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Sending…' : 'Create and send handoff'}
        </button>
      </div>
    </Modal>
  );
}

export function ProductionPage() {
  const { notify, notifyError } = useToast();
  const [handoffs, setHandoffs] = useState<(ProductionHandoff & { order_number: string })[]>([]);
  const [detection, setDetection] = useState<StagepointDetection | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const [statusFor, setStatusFor] = useState<(ProductionHandoff & { order_number: string }) | null>(null);
  const [newStatus, setNewStatus] = useState<ProductionHandoff['status']>('in_progress');
  const [statusNote, setStatusNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ProductionHandoff | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [h, d] = await Promise.all([window.orderly.listHandoffs(), window.orderly.detectStagepoint()]);
      setHandoffs(h);
      setDetection(d);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      window.orderly.listOrders({ search: orderSearch || undefined, limit: 20 })
        .then((r) => setOrders(r.rows))
        .catch(() => {});
    }, orderSearch ? 250 : 0);
    return () => clearTimeout(t);
  }, [orderSearch]);

  async function checkAcks() {
    try {
      const r = await window.orderly.checkHandoffAcks();
      if (r.applied > 0) notify(`Applied ${r.applied} StagePoint update(s).`);
      else if (r.errors.length > 0) notifyError(r.errors.join('; '));
      else notify('No new StagePoint updates found.');
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function pickInbox() {
    try {
      await window.orderly.pickStagepointInbox();
      load();
      notify('StagePoint inbox folder updated.');
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function applyStatus() {
    if (!statusFor) return;
    try {
      await window.orderly.updateHandoffStatus(statusFor.id, newStatus, statusNote || undefined);
      setStatusFor(null);
      setStatusNote('');
      notify(`Handoff marked ${newStatus.replace(/_/g, ' ')}.`);
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function remove() {
    if (!confirmDelete) return;
    setConfirmDelete(null);
    try {
      await window.orderly.deleteHandoff(confirmDelete.id);
      notify('Draft handoff deleted.');
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  const nextStatuses: ProductionHandoff['status'][] = statusFor
    ? (['sent', 'accepted', 'in_progress', 'completed', 'failed'] as ProductionHandoff['status'][]).filter((s) => s !== statusFor.status)
    : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Production</h1>
          <p className="page-sub">Hand production work to StagePoint — or track it manually.</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-sm" onClick={checkAcks}>Check for StagePoint updates</button>
        </div>
      </div>

      {detection && (
        <div className="card" style={{ background: detection.connected ? 'var(--sage-soft)' : 'var(--amber-soft)', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13 }}>
              <strong>{detection.connected ? 'StagePoint connected' : 'StagePoint not connected'}</strong>
              <div style={{ color: 'var(--muted)', marginTop: 2 }}>{detection.message}</div>
            </div>
            <button className="btn btn-sm" onClick={pickInbox}>Set StagePoint inbox…</button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>New handoff</h3>
        <div className="btn-row">
          <TextInput
            className="search-input"
            placeholder="Find order by number…"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            aria-label="Find order"
          />
        </div>
        {orders.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data">
              <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{o.order_number}</td>
                    <td>{o.customer_name ?? '—'}</td>
                    <td>{o.status.replace(/_/g, ' ')}</td>
                    <td><button className="btn btn-sm" onClick={() => setComposerFor(o.id)}>New handoff</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Handoffs ({handoffs.length})</h3>
        {loading ? (
          <p style={{ color: 'var(--muted)' }}>Loading…</p>
        ) : handoffs.length === 0 ? (
          <EmptyState
            title="No production handoffs"
            body="When an order needs manufacturing before fulfillment, create a handoff. Orderly writes a documented JSON envelope for StagePoint — and works fine without it."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Handoff</th><th>Order</th><th>Items</th><th>Status</th><th>Updated</th><th></th></tr></thead>
              <tbody>
                {handoffs.map((h) => (
                  <tr key={h.id}>
                    <td className="mono" style={{ fontSize: 11 }}>{h.id.slice(0, 12)}…</td>
                    <td className="mono">{h.order_number}</td>
                    <td style={{ fontSize: 12 }}>
                      {h.items.map((i) => <div key={i.order_item_id}>{i.quantity}× {i.description}</div>)}
                    </td>
                    <td><StatusPill tone={handoffTone(h.status)}>{h.status.replace(/_/g, ' ')}</StatusPill></td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(h.updated_at).toLocaleString()}</td>
                    <td>
                      <div className="btn-row">
                        <button className="btn btn-sm" onClick={() => { setStatusFor(h); setNewStatus('in_progress'); }}>Update status</button>
                        {h.status === 'draft' && <button className="btn btn-sm" onClick={() => setConfirmDelete(h)}>Delete</button>}
                      </div>
                      {h.progress_note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{h.progress_note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {composerFor && (
        <HandoffComposer orderId={composerFor} onDone={() => { setComposerFor(null); load(); notify('Handoff sent.'); }} onCancel={() => setComposerFor(null)} />
      )}
      {statusFor && (
        <Modal title="Update production status" onClose={() => setStatusFor(null)}>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Manual update for handoff {statusFor.id.slice(0, 12)}… (order {statusFor.order_number}).
            Use this when StagePoint isn't connected or you produced the items yourself.
          </p>
          <Field label="New status">
            <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value as ProductionHandoff['status'])}>
              {nextStatuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Note">
            <TextInput value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="Optional progress note" />
          </Field>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setStatusFor(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={applyStatus}>Apply</button>
          </div>
        </Modal>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete draft handoff"
          body="Delete this draft handoff? It has not been sent anywhere."
          confirmLabel="Delete"
          danger
          onConfirm={remove}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
