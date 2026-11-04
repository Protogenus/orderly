/** Shared domain types between main and renderer. Money is ALWAYS integer minor units (cents). */

export type ID = string;

export interface IpcOk<T> {
  ok: true;
  data: T;
}
export interface IpcErr {
  ok: false;
  error: { code: string; message: string };
}
export type IpcResult<T> = IpcOk<T> | IpcErr;

export type OrderStatus =
  | 'draft'
  | 'new'
  | 'confirmed'
  | 'awaiting_production'
  | 'in_production'
  | 'ready_to_fulfill'
  | 'packing'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'on_hold'
  | 'canceled';

export type OrderPriority = 'low' | 'normal' | 'high' | 'urgent';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overpaid' | 'refunded';

export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'awaiting_return'
  | 'received'
  | 'inspected'
  | 'resolved'
  | 'rejected';

export type HandoffStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'failed';

export interface Customer {
  id: ID;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CustomerAddress {
  id: ID;
  customer_id: ID;
  kind: 'billing' | 'shipping';
  label: string | null;
  recipient: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string | null;
  country: string;
  created_at: string;
}

export interface CustomerProfile extends Customer {
  order_count: number;
  total_sales_cents: number;
  average_order_cents: number;
  outstanding_cents: number;
  recent_products: { product_name: string; purchased_at: string }[];
}

export interface ProductCategory {
  id: ID;
  name: string;
  created_at: string;
}

export interface Product {
  id: ID;
  name: string;
  sku: string | null;
  description: string | null;
  image_path: string | null;
  category_id: ID | null;
  category_name: string | null;
  base_price_cents: number;
  active: boolean;
  marketplace_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProductVariant {
  id: ID;
  product_id: ID;
  name: string;
  sku: string | null;
  price_cents: number | null;
  attributes: Record<string, string>;
  active: boolean;
  created_at: string;
}

export interface OrderItem {
  id: ID;
  order_id: ID;
  product_id: ID | null;
  variant_id: ID | null;
  description: string;
  sku: string | null;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_cents: number;
  line_total_cents: number;
  requires_production: boolean;
  position: number;
}

export interface Order {
  id: ID;
  order_number: string;
  order_date: string;
  customer_id: ID | null;
  customer_name: string | null;
  source: string;
  status: OrderStatus;
  priority: OrderPriority;
  requested_date: string | null;
  internal_notes: string | null;
  customer_notes: string | null;
  tags: string[];
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  grand_total_cents: number;
  paid_cents: number;
  balance_cents: number;
  payment_status: PaymentStatus;
  ship_recipient: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_postal: string | null;
  ship_country: string | null;
  ship_method: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
}

export interface OrderStatusEvent {
  id: ID;
  order_id: ID;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  note: string | null;
  created_at: string;
}

export interface OrderNote {
  id: ID;
  order_id: ID;
  kind: 'internal' | 'customer';
  body: string;
  created_at: string;
}

export interface Payment {
  id: ID;
  order_id: ID;
  amount_cents: number;
  method: string | null;
  reference: string | null;
  paid_at: string;
  note: string | null;
  created_at: string;
}

export interface Fulfillment {
  id: ID;
  order_id: ID;
  status: 'packing' | 'ready_to_ship' | 'shipped';
  package_notes: string | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  created_at: string;
  updated_at: string;
  items: FulfillmentItem[];
  shipment: Shipment | null;
}

export interface FulfillmentItem {
  id: ID;
  fulfillment_id: ID;
  order_item_id: ID;
  quantity_packed: number;
}

export interface Shipment {
  id: ID;
  fulfillment_id: ID;
  order_id: ID;
  carrier: string | null;
  service: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  shipping_cost_cents: number;
  package_summary: string | null;
  created_at: string;
}

export interface ProductionHandoff {
  id: ID;
  order_id: ID;
  status: HandoffStatus;
  items: { order_item_id: ID; quantity: number; description: string }[];
  envelope_path: string | null;
  accepted_at: string | null;
  progress_note: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReturnRecord {
  id: ID;
  order_id: ID;
  status: ReturnStatus;
  reason: string | null;
  refund_status: string | null;
  replacement_order_id: ID | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  items: ReturnItemDetail[];
}

export interface ReturnItem {
  id: ID;
  return_id: ID;
  order_item_id: ID;
  quantity: number;
  reason: string | null;
}

export interface ReturnItemDetail extends ReturnItem {
  description: string;
  sku: string | null;
  quantity_ordered: number;
}

export interface ImportJob {
  id: ID;
  kind: string;
  filename: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_rows: number;
  imported_rows: number;
  error_rows: number;
  created_at: string;
  finished_at: string | null;
}

export interface ImportError {
  id: ID;
  import_job_id: ID;
  row_number: number;
  message: string;
  raw_row: string | null;
}

export interface Integration {
  id: ID;
  name: string;
  kind: string;
  status: 'not_connected' | 'connected' | 'error';
  config_json: string | null;
  last_sync_at: string | null;
  created_at: string;
}

export interface DashboardStats {
  open_orders: number;
  awaiting_processing: number;
  awaiting_production: number;
  ready_for_packing: number;
  awaiting_shipment: number;
  overdue_orders: number;
  completed_recent: number;
  recent_activity: { id: ID; order_id: ID; order_number: string; to_status: OrderStatus; created_at: string }[];
}

export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
}

export type SettingKey =
  | 'company_name'
  | 'order_number_prefix'
  | 'order_number_next'
  | 'default_currency'
  | 'sample_data_enabled'
  | 'window_bounds'
  | 'last_page';

export interface BackupResult {
  path: string;
  size_bytes: number;
}

export interface InboxBuckets {
  unreviewed: (Order & { item_count: number })[];
  needs_attention: (Order & { item_count: number })[];
  missing_info: (Order & { item_count: number })[];
  payment_issues: (Order & { item_count: number })[];
  approaching_due: (Order & { item_count: number })[];
}

// ---------- inputs ----------

export interface NewCustomerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
  tags?: string[];
}
export type UpdateCustomerInput = Partial<NewCustomerInput>;

export interface NewAddressInput {
  kind: 'billing' | 'shipping';
  label?: string | null;
  recipient?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  country?: string;
}

export interface NewProductInput {
  name: string;
  sku?: string | null;
  description?: string | null;
  category_id?: string | null;
  base_price_cents: number;
  active?: boolean;
  marketplace_id?: string | null;
}
export type UpdateProductInput = Partial<NewProductInput>;

export interface NewVariantInput {
  name: string;
  sku?: string | null;
  price_cents?: number | null;
  attributes?: Record<string, string>;
  active?: boolean;
}
export type UpdateVariantInput = Partial<NewVariantInput>;

export interface NewOrderItemInput {
  product_id?: string | null;
  variant_id?: string | null;
  description: string;
  sku?: string | null;
  quantity: number;
  unit_price_cents: number;
  discount_cents?: number;
  tax_cents?: number;
  requires_production?: boolean;
}

export interface NewOrderInput {
  customer_id?: string | null;
  order_date: string;
  source?: string;
  priority?: OrderPriority;
  requested_date?: string | null;
  internal_notes?: string | null;
  customer_notes?: string | null;
  tags?: string[];
  discount_cents?: number;
  shipping_cents?: number;
  tax_cents?: number;
  ship_recipient?: string | null;
  ship_line1?: string | null;
  ship_line2?: string | null;
  ship_city?: string | null;
  ship_state?: string | null;
  ship_postal?: string | null;
  ship_country?: string | null;
  ship_method?: string | null;
  items: NewOrderItemInput[];
}
export interface UpdateOrderInput extends Partial<Omit<NewOrderInput, 'items'>> {
  items?: NewOrderItemInput[];
}

export interface OrderFilters {
  search?: string;
  statuses?: OrderStatus[];
  customer_id?: string;
  source?: string;
  overdue?: boolean;
  include_archived?: boolean;
  limit?: number;
  offset?: number;
  sort?: 'order_date' | 'order_number' | 'grand_total_cents' | 'requested_date' | 'updated_at';
  dir?: 'asc' | 'desc';
}

export interface NewNoteInput {
  kind: 'internal' | 'customer';
  body: string;
}

export interface NewPaymentInput {
  amount_cents: number;
  method?: string | null;
  reference?: string | null;
  paid_at: string;
  note?: string | null;
}

export interface PackItemInput {
  order_item_id: string;
  quantity: number;
}

export interface ReadyToShipInput {
  package_notes?: string | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
}

export interface ShipInput {
  carrier?: string | null;
  service?: string | null;
  tracking_number?: string | null;
  shipped_at: string;
  shipping_cost_cents: number;
  package_summary?: string | null;
}

export interface FulfillmentItemDetail extends FulfillmentItem {
  description: string;
  sku: string | null;
  quantity_ordered: number;
}

export interface FulfillmentDetail extends Fulfillment {
  order_number: string;
  customer_name: string | null;
  items: FulfillmentItemDetail[];
}

export interface WorkspaceBucket {
  orders: (Order & { item_count: number; packed_count: number })[];
  fulfillments: FulfillmentDetail[];
}

export interface WorkspaceData {
  ready_to_pack: (Order & { item_count: number; packed_count: number })[];
  packing: (Order & { item_count: number; packed_count: number })[];
  ready_to_ship: FulfillmentDetail[];
  shipped: FulfillmentDetail[];
  awaiting_delivery: FulfillmentDetail[];
}

export interface StagepointDetection {
  connected: boolean;
  inbox_dir: string | null;
  outbox_dir: string;
  message: string;
}

export type ReportId =
  | 'orders_over_time'
  | 'sales_over_time'
  | 'orders_by_status'
  | 'orders_by_channel'
  | 'best_sellers'
  | 'average_order_value'
  | 'customer_history'
  | 'fulfillment_performance'
  | 'late_orders'
  | 'canceled_orders'
  | 'returns';

export interface ReportResult {
  id: ReportId;
  title: string;
  note: string;
  columns: string[];
  rows: (string | number)[][];
  csv: string;
}

export interface ImportAnalysisDto {
  jobId: string;
  kind: string;
  columns: string[];
  totalRows: number;
  sampleRows: Record<string, string>[];
  autoMapping: Record<string, string | null>;
  fields: { key: string; label: string; required: boolean; hint?: string }[];
}

export interface ImportValidationDto {
  validRows: number;
  errors: { row: number; message: string }[];
  duplicates: { row: number; reason: string }[];
}

export interface ImportApplyDto {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}
