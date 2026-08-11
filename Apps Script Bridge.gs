/*
 * Atmore Operations · Apps Script Bridge
 * ============================================
 * Paste this entire file into your Google Sheet's Apps Script editor
 * (Extensions → Apps Script), then Deploy → New deployment → Web app.
 *
 *   Execute as:    Me (your email)
 *   Who has access: Anyone with the link
 *
 * Copy the resulting Web App URL into the Atmore Operations app
 * under Integration → Sync.
 *
 * What this script does
 * ----------------------
 *   GET  ?action=ping         → health check
 *   GET  ?action=read         → returns the entire workbook as JSON
 *   GET  ?action=meta         → returns last-modified timestamp + row counts
 *   POST { action: "write", payload: <full state> } → replaces every tab
 *
 * The app pushes the whole state on every "Push to Sheet" — simpler than
 * row-level diffs and safer for low-volume editing (a few users, a few
 * dozen writes a day).  For high-volume work upgrade to row-level sync.
 *
 * Run setup() once from the editor to initialize the tabs if the workbook
 * is empty. To UPGRADE an existing workbook that already has data (e.g. after
 * new tabs/columns are added to the app), run migrate() instead — it adds the
 * missing tabs and column headers without clearing any existing rows. Never run
 * setup() on a populated Sheet; it clears every tab.
 */

// ─── Schema mirror (must match the app's SHEET_SCHEMA) ──────────────────────
const SCHEMA = {
  Properties: [
    'id','address','type','status','statusCode','city','county','state','zip',
    'assigned','loanType','financingType','lockbox','ddDate','signingDate','purchaseDate',
    'purchasePrice','acqEarnest','purchaseFees','purchaseCredits','purchaseLoan','acqExchangeFunds','acqDDFee',
    'rehab','rehabFunds','rehabDraws','saleCreditsReceived','saleAttorney','interest','interestCredit','otherFees','cashToClose','cashReceivedAtClose','salesDate','listPrice','salesPrice','grossProfit',
    'vestingLLC','driveUrl','failedReason','notes','attorney','attorneyContact','closingTime',
    'saleSigningDate','saleSigningTime',
    'salesFees','salesCredits','salesLoanPayoff','saleDDCollected','saleEarnest','exchangeFunds',
    'atmoreLoanPrincipal','atmoreLoanPayoff',
    'contractDate','buyerDDDate','expectedCloseDate','utilityNote',
    'insCarrier','insPolicy','insPremium','insRenewal','insAgent','insAgentPhone',
    'loanLender','loanNumber','loanPayment','loanBalance','loanRate','loanMaturity','loanEscrowTaxes','loanEscrowIns','loanContact',
    'taxAnnual','taxDueDate','taxEscrowed','taxParcel',
    'hoa1Name','hoa1Url','hoa1User','hoa1Pass','hoa1Monthly',
    'hoa2Name','hoa2Url','hoa2User','hoa2Pass','hoa2Monthly',
  ],
  Tenants: [
    'id','propertyId','name','phone','email','moveIn','leaseEnd','rent',
    'deposit','source','voucher','phaPortion','tenantPortion','occupants','status','notes',
    'lateFeeAmount','lateFeeStartDay','lateFeeMax','lateFeePerDay',
  ],
  RentLedger: [
    'id','tenantId','propertyId','month','charge','paid','paidOn','source',
    'status','lateFeeWaived','linkedTxId','linkedTxIds','reducedCharge','noAutoMatch',
  ],
  Transactions: [
    'id','date','acct','desc','amount','payee','category','project','bucket','notes','importBatch',
  ],
  Contractors: [
    'id','name','phone','email','specialty','entityType','w9OnFile','w9Date',
    'tin','mailingAddress','isAttorney','paidByCardOnly','notes',
  ],
  Refis: [
    'id','propertyId','status','lender','applicationDate','appraisalDate',
    'appraisedValue','newLoanAmount','interestRate','cashOut','targetClose',
    'actualClose','notes',
  ],
  Exchanges: [
    'id','relinquishedAddress','relinquishedCity','relinquishedPropId','relinquishedSoldDate',
    'relinquishedSalePrice','relinquishedClosingCosts','sellerCredits','sellerCreditsReceived','qiFee',
    'ddReceived','exchangeFunds','fundsDeployed','qi','qiContact',
    'status','identifiedPropIds','closedPropIds','notes',
  ],
  Leads: ['id','propertyId','date','name','phone','source','status','notes'],
  Tasks: [
    'id','propertyId','title','dueDate','priority','recurrence','done','lastDone','checklist','notes',
  ],
  Offers: [
    'id','propertyId','date','buyer','buyerAgent','agentContact',
    'offerPrice','earnestMoney','financing','closeDate','status',
    'concClosingCost','concRepairCredit','concHomeWarranty','concRateBuydown','concOther',
    'closingCosts','netToSeller','contingencies','driveUrl','notes',
  ],
  Statuses: ['code','label','lane','system','tone'],
  Lists: ['list','id','label','kind','archived','isDefault'],
  WebAccounts: ['id','org','username','password','email','notes'],

  // ── Collections + record sub-details (flattened: one row per item + FK) ──
  Maintenance: ['id','propertyId','date','category','description','vendor','cost','status'],
  AutoTagRules: ['id','ord','pattern','category','payee','project','conf'],
  TransactionSplits: ['txId','ord','project','category','amount'],
  TenantRentHistory: ['tenantId','ord','effectiveDate','amount','note'],
  ContractorTen99: ['contractorId','taxYear','status','issuedDate','amountReported'],
  StageHistory: ['propertyId','ord','from','to','at','note','by'],
  FeeItems: ['propertyId','kind','ord','label','amount'],
  Utilities: ['propertyId','type','provider','account','status'],
  CompletedEvents: ['key'],
  ExchangeDraws: ['exchangeId','ord','propId','amount','date','note'],
};

// Foreign keys are stored as comma-joined arrays
const ARRAY_COLS = new Set(['identifiedPropIds', 'closedPropIds', 'contingencies']);

// Every tab carries a per-row updatedAt stamp (ISO timestamp, written by the
// app whenever a row changes). write_() merges row-by-row on it: newer wins.
Object.keys(SCHEMA).forEach(function (t) { if (SCHEMA[t].indexOf('updatedAt') === -1) SCHEMA[t].push('updatedAt'); });
// Deletion records: without these, a per-row merge would resurrect deleted
// rows from whichever side still had them. { coll: tab name, id, at }.
SCHEMA.Tombstones = ['coll', 'id', 'at'];

// ─── Entry points ───────────────────────────────────────────────────────────

// Minimum app build allowed to WRITE. A stale cached build (old tab, old
// service-worker copy) doesn't know newer columns — its full-sheet push
// overwrites them with blanks. Bump this when the schema changes; older
// clients get an OUTDATED_BUILD rejection and show "refresh to update"
// instead of corrupting the Sheet. Builds that predate version stamping
// send no appBuild at all (= 0) and are rejected too.
var MIN_APP_BUILD = 3;

// Simple trigger: fires on MANUAL edits in the Sheet (not on the app's own
// programmatic writes). Stamping lastWriteAt lets the app detect hand edits
// and pull them in instead of overwriting them.
function onEdit(e) {
  try {
    PropertiesService.getDocumentProperties().setProperty('lastWriteAt', new Date().toISOString());
  } catch (err) {}
}

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'ping';
  try {
    if (action === 'ping') return json({ ok: true, version: 1 });
    if (action === 'meta') return json(meta_());
    if (action === 'read') return json(read_());
    return json({ ok: false, error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'write') {
      if ((Number(body.appBuild) || 0) < MIN_APP_BUILD) {
        return json({ ok: false, error: 'OUTDATED_BUILD', minAppBuild: MIN_APP_BUILD });
      }
      const stampedAt = write_(body.payload);
      // Return the EXACT stamped lastWriteAt so the app can record it — otherwise
      // its next meta check mistakes our own write for an outside edit.
      return json({ ok: true, wroteAt: stampedAt, lastWriteAt: stampedAt });
    }
    if (action === 'ping') return json({ ok: true });
    return json({ ok: false, error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}

// ─── Setup (run once) ───────────────────────────────────────────────────────

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(tabName => {
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);
    const headers = SCHEMA[tabName];
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  });
  // Remove default Sheet1 if it's empty
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
}

// ─── Migrate (run when UPGRADING an existing, populated workbook) ────────────
// Non-destructive: creates any missing tabs and appends any missing column
// headers, but NEVER clears existing rows. Use this instead of setup() when you
// already have live data in the Sheet. Safe to run repeatedly.
function migrate() {
  const ss = SpreadsheetApp.getActive();
  const report = [];
  Object.keys(SCHEMA).forEach(tabName => {
    const wanted = SCHEMA[tabName];
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      // New tab — create it with full header row.
      sheet = ss.insertSheet(tabName);
      sheet.getRange(1, 1, 1, wanted.length).setValues([wanted]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, wanted.length).setFontWeight('bold');
      report.push('Created tab: ' + tabName);
      return;
    }
    // Existing tab — append only the headers it doesn't already have.
    const lastCol = sheet.getLastColumn();
    const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    const missing = wanted.filter(h => existing.indexOf(h) === -1);
    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      sheet.getRange(1, existing.length + 1, 1, missing.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
      report.push(tabName + ': added ' + missing.join(', '));
    }
  });
  const msg = report.length ? report.join('\n') : 'Already up to date — nothing to migrate.';
  Logger.log(msg);
  return msg;
}

// ─── Read ───────────────────────────────────────────────────────────────────

function read_() {
  const ss = SpreadsheetApp.getActive();
  const data = { _v: 1, readAt: new Date().toISOString(), tabs: {} };
  Object.keys(SCHEMA).forEach(tabName => {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) { data.tabs[tabName] = []; return; }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) { data.tabs[tabName] = []; return; }
    const headers = values[0];
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const row = {};
      let hasValue = false;
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j];
        let v = values[i][j];
        if (v === '' || v == null) { row[key] = null; continue; }
        if (v instanceof Date) v = (key === 'updatedAt') ? v.toISOString() : v.toISOString().slice(0, 10);
        if (ARRAY_COLS.has(key) && typeof v === 'string') v = v.split(',').filter(Boolean);
        if (typeof v === 'string' && (v === 'TRUE' || v === 'FALSE')) v = v === 'TRUE';
        row[key] = v;
        hasValue = true;
      }
      if (hasValue) rows.push(row);
    }
    data.tabs[tabName] = rows;
  });
  return data;
}

// ─── Write ──────────────────────────────────────────────────────────────────

// Close-out figures the server refuses to blank. If an incoming row has an
// empty value for one of these but the Sheet already holds a value for that
// same property id, the existing value is kept. This protects against any
// client pushing a stale local snapshot (device that hasn't pulled recent
// edits) — the build gate can't catch that, only this can.
var PROTECTED_FIELDS = { Properties: ['cashToClose', 'cashReceivedAtClose', 'grossProfit', 'acqDDFee', 'saleDDCollected'] };

// Root tabs merged row-by-row on id + updatedAt (newer wins).
var MERGE_TABS = ['Properties', 'Transactions', 'Tenants', 'RentLedger', 'Contractors', 'Refis', 'Exchanges', 'Leads', 'Offers', 'Tasks', 'Maintenance', 'WebAccounts'];
// Child tabs have no own stamps — each parent id's rows follow whichever side
// won that parent, so a property/transaction and its sub-rows stay consistent.
var CHILD_TABS = { StageHistory: ['Properties', 'propertyId'], FeeItems: ['Properties', 'propertyId'], Utilities: ['Properties', 'propertyId'], TransactionSplits: ['Transactions', 'txId'], TenantRentHistory: ['Tenants', 'tenantId'], ContractorTen99: ['Contractors', 'contractorId'], ExchangeDraws: ['Exchanges', 'exchangeId'] };

function readTabRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = {};
    let has = false;
    for (let j = 0; j < headers.length; j++) {
      let v = values[i][j];
      if (v === '' || v == null) { row[headers[j]] = null; continue; }
      if (v instanceof Date) v = (headers[j] === 'updatedAt') ? v.toISOString() : v.toISOString().slice(0, 10);
      row[headers[j]] = v;
      has = true;
    }
    if (has) rows.push(row);
  }
  return rows;
}

function writeTab_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  if (!rows.length) return;
  // Timestamp columns must stay text — a date-coerced cell reads back with the
  // time truncated, which would flatten same-day merge ordering.
  headers.forEach(function (h, i) {
    if (h === 'updatedAt' || h === 'at') sheet.getRange(2, i + 1, rows.length, 1).setNumberFormat('@');
  });
  const grid = rows.map(function (row) {
    return headers.map(function (h) {
      let v = row[h];
      if (v == null) return '';
      if (Array.isArray(v)) return v.join(',');
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return v;
    });
  });
  sheet.getRange(2, 1, grid.length, headers.length).setValues(grid);
}

function write_(payload) {
  const ss = SpreadsheetApp.getActive();
  const tabs = (payload && payload.tabs) || {};
  const sheets = {};
  const existingRows = {};
  Object.keys(SCHEMA).forEach(function (tabName) {
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);
    sheets[tabName] = sheet;
    existingRows[tabName] = readTabRows_(sheet);
  });

  // 1. Tombstones — union of Sheet + incoming, newest stamp per row, 60-day retention.
  const tombs = {};
  (existingRows.Tombstones || []).concat(tabs.Tombstones || []).forEach(function (t) {
    if (!t || t.id == null) return;
    const k = (t.coll || '') + '|' + String(t.id);
    if (!tombs[k] || String(t.at || '') > String(tombs[k].at || '')) tombs[k] = { coll: t.coll || '', id: String(t.id), at: t.at || '' };
  });
  const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  Object.keys(tombs).forEach(function (k) { if (tombs[k].at && tombs[k].at < cutoff) delete tombs[k]; });
  function tombFor(tab, id) { return tombs[tab + '|' + id]; }

  // 2. Row-by-row merge for id-keyed tabs. Every save used to replace the whole
  //    Sheet ("last save wins") — a device with a stale local snapshot could
  //    silently erase every other device's newer edits. Now each row keeps
  //    whichever version has the newer updatedAt stamp.
  const out = {};
  const winners = {};
  MERGE_TABS.forEach(function (tabName) {
    if (!SCHEMA[tabName]) return;
    const inc = tabs[tabName] || [];
    const ex = existingRows[tabName] || [];
    const exBy = {};
    ex.forEach(function (r) { if (r.id != null) exBy[String(r.id)] = r; });
    const seen = {};
    const rows = [];
    const win = {};
    inc.forEach(function (r) {
      if (r.id == null) { rows.push(r); return; }
      const id = String(r.id);
      seen[id] = true;
      const e = exBy[id];
      const inAt = String(r.updatedAt || '');
      const t = tombFor(tabName, id);
      if (t && String(t.at || '') >= inAt) { win[id] = 'dead'; return; }      // deleted elsewhere, sender hadn't seen it
      if (e && String(e.updatedAt || '') > inAt) { rows.push(e); win[id] = 'ex'; return; }  // Sheet row is newer — keep it
      // Incoming wins (newer or tie) — but never blank a protected close-out figure.
      const prot = PROTECTED_FIELDS[tabName];
      if (prot && e) prot.forEach(function (f) { if ((r[f] == null || r[f] === '') && e[f] != null && e[f] !== '') r[f] = e[f]; });
      rows.push(r);
      win[id] = 'in';
    });
    ex.forEach(function (e) {
      if (e.id == null || seen[String(e.id)]) return;
      const id = String(e.id);
      const t = tombFor(tabName, id);
      if (t && String(t.at || '') >= String(e.updatedAt || '')) { win[id] = 'dead'; return; }
      rows.push(e);                            // sender's snapshot predates this row — keep it
      win[id] = 'ex';
    });
    out[tabName] = rows;
    winners[tabName] = win;
  });

  // 3. Child tabs follow the parent row's winner.
  Object.keys(CHILD_TABS).forEach(function (tabName) {
    if (!SCHEMA[tabName]) return;
    const parent = CHILD_TABS[tabName][0];
    const fk = CHILD_TABS[tabName][1];
    const win = winners[parent] || {};
    const keep = function (side) {
      return function (r) {
        const w = win[String(r[fk])];
        if (w === 'dead') return false;
        if (w == null) return side === 'in';
        return w === side;
      };
    };
    out[tabName] = (tabs[tabName] || []).filter(keep('in')).concat((existingRows[tabName] || []).filter(keep('ex')));
  });

  // 4. Config tabs (Lists, Statuses, AutoTagRules, CompletedEvents, …): full
  //    replace, as before — low-volume settings where last save winning is fine.
  Object.keys(SCHEMA).forEach(function (tabName) {
    if (out[tabName]) return;
    if (tabName === 'Tombstones') { out[tabName] = Object.keys(tombs).map(function (k) { return tombs[k]; }); return; }
    out[tabName] = tabs[tabName] || [];
  });

  Object.keys(SCHEMA).forEach(function (tabName) {
    writeTab_(sheets[tabName], SCHEMA[tabName], out[tabName]);
  });

  // Stamp last-modified
  const props = PropertiesService.getDocumentProperties();
  const stampedAt = new Date().toISOString();
  props.setProperty('lastWriteAt', stampedAt);
  return stampedAt;
}

// ─── Meta ───────────────────────────────────────────────────────────────────

function meta_() {
  const ss = SpreadsheetApp.getActive();
  const counts = {};
  Object.keys(SCHEMA).forEach(tabName => {
    const sheet = ss.getSheetByName(tabName);
    counts[tabName] = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
  });
  return {
    ok: true,
    workbookId: ss.getId(),
    workbookName: ss.getName(),
    lastWriteAt: PropertiesService.getDocumentProperties().getProperty('lastWriteAt'),
    minAppBuild: MIN_APP_BUILD,
    counts: counts,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(obj, status) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
