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

  productsList: 'products:list',
  productsGet: 'products:get',
  productsCreate: 'products:create',
  productsUpdate: 'products:update',
  productsDelete: 'products:delete',

  ordersList: 'orders:list',
  ordersGet: 'orders:get',
  ordersCreate: 'orders:create',
  ordersUpdate: 'orders:update',
  ordersDuplicate: 'orders:duplicate',
  ordersSetStatus: 'orders:set-status',
  ordersCancel: 'orders:cancel',
  ordersArchive: 'orders:archive',
  ordersInbox: 'orders:inbox',

  // Milestone 3+
  fulfillmentsForOrder: 'fulfillments:for-order',
  fulfillmentsStart: 'fulfillments:start',
  fulfillmentsPackItem: 'fulfillments:pack-item',
  fulfillmentsReadyToShip: 'fulfillments:ready-to-ship',
  fulfillmentsShip: 'fulfillments:ship',
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
