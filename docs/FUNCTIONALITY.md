# Orderly — Implemented Functionality (v0.1.0)

Orderly ("Every order, in order.") is an offline-first desktop app for independent makers to manage
customers, orders, fulfillment, shipments, and returns. Electron + React + TypeScript + SQLite. No cloud,
no AI, no accounts, no paid services.

## Customers
- Customer directory with search, create/edit, soft-delete (order history preserved).
- Duplicate-email warning on create/import (never auto-merges).
- Multiple billing/shipping addresses per customer.
- Customer profile: order history, lifetime totals, outstanding balance.

## Products (lightweight catalog)
- Products with name, SKU, description, category, base price, active flag, marketplace ID, image.
- Product variants (name/SKU/price/attributes), product categories.
- Images served from the app data dir via a custom `orderly-img://` protocol.
- No BOMs, recipes, or material consumption (belongs to Materialist/Stockroom/StagePoint).

## Orders
- Multi-item order editor: product picker with live search, custom line items, per-line quantity /
  price / discount / tax, order-level discount / shipping / tax. All money in integer cents.
- Auto order numbers (`ORD-1001…`, configurable prefix), 12-state lifecycle
  (draft → new → confirmed → awaiting_production → in_production → ready_to_fulfill → packing →
  shipped → delivered → completed, plus on_hold and canceled) with guarded transitions and an
  append-only status history on every change.
- Duplicate, archive/unarchive, cancel (confirmed), priorities, requested dates, sources
  (Manual, Etsy, Shopify, …), internal + customer notes, tags.
- Informational payment records (amount, method, date, reference). No processing, no refunds.
- Order Inbox: dense table (search, status filter, sort) and kanban board with drag-and-drop status
  changes, overdue highlighting, and five attention buckets.

## Fulfillment
- Workspace tabs: Ready to pack, Packing, Ready to ship, Shipped, Awaiting delivery.
- Packing sessions with per-item quantities; over-packing rejected.
- Partial fulfillment: pack 3 of 5 now → order returns to Ready to fulfill; separate fulfillment
  and shipment records per partial.
- Shipments: carrier, service, tracking number, ship date, cost; multiple shipments per order.
- Packing slips and shipping summaries printed through Electron (`window.print()` with print CSS).
- Order status auto-advances with packing/shipping/delivery events.

## Production handoff (StagePoint)
- Local file-drop contract (`cleversignal.production-handoff/1`): JSON envelope with schema version,
  written to Orderly's outbox or a user-chosen StagePoint inbox folder; acknowledgment files scanned
  back in. Full contract in `docs/STAGEPOINT_CONTRACT.md`.
- Honest connection state: "not connected" until the user configures a real inbox folder. Nothing is
  ever implied or simulated; no network traffic.

## Returns
- 7-state lifecycle (requested → approved → awaiting_return → received → inspected → resolved, plus
  rejected) with guarded transitions.
- Per-item return quantities enforced against ordered-minus-already-returned.
- Replacement-order linking; refund status is informational only.

## CSV import / export
- Guided 8-step import wizard (choose data → pick file → inspect → map columns → preview → validate →
  confirm → results) for customers, products, and orders.
- Header auto-mapping from a real-world alias table; per-row validation errors with row numbers;
  duplicate detection (email / SKU / order number) with warn-and-skip; single-transaction apply
  (any failure rolls everything back).
- One-click CSV export of orders, customers, products (dollars; re-import converts back to cents).

## Dashboard and reports
- Overview: live stat tiles (open, awaiting processing/production, ready for packing, awaiting
  shipment, overdue, completed in range), Today/7/30-day/custom ranges, recent activity feed.
- 11 reports from live data (orders/revenue over time, by status, by channel, best sellers, AOV,
  customer history, fulfillment performance, late/canceled orders, returns) with CSV export.
- Revenue is labeled revenue; the UI states Orderly does not track costs or profit.

## Data safety
- Backup to a single file / restore with integrity + schema-version validation (Settings).
- Window size/position, last page, and settings persist across restarts.
- All data lives in `%APPDATA%/Orderly` (Windows) — the user's own machine.
