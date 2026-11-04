# Orderly — 20-Point Completion Gate Check (v0.1.0)

Each point from SPEC §18 with its evidence. Verified 2026-11-04.

1. **Create and manage customers.** PASS — directory, create/edit/soft-delete, duplicate-email
   warning, addresses, profiles. Unit: `tests/milestone2.test.ts` (11 tests). E2E: M2 spec.
2. **Create products and variants.** PASS — catalog, variants, categories, image upload via
   `orderly-img://`. Unit: M2. E2E: M2 spec.
3. **Create multi-item orders.** PASS — order editor with product picker, per-line qty/price/
   discount/tax, live cents totals. Unit: M2. E2E: M2 spec.
4. **Orders move through the complete lifecycle.** PASS — 12 states, guarded transitions,
   drag-and-drop on the board. Unit: M2 (incl. illegal-transition rejection). E2E: M2 spec.
5. **Order history preserved.** PASS — append-only `order_status_history` incl. creation entry;
   soft-deleted customers/products keep historical snapshots on order items. Unit: M2, M5
   (import walks the lifecycle with full history).
6. **Inbox in table and board views.** PASS — dense table (search/filter/sort) + kanban with
   drag-drop, overdue highlighting, 5 attention buckets. E2E: M2 spec.
7. **Partial fulfillment.** PASS — per-item pack quantities, over-pack rejected, order returns to
   Ready to fulfill. Unit: `tests/milestone3.test.ts` (8). E2E: M3 spec (3-of-5 then rest).
8. **Multiple shipments per order.** PASS — shipments table allows many per order; separate
   fulfillment + shipment records per partial. Unit: M3. E2E: M3 spec.
9. **Packing slips printed.** PASS — print CSS + `window.print()`; doc unmounts in try/finally.
   E2E: M3 spec (print stubbed headless — `window.print()` blocks in headless Electron).
10. **Shipping/tracking recorded.** PASS — carrier, service, tracking, ship date, cost per
    shipment. Unit: M3. E2E: M3 spec.
11. **Returns managed.** PASS — 7-state lifecycle, qty enforcement, replacement-order link,
    informational refund status. Unit: `tests/milestone4.test.ts` (8). E2E: M4 spec.
12. **CSV import/export with real files.** PASS — 8-step wizard, real parse/validate/apply;
    one-click exports. Unit: `tests/milestone5.test.ts` (11). E2E: M5 spec drives the full
    wizard on a real CSV (only the native picker bypassed via `ORDERLY_TEST_CSV`).
13. **Dashboard/reports from real data.** PASS — every figure from live SQL; revenue labeled
    revenue, "not profit" stated. Unit: M5 (hand-computed). E2E: M5 spec.
14. **Production handoff records persist.** PASS — handoffs table, envelope JSON validated
    against the contract schema, ack scanning, honest not-connected state.
    Unit: M4. E2E: M4 spec. Contract: `docs/STAGEPOINT_CONTRACT.md`.
15. **Data survives restarts.** PASS — SQLite in the user data dir; window state, last page,
    settings persisted. E2E: M1 spec (restart persistence).
16. **Backup and restore.** PASS — backup with checkpoint+close-then-copy, restore with
    integrity + schema-version validation. Unit: M1 (incl. the WAL-checkpoint catch). E2E: M1.
17. **Packaged and installed.** PASS (with caveat) — electron-builder produces nsis installer +
    portable zip for Windows x64; portable zip is the verified deliverable. Caveat: not yet
    launched on a real Windows machine (see `docs/LIMITATIONS.md`).
18. **No placeholder nav items.** PASS — all 11 nav sections are fully implemented; the
    `placeholders.tsx` ComingSoon components are no longer referenced by `App.tsx`.
19. **No workflow depends on mock data.** PASS — zero seed/demo data in the app or repo
    (verified by grep; migrations seed only settings). All empty states are honest.
20. **No critical errors remain.** PASS — typecheck clean (node + web), 46/46 unit tests,
    5/5 E2E specs in one run; error-handling audit done (every renderer async call guarded,
    every IPC handler validated + enveloped); destructive actions confirmed; keyboard pass done
    (sort headers and picker options made focusable in M6).

## Completion artifacts (§18)

- Functionality summary: `docs/FUNCTIONALITY.md`
- Architecture: `docs/ARCHITECTURE.md`
- Schema overview: `docs/SCHEMA.md`
- Integration contracts: `docs/STAGEPOINT_CONTRACT.md`
- Build/install instructions: `docs/BUILD.md`
- Known limitations: `docs/LIMITATIONS.md`
- Incomplete requirements: `docs/INCOMPLETE.md`
- Per-milestone reports: `docs/PHASE2_REPORT.md`, `docs/PHASE5_REPORT.md`
  (M1/M3/M4 landed with inline verification; their test files are the record.)

## M6 release-quality work (this pass)

- Confirmations added for address delete and variant delete (were unconfirmed).
- Sort headers and product-picker options made keyboard-operable.
- Vestigial `sample_data_enabled` setting removed via migration 005.
- 10k-order synthetic perf: insert ~1s; listOrders page 45ms, search 9ms, status filter 4ms,
  dashboard 79ms, reports ≤19ms.
- `START_ORDERLY.bat` (CRLF, pauses with the error on screen) + `README.txt`.
- Windows packaging: nsis + portable zip via electron-builder; `orderly-0.1.0.zip` assembled
  from a fresh staging dir and verified by listing.
