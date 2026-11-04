import { useCallback, useEffect, useState } from 'react';
import type { Customer, CustomerProfile, NewAddressInput } from '../../../shared/types.js';
import { useToast, errMsg } from '../components/Toast';
import { ConfirmDialog, EmptyState, StatusPill } from '../components/ui';
import { Field, TextInput, TextArea, Select, Modal, Money } from '../components/forms';
import { formatCents } from '../../../shared/format.js';

function CustomerForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<Customer>;
  onSave: (input: { name: string; email: string; phone: string; company: string; notes: string; tags: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [company, setCompany] = useState(initial?.company ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [dupWarning, setDupWarning] = useState<Customer[]>([]);
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');

  async function checkDup(value: string) {
    setEmailError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      if (value.trim()) setEmailError('Enter a valid email address.');
      setDupWarning([]);
      return;
    }
    try {
      const dups = await window.orderly.checkDuplicateCustomers(value.trim(), initial?.id);
      setDupWarning(dups);
    } catch {
      /* non-fatal */
    }
  }

  function submit() {
    let ok = true;
    if (!name.trim()) {
      setNameError('Name is required.');
      ok = false;
    } else setNameError('');
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Enter a valid email address.');
      ok = false;
    }
    if (!ok) return;
    onSave({ name: name.trim(), email: email.trim(), phone: phone.trim(), company: company.trim(), notes: notes.trim(), tags });
  }

  return (
    <div>
      {dupWarning.length > 0 && (
        <div className="card" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber)', marginBottom: 12 }}>
          <strong>Possible duplicate:</strong> {dupWarning.map((d) => d.name).join(', ')} already use{dupWarning.length > 1 ? '' : 's'} this email.
          Records will <em>not</em> be merged automatically.
        </div>
      )}
      <div className="form-grid">
        <Field label="Name" error={nameError} htmlFor="cf-name">
          <TextInput id="cf-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Company" htmlFor="cf-company">
          <TextInput id="cf-company" value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label="Email" error={emailError} htmlFor="cf-email">
          <TextInput id="cf-email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => email.trim() && checkDup(email)} />
        </Field>
        <Field label="Phone" htmlFor="cf-phone">
          <TextInput id="cf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
      <Field label="Tags" hint="Comma-separated, e.g. wholesale, vip" htmlFor="cf-tags">
        <TextInput id="cf-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <Field label="Notes" htmlFor="cf-notes">
        <TextArea id="cf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create customer'}
        </button>
      </div>
    </div>
  );
}

function AddressForm({ onSave, onCancel }: { onSave: (a: NewAddressInput) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<'billing' | 'shipping'>('shipping');
  const [label, setLabel] = useState('');
  const [recipient, setRecipient] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postal, setPostal] = useState('');
  const [error, setError] = useState('');

  function submit() {
    if (!line1.trim() || !city.trim()) {
      setError('Street address and city are required.');
      return;
    }
    onSave({ kind, label, recipient, line1: line1.trim(), city: city.trim(), state, postal_code: postal });
  }

  return (
    <div>
      {error && <div className="field-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="form-grid">
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value as 'billing' | 'shipping')}><option value="shipping">Shipping</option><option value="billing">Billing</option></Select></Field>
        <Field label="Label"><TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Home, Warehouse…" /></Field>
        <Field label="Recipient"><TextInput value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>
        <Field label="Street"><TextInput value={line1} onChange={(e) => setLine1(e.target.value)} /></Field>
        <Field label="City"><TextInput value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <Field label="State"><TextInput value={state} onChange={(e) => setState(e.target.value)} /></Field>
        <Field label="Postal code"><TextInput value={postal} onChange={(e) => setPostal(e.target.value)} /></Field>
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Add address</button>
      </div>
    </div>
  );
}

export function CustomersPage() {
  const { notify, notifyError } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [addresses, setAddresses] = useState<import('../../../shared/types.js').CustomerAddress[]>([]);
  const [customerOrders, setCustomerOrders] = useState<{ rows: import('../../../shared/types.js').Order[]; total: number } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await window.orderly.listCustomers(search);
      setCustomers(list);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [search, notifyError]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load]);

  const select = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      const [p, addrs, ords] = await Promise.all([
        window.orderly.getCustomer(id),
        window.orderly.listAddresses(id),
        window.orderly.listOrders({ customer_id: id, limit: 20 }),
      ]);
      setProfile(p);
      setAddresses(addrs);
      setCustomerOrders(ords as { rows: import('../../../shared/types.js').Order[]; total: number });
    } catch (e) {
      notifyError(errMsg(e));
    }
  }, [notifyError]);

  async function saveNew(input: { name: string; email: string; phone: string; company: string; notes: string; tags: string }) {
    setSaving(true);
    try {
      const c = await window.orderly.createCustomer({
        name: input.name,
        email: input.email || null,
        phone: input.phone || null,
        company: input.company || null,
        notes: input.notes || null,
        tags: input.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setShowNew(false);
      notify('Customer created.');
      await load();
      select(c.id);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(input: { name: string; email: string; phone: string; company: string; notes: string; tags: string }) {
    if (!selectedId) return;
    setSaving(true);
    try {
      await window.orderly.updateCustomer(selectedId, {
        name: input.name,
        email: input.email || null,
        phone: input.phone || null,
        company: input.company || null,
        notes: input.notes || null,
        tags: input.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setEditing(false);
      notify('Customer updated.');
      await load();
      select(selectedId);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selectedId) return;
    setConfirmDelete(false);
    try {
      await window.orderly.deleteCustomer(selectedId);
      notify('Customer removed.');
      setSelectedId(null);
      setProfile(null);
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function saveAddress(a: NewAddressInput) {
    if (!selectedId) return;
    try {
      await window.orderly.addAddress(selectedId, a);
      setShowAddress(false);
      notify('Address added.');
      setAddresses(await window.orderly.listAddresses(selectedId));
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-sub">{customers.length} customer{customers.length === 1 ? '' : 's'}</p>
        </div>
        <div className="btn-row">
          <TextInput
            className="search-input"
            placeholder="Search name, email, company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search customers"
          />
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>New customer</button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : customers.length === 0 ? (
        <EmptyState
          title="No customers yet"
          body="Add your first customer to start taking orders. You'll get a warning — never an automatic merge — if an email already exists."
          actionLabel="New customer"
          onAction={() => setShowNew(true)}
        />
      ) : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div className="table-wrap" style={{ flex: '0 0 340px' }}>
            <table className="data">
              <thead><tr><th>Name</th><th>Company</th></tr></thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className={selectedId === c.id ? 'row-selected' : ''} onClick={() => select(c.id)} style={{ cursor: 'pointer' }} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') select(c.id); }}>
                    <td><div style={{ fontWeight: 600 }}>{c.name}</div><div style={{ color: 'var(--muted)', fontSize: 12 }}>{c.email ?? '—'}</div></td>
                    <td style={{ color: 'var(--muted)' }}>{c.company ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {!profile ? (
              <div className="card" style={{ color: 'var(--muted)' }}>Select a customer to see their profile.</div>
            ) : (
              <>
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: 17, marginBottom: 2 }}>{profile.name}</h3>
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                        {[profile.company, profile.email, profile.phone].filter(Boolean).join(' · ') || 'No contact details'}
                      </div>
                      {profile.tags.length > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {profile.tags.map((t) => <StatusPill key={t} tone="gray">{t}</StatusPill>)}
                        </div>
                      )}
                    </div>
                    <div className="btn-row">
                      <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
                      <button className="btn btn-sm" onClick={() => setConfirmDelete(true)}>Remove</button>
                    </div>
                  </div>
                  <hr className="divider" />
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>ORDERS</div><div style={{ fontSize: 18, fontWeight: 700 }}>{profile.order_count}</div></div>
                    <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>TOTAL SALES</div><div style={{ fontSize: 18, fontWeight: 700 }}><Money cents={profile.total_sales_cents} /></div></div>
                    <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>AVG ORDER</div><div style={{ fontSize: 18, fontWeight: 700 }}><Money cents={profile.average_order_cents} /></div></div>
                    <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>OUTSTANDING</div><div style={{ fontSize: 18, fontWeight: 700, color: profile.outstanding_cents > 0 ? 'var(--danger)' : undefined }}><Money cents={profile.outstanding_cents} /></div></div>
                  </div>
                  {profile.notes && <p style={{ marginTop: 10, fontSize: 13 }}>{profile.notes}</p>}
                </div>

                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3>Addresses</h3>
                    <button className="btn btn-sm" onClick={() => setShowAddress(true)}>Add address</button>
                  </div>
                  {addresses.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>No addresses on file.</p>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {addresses.map((a) => (
                        <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontSize: 12, maxWidth: 240 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <strong>{a.label || (a.kind === 'billing' ? 'Billing' : 'Shipping')}</strong>
                            <button className="btn btn-sm" style={{ padding: '1px 6px' }} onClick={async () => {
                              try { await window.orderly.deleteAddress(a.id); setAddresses(await window.orderly.listAddresses(profile.id)); }
                              catch (e) { notifyError(errMsg(e)); }
                            }}>Remove</button>
                          </div>
                          <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                            {a.recipient && <div>{a.recipient}</div>}
                            <div>{a.line1}</div>
                            {a.line2 && <div>{a.line2}</div>}
                            <div>{a.city}{a.state ? `, ${a.state}` : ''} {a.postal_code ?? ''}</div>
                            <div>{a.country}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card">
                  <h3>Order history ({customerOrders?.total ?? 0})</h3>
                  {!customerOrders || customerOrders.rows.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>No orders yet.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="data">
                        <thead><tr><th>Order</th><th>Date</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                        <tbody>
                          {customerOrders.rows.map((o) => (
                            <tr key={o.id}>
                              <td className="mono">{o.order_number}</td>
                              <td>{o.order_date}</td>
                              <td>{o.status.replace(/_/g, ' ')}</td>
                              <td className="num">{formatCents(o.grand_total_cents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {profile.recent_products.length > 0 && (
                  <div className="card">
                    <h3>Recently purchased</h3>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {profile.recent_products.map((p, i) => (
                        <StatusPill key={i} tone="sky">{p.product_name}</StatusPill>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showNew && (
        <Modal title="New customer" onClose={() => setShowNew(false)}>
          <CustomerForm onSave={saveNew} onCancel={() => setShowNew(false)} saving={saving} />
        </Modal>
      )}
      {editing && profile && (
        <Modal title="Edit customer" onClose={() => setEditing(false)}>
          <CustomerForm initial={profile} onSave={saveEdit} onCancel={() => setEditing(false)} saving={saving} />
        </Modal>
      )}
      {showAddress && (
        <Modal title="Add address" onClose={() => setShowAddress(false)}>
          <AddressForm onSave={saveAddress} onCancel={() => setShowAddress(false)} />
        </Modal>
      )}
      {confirmDelete && profile && (
        <ConfirmDialog
          title="Remove customer"
          body={`Remove ${profile.name}? Their order history is preserved, but the customer will be hidden from the directory. This can be undone only by restoring a backup.`}
          confirmLabel="Remove customer"
          danger
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
