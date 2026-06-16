# Atmore Operations — deploy package

Drop-in replacement for **atmoreadmin/atmore-ops**. The mobile layout has been
**completely removed** — this is the desktop app only.

## Update the live site
Your live site is served from **`index.html`**. Replace it with the one in this folder
and GitHub Pages redeploys automatically (~1–2 min). Then hard-refresh the page
(Cmd/Ctrl+Shift+R) to clear the cached bundle.

Simplest path on GitHub: **Add file → Upload files** → drag in the entire contents of
this folder → **Commit changes**. GitHub overwrites the matching files.

## Files
- **`index.html`** — what the live site serves (a copy of the standalone bundle).
- **`Atmore Operations (standalone).html`** — same bundle, second name kept for parity with your repo.
- **`Atmore Operations.html`** + the `.jsx`/`.js` files + `lib/` + `screens/` — the multi-file source. Keep the folder structure intact.
- **`Apps Script Bridge.gs`** — UNCHANGED. No need to re-deploy the Apps Script.

## What's in this build (vs. your current production)
- Mobile layout **removed** — desktop layout only, as before.
- Save button shows a visible disabled state + reason hint (no more silent dead clicks).
- `$0` accepted as a valid transaction amount.
- New "Rentals (general)" overhead bucket (rolls into the P&L like "Office").
- Rent ledger de-duplication (healed on load, on sheet-pull, and at render).
- Click a transaction row on a property to open its editor.
- Column picker on the property Transactions table.
- App clock auto-advances to the real current date on load (never backward).
