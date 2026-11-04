# Orderly — Known Limitations (v0.1.0)

Honest limits of this release. None of these are presented differently in the UI.

- **Windows boot not yet observed.** The Windows package is assembled and structurally verified
  (exe, asar, unpacked win32-x64 sqlite binding present), but it has not been launched on a real
  Windows machine in this environment. First launch on Windows should be watched.
- **No marketplace sync.** Etsy/Shopify/etc. orders arrive via CSV import only. The Integrations
  page says this explicitly.
- **StagePoint handoff is file-drop only.** No live API, no automatic status sync beyond
  acknowledgment files the user scans for. "Not connected" is shown until a real inbox folder
  is configured.
- **Payments are informational.** Recording that a customer paid; no processing, no refunds,
  no gateway reconciliation.
- **No inventory, costing, or accounting.** Stock levels, cost of goods, and ledgers are
  out of scope by design (Materialist/Stockroom/StagePoint own those).
- **Single user, single machine.** No multi-user, no roles, no network sharing of the database.
- **Print preview is the OS dialog.** Packing slips use the system print dialog; there is no
  built-in label-printer (Dymo/Zebra) support.
- **CSV import caps:** 50 MB / 50,000 rows per file. Larger files must be split.
- **Search is substring-based**, not full-text; fine at tested scale (10k orders, all hot
  queries <100 ms) but not tuned beyond that.
- **The native file picker cannot be E2E-tested headless**; it is bypassed in tests via the
  `ORDERLY_TEST_CSV` env seam. The parse/map/validate/apply path behind it is fully tested.
- **No automatic updates.** New versions are manual downloads.
