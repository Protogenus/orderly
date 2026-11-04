import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';
import type {
  AppInfo,
  BackupResult,
  Customer,
  CustomerAddress,
  CustomerProfile,
  InboxBuckets,
  NewAddressInput,
  NewCustomerInput,
  NewNoteInput,
  NewOrderInput,
  NewPaymentInput,
  NewProductInput,
  NewVariantInput,
  Order,
  OrderFilters,
  OrderNote,
  OrderStatus,
  OrderStatusEvent,
  Payment,
  Product,
  ProductCategory,
  ProductVariant,
  UpdateCustomerInput,
  UpdateOrderInput,
  UpdateProductInput,
  UpdateVariantInput,
} from '../shared/types.js';

/** Unwrap the IPC envelope; surface main-process errors as thrown Errors. */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).then((res) => {
    if (res && res.ok === true) return res.data as T;
    const message =
      res && res.error && typeof res.error.message === 'string'
        ? res.error.message
        : 'An unexpected error occurred.';
    const error = new Error(message) as Error & { code?: string };
    if (res && res.error && typeof res.error.code === 'string') error.code = res.error.code;
    throw error;
  });
}

/** Restricted API surface exposed to the renderer. No database access. */
const api = {
  // app + settings + backup
  getAppInfo: () => invoke<AppInfo>(IPC.appGetInfo),
  getSettings: () => invoke<Record<string, string>>(IPC.settingsGet),
  setSetting: (key: string, value: string) => invoke<string | null>(IPC.settingsSet, key, value),
  createBackup: () => invoke<BackupResult>(IPC.backupCreate),
  restoreBackup: () => invoke<null>(IPC.backupRestore),
  pickBackupFile: () => invoke<string | null>(IPC.dialogPickBackupFile),

  // customers
  listCustomers: (search = '', includeDeleted = false) =>
    invoke<Customer[]>(IPC.customersList, search, includeDeleted),
  getCustomer: (id: string) => invoke<CustomerProfile>(IPC.customersGet, id),
  createCustomer: (input: NewCustomerInput) => invoke<Customer>(IPC.customersCreate, input),
  updateCustomer: (id: string, patch: UpdateCustomerInput) =>
    invoke<Customer>(IPC.customersUpdate, id, patch),
  deleteCustomer: (id: string) => invoke<null>(IPC.customersDelete, id),
  checkDuplicateCustomers: (email: string, excludeId?: string) =>
    invoke<Customer[]>(IPC.customersCheckDuplicate, email, excludeId),
  listAddresses: (customerId: string) =>
    invoke<CustomerAddress[]>(IPC.customersListAddresses, customerId),
  addAddress: (customerId: string, input: NewAddressInput) =>
    invoke<CustomerAddress>(IPC.customersAddAddress, customerId, input),
  deleteAddress: (id: string) => invoke<null>(IPC.customersDeleteAddress, id),

  // products
  listProducts: (opts?: { search?: string; category_id?: string; activeOnly?: boolean }) =>
    invoke<Product[]>(IPC.productsList, opts ?? {}),
  listCategories: () => invoke<ProductCategory[]>(IPC.productsListCategories),
  createCategory: (name: string) => invoke<ProductCategory>(IPC.productsCreateCategory, name),
  getProduct: (id: string) => invoke<Product & { variants: ProductVariant[] }>(IPC.productsGet, id),
  createProduct: (input: NewProductInput) => invoke<Product>(IPC.productsCreate, input),
  updateProduct: (id: string, patch: UpdateProductInput) =>
    invoke<Product>(IPC.productsUpdate, id, patch),
  deleteProduct: (id: string) => invoke<null>(IPC.productsDelete, id),
  createVariant: (productId: string, input: NewVariantInput) =>
    invoke<ProductVariant>(IPC.productsCreateVariant, productId, input),
  updateVariant: (id: string, patch: UpdateVariantInput) =>
    invoke<ProductVariant>(IPC.productsUpdateVariant, id, patch),
  deleteVariant: (id: string) => invoke<null>(IPC.productsDeleteVariant, id),
  pickProductImage: (id: string) => invoke<Product>(IPC.productsPickImage, id),
  clearProductImage: (id: string) => invoke<Product>(IPC.productsClearImage, id),

  // orders
  listOrders: (filters?: OrderFilters) =>
    invoke<{ rows: (Order & { item_count: number })[]; total: number }>(IPC.ordersList, filters ?? {}),
  getOrder: (id: string) => invoke<Order>(IPC.ordersGet, id),
  createOrder: (input: NewOrderInput) => invoke<Order>(IPC.ordersCreate, input),
  updateOrder: (id: string, patch: UpdateOrderInput) =>
    invoke<Order>(IPC.ordersUpdate, id, patch),
  duplicateOrder: (id: string) => invoke<Order>(IPC.ordersDuplicate, id),
  setOrderStatus: (id: string, to: OrderStatus, note?: string) =>
    invoke<Order>(IPC.ordersSetStatus, id, to, note),
  cancelOrder: (id: string, note?: string) => invoke<Order>(IPC.ordersCancel, id, note),
  archiveOrder: (id: string, archived: boolean) => invoke<Order>(IPC.ordersArchive, id, archived),
  getStatusHistory: (id: string) => invoke<OrderStatusEvent[]>(IPC.ordersStatusHistory, id),
  addNote: (id: string, input: NewNoteInput) => invoke<OrderNote>(IPC.ordersAddNote, id, input),
  listNotes: (id: string) => invoke<OrderNote[]>(IPC.ordersListNotes, id),
  addPayment: (id: string, input: NewPaymentInput) =>
    invoke<{ payment: Payment; order: Order }>(IPC.ordersAddPayment, id, input),
  listPayments: (id: string) => invoke<Payment[]>(IPC.ordersListPayments, id),
  getInbox: () => invoke<InboxBuckets>(IPC.ordersInbox),
};

export type OrderlyApi = typeof api;

contextBridge.exposeInMainWorld('orderly', api);

declare global {
  interface Window {
    orderly: OrderlyApi;
  }
}
