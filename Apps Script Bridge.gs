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
    'assigned','loanType','lockbox','ddDate','signingDate','purchaseDate',
    'purchasePrice','acqEarnest','purchaseFees','purchaseCredits','purchaseLoan','acqExchangeFunds','acqDDFee',
    'rehab','rehabFunds','interest','salesDate','listPrice','salesPrice','grossProfit',
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
  ],
  RentLedger: [
    'id','tenantId','propertyId','month','charge','paid','paidOn','source',
    'status','lateFeeWaived','linkedTxId',
  ],
  Transactions: [
    'id','date','acct','desc','amount','payee','category','project','importBatch',
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
};

// Foreign keys are stored as comma-joined arrays
const ARRAY_COLS = new Set(['identifiedPropIds', 'closedPropIds', 'contingencies']);

// ─── Entry points ───────────────────────────────────────────────────────────

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
      write_(body.payload);
      return json({ ok: true, wroteAt: new Date().toISOString() });
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
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
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

function write_(payload) {
  const ss = SpreadsheetApp.getActive();
  Object.entries(SCHEMA).forEach(([tabName, headers]) => {
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);

    const sourceRows = (payload.tabs && payload.tabs[tabName]) || [];
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    if (sourceRows.length === 0) return;

    const grid = sourceRows.map(row => headers.map(h => {
      let v = row[h];
      if (v == null) return '';
      if (Array.isArray(v)) return v.join(',');
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return v;
    }));
    sheet.getRange(2, 1, grid.length, headers.length).setValues(grid);
  });
  // Stamp last-modified
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('lastWriteAt', new Date().toISOString());
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
    counts: counts,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(obj, status) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
