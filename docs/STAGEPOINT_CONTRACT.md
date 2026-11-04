# StagePoint Production Handoff — Integration Contract v1

**Contract ID:** `cleversignal.production-handoff/1`  
**Direction:** Orderly → StagePoint (production requirements); StagePoint → Orderly (acknowledgements)  
**Transport:** local JSON file drop. No network, no accounts, no paid services.

## Honesty rule

Orderly **never** claims StagePoint is connected unless the user has pointed Orderly at an
existing StagePoint inbox directory (Settings → Production → StagePoint inbox folder).
Without that, envelopes are written to Orderly's own outbox
(`<data-dir>/handoff/outbox/`) and the UI shows **"StagePoint not connected"**.
Production status can always be updated manually.

## Handoff lifecycle (Orderly side)

`draft` → `sent` → `accepted` → `in_progress` → `completed` (or `failed` from any state)

- `draft`: composed in Orderly, not yet sent. Only drafts can be deleted.
- `sent`: envelope JSON written (to StagePoint's inbox when connected, else Orderly's outbox).
- `accepted` / `in_progress` / `completed` / `failed`: via StagePoint ack files (see below)
  or manual update in Orderly.

When a handoff reaches `completed`, an order sitting in `awaiting_production` or
`in_production` is moved to `in_production` with a history entry (the user then moves it
to Ready to Fulfill when the goods arrive).

## Envelope (Orderly → StagePoint)

File: `<inbox-or-outbox>/<handoff-id>.json`

```json
{
  "contract": "cleversignal.production-handoff/1",
  "handoff_id": "hnd_abc123",
  "order_id": "ord_xyz789",
  "order_number": "ORD-1001",
  "customer_name": "Acme Candle Co",
  "requested_date": "2026-11-20",
  "items": [
    { "order_item_id": "oit_111", "description": "Soy Candle — Lavender 8oz", "sku": "CAND-001-LAV", "quantity": 50 }
  ],
  "notes": "Rush — market stall Saturday.",
  "created_at": "2026-11-04T07:00:00.000Z"
}
```

Validation rules for producers/consumers:

- `contract` must equal `cleversignal.production-handoff/1`.
- `handoff_id` is a stable unique string; StagePoint must echo it in acks.
- `items` is non-empty; every item has a non-blank `description` and an integer `quantity >= 1`.
- `sku` may be null. All money is intentionally absent — StagePoint owns costing.

## Acknowledgement (StagePoint → Orderly)

File: `<orderly-outbox>/<handoff-id>.ack.json` (next to the envelope).

```json
{
  "contract": "cleversignal.production-handoff/1",
  "handoff_id": "hnd_abc123",
  "status": "accepted",
  "progress_note": "Scheduled for Monday's pour.",
  "updated_at": "2026-11-04T09:30:00.000Z"
}
```

- `status` is one of `accepted`, `in_progress`, `completed`, `failed`.
- Orderly applies acks when the user clicks **Check for updates** (Production page) —
  never silently in the background. Invalid ack files are reported, never applied.
- Acks that violate the lifecycle (e.g. `completed` on a `draft`) are rejected with an error.

## What Orderly does NOT do

- No automatic polling or background sync.
- No fabrication of StagePoint data: if no ack exists, the handoff simply stays `sent`.
- No tight coupling: StagePoint is never imported, required, or assumed present.
