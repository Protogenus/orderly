import Papa from 'papaparse';
import { readFileSync } from 'fs';
import { AppError } from './errors.js';

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

const MAX_ROWS = 50000;
const MAX_BYTES = 50 * 1024 * 1024;

/** Parse a CSV file into string-valued row objects. Throws human-readable errors. */
export function parseCsvFile(path: string): ParsedCsv {
  let text: string;
  try {
    const buf = readFileSync(path);
    if (buf.length > MAX_BYTES) throw new AppError('VALIDATION', 'CSV file is too large (max 50 MB).');
    // Strip BOM for clean header names.
    text = buf.toString('utf-8').replace(/^\uFEFF/, '');
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('IO', 'Could not read the CSV file.');
  }
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const columns = result.meta.fields ?? [];
  if (columns.length === 0) throw new AppError('VALIDATION', 'The CSV has no header row.');
  const rows = (result.data as Record<string, string>[]).filter((r) =>
    Object.values(r).some((v) => v !== undefined && v !== null && String(v).trim() !== ''),
  );
  if (rows.length === 0) throw new AppError('VALIDATION', 'The CSV has no data rows.');
  if (rows.length > MAX_ROWS) throw new AppError('VALIDATION', `Too many rows (max ${MAX_ROWS}).`);
  if (result.errors.length > 0) {
    const first = result.errors[0];
    throw new AppError('VALIDATION', `CSV parse error on row ${first.row ?? '?'}: ${first.message}`);
  }
  return { columns, rows, totalRows: rows.length };
}

export interface TargetField {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
}

/** Target fields per import kind. */
export const IMPORT_FIELDS: Record<string, TargetField[]> = {
  customers: [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email', required: false, hint: 'Used for duplicate detection' },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'company', label: 'Company', required: false },
    { key: 'notes', label: 'Notes', required: false },
    { key: 'tags', label: 'Tags', required: false, hint: 'Comma-separated' },
  ],
  products: [
    { key: 'name', label: 'Product name', required: true },
    { key: 'sku', label: 'SKU', required: false, hint: 'Used for duplicate detection' },
    { key: 'description', label: 'Description', required: false },
    { key: 'category', label: 'Category', required: false, hint: 'Created if missing' },
    { key: 'price', label: 'Selling price', required: true, hint: 'Dollars, e.g. 18.50' },
    { key: 'active', label: 'Active', required: false, hint: 'true/false, yes/no, 1/0' },
    { key: 'marketplace_id', label: 'Marketplace ID', required: false },
  ],
  orders: [
    { key: 'order_number', label: 'Order number', required: false, hint: 'Rows sharing a number become one order; blank = new order per row' },
    { key: 'order_date', label: 'Order date', required: true, hint: 'YYYY-MM-DD' },
    { key: 'customer_name', label: 'Customer name', required: false },
    { key: 'customer_email', label: 'Customer email', required: false, hint: 'Links to an existing customer or creates one' },
    { key: 'source', label: 'Source', required: false },
    { key: 'status', label: 'Status', required: false, hint: 'Defaults to New' },
    { key: 'priority', label: 'Priority', required: false },
    { key: 'requested_date', label: 'Requested date', required: false },
    { key: 'item_description', label: 'Item description', required: true },
    { key: 'item_sku', label: 'Item SKU', required: false },
    { key: 'item_quantity', label: 'Item quantity', required: true },
    { key: 'item_unit_price', label: 'Item unit price', required: true, hint: 'Dollars' },
    { key: 'item_discount', label: 'Item discount', required: false, hint: 'Dollars' },
    { key: 'item_tax', label: 'Item tax', required: false, hint: 'Dollars' },
    { key: 'discount', label: 'Order discount', required: false, hint: 'Dollars' },
    { key: 'shipping', label: 'Shipping charge', required: false, hint: 'Dollars' },
    { key: 'tax', label: 'Order tax', required: false, hint: 'Dollars' },
    { key: 'ship_recipient', label: 'Ship: recipient', required: false },
    { key: 'ship_line1', label: 'Ship: street', required: false },
    { key: 'ship_city', label: 'Ship: city', required: false },
    { key: 'ship_state', label: 'Ship: state', required: false },
    { key: 'ship_postal', label: 'Ship: postal code', required: false },
    { key: 'ship_country', label: 'Ship: country', required: false },
    { key: 'internal_notes', label: 'Internal notes', required: false },
    { key: 'customer_notes', label: 'Customer notes', required: false },
    { key: 'tags', label: 'Tags', required: false, hint: 'Comma-separated' },
  ],
};

/** Common real-world header spellings per target field, normalized (lowercase, alnum only). */
const HEADER_ALIASES: Record<string, Record<string, string[]>> = {
  customers: {
    name: ['name', 'customer', 'customername', 'fullname', 'full_name'],
    email: ['email', 'e-mail', 'emailaddress', 'customeremail'],
    phone: ['phone', 'phonenumber', 'telephone', 'tel'],
    company: ['company', 'business', 'organization'],
    notes: ['notes', 'note', 'comments'],
    tags: ['tags', 'labels'],
  },
  products: {
    name: ['name', 'product', 'productname', 'title', 'item', 'itemname'],
    sku: ['sku', 'productcode', 'code', 'itemcode'],
    description: ['description', 'desc', 'details'],
    category: ['category', 'type', 'department'],
    price: ['price', 'sellingprice', 'unitprice', 'cost', 'amount'],
    active: ['active', 'enabled', 'status'],
    marketplace_id: ['marketplaceid', 'marketplace', 'listingid', 'externalid'],
  },
  orders: {
    order_number: ['ordernumber', 'order', 'orderid', 'number', 'id'],
    order_date: ['orderdate', 'date', 'purchasedate', 'created'],
    customer_name: ['customername', 'customer', 'name', 'buyer', 'client'],
    customer_email: ['customeremail', 'email', 'e-mail', 'buyeremail'],
    source: ['source', 'channel', 'marketplace', 'origin'],
    status: ['status', 'state', 'orderstatus'],
    priority: ['priority'],
    requested_date: ['requesteddate', 'duedate', 'neededby', 'shipby'],
    item_description: ['itemdescription', 'item', 'product', 'productname', 'description', 'title'],
    item_sku: ['itemsku', 'sku', 'productcode'],
    item_quantity: ['itemquantity', 'quantity', 'qty', 'count'],
    item_unit_price: ['itemunitprice', 'unitprice', 'price', 'itemprice'],
    item_discount: ['itemdiscount', 'discount'],
    item_tax: ['itemtax', 'tax'],
    discount: ['orderdiscount', 'discount'],
    shipping: ['shipping', 'shippingcost', 'postage', 'delivery'],
    tax: ['ordertax', 'tax'],
    internal_notes: ['internalnotes', 'notes', 'adminnotes'],
    customer_notes: ['customernotes', 'buyernotes', 'message'],
    tags: ['tags', 'labels'],
  },
};

/** Auto-match CSV columns to target fields by normalized name. */
export function autoMap(columns: string[], kind: string): Record<string, string | null> {
  const fields = IMPORT_FIELDS[kind] ?? [];
  const aliases = HEADER_ALIASES[kind] ?? {};
  const out: Record<string, string | null> = {};
  for (const f of fields) {
    const want = aliases[f.key] ?? [f.key];
    let hit: string | null = null;
    for (const col of columns) {
      const norm = col.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (want.includes(norm)) {
        hit = col;
        break;
      }
    }
    out[f.key] = hit;
  }
  return out;
}

/** Serialize rows to CSV text. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return Papa.unparse({ fields: headers, data: rows });
}

export function parseBoolish(v: string | undefined): boolean | null {
  if (v === undefined) return null;
  const t = v.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'active'].includes(t)) return true;
  if (['false', 'no', 'n', '0', 'inactive'].includes(t)) return false;
  return null;
}
