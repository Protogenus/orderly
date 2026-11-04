import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import { statSync } from 'fs';
import { IPC } from '../shared/ipc.js';
import type {
  AppInfo,
  BackupResult,
  Customer,
  CustomerAddress,
  CustomerProfile,
  Fulfillment,
  ImportError,
  ImportJob,
  NewAddressInput,
  NewCustomerInput,
  NewNoteInput,
  NewOrderInput,
  NewOrderItemInput,
  NewPaymentInput,
  NewProductInput,
  NewVariantInput,
  Order,
  OrderFilters,
  OrderItem,
  OrderNote,
  OrderStatus,
  OrderStatusEvent,
  Payment,
  ProductionHandoff,
  Product,
  ProductCategory,
  ProductVariant,
  ReturnRecord,
  UpdateCustomerInput,
  UpdateOrderInput,
  UpdateProductInput,
  UpdateVariantInput,
} from '../shared/types.js';
import { AppError } from '../domain/errors.js';
import { getAllSettings, getSetting, setSetting } from '../database/settings.js';
import { getDbPath, dataDir } from '../database/index.js';
import { backupNow, restoreFlow } from './index.js';
import {
  optString,
  reqString,
  reqInt,
  optInt,
  reqEnum,
  optEnum,
  reqId,
  optId,
  reqDate,
  optDate,
  optEmail,
  optStringArray,
  moneyToCents,
} from '../shared/validate.js';
import { ORDER_SOURCES, ORDER_TRANSITIONS } from '../shared/constants.js';
import * as customers from '../database/customers.js';
import * as products from '../database/products.js';
import * as orders from '../database/orders.js';
import { saveProductImage } from './images.js';

function ok<T>(data: T) {
  return { ok: true, data };
}
function err(e: unknown) {
  if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message } };
  const message = e instanceof Error ? e.message : 'An unexpected error occurred.';
  return { ok: false, error: { code: 'INTERNAL', message } };
}

function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return ok(await fn(...args));
    } catch (e) {
      return err(e);
    }
  });
}

// ---------- input validation ----------

function vCustomer(input: unknown): NewCustomerInput {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    name: reqString(o.name, 'name', 200),
    email: optEmail(o.email, 'email'),
    phone: optString(o.phone, 'phone', 40),
    company: optString(o.company, 'company', 200),
    notes: optString(o.notes, 'notes', 2000),
    tags: optStringArray(o.tags, 'tags'),
  };
}

function vCustomerPatch(input: unknown): UpdateCustomerInput {
  const o = (input ?? {}) as Record<string, unknown>;
  const p: UpdateCustomerInput = {};
  if (o.name !== undefined) p.name = reqString(o.name, 'name', 200);
  if (o.email !== undefined) p.email = optEmail(o.email, 'email');
  if (o.phone !== undefined) p.phone = optString(o.phone, 'phone', 40);
  if (o.company !== undefined) p.company = optString(o.company, 'company', 200);
  if (o.notes !== undefined) p.notes = optString(o.notes, 'notes', 2000);
  if (o.tags !== undefined) p.tags = optStringArray(o.tags, 'tags');
  return p;
}

function vAddress(input: unknown): NewAddressInput {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    kind: reqEnum(o.kind, 'kind', ['billing', 'shipping'] as const),
    label: optString(o.label, 'label', 80),
    recipient: optString(o.recipient, 'recipient', 200),
    line1: reqString(o.line1, 'address line 1', 200),
    line2: optString(o.line2, 'address line 2', 200),
    city: reqString(o.city, 'city', 120),
    state: optString(o.state, 'state', 80),
    postal_code: optString(o.postal_code, 'postal code', 20),
    country: optString(o.country, 'country', 80) ?? 'US',
  };
}

function vProduct(input: unknown): NewProductInput {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    name: reqString(o.name, 'name', 200),
    sku: optString(o.sku, 'SKU', 80),
    description: optString(o.description, 'description', 2000),
    category_id: optId(o.category_id, 'category'),
    base_price_cents: moneyToCents(o.base_price_cents ?? 0, 'price'),
    active: o.active === undefined ? true : Boolean(o.active),
    marketplace_id: optString(o.marketplace_id, 'marketplace ID', 120),
  };
}

function vProductPatch(input: unknown): UpdateProductInput {
  const o = (input ?? {}) as Record<string, unknown>;
  const p: UpdateProductInput = {};
  if (o.name !== undefined) p.name = reqString(o.name, 'name', 200);
  if (o.sku !== undefined) p.sku = optString(o.sku, 'SKU', 80);
  if (o.description !== undefined) p.description = optString(o.description, 'description', 2000);
  if (o.category_id !== undefined) p.category_id = optId(o.category_id, 'category');
  if (o.base_price_cents !== undefined) p.base_price_cents = moneyToCents(o.base_price_cents, 'price');
  if (o.active !== undefined) p.active = Boolean(o.active);
  if (o.marketplace_id !== undefined) p.marketplace_id = optString(o.marketplace_id, 'marketplace ID', 120);
  return p;
}

function vVariant(input: unknown): NewVariantInput {
  const o = (input ?? {}) as Record<string, unknown>;
  const attrs: Record<string, string> = {};
  if (o.attributes && typeof o.attributes === 'object') {
    for (const [k, v] of Object.entries(o.attributes as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) attrs[k.slice(0, 40)] = v.trim().slice(0, 120);
    }
  }
  return {
    name: reqString(o.name, 'variant name', 200),
    sku: optString(o.sku, 'SKU', 80),
    price_cents: o.price_cents === undefined || o.price_cents === null ? null : moneyToCents(o.price_cents, 'variant price'),
    attributes: attrs,
    active: o.active === undefined ? true : Boolean(o.active),
  };
}

function vVariantPatch(input: unknown): UpdateVariantInput {
  const o = (input ?? {}) as Record<string, unknown>;
  const p: UpdateVariantInput = {};
  if (o.name !== undefined) p.name = reqString(o.name, 'variant name', 200);
  if (o.sku !== undefined) p.sku = optString(o.sku, 'SKU', 80);
  if (o.price_cents !== undefined) p.price_cents = o.price_cents === null ? null : moneyToCents(o.price_cents, 'variant price');
  if (o.attributes !== undefined) p.attributes = vVariant({ ...o, name: 'x' }).attributes;
  if (o.active !== undefined) p.active = Boolean(o.active);
  return p;
}

function vOrderItem(o: Record<string, unknown>, idx: number): NewOrderItemInput {
  const field = (n: string) => `${n} (item ${idx + 1})`;
  return {
    product_id: optId(o.product_id, field('product')),
    variant_id: optId(o.variant_id, field('variant')),
    description: reqString(o.description, field('description'), 500),
    sku: optString(o.sku, field('SKU'), 80),
    quantity: reqInt(o.quantity, field('quantity'), 1, 1000000),
    unit_price_cents: moneyToCents(o.unit_price_cents ?? 0, field('unit price')),
    discount_cents: o.discount_cents === undefined ? 0 : moneyToCents(o.discount_cents, field('discount')),
    tax_cents: o.tax_cents === undefined ? 0 : moneyToCents(o.tax_cents, field('tax')),
    requires_production: Boolean(o.requires_production),
  };
}

function vOrder(input: unknown): NewOrderInput {
  const o = (input ?? {}) as Record<string, unknown>;
  const rawItems = o.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new AppError('VALIDATION', 'An order must have at least one item.');
  }
  if (rawItems.length > 500) throw new AppError('VALIDATION', 'An order cannot have more than 500 items.');
  return {
    customer_id: optId(o.customer_id, 'customer'),
    order_date: o.order_date === undefined ? new Date().toISOString().slice(0, 10) : reqDate(o.order_date, 'order date'),
    source: o.source === undefined ? 'Manual' : reqEnum(o.source, 'source', ORDER_SOURCES),
    priority: o.priority === undefined ? 'normal' : reqEnum(o.priority, 'priority', ['low', 'normal', 'high', 'urgent'] as const),
    requested_date: optDate(o.requested_date, 'requested date'),
    internal_notes: optString(o.internal_notes, 'internal notes', 4000),
    customer_notes: optString(o.customer_notes, 'customer notes', 4000),
    tags: optStringArray(o.tags, 'tags'),
    discount_cents: o.discount_cents === undefined ? 0 : moneyToCents(o.discount_cents, 'order discount'),
    shipping_cents: o.shipping_cents === undefined ? 0 : moneyToCents(o.shipping_cents, 'shipping charge'),
    tax_cents: o.tax_cents === undefined ? 0 : moneyToCents(o.tax_cents, 'order tax'),
    ship_recipient: optString(o.ship_recipient, 'recipient', 200),
    ship_line1: optString(o.ship_line1, 'address line 1', 200),
    ship_line2: optString(o.ship_line2, 'address line 2', 200),
    ship_city: optString(o.ship_city, 'city', 120),
    ship_state: optString(o.ship_state, 'state', 80),
    ship_postal: optString(o.ship_postal, 'postal code', 20),
    ship_country: optString(o.ship_country, 'country', 80),
    ship_method: optString(o.ship_method, 'shipping method', 80),
    items: rawItems.map((r, i) => vOrderItem((r ?? {}) as Record<string, unknown>, i)),
  };
}

function vOrderPatch(input: unknown): UpdateOrderInput {
  const o = (input ?? {}) as Record<string, unknown>;
  const p: UpdateOrderInput = {};
  if (o.customer_id !== undefined) p.customer_id = optId(o.customer_id, 'customer');
  if (o.order_date !== undefined) p.order_date = reqDate(o.order_date, 'order date');
  if (o.source !== undefined) p.source = reqEnum(o.source, 'source', ORDER_SOURCES);
  if (o.priority !== undefined) p.priority = reqEnum(o.priority, 'priority', ['low', 'normal', 'high', 'urgent'] as const);
  if (o.requested_date !== undefined) p.requested_date = optDate(o.requested_date, 'requested date');
  if (o.internal_notes !== undefined) p.internal_notes = optString(o.internal_notes, 'internal notes', 4000);
  if (o.customer_notes !== undefined) p.customer_notes = optString(o.customer_notes, 'customer notes', 4000);
  if (o.tags !== undefined) p.tags = optStringArray(o.tags, 'tags');
  if (o.discount_cents !== undefined) p.discount_cents = moneyToCents(o.discount_cents, 'order discount');
  if (o.shipping_cents !== undefined) p.shipping_cents = moneyToCents(o.shipping_cents, 'shipping charge');
  if (o.tax_cents !== undefined) p.tax_cents = moneyToCents(o.tax_cents, 'order tax');
  if (o.ship_recipient !== undefined) p.ship_recipient = optString(o.ship_recipient, 'recipient', 200);
  if (o.ship_line1 !== undefined) p.ship_line1 = optString(o.ship_line1, 'address line 1', 200);
  if (o.ship_line2 !== undefined) p.ship_line2 = optString(o.ship_line2, 'address line 2', 200);
  if (o.ship_city !== undefined) p.ship_city = optString(o.ship_city, 'city', 120);
  if (o.ship_state !== undefined) p.ship_state = optString(o.ship_state, 'state', 80);
  if (o.ship_postal !== undefined) p.ship_postal = optString(o.ship_postal, 'postal code', 20);
  if (o.ship_country !== undefined) p.ship_country = optString(o.ship_country, 'country', 80);
  if (o.ship_method !== undefined) p.ship_method = optString(o.ship_method, 'shipping method', 80);
  if (o.items !== undefined) {
    if (!Array.isArray(o.items) || o.items.length === 0) throw new AppError('VALIDATION', 'An order must have at least one item.');
    p.items = (o.items as unknown[]).map((r, i) => vOrderItem((r ?? {}) as Record<string, unknown>, i));
  }
  return p;
}

function vOrderFilters(input: unknown): OrderFilters {
  const o = (input ?? {}) as Record<string, unknown>;
  const statuses = o.statuses;
  return {
    search: optString(o.search, 'search', 200) ?? undefined,
    statuses: Array.isArray(statuses)
      ? statuses.map((s) => reqEnum(s, 'status', Object.keys(ORDER_TRANSITIONS) as OrderStatus[]))
      : undefined,
    customer_id: optId(o.customer_id, 'customer') ?? undefined,
    source: o.source === undefined ? undefined : reqEnum(o.source, 'source', ORDER_SOURCES),
    overdue: o.overdue === undefined ? undefined : Boolean(o.overdue),
    include_archived: o.include_archived === undefined ? undefined : Boolean(o.include_archived),
    limit: optInt(o.limit, 'limit', 1, 500) ?? undefined,
    offset: optInt(o.offset, 'offset', 0, 1000000) ?? undefined,
    sort: o.sort === undefined ? undefined : reqEnum(o.sort, 'sort', ['order_date', 'order_number', 'grand_total_cents', 'requested_date', 'updated_at'] as const),
    dir: o.dir === undefined ? undefined : reqEnum(o.dir, 'dir', ['asc', 'desc'] as const),
  };
}

// ---------- registration ----------

const ALLOWED_SETTINGS = new Set([
  'company_name',
  'order_number_prefix',
  'default_currency',
  'sample_data_enabled',
  'last_page',
]);

export function registerIpc(): void {
  handle<AppInfo>(IPC.appGetInfo, () => ({
    version: app.getVersion(),
    dataDir: dataDir(),
    dbPath: getDbPath(),
  }));

  handle(IPC.settingsGet, () => getAllSettings());

  handle(IPC.settingsSet, (key: unknown, value: unknown) => {
    const k = reqString(key, 'setting key', 64);
    if (!ALLOWED_SETTINGS.has(k)) throw new AppError('VALIDATION', `Unknown setting: ${k}.`);
    if (k === 'sample_data_enabled') {
      const v = optString(value, 'value', 8);
      if (v !== '0' && v !== '1') throw new AppError('VALIDATION', 'sample_data_enabled must be 0 or 1.');
      setSetting(k, v ?? '0');
    } else if (k === 'default_currency') {
      setSetting(k, reqString(value, 'value', 8).toUpperCase());
    } else {
      setSetting(k, optString(value, 'value', 200) ?? '');
    }
    return getSetting(k);
  });

  handle<BackupResult>(IPC.backupCreate, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose backup location',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) {
      throw new AppError('CANCELED', 'Backup canceled.');
    }
    const path = backupNow(res.filePaths[0]);
    const size = statSync(path).size;
    return { path, size_bytes: size };
  });

  handle(IPC.backupRestore, async () => {
    await restoreFlow();
    return null;
  });

  handle<string | null>(IPC.dialogPickBackupFile, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose an Orderly backup file',
      filters: [{ name: 'Orderly backups', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  // ----- customers -----
  handle<Customer[]>(IPC.customersList, (search?: unknown, includeDeleted?: unknown) =>
    customers.listCustomers(optString(search, 'search', 200) ?? '', Boolean(includeDeleted)),
  );
  handle<CustomerProfile>(IPC.customersGet, (id: unknown) => customers.getCustomerProfile(reqId(id)));
  handle<Customer>(IPC.customersCreate, (input: unknown) => customers.createCustomer(vCustomer(input)));
  handle<Customer>(IPC.customersUpdate, (id: unknown, patch: unknown) =>
    customers.updateCustomer(reqId(id), vCustomerPatch(patch)),
  );
  handle(IPC.customersDelete, (id: unknown) => {
    customers.deleteCustomer(reqId(id));
    return null;
  });
  handle<Customer[]>(IPC.customersCheckDuplicate, (email: unknown, excludeId: unknown) => {
    const e = optString(email, 'email', 320);
    if (!e) return [];
    return customers.findDuplicateEmails(e, optId(excludeId, 'exclude') ?? undefined);
  });
  handle<CustomerAddress[]>(IPC.customersListAddresses, (customerId: unknown) =>
    customers.listAddresses(reqId(customerId, 'customer')),
  );
  handle<CustomerAddress>(IPC.customersAddAddress, (customerId: unknown, input: unknown) =>
    customers.addAddress(reqId(customerId, 'customer'), vAddress(input)),
  );
  handle(IPC.customersDeleteAddress, (id: unknown) => {
    customers.deleteAddress(reqId(id));
    return null;
  });

  // ----- products -----
  handle<Product[]>(IPC.productsList, (opts: unknown) => {
    const o = (opts ?? {}) as Record<string, unknown>;
    return products.listProducts({
      search: optString(o.search, 'search', 200) ?? undefined,
      category_id: optId(o.category_id, 'category') ?? undefined,
      activeOnly: o.activeOnly === undefined ? undefined : Boolean(o.activeOnly),
    });
  });
  handle<ProductCategory[]>(IPC.productsListCategories, () => products.listCategories());
  handle<ProductCategory>(IPC.productsCreateCategory, (name: unknown) =>
    products.createCategory(reqString(name, 'category name', 120)),
  );
  handle(IPC.productsGet, (id: unknown) => products.getProduct(reqId(id)));
  handle(IPC.productsCreate, (input: unknown) => products.createProduct(vProduct(input)));
  handle(IPC.productsUpdate, (id: unknown, patch: unknown) =>
    products.updateProduct(reqId(id), vProductPatch(patch)),
  );
  handle(IPC.productsDelete, (id: unknown) => {
    products.deleteProduct(reqId(id));
    return null;
  });
  handle<ProductVariant>(IPC.productsCreateVariant, (productId: unknown, input: unknown) =>
    products.createVariant(reqId(productId, 'product'), vVariant(input)),
  );
  handle<ProductVariant>(IPC.productsUpdateVariant, (id: unknown, patch: unknown) =>
    products.updateVariant(reqId(id), vVariantPatch(patch)),
  );
  handle(IPC.productsDeleteVariant, (id: unknown) => {
    products.deleteVariant(reqId(id));
    return null;
  });
  handle(IPC.productsPickImage, async (id: unknown) => {
    const productId = reqId(id);
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose product image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return products.getProduct(productId);
    const rel = saveProductImage(res.filePaths[0]);
    return products.setProductImage(productId, rel);
  });
  handle(IPC.productsClearImage, (id: unknown) => products.setProductImage(reqId(id), null));

  // ----- orders -----
  handle(IPC.ordersList, (filters: unknown) => orders.listOrders(vOrderFilters(filters)));
  handle<Order>(IPC.ordersGet, (id: unknown) => orders.getOrder(reqId(id)));
  handle<Order>(IPC.ordersCreate, (input: unknown) => orders.createOrder(vOrder(input)));
  handle<Order>(IPC.ordersUpdate, (id: unknown, patch: unknown) =>
    orders.updateOrder(reqId(id), vOrderPatch(patch)),
  );
  handle<Order>(IPC.ordersDuplicate, (id: unknown) => orders.duplicateOrder(reqId(id)));
  handle<Order>(IPC.ordersSetStatus, (id: unknown, to: unknown, note: unknown) =>
    orders.setOrderStatus(reqId(id), reqEnum(to, 'status', Object.keys(ORDER_TRANSITIONS) as OrderStatus[]), optString(note, 'note', 500)),
  );
  handle<Order>(IPC.ordersCancel, (id: unknown, note: unknown) =>
    orders.cancelOrder(reqId(id), optString(note, 'note', 500)),
  );
  handle<Order>(IPC.ordersArchive, (id: unknown, archived: unknown) =>
    orders.archiveOrder(reqId(id), Boolean(archived)),
  );
  handle<OrderStatusEvent[]>(IPC.ordersStatusHistory, (id: unknown) => orders.getStatusHistory(reqId(id)));
  handle<OrderNote>(IPC.ordersAddNote, (id: unknown, input: unknown) => {
    const o = (input ?? {}) as Record<string, unknown>;
    const note: NewNoteInput = {
      kind: reqEnum(o.kind, 'kind', ['internal', 'customer'] as const),
      body: reqString(o.body, 'note', 4000),
    };
    return orders.addNote(reqId(id), note);
  });
  handle<OrderNote[]>(IPC.ordersListNotes, (id: unknown) => orders.listNotes(reqId(id)));
  handle(IPC.ordersAddPayment, (id: unknown, input: unknown) => {
    const o = (input ?? {}) as Record<string, unknown>;
    const payment: NewPaymentInput = {
      amount_cents: moneyToCents(o.amount_cents ?? 0, 'amount'),
      method: optString(o.method, 'method', 80),
      reference: optString(o.reference, 'reference', 120),
      paid_at: o.paid_at === undefined ? new Date().toISOString().slice(0, 10) : reqDate(o.paid_at, 'payment date'),
      note: optString(o.note, 'note', 500),
    };
    if (payment.amount_cents <= 0) throw new AppError('VALIDATION', 'Payment amount must be greater than zero.');
    return orders.addPayment(reqId(id), payment);
  });
  handle<Payment[]>(IPC.ordersListPayments, (id: unknown) => orders.listPayments(reqId(id)));
  handle(IPC.ordersInbox, () => orders.inboxBuckets());
}
