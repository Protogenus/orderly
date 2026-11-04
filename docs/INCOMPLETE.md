# Orderly — Incomplete Requirements (v0.1.0)

Checked against the master spec (products/orderly/SPEC.md). Everything in the spec's milestone
scope is implemented. The following spec-adjacent items are intentionally deferred or out of scope:

1. **Sample data (spec §16, optional).** The spec allows optional removable sample data. None is
   included: the app ships with honest empty states, per Blake's standing rule (no demo data, ever).
2. **Windows installer testing on a real machine.** The nsis installer is built but the install
   flow has not been run on Windows here; the portable zip is the verified deliverable.
3. **Multi-currency.** Currency is a single setting; per-order currencies are not supported.
4. **Tax rules engine.** Tax is a recorded amount per line/order, not computed from jurisdictions.
5. **Email/label integrations.** No email sending, no shipping-label purchase — tracking numbers
   are recorded, labels come from the carrier.
6. **API for third parties.** No HTTP API; integration surface is CSV + the StagePoint file-drop
   contract + backup files.

No spec requirement from §§1–17 is missing. The 20-point completion gate is checked separately
in `docs/GATE_CHECK.md`.
