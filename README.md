# Atmore Operations — deploy package

This folder is everything needed to run the app. Push these into your GitHub repo
(replacing the existing files) and redeploy.

## Your repo: atmoreadmin/atmore-ops

Your live site is served from **`index.html`** (a copy of the bundled standalone). To
update production you MUST replace that file. The matching, ready-to-upload files are here.

### Minimum to update the live site
Replace **`index.html`** with the one in this folder. That's it — GitHub Pages redeploys
automatically within a minute or two.

### Recommended (keep the whole repo consistent)
Replace these too, so the source matches what's live:
`Atmore Operations (standalone).html`, `Atmore Operations.html`, `app.jsx`, `store.jsx`,
`ui.jsx`, `sync.jsx`, `modals.jsx`, `capture-hub.jsx`, `global-search.jsx`,
`property-editor.jsx`, `stage-picker.jsx`, `tweaks-panel.jsx`, `seed.js`,
and the `screens/` folder. (`index.html` == the standalone bundle — same file, two names.)

The simplest move: upload the ENTIRE contents of this folder and let GitHub overwrite.

---

## Reference — the two file forms
- **`index.html` / `Atmore Operations (standalone).html`** — the all-in-one bundle. Every
  script, style, and library inlined; no other files needed. This is what's served.
- **`Atmore Operations.html`** — the multi-file source entry point. It loads the
  `.jsx`/`.js` files plus `lib/` and `screens/` from the same folder; keep the structure: 
```
Atmore Operations.html
seed.js
store.jsx  ui.jsx  sync.jsx  app.jsx  modals.jsx  capture-hub.jsx
global-search.jsx  property-editor.jsx  stage-picker.jsx  tweaks-panel.jsx
lib/xlsx.js
screens/*.jsx
```

## Backend (only if you changed it — you didn't)
`Apps Script Bridge.gs` is your Google Apps Script. It is **unchanged** in this update,
so you do NOT need to re-deploy it. It's included only for completeness/reference.

## What changed in this update
- Save button no longer silently dead — disabled state is now visible, with a reason hint
- `$0` accepted as a valid transaction amount
- New "Rentals (general)" overhead bucket (rolls into the P&L like "Office")
- Rent ledger de-duplication (healed on load, on sheet-pull, and at render)
- Click a transaction row on a property to open its editor
- Column picker on the property Transactions table
- Full mobile layout (bottom tab bar, card-reflow tables, bottom-sheet modals) — phones only;
  desktop is unchanged

## Note on the date
The app advances its internal "today" to the real calendar date on load (see the
clock-advance block in `store.jsx`). That's why it tracks the current day rather than the
frozen seed date. If you'd prefer it frozen, remove that block before deploying.
