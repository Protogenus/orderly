/** IPC channel names. Every channel returns an IpcResult envelope. */
export const IPC = {
  appGetInfo: 'app:get-info',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  backupCreate: 'backup:create',
  backupRestore: 'backup:restore',
  dialogPickBackupFile: 'dialog:pick-backup-file',

  // Milestone 2+
  customersList: 'customers:list',
  customersGet: 'customers:get',
  customersCreate: 'customers:create',
  customersUpdate: 'customers:update',
  customersDelete: 'customers:delete',
  customersCheckDuplicate: 'customers:check-duplicate',
  customersListAddresses: 'customers:list-addresses',
  customersAddAddress: 'customers:add-address',
  customersDeleteAddress: 'customers:delete-address',

  productsList: 'products:list',
  productsListCategories: 'products:list-categories',
  productsCreateCategory: 'products:create-category',
  productsGet: 'products:get',
  productsCreate: 'products:create',
  productsUpdate: 'products:update',
  productsDelete: 'products:delete',
  productsCreateVariant: 'products:create-variant',
  productsUpdateVariant: 'products:update-variant',
  productsDeleteVariant: 'products:delete-variant',
  productsPickImage: 'products:pick-image',
  productsClearImage: 'products:clear-image',

  ordersList: 'orders:list',
  ordersGet: 'orders:get',
  ordersCreate: 'orders:create',
  ordersUpdate: 'orders:update',
  ordersDuplicate: 'orders:duplicate',
  ordersSetStatus: 'orders:set-status',
  ordersCancel: 'orders:cancel',
  ordersArchive: 'orders:archive',
  ordersInbox: 'orders:inbox',
  ordersStatusHistory: 'orders:status-history',
  ordersAddNote: 'orders:add-note',
  ordersListNotes: 'orders:list-notes',
  ordersAddPayment: 'orders:add-payment',
  ordersListPayments: 'orders:list-payments',

  // Milestone 3+
  fulfillmentsForOrder: 'fulfillments:for-order',
  fulfillmentsStart: 'fulfillments:start',
  fulfillmentsPackItem: 'fulfillments:pack-item',
  fulfillmentsReadyToShip: 'fulfillments:ready-to-ship',
  fulfillmentsBackToPacking: 'fulfillments:back-to-packing',
  fulfillmentsShip: 'fulfillments:ship',
  fulfillmentsDelete: 'fulfillments:delete',
  fulfillmentsWorkspace: 'fulfillments:workspace',

  // Milestone 4+
  handoffsCreate: 'handoffs:create',
  handoffsList: 'handoffs:list',
  handoffsUpdateStatus: 'handoffs:update-status',
  stagepointDetect: 'stagepoint:detect',

  returnsList: 'returns:list',
  returnsGet: 'returns:get',
  returnsCreate: 'returns:create',
  returnsUpdate: 'returns:update',

  // Milestone 5+
  dashboardStats: 'dashboard:stats',
  reportsRun: 'reports:run',
  csvExport: 'csv:export',
  csvImportAnalyze: 'csv:import-analyze',
  csvImportApply: 'csv:import-apply',
} as const;
