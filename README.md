# Atmore Operations

A single-page property-operations app (ledger, rent roll, properties, tax binder, bank import) built with React + Babel served directly in the browser — no build step.

## Run locally

Because the app loads `.jsx` modules over `fetch`, open it through a local web server (not `file://`):

```bash
# from this folder
python3 -m http.server 8000
# then visit http://localhost:8000/Atmore%20Operations.html
```

Any static server works (`npx serve`, etc.).

## Files

- **Atmore Operations.html** — app entry point; loads React, Babel, and all modules.
- **Atmore Operations (standalone).html** — self-contained single-file build (works offline, openable directly).
- **app.jsx** — shell + hash routing.
- **store.jsx / seed.js** — state store and seed data.
- **ui.jsx** — shared UI primitives.
- **screens/** — one module per screen (transactions, rent-roll, property, dashboard, …).
- **lib/xlsx.js** — spreadsheet import/export.
- **Apps Script Bridge.gs** — optional Google Sheets sync backend.

## Notes

- Data persists in the browser's `localStorage`.
- The Transactions ledger paginates at 100 rows per page (Prev / Next below the table).
