import { useEffect, useMemo, useState } from 'react';
import type { Customer, NewOrderInput, Order, Product, ProductVariant } from '../../../shared/types.js';
import { ORDER_SOURCES, ORDER_TRANSITIONS } from '../../../shared/constants.js';
import { computeTotals, lineTotal } from '../../../shared/totals.js';
import { formatCents } from '../../../shared/format.js';
import { useToast, errMsg } from '../components/Toast';
import { Field, TextInput, TextArea, Select, MoneyInput, Money } from '../components/forms';

interface LineItem {
  key: number;
  product_id: string | null;
  variant_id: string | null;
  description: string;
  sku: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_cents: number;
  requires_production: boolean;
  variants: ProductVariant[];
}

let nextKey = 1;

function toLine(o: Order['items'][number]): LineItem {
  return {
    key: nextKey++,
    product_id: o.product_id,
    variant_id: o.variant_id,
    description: o.description,
    sku: o.sku ?? '',
    quantity: o.quantity,
    unit_price_cents: o.unit_price_cents,
    discount_cents: o.discount_cents,
    tax_cents: o.tax_cents,
    requires_production: o.requires_production,
    variants: [],
  };
}

export function OrderEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Order;
  onSaved: (order: Order) => void;
  onCancel: () => void;
}) {
  const { notifyError } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(initial?.customer_id ?? null);
  const [orderDate, setOrderDate] = useState(initial?.order_date ?? new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState<string>(initial?.source ?? 'Manual');
  const [priority, setPriority] = useState<string>(initial?.priority ?? 'normal');
  const [requestedDate, setRequestedDate] = useState(initial?.requested_date ?? '');
  const [internalNotes, setInternalNotes] = useState(initial?.internal_notes ?? '');
  const [customerNotes, setCustomerNotes] = useState(initial?.customer_notes ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [discount, setDiscount] = useState(initial?.discount_cents ?? 0);
  const [shipping, setShipping] = useState(initial?.shipping_cents ?? 0);
  const [tax, setTax] = useState(initial?.tax_cents ?? 0);
  const [ship, setShip] = useState({
    recipient: initial?.ship_recipient ?? '',
    line1: initial?.ship_line1 ?? '',
    line2: initial?.ship_line2 ?? '',
    city: initial?.ship_city ?? '',
    state: initial?.ship_state ?? '',
    postal: initial?.ship_postal ?? '',
    country: initial?.ship_country ?? '',
    method: initial?.ship_method ?? '',
  });
  const [items, setItems] = useState<LineItem[]>(initial ? initial.items.map(toLine) : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // product picker
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  useEffect(() => {
    window.orderly.listCustomers(customerSearch).then(setCustomers).catch((e) => notifyError(errMsg(e)));
  }, [customerSearch, notifyError]);

  useEffect(() => {
    if (pickerFor === null) return;
    const t = setTimeout(() => {
      window.orderly.listProducts({ search: productSearch, activeOnly: true }).then(setProducts).catch((e) => notifyError(errMsg(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [productSearch, pickerFor, notifyError]);

  const totals = useMemo(
    () =>
      computeTotals({
        items: items.map((i) => ({ quantity: i.quantity, unit_price_cents: i.unit_price_cents, discount_cents: i.discount_cents, tax_cents: i.tax_cents })),
        discount_cents: discount,
        shipping_cents: shipping,
        tax_cents: tax,
        paid_cents: initial?.paid_cents ?? 0,
      }),
    [items, discount, shipping, tax, initial],
  );

  function updateLine(key: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function pickProduct(lineKey: number, productId: string) {
    try {
      const p = await window.orderly.getProduct(productId);
      setItems((prev) =>
        prev.map((l) =>
          l.key === lineKey
            ? {
                ...l,
                product_id: p.id,
                variant_id: null,
                description: p.name,
                sku: p.sku ?? '',
                unit_price_cents: p.base_price_cents,
                variants: p.variants.filter((v) => v.active),
              }
            : l,
        ),
      );
      setPickerFor(null);
      setProductSearch('');
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  function pickVariant(lineKey: number, variantId: string) {
    setItems((prev) =>
      prev.map((l) => {
        if (l.key !== lineKey) return l;
        const v = l.variants.find((x) => x.id === variantId);
        if (!v) return { ...l, variant_id: null };
        return {
          ...l,
          variant_id: v.id,
          description: `${l.description.split(' — ')[0]} — ${v.name}`,
          sku: v.sku ?? l.sku,
          unit_price_cents: v.price_cents ?? l.unit_price_cents,
        };
      }),
    );
  }

  function addLine() {
    setItems((prev) => [
      ...prev,
      { key: nextKey++, product_id: null, variant_id: null, description: '', sku: '', quantity: 1, unit_price_cents: 0, discount_cents: 0, tax_cents: 0, requires_production: false, variants: [] },
    ]);
  }

  async function save() {
    setError('');
    if (items.length === 0) {
      setError('Add at least one line item.');
      return;
    }
    for (const [i, l] of items.entries()) {
      if (!l.description.trim()) {
        setError(`Line ${i + 1}: description is required.`);
        return;
      }
      if (!Number.isInteger(l.quantity) || l.quantity < 1) {
        setError(`Line ${i + 1}: quantity must be a whole number of at least 1.`);
        return;
      }
    }
    if (totals.grand_total_cents < 0) {
      setError('Order total cannot be negative.');
      return;
    }
    const input: NewOrderInput = {
      customer_id: customerId,
      order_date: orderDate,
      source,
      priority: priority as NewOrderInput['priority'],
      requested_date: requestedDate || null,
      internal_notes: internalNotes || null,
      customer_notes: customerNotes || null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      discount_cents: discount,
      shipping_cents: shipping,
      tax_cents: tax,
      ship_recipient: ship.recipient || null,
      ship_line1: ship.line1 || null,
      ship_line2: ship.line2 || null,
      ship_city: ship.city || null,
      ship_state: ship.state || null,
      ship_postal: ship.postal || null,
      ship_country: ship.country || null,
      ship_method: ship.method || null,
      items: items.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        description: l.description.trim(),
        sku: l.sku.trim() || null,
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        discount_cents: l.discount_cents,
        tax_cents: l.tax_cents,
        requires_production: l.requires_production,
      })),
    };
    setSaving(true);
    try {
      const saved = initial
        ? await window.orderly.updateOrder(initial.id, input)
        : await window.orderly.createOrder(input);
      onSaved(saved);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  const setShipField = (k: keyof typeof ship) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setShip((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div>
      {error && <div className="card" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)', marginBottom: 12 }}>{error}</div>}

      <div className="card">
        <h3>Order details</h3>
        <div className="form-grid-3">
          <Field label="Customer">
            <Select value={customerId ?? ''} onChange={(e) => setCustomerId(e.target.value || null)}>
              <option value="">— No customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
            </Select>
            <TextInput placeholder="Type to search…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} style={{ marginTop: 4 }} aria-label="Search customers" />
          </Field>
          <Field label="Order date"><TextInput type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>
          <Field label="Requested date"><TextInput type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} /></Field>
          <Field label="Source">
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              {ORDER_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option><option value="normal">Normal</option>
              <option value="high">High</option><option value="urgent">Urgent</option>
            </Select>
          </Field>
          <Field label="Tags" hint="Comma-separated"><TextInput value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        </div>
        <div className="form-grid">
          <Field label="Internal notes"><TextArea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} /></Field>
          <Field label="Customer-facing notes"><TextArea value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} rows={2} /></Field>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3>Line items ({items.length})</h3>
          <button className="btn btn-sm" onClick={addLine}>Add item</button>
        </div>
        {items.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No items yet. Add a product from your catalog or type a custom line.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th style={{ minWidth: 220 }}>Description</th><th>SKU</th><th>Qty</th><th>Unit price</th><th>Disc.</th><th>Tax</th><th style={{ textAlign: 'right' }}>Line total</th><th title="Requires production">Prod.</th><th></th></tr></thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <TextInput value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Item description" aria-label="Item description" />
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <button className="btn btn-sm" onClick={() => { setPickerFor(l.key); setProductSearch(''); }}>Choose product…</button>
                        {l.variants.length > 0 && (
                          <Select value={l.variant_id ?? ''} onChange={(e) => pickVariant(l.key, e.target.value)} aria-label="Variant">
                            <option value="">— Variant —</option>
                            {l.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </Select>
                        )}
                      </div>
                      {pickerFor === l.key && (
                        <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, maxHeight: 180, overflowY: 'auto', background: 'var(--surface)' }}>
                          <TextInput value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products…" autoFocus aria-label="Search products" style={{ border: 0, borderBottom: '1px solid var(--border)', borderRadius: 0 }} />
                          {products.map((p) => (
                            <div key={p.id} role="option" aria-selected="false" tabIndex={0}
                              onClick={() => pickProduct(l.key, p.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickProduct(l.key, p.id); } }}
                              style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                              <strong>{p.name}</strong> <span style={{ color: 'var(--muted)' }}>{formatCents(p.base_price_cents)}</span>
                            </div>
                          ))}
                          {products.length === 0 && <div style={{ padding: 8, color: 'var(--muted)', fontSize: 12 }}>No matches.</div>}
                        </div>
                      )}
                    </td>
                    <td><TextInput className="mono" value={l.sku} onChange={(e) => updateLine(l.key, { sku: e.target.value })} style={{ width: 90 }} aria-label="SKU" /></td>
                    <td><TextInput type="number" min={1} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: parseInt(e.target.value, 10) || 0 })} style={{ width: 64 }} aria-label="Quantity" /></td>
                    <td><MoneyInput cents={l.unit_price_cents} onChange={(c) => updateLine(l.key, { unit_price_cents: c })} ariaLabel="Unit price" /></td>
                    <td><MoneyInput cents={l.discount_cents} onChange={(c) => updateLine(l.key, { discount_cents: c })} ariaLabel="Line discount" /></td>
                    <td><MoneyInput cents={l.tax_cents} onChange={(c) => updateLine(l.key, { tax_cents: c })} ariaLabel="Line tax" /></td>
                    <td className="num"><Money cents={lineTotal(l)} /></td>
                    <td><input type="checkbox" checked={l.requires_production} onChange={(e) => updateLine(l.key, { requires_production: e.target.checked })} aria-label="Requires production" title="Requires production" /></td>
                    <td><button className="btn btn-sm" onClick={() => setItems((prev) => prev.filter((x) => x.key !== l.key))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <dl className="kv" style={{ gridTemplateColumns: '140px 110px' }}>
            <dt>Subtotal</dt><dd className="num"><Money cents={totals.subtotal_cents} /></dd>
            <dt>Order discount</dt><dd><MoneyInput cents={discount} onChange={setDiscount} ariaLabel="Order discount" /></dd>
            <dt>Shipping</dt><dd><MoneyInput cents={shipping} onChange={setShipping} ariaLabel="Shipping charge" /></dd>
            <dt>Order tax</dt><dd><MoneyInput cents={tax} onChange={setTax} ariaLabel="Order tax" /></dd>
            <dt><strong>Grand total</strong></dt><dd className="num"><strong><Money cents={totals.grand_total_cents} /></strong></dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <h3>Shipping</h3>
        <div className="form-grid-3">
          <Field label="Recipient"><TextInput value={ship.recipient} onChange={setShipField('recipient')} /></Field>
          <Field label="Method"><TextInput value={ship.method} onChange={setShipField('method')} placeholder="USPS Priority…" /></Field>
          <Field label="Country"><TextInput value={ship.country} onChange={setShipField('country')} /></Field>
          <Field label="Street"><TextInput value={ship.line1} onChange={setShipField('line1')} /></Field>
          <Field label="Apt / Suite"><TextInput value={ship.line2} onChange={setShipField('line2')} /></Field>
          <Field label="City"><TextInput value={ship.city} onChange={setShipField('city')} /></Field>
          <Field label="State"><TextInput value={ship.state} onChange={setShipField('state')} /></Field>
          <Field label="Postal code"><TextInput value={ship.postal} onChange={setShipField('postal')} /></Field>
        </div>
      </div>

      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create order'}
        </button>
      </div>
    </div>
  );
}

// Re-export for tree-shaking friendliness in tests
export { ORDER_TRANSITIONS };
