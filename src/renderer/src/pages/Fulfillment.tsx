import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  FulfillmentDetail,
  Order,
  ReadyToShipInput,
  ShipInput,
  WorkspaceData,
} from '../../../shared/types.js';
import { formatCents } from '../../../shared/format.js';
import { useToast, errMsg } from '../components/Toast';
import { ConfirmDialog, EmptyState } from '../components/ui';
import { Field, TextInput, TextArea, Modal, MoneyInput, Money } from '../components/forms';
import { getSettings } from '../api';

type OrderRow = Order & { item_count: number; packed_count: number };

function PackingDialog({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged: () => void }) {
  const { notifyError } = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [ful, setFul] = useState<FulfillmentDetail | null>(null);
  const [notes, setNotes] = useState('');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const load = useCallback(async () => {
    try {
      const o = await window.orderly.getOrder(orderId);
      setOrder(o);
      const fuls = await window.orderly.getFulfillmentsForOrder(orderId);
      const active = fuls.find((x) => x.status === 'packing') ?? null;
      setFul(active);
      if (active) {
        setNotes(active.package_notes ?? '');
        setLength(active.length_cm?.toString() ?? '');
        setWidth(active.width_cm?.toString() ?? '');
        setHeight(active.height_cm?.toString() ?? '');
        setWeight(active.weight_kg?.toString() ?? '');
      }
    } catch (e) {
      notifyError(errMsg(e));
    }
  }, [orderId, notifyError]);

  useEffect(() => {
    load();
  }, [load]);

  async function start() {
    try {
      await window.orderly.startPacking(orderId);
      await load();
      onChanged();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function setQty(orderItemId: string, qty: number) {
    if (!ful) return;
    try {
      const d = await window.orderly.packItem(ful.id, { order_item_id: orderItemId, quantity: qty });
      setFul(d);
      onChanged();
    } catch (e) {
      notifyError(errMsg(e));
      load(); // refresh to the true server state after a rejected edit
    }
  }

  async function ready() {
    if (!ful) return;
    const input: ReadyToShipInput = {
      package_notes: notes || null,
      length_cm: length === '' ? null : parseFloat(length),
      width_cm: width === '' ? null : parseFloat(width),
      height_cm: height === '' ? null : parseFloat(height),
      weight_kg: weight === '' ? null : parseFloat(weight),
    };
    for (const [k, v] of Object.entries({ length: input.length_cm, width: input.width_cm, height: input.height_cm, weight: input.weight_kg })) {
      if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) {
        notifyError(`${k} must be a positive number.`);
        return;
      }
    }
    try {
      await window.orderly.markReadyToShip(ful.id, input);
      onClose();
      onChanged();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function discard() {
    if (!ful) return;
    setConfirmDiscard(false);
    try {
      await window.orderly.deleteFulfillment(ful.id);
      onClose();
      onChanged();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  if (!order) return <Modal title="Packing" onClose={onClose}><p>Loading…</p></Modal>;

  const packedByItem = new Map((ful?.items ?? []).map((i) => [i.order_item_id, i.quantity_packed]));

  return (
    <Modal title={`Packing ${order.order_number}`} onClose={onClose} wide>
      {!ful ? (
        <div>
          <p>No packing session in progress for this order.</p>
          <button className="btn btn-primary" onClick={start}>Start packing</button>
        </div>
      ) : (
        <div>
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="data">
              <thead><tr><th>Item</th><th>Ordered</th><th>Packed</th><th>Pack now</th></tr></thead>
              <tbody>
                {order.items.map((i) => {
                  const packed = packedByItem.get(i.id) ?? 0;
                  return (
                    <tr key={i.id}>
                      <td>{i.description}<div style={{ color: 'var(--muted)', fontSize: 11 }} className="mono">{i.sku ?? ''}</div></td>
                      <td>{i.quantity}</td>
                      <td>{packed}</td>
                      <td>
                        <TextInput
                          type="number"
                          min={0}
                          max={i.quantity}
                          value={packed}
                          onChange={(e) => setQty(i.id, parseInt(e.target.value, 10) || 0)}
                          style={{ width: 80 }}
                          aria-label={`Pack quantity for ${i.description}`}
                        />
                        <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>of {i.quantity}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="form-grid">
            <Field label="Package notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Field label="Weight (kg)"><TextInput value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Length (cm)"><TextInput value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Width (cm)"><TextInput value={width} onChange={(e) => setWidth(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Height (cm)"><TextInput value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" /></Field>
          </div>
          <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <button className="btn btn-sm" onClick={() => setConfirmDiscard(true)}>Discard session</button>
            <div className="btn-row">
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={ready}>Mark ready to ship</button>
            </div>
          </div>
        </div>
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard packing session"
          body="Discard this packing session? Packed quantities will be cleared and the order returns to Ready to Fulfill."
          confirmLabel="Discard"
          danger
          onConfirm={discard}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </Modal>
  );
}

function ShipDialog({ ful, onClose, onChanged }: { ful: FulfillmentDetail; onClose: () => void; onChanged: () => void }) {
  const { notifyError } = useToast();
  const [carrier, setCarrier] = useState('');
  const [service, setService] = useState('');
  const [tracking, setTracking] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState(0);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');

  async function ship() {
    setError('');
    if (!date) {
      setError('Ship date is required.');
      return;
    }
    const input: ShipInput = {
      carrier: carrier || null,
      service: service || null,
      tracking_number: tracking || null,
      shipped_at: date,
      shipping_cost_cents: cost,
      package_summary: summary || null,
    };
    try {
      await window.orderly.shipFulfillment(ful.id, input);
      onClose();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Modal title={`Ship ${ful.order_number}`} onClose={onClose}>
      {error && <div className="field-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="form-grid">
        <Field label="Carrier"><TextInput value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="USPS, UPS, FedEx…" autoFocus /></Field>
        <Field label="Service"><TextInput value={service} onChange={(e) => setService(e.target.value)} placeholder="Priority, Ground…" /></Field>
        <Field label="Tracking number"><TextInput className="mono" value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
        <Field label="Ship date"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Shipping cost"><MoneyInput cents={cost} onChange={setCost} ariaLabel="Shipping cost" /></Field>
      </div>
      <Field label="Package summary"><TextArea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder="1 box, 12×9×6 in, 2.5 kg…" /></Field>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {ful.items.reduce((s, i) => s + i.quantity_packed, 0)} item(s) in this package.
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={ship}>Record shipment</button>
      </div>
    </Modal>
  );
}

function PrintDocs({ doc, onDone }: { doc: { kind: 'packing' | 'shipping'; ful: FulfillmentDetail } | null; onDone: () => void }) {
  const [company, setCompany] = useState('');
  useEffect(() => {
    if (doc) {
      getSettings().then((s) => setCompany(s.company_name ?? '')).catch(() => {});
      // Wait a tick for the portal to paint, then print. The doc unmounts
      // afterwards even if printing throws (headless environments).
      const t = setTimeout(() => {
        try {
          window.print();
        } finally {
          onDone();
        }
      }, 350);
      return () => clearTimeout(t);
    }
  }, [doc, onDone]);
  if (!doc) return null;
  const { ful } = doc;
  const isPacking = doc.kind === 'packing';
  return createPortal(
    <div className="print-area">
      <div style={{ fontFamily: 'Georgia, serif', color: '#000', padding: 24, maxWidth: 720 }}>
        {company && <div style={{ fontSize: 20, fontWeight: 700 }}>{company}</div>}
        <div style={{ fontSize: 14, letterSpacing: '0.1em', marginTop: 4, color: '#444' }}>
          {isPacking ? 'PACKING SLIP' : 'SHIPPING SUMMARY'}
        </div>
        <hr />
        <table style={{ width: '100%', fontSize: 13, marginBottom: 12 }}>
          <tbody>
            <tr><td><strong>Order:</strong></td><td>{ful.order_number}</td><td><strong>Date:</strong></td><td>{new Date().toISOString().slice(0, 10)}</td></tr>
            <tr><td><strong>Customer:</strong></td><td>{ful.customer_name ?? '—'}</td><td><strong>Status:</strong></td><td>{ful.status.replace(/_/g, ' ')}</td></tr>
            {!isPacking && ful.shipment && (
              <>
                <tr><td><strong>Carrier:</strong></td><td>{ful.shipment.carrier ?? '—'} {ful.shipment.service ?? ''}</td><td><strong>Tracking:</strong></td><td>{ful.shipment.tracking_number ?? '—'}</td></tr>
                <tr><td><strong>Shipped:</strong></td><td>{ful.shipment.shipped_at ?? '—'}</td><td><strong>Cost:</strong></td><td>{formatCents(ful.shipment.shipping_cost_cents)}</td></tr>
              </>
            )}
          </tbody>
        </table>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: '2px solid #000' }}><th style={{ textAlign: 'left' }}>Item</th><th style={{ textAlign: 'left' }}>SKU</th><th style={{ textAlign: 'right' }}>Qty</th></tr></thead>
          <tbody>
            {ful.items.map((i) => (
              <tr key={i.id} style={{ borderBottom: '1px solid #ccc' }}>
                <td>{i.description}</td><td>{i.sku ?? '—'}</td><td style={{ textAlign: 'right' }}>{i.quantity_packed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ful.package_notes && <p style={{ fontSize: 13 }}><strong>Package notes:</strong> {ful.package_notes}</p>}
        {(ful.length_cm || ful.width_cm || ful.height_cm || ful.weight_kg) && (
          <p style={{ fontSize: 13 }}>
            <strong>Package:</strong>{' '}
            {[ful.length_cm && `${ful.length_cm}cm L`, ful.width_cm && `${ful.width_cm}cm W`, ful.height_cm && `${ful.height_cm}cm H`, ful.weight_kg && `${ful.weight_kg}kg`].filter(Boolean).join(' · ')}
          </p>
        )}
        {!isPacking && ful.shipment?.package_summary && <p style={{ fontSize: 13 }}><strong>Summary:</strong> {ful.shipment.package_summary}</p>}
      </div>
    </div>,
    document.body,
  );
}

export function FulfillmentPage() {
  const { notify, notifyError } = useToast();
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [tab, setTab] = useState<'ready_to_pack' | 'packing' | 'ready_to_ship' | 'shipped' | 'awaiting_delivery'>('ready_to_pack');
  const [packingOrderId, setPackingOrderId] = useState<string | null>(null);
  const [shipFul, setShipFul] = useState<FulfillmentDetail | null>(null);
  const [printDoc, setPrintDoc] = useState<{ kind: 'packing' | 'shipping'; ful: FulfillmentDetail } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setWs(await window.orderly.getWorkspace());
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    load();
  }, [load]);

  async function backToPacking(id: string) {
    try {
      await window.orderly.backToPacking(id);
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function startAndOpen(orderId: string) {
    try {
      await window.orderly.startPacking(orderId);
    } catch (e) {
      // A session may already be in progress — just open it.
      if ((e as Error & { code?: string }).code !== 'CONFLICT') {
        notifyError(errMsg(e));
        return;
      }
    }
    setPackingOrderId(orderId);
    load();
  }

  const tabs = [
    { key: 'ready_to_pack', label: 'Ready to pack', count: ws?.ready_to_pack.length ?? 0 },
    { key: 'packing', label: 'Packing', count: ws?.packing.length ?? 0 },
    { key: 'ready_to_ship', label: 'Ready to ship', count: ws?.ready_to_ship.length ?? 0 },
    { key: 'shipped', label: 'Shipped', count: ws?.shipped.length ?? 0 },
    { key: 'awaiting_delivery', label: 'Awaiting delivery', count: ws?.awaiting_delivery.length ?? 0 },
  ] as const;

  function orderCard(o: OrderRow) {
    return (
      <div key={o.id} className="card" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong className="mono">{o.order_number}</strong>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {o.customer_name ?? 'No customer'} · {o.item_count} items ({o.packed_count} packed)</span>
            {o.requested_date && <span style={{ fontSize: 12, color: 'var(--muted)' }}> · due {o.requested_date}</span>}
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => startAndOpen(o.id)}>
            {tab === 'packing' ? 'Continue packing' : 'Start packing'}
          </button>
        </div>
      </div>
    );
  }

  function fulCard(f: FulfillmentDetail, showShip: boolean) {
    const packed = f.items.reduce((s, i) => s + i.quantity_packed, 0);
    return (
      <div key={f.id} className="card" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <strong className="mono">{f.order_number}</strong>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {f.customer_name ?? 'No customer'} · {packed} item{packed === 1 ? '' : 's'} packed</span>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {f.items.map((i) => <div key={i.id}>{i.quantity_packed}× {i.description}</div>)}
            </div>
            {f.shipment && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                {f.shipment.carrier} {f.shipment.service} · <span className="mono">{f.shipment.tracking_number ?? 'no tracking'}</span> · {f.shipment.shipped_at}
              </div>
            )}
          </div>
          <div className="btn-row">
            <button className="btn btn-sm" onClick={() => setPrintDoc({ kind: 'packing', ful: f })}>Packing slip</button>
            {f.shipment && <button className="btn btn-sm" onClick={() => setPrintDoc({ kind: 'shipping', ful: f })}>Shipping summary</button>}
            {showShip && (
              <>
                <button className="btn btn-sm" onClick={() => backToPacking(f.id)}>Back to packing</button>
                <button className="btn btn-sm btn-primary" onClick={() => setShipFul(f)}>Ship…</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Fulfillment</h1>
          <p className="page-sub">Pack orders, ship packages, print slips. Partial shipments are kept as separate records.</p>
        </div>
      </div>

      <div className="toolbar" role="tablist" aria-label="Fulfillment stages">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {loading || !ws ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : tab === 'ready_to_pack' ? (
        ws.ready_to_pack.length === 0 ? <EmptyState title="Nothing ready to pack" body="Orders in the Ready to Fulfill stage will appear here." /> : ws.ready_to_pack.map(orderCard)
      ) : tab === 'packing' ? (
        ws.packing.length === 0 ? <EmptyState title="No packing in progress" body="Start packing an order from the Ready to pack tab." /> : ws.packing.map(orderCard)
      ) : tab === 'ready_to_ship' ? (
        ws.ready_to_ship.length === 0 ? <EmptyState title="Nothing ready to ship" body="Packages marked ready to ship will appear here." /> : ws.ready_to_ship.map((f) => fulCard(f, true))
      ) : tab === 'shipped' ? (
        ws.shipped.length === 0 ? <EmptyState title="No shipments yet" body="Completed shipments will appear here with their tracking records." /> : ws.shipped.map((f) => fulCard(f, false))
      ) : (
        ws.awaiting_delivery.length === 0 ? <EmptyState title="Nothing awaiting delivery" body="Shipped orders not yet marked delivered will appear here." /> : ws.awaiting_delivery.map((f) => fulCard(f, false))
      )}

      {packingOrderId && (
        <PackingDialog orderId={packingOrderId} onClose={() => setPackingOrderId(null)} onChanged={load} />
      )}
      {shipFul && (
        <ShipDialog ful={shipFul} onClose={() => setShipFul(null)} onChanged={() => { load(); notify('Shipment recorded.'); }} />
      )}
      <PrintDocs doc={printDoc} onDone={() => setPrintDoc(null)} />
    </div>
  );
}
