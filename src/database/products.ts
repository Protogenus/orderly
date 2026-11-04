import { getDb, tx } from './index.js';
import { newId, nowIso } from '../domain/ids.js';
import { AppError } from '../domain/errors.js';
import type {
  NewProductInput,
  NewVariantInput,
  Product,
  ProductCategory,
  ProductVariant,
  UpdateProductInput,
  UpdateVariantInput,
} from '../shared/types.js';

function rowToProduct(r: any): Product {
  return { ...r, active: r.active === 1 };
}
function rowToVariant(r: any): ProductVariant {
  return { ...r, active: r.active === 1, attributes: JSON.parse(r.attributes ?? '{}') };
}

export function listCategories(): ProductCategory[] {
  return getDb().prepare(`SELECT * FROM product_categories ORDER BY name COLLATE NOCASE`).all() as ProductCategory[];
}

export function createCategory(name: string): ProductCategory {
  const c: ProductCategory = { id: newId('cat'), name, created_at: nowIso() };
  try {
    getDb().prepare(`INSERT INTO product_categories (id, name, created_at) VALUES (?, ?, ?)`).run(c.id, c.name, c.created_at);
  } catch {
    throw new AppError('CONFLICT', `Category "${name}" already exists.`);
  }
  return c;
}

export interface ProductListOptions {
  search?: string;
  category_id?: string;
  activeOnly?: boolean;
}

export function listProducts(opts: ProductListOptions = {}): Product[] {
  const db = getDb();
  let sql = `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN product_categories c ON c.id = p.category_id WHERE p.deleted_at IS NULL`;
  const params: unknown[] = [];
  if (opts.activeOnly) sql += ` AND p.active = 1`;
  if (opts.category_id) {
    sql += ` AND p.category_id = ?`;
    params.push(opts.category_id);
  }
  if (opts.search?.trim()) {
    sql += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ?)`;
    const q = `%${opts.search.trim()}%`;
    params.push(q, q, q);
  }
  sql += ` ORDER BY p.name COLLATE NOCASE`;
  return (db.prepare(sql).all(...params) as any[]).map(rowToProduct);
}

export function getProduct(id: string): Product & { variants: ProductVariant[] } {
  const row = getDb()
    .prepare(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN product_categories c ON c.id = p.category_id WHERE p.id = ?`)
    .get(id) as any;
  if (!row || row.deleted_at) throw new AppError('NOT_FOUND', 'Product not found.');
  const variants = (getDb().prepare(`SELECT * FROM product_variants WHERE product_id = ? ORDER BY name`).all(id) as any[]).map(rowToVariant);
  return { ...rowToProduct(row), variants };
}

export function createProduct(input: NewProductInput): Product {
  return tx((db) => {
    const now = nowIso();
    const p: Product = {
      id: newId('prd'),
      name: input.name,
      sku: input.sku ?? null,
      description: input.description ?? null,
      image_path: null,
      category_id: input.category_id ?? null,
      category_name: null,
      base_price_cents: input.base_price_cents,
      active: input.active ?? true,
      marketplace_id: input.marketplace_id ?? null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    db.prepare(
      `INSERT INTO products (id, name, sku, description, image_path, category_id, base_price_cents, active, marketplace_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(p.id, p.name, p.sku, p.description, p.category_id, p.base_price_cents, p.active ? 1 : 0, p.marketplace_id, p.created_at, p.updated_at);
    return { ...p, variants: [] } as Product & { variants: ProductVariant[] };
  });
}

export function updateProduct(id: string, patch: UpdateProductInput): Product {
  return tx(() => {
    getProduct(id);
    const db = getDb();
    const fields: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, v: unknown) => {
      fields.push(`${col} = ?`);
      params.push(v);
    };
    if (patch.name !== undefined) set('name', patch.name);
    if (patch.sku !== undefined) set('sku', patch.sku);
    if (patch.description !== undefined) set('description', patch.description);
    if (patch.category_id !== undefined) set('category_id', patch.category_id);
    if (patch.base_price_cents !== undefined) set('base_price_cents', patch.base_price_cents);
    if (patch.active !== undefined) set('active', patch.active ? 1 : 0);
    if (patch.marketplace_id !== undefined) set('marketplace_id', patch.marketplace_id);
    set('updated_at', nowIso());
    params.push(id);
    db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return getProduct(id);
  });
}

/** Soft delete; historical order items keep their snapshots. */
export function deleteProduct(id: string): void {
  tx((db) => {
    getProduct(id);
    db.prepare(`UPDATE products SET deleted_at = ?, updated_at = ?, active = 0 WHERE id = ?`).run(nowIso(), nowIso(), id);
  });
}

export function setProductImage(id: string, imagePath: string | null): Product {
  return tx((db) => {
    getProduct(id);
    db.prepare(`UPDATE products SET image_path = ?, updated_at = ? WHERE id = ?`).run(imagePath, nowIso(), id);
    return getProduct(id);
  });
}

export function createVariant(productId: string, input: NewVariantInput): ProductVariant {
  return tx((db) => {
    getProduct(productId);
    const v: ProductVariant = {
      id: newId('var'),
      product_id: productId,
      name: input.name,
      sku: input.sku ?? null,
      price_cents: input.price_cents ?? null,
      attributes: input.attributes ?? {},
      active: input.active ?? true,
      created_at: nowIso(),
    };
    db.prepare(
      `INSERT INTO product_variants (id, product_id, name, sku, price_cents, attributes, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(v.id, v.product_id, v.name, v.sku, v.price_cents, JSON.stringify(v.attributes), v.active ? 1 : 0, v.created_at);
    return v;
  });
}

export function updateVariant(id: string, patch: UpdateVariantInput): ProductVariant {
  return tx((db) => {
    const row = db.prepare(`SELECT * FROM product_variants WHERE id = ?`).get(id) as any;
    if (!row) throw new AppError('NOT_FOUND', 'Variant not found.');
    const fields: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, v: unknown) => {
      fields.push(`${col} = ?`);
      params.push(v);
    };
    if (patch.name !== undefined) set('name', patch.name);
    if (patch.sku !== undefined) set('sku', patch.sku);
    if (patch.price_cents !== undefined) set('price_cents', patch.price_cents);
    if (patch.attributes !== undefined) set('attributes', JSON.stringify(patch.attributes));
    if (patch.active !== undefined) set('active', patch.active ? 1 : 0);
    params.push(id);
    if (fields.length) db.prepare(`UPDATE product_variants SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return rowToVariant(db.prepare(`SELECT * FROM product_variants WHERE id = ?`).get(id) as any);
  });
}

export function deleteVariant(id: string): void {
  const r = getDb().prepare(`DELETE FROM product_variants WHERE id = ?`).run(id);
  if (r.changes === 0) throw new AppError('NOT_FOUND', 'Variant not found.');
}
