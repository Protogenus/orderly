# Orderly — Milestone 5 Report: Imports and Reports

Date: 2026-11-04. Commit: (M5 commit).

## What was built

**Dashboard (Overview page, real figures only).** `src/database/dashboard.ts` `getDashboardStats(from, to)` computes
open orders, awaiting processing (draft+new), awaiting production, ready for packing, awaiting shipment
(fulfillments in `ready_to_ship`), overdue orders (past requested date, open statuses), completed in range, and the
30 most recent status-change events — every number from live DB queries, no cached or sample figures. The Overview
page shows dense stat tiles (click a tile to jump to Inbox/Fulfillment/Production/Orders), Today/7-day/30-day/Custom
range presets, and a recent-activity table. Empty states when there is nothing to show.

**CSV import — guided 8-step wizard** (spec §13): choose data (customers/products/orders) → pick file → inspect
(columns, row count, sample rows) → map columns (auto-mapped from a real-world header alias table, e.g. "E-mail
Address" → email, "Full Name" → name) → preview mapped rows → validate (per-row errors with row numbers, duplicate
detection against live records) → confirm (explicit counts: import N, skip D duplicates, exclude E error rows) →
results. Duplicates are warned and skipped, never auto-merged. The apply runs in a single transaction: any mid-apply
failure rolls everything back (verified by test) and the job is marked `failed` with the error recorded in
`import_errors`. Orders import groups rows by order number into one order, matches-or-creates customers by email,
lands in the CSV's status by walking the legal lifecycle (BFS shortest path) so history stays truthful, and keeps an
explicit order number when the CSV provides one (duplicates filtered at validate time).

**CSV export.** One click per kind (orders/customers/products) → native save dialog → file. Amounts written as dollars;
re-import converts back to cents. Exported orders re-parse to identical row counts (tested).

**Reports.** 11 reports from live data: orders over time, revenue over time, orders by status/channel, best sellers,
average order value, customer purchase history, fulfillment performance (days order→shipped), late orders, canceled
orders, returns. Every report carries a note explaining what it measures; revenue figures are labeled REVENUE and the
UI states plainly that Orderly does not track costs or profit. Date-range filtering + CSV export of each report via
save dialog.

**Honest integrations page.** StagePoint section links to the Production page and restates the local file-drop
contract. "Connected services" states explicitly that Orderly has no marketplace/storefront connections and never
implies any — orders from sales channels arrive via CSV import.

## Verification

- `npm run typecheck`: clean (node + web).
- `npm test`: **46/46 pass** (11 new M5 tests). Includes: CSV parse edge cases (BOM, quoted commas, header-only
  rejection, 50k-row/50MB caps), header alias auto-mapping, customer/product/order import validation, duplicate
  detection (emails, SKUs, order numbers), **transactional rollback** (seeded order-number conflict between validate
  and apply → zero partial rows, job marked failed), multi-line order grouping with hand-computed totals
  (2×$8.00 + 1×$4.00 + $3.50 shipping = $23.50), lifecycle walk draft→shipped with full history, dashboard stats
  matching direct SQL, all report figures hand-computed (revenue $28.00/$12.00, AOV $13.33, best-seller ranking),
  export→re-parse round trip.
- Playwright E2E: **5/5 specs pass** (M1–M5 in one run). New `e2e/milestone5.spec.ts` drives the real app end to end:
  overview tiles show seeded figures → revenue report shows $30.00 → full 8-step CSV import wizard (2 customers
  imported, visible in the customer directory). Only the native file picker is bypassed, via the `ORDERLY_TEST_CSV`
  env seam in the main-process dialog handler (the preload API object is frozen, so renderer-side stubbing is
  impossible); parse/map/validate/apply are the real IPC path.

## Notes / deviations

- `src/domain/csv.ts` gained the header-alias table after the first version only matched exact field names; the
  on-disk file briefly differed from the authored version (transient write state), caught by tests, resolved.
- /tmp (512MB tmpfs) filled during the run from sibling agents' E2E litter; test runs now use `TMPDIR=~/.orderly-test-tmp`.
  Stale (>15 min) sibling temp dirs were removed; active ones left alone.
- No demo or seed data exists anywhere in the app or repo. Dev verification databases are per-test temp dirs,
  wiped after each test.

## Remaining (M6)

Release-quality pass: error-handling audit, confirmations, keyboard nav, 10k-order synthetic perf check,
electron-builder Windows packaging, clean-install test, backup/restore verification, seed-wipe verification,
CRLF START_ORDERLY.bat, self-contained verified zip, 7 completion artifacts, 20-point gate.
