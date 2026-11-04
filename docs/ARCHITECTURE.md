# Orderly — Architecture (v0.1.0)

## Process model (Electron 45)

```
┌─ Main process (Node) ─────────────────────────────┐
│  src/main/index.ts      app lifecycle, window      │
│                         state, backup/restore,     │
│                         orderly-img:// protocol    │
│  src/main/ipc.ts        ALL ipcMain handlers;      │
│                         every payload validated    │
│  src/database/*.ts      SQLite access (better-     │
│                         sqlite3), transactions     │
│  src/domain/*.ts        pure logic: money, ids,    │
│                         lifecycle, CSV, handoff    │
└──────────────────────────┬────────────────────────┘
              contextBridge │  window.orderly only
┌─ Renderer (React 19) ─────┴───────────────────────┐
│  src/renderer/src/      pages, components          │
│  src/shared/*.ts        types, IPC names, totals,  │
│                         validation (shared both)   │
│  ZERO database access from the renderer            │
└────────────────────────────────────────────────────┘
```

## Key rules

- **IPC envelope**: every handler returns `{ok:true,data}` or `{ok:false,error:{code,message}}`.
  The preload exposes a fixed method list; the renderer cannot reach anything else.
- **Validation boundary**: `src/main/ipc.ts` validates every argument via `src/shared/validate.ts`
  (reqString/reqInt/reqEnum/reqDate/optEmail/moneyToCents…). Invalid input never reaches the DB.
- **Money**: integer minor units (cents) everywhere, never floats. `moneyToCents` parses user input;
  `formatCents` renders.
- **Timestamps**: ISO-8601 UTC strings.
- **IDs**: prefixed (`ord_…`, `cus_…`, `itm_…`) via `src/domain/ids.ts`; stable across restarts.
- **Migrations**: `src/database/migrations/00N_*.ts`, transactional, idempotent, applied in order at
  startup (`001_foundation` → `002_core` → `003_fulfillment` → `004_production_returns`).
- **Soft deletion**: customers and products are soft-deleted (`deleted_at`) so historical order items
  keep referential integrity. Order items snapshot name/SKU/price at order time.
- **Shared totals**: `src/shared/totals.ts` (`computeTotals`, `lineTotal`) is used by both main and
  renderer so displayed totals always match stored totals.
- **No domain imports in renderer**: web tsconfig excludes `src/domain/`; shared logic lives in
  `src/shared/`.

## Module map

| Path | Responsibility |
|---|---|
| `src/main/index.ts` | lifecycle, window-state persist, backup/restore orchestration, protocol |
| `src/main/ipc.ts` | all IPC handlers + input validation |
| `src/main/images.ts` | product image save/serve |
| `src/preload/index.ts` | `window.orderly` restricted API |
| `src/database/index.ts` | open/pragma/tx helpers, data-dir resolution |
| `src/database/migrations.ts` + `migrations/` | schema versions |
| `src/database/settings.ts` | key/value settings |
| `src/database/customers.ts` | customers, addresses |
| `src/database/products.ts` | products, variants, categories |
| `src/database/orders.ts` | orders, items, lifecycle, notes, payments |
| `src/database/fulfillment.ts` | fulfillments, shipments, packing |
| `src/database/production.ts` | StagePoint handoffs |
| `src/database/returns.ts` | returns |
| `src/database/imports.ts` | CSV import jobs (in-memory parse cache in main) |
| `src/database/dashboard.ts` | dashboard aggregates |
| `src/database/reports.ts` | 11 reports |
| `src/database/exports.ts` | CSV export builders |
| `src/domain/orders.ts` | `assertTransition`, order numbering |
| `src/domain/handoff.ts` | contract schemas + validation |
| `src/domain/csv.ts` | CSV parse, header alias mapping, serialize |
| `src/domain/backup.ts` | backup validation |
| `src/shared/*` | types, IPC channel names, validation, constants, totals, format |

## Data flow example (order status change)

Renderer calls `window.orderly.setOrderStatus(id, to)` → preload invokes `orders:set-status` →
`main/ipc.ts` validates id + enum → `database/orders.ts` runs `assertTransition` inside a transaction,
updates the order, appends to `order_status_history` → envelope returned → renderer reloads + toast.

## UI structure

`App.tsx` shell: dark sidebar nav (Workspace / Records / Operations / Other groups), Alt+1..0
shortcuts, last-page persistence. Pages: Overview, Inbox, Orders (+OrderEditor), Customers, Products,
Fulfillment, Production, Returns, Reports, Integrations, Settings. Design: Clever Signal Vista v2
palette resolved toward a dense ops tool (compact tables, restrained rounding, no decorative charts).
