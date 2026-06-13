# Atmore Operations — deploy package

This folder is everything needed to run the app. Push these into your GitHub repo
(replacing the existing files) and redeploy.

## Two ways to deploy — pick the one your repo already uses

### A) Single bundled file (simplest)
Use **`Atmore Operations (standalone).html`** on its own. It has every script, style,
and library inlined — no other files required.
- If your repo serves one file (e.g. GitHub Pages with `index.html`), rename this to
  match (`index.html`) and replace the existing one. Done.

### B) Source files (multi-file)
Use **`Atmore Operations.html`** as the entry point. It loads the `.jsx`/`.js` files and
`lib/` and `screens/` from the same folder, so keep the folder structure intact:
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
