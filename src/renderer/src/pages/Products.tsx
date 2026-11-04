import { useCallback, useEffect, useState } from 'react';
import type { Product, ProductCategory, ProductVariant } from '../../../shared/types.js';
import { useToast, errMsg } from '../components/Toast';
import { ConfirmDialog, EmptyState, StatusPill } from '../components/ui';
import { Field, TextInput, TextArea, Select, Modal, Money, MoneyInput } from '../components/forms';
import { imageUrl } from '../api';

type FullProduct = Product & { variants: ProductVariant[] };

function ProductForm({
  initial,
  categories,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Product;
  categories: ProductCategory[];
  onSave: (input: { name: string; sku: string; description: string; category_id: string; base_price_cents: number; active: boolean; marketplace_id: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '');
  const [price, setPrice] = useState(initial?.base_price_cents ?? 0);
  const [active, setActive] = useState(initial?.active ?? true);
  const [marketplaceId, setMarketplaceId] = useState(initial?.marketplace_id ?? '');
  const [nameError, setNameError] = useState('');

  function submit() {
    if (!name.trim()) {
      setNameError('Name is required.');
      return;
    }
    onSave({
      name: name.trim(), sku: sku.trim(), description: description.trim(),
      category_id: categoryId || '', base_price_cents: price, active, marketplace_id: marketplaceId.trim(),
    });
  }

  return (
    <div>
      <div className="form-grid">
        <Field label="Product name" error={nameError}><TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="SKU"><TextInput className="mono" value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
        <Field label="Category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— No category —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Selling price"><MoneyInput cents={price} onChange={setPrice} ariaLabel="Selling price" /></Field>
        <Field label="Marketplace ID" hint="Optional external identifier (Etsy listing ID, Shopify SKU…)">
          <TextInput value={marketplaceId} onChange={(e) => setMarketplaceId(e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </Field>
      </div>
      <Field label="Description"><TextArea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create product'}</button>
      </div>
    </div>
  );
}

function VariantForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ProductVariant;
  onSave: (input: { name: string; sku: string; price_cents: number | null; useBasePrice: boolean; attributes: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [useBase, setUseBase] = useState(initial?.price_cents == null);
  const [price, setPrice] = useState(initial?.price_cents ?? 0);
  const [attrs, setAttrs] = useState(
    initial ? Object.entries(initial.attributes).map(([k, v]) => `${k}: ${v}`).join('\n') : 'Size: \nColor: ',
  );
  const [error, setError] = useState('');

  function submit() {
    if (!name.trim()) {
      setError('Variant name is required.');
      return;
    }
    const attributes: Record<string, string> = {};
    for (const line of attrs.split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) {
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k && v) attributes[k] = v;
      }
    }
    onSave({ name: name.trim(), sku: sku.trim(), price_cents: useBase ? null : price, useBasePrice: useBase, attributes: JSON.stringify(attributes) });
  }

  return (
    <div>
      {error && <div className="field-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="form-grid">
        <Field label="Variant name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Lavender 8oz" autoFocus /></Field>
        <Field label="SKU"><TextInput className="mono" value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
      </div>
      <Field label="Price">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" checked={useBase} onChange={(e) => setUseBase(e.target.checked)} /> Use product base price
        </label>
        {!useBase && <div style={{ marginTop: 6 }}><MoneyInput cents={price} onChange={setPrice} ariaLabel="Variant price" /></div>}
      </Field>
      <Field label="Attributes" hint="One per line as Key: Value — e.g. Size: 8oz, Color: Lavender, Material: Soy wax">
        <TextArea value={attrs} onChange={(e) => setAttrs(e.target.value)} rows={4} />
      </Field>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>{initial ? 'Save variant' : 'Add variant'}</button>
      </div>
    </div>
  );
}

export function ProductsPage() {
  const { notify, notifyError } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FullProduct | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showVariant, setShowVariant] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [showCategory, setShowCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteVariant, setConfirmDeleteVariant] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [list, cats] = await Promise.all([
        window.orderly.listProducts({ search, category_id: categoryFilter || undefined, activeOnly: activeOnly || undefined }),
        window.orderly.listCategories(),
      ]);
      setProducts(list);
      setCategories(cats);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, activeOnly, notifyError]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load]);

  const select = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      setDetail(await window.orderly.getProduct(id));
    } catch (e) {
      notifyError(errMsg(e));
    }
  }, [notifyError]);

  async function saveNew(input: { name: string; sku: string; description: string; category_id: string; base_price_cents: number; active: boolean; marketplace_id: string }) {
    setSaving(true);
    try {
      const p = await window.orderly.createProduct({
        name: input.name, sku: input.sku || null, description: input.description || null,
        category_id: input.category_id || null, base_price_cents: input.base_price_cents,
        active: input.active, marketplace_id: input.marketplace_id || null,
      });
      setShowNew(false);
      notify('Product created.');
      await load();
      select(p.id);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(input: { name: string; sku: string; description: string; category_id: string; base_price_cents: number; active: boolean; marketplace_id: string }) {
    if (!selectedId) return;
    setSaving(true);
    try {
      await window.orderly.updateProduct(selectedId, {
        name: input.name, sku: input.sku || null, description: input.description || null,
        category_id: input.category_id || null, base_price_cents: input.base_price_cents,
        active: input.active, marketplace_id: input.marketplace_id || null,
      });
      setEditing(false);
      notify('Product updated.');
      await load();
      select(selectedId);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveVariant(input: { name: string; sku: string; price_cents: number | null; useBasePrice: boolean; attributes: string }) {
    if (!selectedId) return;
    try {
      const attrs = JSON.parse(input.attributes) as Record<string, string>;
      if (editingVariant) {
        await window.orderly.updateVariant(editingVariant.id, { name: input.name, sku: input.sku || null, price_cents: input.price_cents, attributes: attrs });
        notify('Variant updated.');
      } else {
        await window.orderly.createVariant(selectedId, { name: input.name, sku: input.sku || null, price_cents: input.price_cents, attributes: attrs });
        notify('Variant added.');
      }
      setShowVariant(false);
      setEditingVariant(null);
      await load();
      select(selectedId);
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function pickImage() {
    if (!selectedId) return;
    try {
      const p = await window.orderly.pickProductImage(selectedId);
      setDetail({ ...p, variants: detail?.variants ?? [] });
      notify('Product image updated.');
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  async function remove() {
    if (!selectedId) return;
    setConfirmDelete(false);
    try {
      await window.orderly.deleteProduct(selectedId);
      notify('Product removed. Historical order items keep their snapshots.');
      setSelectedId(null);
      setDetail(null);
      load();
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-sub">Lightweight catalog for order line items — no costing or inventory here.</p>
        </div>
        <div className="btn-row">
          <TextInput className="search-input" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <button className="btn btn-sm" onClick={() => setShowCategory(true)}>Categories</button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>New product</button>
        </div>
      </div>

      <div className="toolbar">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
        </label>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : products.length === 0 ? (
        <EmptyState
          title="No products yet"
          body="Create products with variants so orders can carry real line items. You can also import them from CSV later."
          actionLabel="New product"
          onAction={() => setShowNew(true)}
        />
      ) : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div className="table-wrap" style={{ flex: 1 }}>
            <table className="data">
              <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th style={{ textAlign: 'right' }}>Price</th><th>Status</th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className={selectedId === p.id ? 'row-selected' : ''} onClick={() => select(p.id)} style={{ cursor: 'pointer' }} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') select(p.id); }}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>{p.sku ?? '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{p.category_name ?? '—'}</td>
                    <td className="num"><Money cents={p.base_price_cents} /></td>
                    <td>{p.active ? <StatusPill tone="sage">Active</StatusPill> : <StatusPill tone="gray">Inactive</StatusPill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detail && (
            <div style={{ flex: '0 0 380px', minWidth: 0 }}>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3 style={{ fontSize: 16 }}>{detail.name}</h3>
                  <div className="btn-row">
                    <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
                    <button className="btn btn-sm" onClick={() => setConfirmDelete(true)}>Remove</button>
                  </div>
                </div>
                <div style={{ margin: '8px 0' }}>
                  {detail.image_path ? (
                    <img src={imageUrl(detail.image_path)} alt={detail.name} style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8, border: '1px solid var(--border)' }} />
                  ) : (
                    <div style={{ color: 'var(--muted)', fontSize: 12 }}>No image.</div>
                  )}
                  <div className="btn-row" style={{ marginTop: 6 }}>
                    <button className="btn btn-sm" onClick={pickImage}>Choose image…</button>
                    {detail.image_path && (
                      <button className="btn btn-sm" onClick={async () => {
                        try { const p = await window.orderly.clearProductImage(detail.id); setDetail({ ...p, variants: detail.variants }); }
                        catch (e) { notifyError(errMsg(e)); }
                      }}>Remove image</button>
                    )}
                  </div>
                </div>
                <dl className="kv">
                  <dt>SKU</dt><dd className="mono">{detail.sku ?? '—'}</dd>
                  <dt>Category</dt><dd>{detail.category_name ?? '—'}</dd>
                  <dt>Price</dt><dd><Money cents={detail.base_price_cents} /></dd>
                  <dt>Marketplace ID</dt><dd className="mono">{detail.marketplace_id ?? '—'}</dd>
                </dl>
                {detail.description && <p style={{ fontSize: 13, marginTop: 8 }}>{detail.description}</p>}
              </div>

              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <h3>Variants ({detail.variants.length})</h3>
                  <button className="btn btn-sm" onClick={() => { setEditingVariant(null); setShowVariant(true); }}>Add variant</button>
                </div>
                {detail.variants.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>No variants — the base product is used as-is.</p>
                ) : (
                  detail.variants.map((v) => (
                    <div key={v.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 6, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>{v.name}</strong>
                        <span>
                          <button className="btn btn-sm" style={{ padding: '1px 6px', marginRight: 4 }} onClick={() => { setEditingVariant(v); setShowVariant(true); }}>Edit</button>
                          <button className="btn btn-sm" style={{ padding: '1px 6px' }} onClick={() => setConfirmDeleteVariant(v.id)}>Delete</button>
                        </span>
                      </div>
                      <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                        {v.sku && <span className="mono">{v.sku} · </span>}
                        {v.price_cents != null ? <Money cents={v.price_cents} /> : 'Base price'}
                        {Object.keys(v.attributes).length > 0 && (
                          <span> · {Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {showNew && (
        <Modal title="New product" onClose={() => setShowNew(false)} wide>
          <ProductForm categories={categories} onSave={saveNew} onCancel={() => setShowNew(false)} saving={saving} />
        </Modal>
      )}
      {editing && detail && (
        <Modal title="Edit product" onClose={() => setEditing(false)} wide>
          <ProductForm initial={detail} categories={categories} onSave={saveEdit} onCancel={() => setEditing(false)} saving={saving} />
        </Modal>
      )}
      {showVariant && (
        <Modal title={editingVariant ? 'Edit variant' : 'Add variant'} onClose={() => { setShowVariant(false); setEditingVariant(null); }}>
          <VariantForm initial={editingVariant ?? undefined} onSave={saveVariant} onCancel={() => { setShowVariant(false); setEditingVariant(null); }} />
        </Modal>
      )}
      {showCategory && (
        <Modal title="Categories" onClose={() => setShowCategory(false)}>
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <TextInput value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category name" aria-label="New category name" />
            <button className="btn btn-primary btn-sm" onClick={async () => {
              if (!newCategory.trim()) return;
              try {
                await window.orderly.createCategory(newCategory.trim());
                setNewCategory('');
                setCategories(await window.orderly.listCategories());
                notify('Category created.');
              } catch (e) { notifyError(errMsg(e)); }
            }}>Add</button>
          </div>
          {categories.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No categories yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {categories.map((c) => <li key={c.id}>{c.name}</li>)}
            </ul>
          )}
        </Modal>
      )}
      {confirmDeleteVariant && detail && (
        <ConfirmDialog
          title="Delete variant"
          body="Delete this variant? It will be permanently removed from the product."
          confirmLabel="Delete variant"
          danger
          onConfirm={async () => {
            try {
              await window.orderly.deleteVariant(confirmDeleteVariant);
              const d = await window.orderly.getProduct(detail.id);
              setDetail(d);
            } catch (e) { notifyError(errMsg(e)); }
            setConfirmDeleteVariant(null);
          }}
          onCancel={() => setConfirmDeleteVariant(null)}
        />
      )}
      {confirmDelete && detail && (
        <ConfirmDialog
          title="Remove product"
          body={`Remove ${detail.name}? It will be hidden from the catalog. Historical order items keep their name, SKU, and price snapshots.`}
          confirmLabel="Remove product"
          danger
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
