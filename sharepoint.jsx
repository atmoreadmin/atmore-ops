# Atmore Operations

A single-page property-operations app (ledger, rent roll, properties, tax binder, bank import) built with React + Babel served directly in the browser — no build step.

## Deploying to GitHub Pages

Push all files (including the hidden **`.nojekyll`**) to the repo, then enable Pages on the branch. The root URL serves `index.html`.

> The `.nojekyll` file is essential: GitHub Pages runs Jekyll by default, which treats `{{ }}` / `{% %}` as template syntax and corrupts the inlined JSX bundle. `.nojekyll` turns that off.

## Run locally

Because the app loads `.jsx` modules over `fetch`, open it through a local web server (not `file://`):

```bash
# from this folder
python3 -m http.server 8000
# then visit http://localhost:8000/Atmore%20Operations.html
```

Any static server works (`npx serve`, etc.).

## Files

- **index.html** — self-contained single-file build; this is what GitHub Pages serves at the root URL.
- **.nojekyll** — disables GitHub Pages' Jekyll processing (required — without it the inlined bundle is mangled and the page hangs on “Unpacking…”).
- **Atmore Operations.html** — multi-file dev entry point; loads React, Babel, and all modules.
- **app.jsx** — shell + hash routing.
- **store.jsx / seed.js** — state store and seed data.
- **ui.jsx** — shared UI primitives.
- **screens/** — one module per screen (transactions, rent-roll, property, dashboard, …).
- **lib/xlsx.js** — spreadsheet import/export.
- **Apps Script Bridge.gs** — optional Google Sheets sync backend.

## Notes

- Data persists in the browser's `localStorage`.
- The Transactions ledger paginates at 100 rows per page (Prev / Next below the table).
