// sync.jsx — client-side sync engine for the Apps Script bridge

const SYNC_KEY = 'atmore-sync-config-v1';

const Sync = {
  config: null,
  lastResult: null,

  loadConfig() {
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      this.config = raw ? JSON.parse(raw) : { url: '', autoSync: false };
    } catch (e) {
      this.config = { url: '', autoSync: false };
    }
    return this.config;
  },

  saveConfig(patch) {
    this.config = { ...(this.config || {}), ...patch };
    localStorage.setItem(SYNC_KEY, JSON.stringify(this.config));
  },

  isConfigured() {
    return !!(this.config && this.config.url);
  },

  // Apps Script Web Apps redirect through googleusercontent.com; fetch handles
  // that, but POSTs must use a "simple" content type to avoid CORS preflight.
  async ping() {
    if (!this.isConfigured()) throw new Error('No Web App URL configured.');
    const res = await fetch(this.config.url + '?action=ping', { method: 'GET', redirect: 'follow' });
    return res.json();
  },

  async meta() {
    if (!this.isConfigured()) throw new Error('No Web App URL configured.');
    const res = await fetch(this.config.url + '?action=meta', { method: 'GET', redirect: 'follow' });
    return res.json();
  },

  async pull() {
    if (!this.isConfigured()) throw new Error('No Web App URL configured.');
    const res = await fetch(this.config.url + '?action=read', { method: 'GET', redirect: 'follow' });
    const data = await res.json();
    if (data.ok === false) throw new Error(data.error || 'Pull failed');
    return data;
  },

  async push(state) {
    if (!this.isConfigured()) throw new Error('No Web App URL configured.');
    const payload = serializeForSheet(state);
    const res = await fetch(this.config.url, {
      method: 'POST',
      redirect: 'follow',
      // text/plain avoids the CORS preflight that 'application/json' would trigger
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'write', appBuild: APP_BUILD, payload }),
    });
    const data = await res.json();
    if (data.ok === false) throw new Error(data.error || 'Push failed');
    return data;
  },
};

// Build stamp sent with every write. The bridge rejects writes from builds
// below its MIN_APP_BUILD — the stale-cached-build corruption fix. Bump BOTH
// together whenever the sheet schema changes.
const APP_BUILD = 3;
window.APP_BUILD = APP_BUILD;

// Checklists ride to SharePoint as JSON inside one text cell. A multiline column
// provisioned as RICH text hands that value back HTML-encoded (&quot;) and wrapped
// in <div>, so a straight JSON.parse throws and the checklist reads as EMPTY on
// every other machine — the edit pushes fine, then vanishes on arrival. Decode and
// unwrap before parsing; return null (not []) when a non-empty value still will not
// parse, so the caller keeps what this device already has instead of blanking it.
function unrichText(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:div|p|span|font)[^>]*>/gi, '')
    .replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').trim();
}
function parseChecklistCell(v) {
  const clean = a => a.filter(c => c && c.id != null)
    .map(c => ({ id: String(c.id), text: String(c.text == null ? '' : c.text), done: !!c.done }));
  if (Array.isArray(v)) return clean(v);
  const raw = (v == null ? '' : String(v)).trim();
  if (!raw) return [];
  const tryParse = s => { try { const a = JSON.parse(s); return Array.isArray(a) ? a : null; } catch (e) { return null; } };
  const out = tryParse(raw) || tryParse(unrichText(raw));
  if (!out) {
    try { if (window.SPSync) SPSync.logLine('\u26a0 A task checklist came back from SharePoint in a form the app could not read \u2014 this device kept its own copy'); } catch (e) {}
    return null;
  }
  return clean(out);
}

// Sheet tab → state collection for tabs merged row-by-row on updatedAt.
// Child tabs (splits, fee items, histories…) live ON these parent objects, so
// stamping the parent covers them; the bridge keeps children with the parent.
const MERGED_COLLECTIONS = { Properties: 'properties', Transactions: 'transactions', Tenants: 'tenants', RentLedger: 'rentLedger', Contractors: 'contractors', Refis: 'refis', Exchanges: 'exchanges', Leads: 'leads', Offers: 'offers', Tasks: 'reminders', Maintenance: 'maintenance', WebAccounts: 'webAccounts', SpendLog: 'spendLog', Employees: 'employees', TimeOff: 'timeOff' };

// Convert app state → { tabs: { TabName: [rows] } } matching the Apps Script schema
function serializeForSheet(state) {
  const tabs = {};
  for (const [tabName, def] of Object.entries(window.SHEET_SCHEMA || {})) {
    const rows = def.rowSource(state).map(r => {
      const out = {};
      for (const c of def.columns) {
        let v = r[c.key];
        // Normalize for sheet
        if (v == null) { out[c.key] = null; continue; }
        if (c.type === 'array' && Array.isArray(v)) out[c.key] = v;
        else if (c.key === 'linkedTxIds') out[c.key] = Array.isArray(v) ? v.join(',') : (v || '');
        else if (c.type === 'bool') out[c.key] = !!v;
        else out[c.key] = v;
      }
      out.updatedAt = r.updatedAt || null;   // per-row merge stamp (see SyncEngine._stampChanges)
      return out;
    });
    tabs[tabName] = rows;
  }
  // Deletion records — the bridge merges per-row, so without these a deleted
  // row would resurrect from the Sheet's copy.
  tabs.Tombstones = (state.tombstones || []).map(t => ({ coll: t.coll || '', id: String(t.id), at: t.at || '' }));
  return { _v: 1, sentAt: new Date().toISOString(), tabs };
}

// ─── Schema drift audit ───
// Round-trips live state through serialize → deserialize and reports any field that
// carried a real value on the way in but came back empty. Catches BOTH ways a field
// can silently fail to sync: (1) no column in SHEET_SCHEMA, so serializeForSheet
// never copies it; (2) a hard-coded whitelist in deserializeFromSheet that doesn't
// name it, so a pull strips it. Column auto-create can't help with either — nothing
// is ever sent, so SharePoint never returns the 400 that triggers the repair.
const DRIFT_IGNORE = new Set([
  'netToSeller', 'concClosingCost', 'concRepairCredit', 'concHomeWarranty', 'concRateBuydown', 'concOther',
  'ytd', 'jobs', 'ten99History', 'draws', 'concessions', 'hoas', 'insurance', 'loan', 'tax', 'rentalCarrying',
  'splits', 'feeItems', 'utilities', 'stageHistory', 'updatedAt',
  // Carried by child tabs or folded into flat columns — no own column by design.
  'purchaseFeeItems', 'saleFeeItems', 'loanDetail', 'taxes', 'rentHistory',
]);
function auditSyncFields() {
  const src = Store.state;
  let round;
  try { round = deserializeFromSheet(serializeForSheet(src), { audit: true }); }
  catch (e) { return { error: e.message || String(e), findings: [] }; }
  const findings = [];
  const filled = v => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
  for (const [tabName, coll] of Object.entries(MERGED_COLLECTIONS)) {
    const before = src[coll] || [], after = round[coll] || [];
    if (!before.length) continue;
    const byId = new Map(after.map(r => [r.id, r]));
    // Duplicate/blank ids are the #1 cause of phantom "pull is dropping it" reports:
    // two rows share one id, so the merge keeps one and the other's fields read as
    // lost. Report it as its own finding — no column work can fix it.
    const idSeen = new Set(), dupIds = new Set();
    for (const rec of before) { const k = String(rec.id || ''); if (!k || idSeen.has(k)) dupIds.add(k || '(blank)'); idSeen.add(k); }
    const cols = new Set(((window.SHEET_SCHEMA[tabName] || {}).columns || []).map(c => c.key));
    const lost = new Map();
    // Direction 1 — undeclared columns. A key with no SHEET_SCHEMA column is stripped
    // by serializeForSheet on the way out. Some collections (Exchanges) then restore
    // it from this device's local copy on the way back, so the round-trip below sees
    // no loss even though a second device would show the field blank. This check does
    // not depend on survival, so it catches those.
    for (const rec of before) {
      for (const [k, v] of Object.entries(rec)) {
        if (k[0] === '_' || DRIFT_IGNORE.has(k) || cols.has(k) || !filled(v)) continue;
        const e = lost.get(k) || { field: k, count: 0, inSchema: false, sample: v };
        e.count++; lost.set(k, e);
      }
    }
    // Direction 2 — declared column, but the pull drops it (hard-coded whitelist).
    for (const rec of before) {
      if (dupIds.has(String(rec.id || '')) || dupIds.has('(blank)') && !rec.id) continue;  // explained by the duplicate-id finding
      const out = byId.get(rec.id);
      if (!out) continue;
      for (const [k, v] of Object.entries(rec)) {
        if (k[0] === '_' || DRIFT_IGNORE.has(k) || !filled(v)) continue;
        if (!cols.has(k)) continue;   // already reported above
        if (filled(out[k])) continue;
        const e = lost.get(k) || { field: k, count: 0, inSchema: true, sample: v };
        e.count++; lost.set(k, e);
      }
    }
    if (dupIds.size) lost.set('id', { field: 'id', count: dupIds.size, inSchema: true, dup: true, sample: [...dupIds].join(', ') });
    if (lost.size) findings.push({ tab: tabName, collection: coll, records: before.length, fields: [...lost.values()].sort((a, b) => b.count - a.count) });
  }
  // Direction 3 — the server itself never returned the column. Not visible to the
  // round-trip above (which serializes through the local schema, so every column is
  // always present); only a real pull can see it. Recorded by preserveMissingKeys.
  for (const [tabName, fields] of Object.entries(RestoreLog.all())) {
    const coll = MERGED_COLLECTIONS[tabName]; if (!coll) continue;
    const rows = Object.entries(fields).map(([field, count]) => ({ field, count, inSchema: true, serverMissing: true, sample: '' }));
    if (!rows.length) continue;
    const hit = findings.find(f => f.tab === tabName);
    if (hit) hit.fields = [...hit.fields.filter(f => !fields[f.field]), ...rows];
    else findings.push({ tab: tabName, collection: coll, records: (src[coll] || []).length, fields: rows });
  }
  return { error: null, findings, checkedAt: new Date().toISOString() };
}

// ─── Server-acknowledged row ids ───
// "Has the server ever confirmed this row exists?" — deliberately NOT the same
// question as SyncEngine._rowSigs, which is a local-edit signature map: it gains
// a row the moment it is saved locally, long before any push succeeds. Only two
// things add to this set: a row that came back in a pull, and a row a push
// confirmed. That makes "absent here" a reliable proof of never-pushed, which is
// what the pull's rescue pass needs to tell a failed import from a remote delete.
const ServerAck = {
  _m: null,
  _load() {
    if (this._m) return this._m;
    this._m = {};
    try {
      const raw = JSON.parse(localStorage.getItem('sync_acked_v1') || '{}');
      for (const [t, ids] of Object.entries(raw)) this._m[t] = new Set(ids.map(String));
    } catch (e) {}
    return this._m;
  },
  _persist() {
    try {
      const out = {};
      for (const [t, s] of Object.entries(this._m || {})) out[t] = [...s];
      localStorage.setItem('sync_acked_v1', JSON.stringify(out));
    } catch (e) {}
  },
  known(tab) { const m = this._load(); return m[tab] || null; },
  add(tab, ids) {
    const m = this._load();
    const s = m[tab] || (m[tab] = new Set());
    (ids || []).forEach(id => { if (id != null) s.add(String(id)); });
    this._persist();
  },
  // A pull is the authoritative picture of what the server holds for that tab.
  syncTab(tab, ids) {
    const m = this._load();
    m[tab] = new Set((ids || []).filter(id => id != null).map(String));
    this._persist();
  },
  reset() { this._m = {}; this._persist(); },
};

// ─── Restored-from-local log ───
// When a pulled row is MISSING a key the local copy has, the deserializer keeps the
// local value so a stale bridge can't wipe it. That rescue is also a trap: this
// device looks fine forever while a second device — with nothing local to restore
// from — shows the field blank. Every restore is recorded here so the field check
// can report it instead of it staying invisible.
const RestoreLog = {
  m: {},
  note(tab, field) {
    const t = this.m[tab] || (this.m[tab] = {});
    t[field] = (t[field] || 0) + 1;
  },
  reset() { this.m = {}; },
  all() { return this.m; },
};
window.__pullRestores = RestoreLog;

// Keep a pulled row's fields, but restore any key the server did not return at all
// from this device's copy. Blank cells come back as null (key present), so a missing
// key means the column does not exist server-side or is being skipped on push.
function preserveMissingKeys(serverRow, localRow, tabName, audit, skip) {
  const out = { ...serverRow };
  for (const k of Object.keys(localRow || {})) {
    if (skip && skip.includes(k)) continue;
    if (k in serverRow) continue;
    const v = localRow[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
    if (!audit) RestoreLog.note(tabName, k);
  }
  return out;
}

// Rows this device deleted that the Sheet still has. Drop them from the pulled
// snapshot — otherwise they reappear — and report it so the caller re-sends the
// delete instead of clearing dirty and forgetting it. The SharePoint path has done
// this since it shipped (_finishPull → _dropTombstoned); the Sheet path never did,
// so any auto-pull landing before the delete's push silently undid the deletion.
function dropTombstonedFromSheet(state) {
  const tombs = (state && state.tombstones) || [];
  if (!tombs.length) return 0;
  const byColl = {};
  tombs.forEach(t => {
    if (!t || t.id == null || !t.coll) return;
    (byColl[t.coll] = byColl[t.coll] || new Set()).add(String(t.id));
  });
  let dropped = 0;
  Object.keys(byColl).forEach(coll => {
    const list = state[coll];
    if (!Array.isArray(list)) return;
    const ids = byColl[coll];
    // A row RESTORED or re-created on the server after the delete was recorded must
    // win — a version-history restore is the counter-case to "re-send the delete".
    const tsAt = {};
    tombs.forEach(t => { if (t && t.coll === coll && t.id != null) tsAt[String(t.id)] = String(t.at || ''); });
    const kept = list.filter(r => {
      if (!r || r.id == null || !ids.has(String(r.id))) return true;
      const at = tsAt[String(r.id)] || '';
      return !!(r.updatedAt && at && String(r.updatedAt) > at);
    });
    if (kept.length !== list.length) { dropped += list.length - kept.length; state[coll] = kept; }
  });
  return dropped;
}

// Convert pulled { tabs: {...} } → app state shape
function deserializeFromSheet(pulledData, opts) {
  const audit = !!(opts && opts.audit);
  if (!pulledData || !pulledData.tabs) throw new Error('Empty or malformed response');
  const tabs = pulledData.tabs;
  if (!audit) RestoreLog.reset();
  const state = JSON.parse(JSON.stringify(window.SEED));  // start from seed shape
  state.uiState = Store.state.uiState || { selectedPropertyId: null, propertyTab: 'summary' };
  // Local-only flags a pull must not drop. _offersSeeded gates a one-time sample
  // seed that REPLACES the offers array — losing the flag re-runs it on the next
  // reload and wipes real offers.
  state._offersSeeded = Store.state._offersSeeded || state._offersSeeded;
  // Same one-time-seed gate for the roster: losing it re-seeds four people who
  // may have been deliberately removed, on every reload.
  state._employeesSeeded = Store.state._employeesSeeded || state._employeesSeeded;
  // Local bookkeeping that must survive a pull. These are not Sheet columns; dropping
  // them re-armed the one-time tombstone audit (which then cleared every legitimate
  // deletion record) and made both engines fall back to the retired size heuristic.
  state._intentDeletes = Store.state._intentDeletes || state._intentDeletes || [];
  state._intentSince   = Store.state._intentSince || state._intentSince || null;
  state._tombAuditV2   = Store.state._tombAuditV2 || state._tombAuditV2 || false;
  // Deletion records ride along so this device honors deletes made elsewhere.
  state.tombstones = Array.isArray(tabs.Tombstones)
    ? tabs.Tombstones.filter(t => t && t.id != null).map(t => ({ coll: t.coll || '', id: String(t.id), at: t.at || '' }))
    : (Store.state.tombstones || []);
  // The maintenance log stays local-only (not a Sheet tab); carry it across a pull
  // so a remote refresh never wipes it. Tasks DO sync — see the Tasks tab below.
  // Tasks/reminders now sync via the Tasks tab. Fail-safe: if the tab is absent
  // (older bridge not yet migrated), keep this device's tasks so nothing is lost.
  const localTaskById = new Map((Store.state.reminders || []).map(r => [String(r.id), r]));
  state.reminders = Array.isArray(tabs.Tasks)
    ? tabs.Tasks.map(r => ({
        id: r.id,
        propertyId: r.propertyId || '',
        title: r.title || '',
        dueDate: r.dueDate || '',
        priority: r.priority || 'normal',
        recurrence: r.recurrence || 'none',
        done: r.done === true || r.done === 'TRUE' || r.done === 'true',
        lastDone: r.lastDone || null,
        notes: r.notes || '',
        checklist: (() => {
          const parsed = parseChecklistCell(r.checklist);
          if (parsed) return parsed;
          const prev = localTaskById.get(String(r.id));
          return (prev && Array.isArray(prev.checklist)) ? prev.checklist : [];
        })(),
        updatedAt: r.updatedAt || null,
      }))
    : (Store.state.reminders || []);
  // ── Child-tab helpers ──────────────────────────────────────────────────
  // Sub-collections (splits, histories, fee items, …) are flattened into their
  // own tabs with a foreign key. Each helper regroups them by parent id. If a
  // tab is ABSENT (older bridge not yet migrated), the helper returns null so
  // the caller keeps this device's local copy instead of wiping it.
  const childTab = (name) => Array.isArray(tabs[name]) ? tabs[name] : null;
  const byOrd = (a, b) => (a.ord || 0) - (b.ord || 0);
  const groupByFk = (rows, fk) => {
    const m = {};
    (rows || []).forEach(r => { const k = r[fk]; (m[k] = m[k] || []).push(r); });
    return m;
  };

  // Maintenance log — now a synced tab; fail-safe to local if the tab is absent.
  state.maintenance = childTab('Maintenance')
    ? tabs.Maintenance.map(m => ({
        id: m.id, propertyId: m.propertyId || '', date: m.date || '',
        category: m.category || '', description: m.description || '',
        vendor: m.vendor || '', cost: (m.cost === '' || m.cost == null) ? null : m.cost,
        status: m.status || 'open', updatedAt: m.updatedAt || null,
      }))
    : (Store.state.maintenance || []);

  // Completed calendar events — now synced. Rebuild the {key:true} map from rows.
  state.completedEvents = childTab('CompletedEvents')
    ? Object.fromEntries(tabs.CompletedEvents.filter(r => r.key).map(r => [String(r.key), true]))
    : (Store.state.completedEvents || {});

  // Pre-grouped child tables consumed by the passes below.
  const splitsByTx  = childTab('TransactionSplits') ? groupByFk(tabs.TransactionSplits, 'txId') : null;
  const rentHistByT = childTab('TenantRentHistory') ? groupByFk(tabs.TenantRentHistory, 'tenantId') : null;
  const ten99ByC    = childTab('ContractorTen99') ? groupByFk(tabs.ContractorTen99, 'contractorId') : null;
  const stageByP    = childTab('StageHistory') ? groupByFk(tabs.StageHistory, 'propertyId') : null;
  const feesByP     = childTab('FeeItems') ? groupByFk(tabs.FeeItems, 'propertyId') : null;
  const utilByP     = childTab('Utilities') ? groupByFk(tabs.Utilities, 'propertyId') : null;

  const localProps = {};
  (Store.state.properties || []).forEach(p => { localProps[p.id] = p; });
  const hoaSeq = { n: 1000 };
  const num = v => (v === '' || v == null) ? null : (typeof v === 'number' ? v : (isNaN(parseFloat(v)) ? null : parseFloat(v)));
  const truthy = v => v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
  const nonEmpty = obj => Object.values(obj).some(v => v != null && v !== '');

  // Properties — nested objects (insurance/loan/taxes/HOAs) are now FLAT columns on this tab.
  const rebuiltHoas = [];
  const tabPresent = name => Array.isArray(tabs[name]);
  state.properties = !tabPresent('Properties') ? (Store.state.properties || []) : (tabs.Properties).map(p => {
    const out = { ...p };
    const local = localProps[p.id] || {};
    // Columns the Sheet doesn't have yet (bridge not migrated) come back with the
    // key entirely ABSENT from the pulled row. Keep this device's local value for
    // those instead of erasing it. (Blank cells DO come back as null and win.)
    for (const k of Object.keys(local)) {
      if (!(k in out)) out[k] = local[k];
    }
    // Close-out HUD money figures are sticky: a stale app build pushes blank
    // cells for columns it doesn't know, and "blank wins" was erasing recorded
    // figures (cashReceivedAtClose etc.) — silently corrupting net profit.
    // So a blank from the server does not overwrite a local value UNLESS the
    // server row is newer — otherwise clearing one of these on another device
    // could never reach this one (the same class of bug as the cash-out
    // auto-fill: a clear that never lands).
    const serverNewer = out.updatedAt && local.updatedAt && String(out.updatedAt) > String(local.updatedAt);
    for (const k of ['cashReceivedAtClose', 'cashToClose', 'grossProfit', 'saleDDCollected', 'acqDDFee']) {
      if (out[k] == null && local[k] != null && !serverNewer) out[k] = local[k];
    }
    // Stage history isn't synced anymore — keep local, or seed one entry for a fresh import.
    // Stage history — synced tab authoritative; else keep local; else seed one entry.
    if (stageByP) {
      const sh = (stageByP[p.id] || []).slice().sort(byOrd)
        .map(h => ({ rowId: h.rowId, from: h.from || null, to: h.to || null, at: h.at || '', note: h.note || '', by: h.by || '' }));
      out.stageHistory = sh.length ? sh
        : [{ from: null, to: out.statusCode, at: out.purchaseDate || out.signingDate || out.ddDate || state.today, note: 'Imported', by: 'import' }];
    } else {
      out.stageHistory = (local.stageHistory && local.stageHistory.length)
        ? local.stageHistory
        : [{ from: null, to: out.statusCode, at: out.purchaseDate || out.signingDate || out.ddDate || state.today, note: 'Imported', by: 'import' }];
    }
    // Fee items — synced tab authoritative; else keep local.
    if (feesByP) {
      const items = feesByP[p.id] || [];
      out.purchaseFeeItems = items.filter(r => r.kind === 'purchase').slice().sort(byOrd).map(r => ({ rowId: r.rowId, label: r.label || '', amount: r.amount ?? 0 }));
      out.saleFeeItems = items.filter(r => r.kind === 'sale').slice().sort(byOrd).map(r => ({ rowId: r.rowId, label: r.label || '', amount: r.amount ?? 0 }));
    } else {
      out.purchaseFeeItems = local.purchaseFeeItems || [];
      out.saleFeeItems = local.saleFeeItems || [];
    }

    // Insurance
    const ins = { carrier: p.insCarrier || '', policyNumber: p.insPolicy || '', premium: num(p.insPremium), renewalDate: p.insRenewal || '', agentName: p.insAgent || '', agentPhone: p.insAgentPhone || '' };
    out.insurance = nonEmpty(ins) ? ins : null;
    // Loan detail
    const loan = { lender: p.loanLender || '', loanNumber: p.loanNumber || '', monthlyPayment: num(p.loanPayment), currentBalance: num(p.loanBalance), interestRate: num(p.loanRate), maturityDate: p.loanMaturity || '', escrowedTaxes: truthy(p.loanEscrowTaxes), escrowedInsurance: truthy(p.loanEscrowIns), lenderContact: p.loanContact || '' };
    out.loanDetail = (loan.lender || loan.loanNumber || loan.currentBalance != null || loan.monthlyPayment != null) ? loan : null;
    // Rental P&L carrying costs
    const carry = { mortgage: num(p.carryMortgage), hoa: num(p.carryHOA), tax: num(p.carryTax), insurance: num(p.carryInsurance) };
    out.rentalCarrying = Object.values(carry).some(v => v != null) ? carry : null;
    // Taxes
    const tax = { annualAmount: num(p.taxAnnual), dueDate: p.taxDueDate || '', escrowed: truthy(p.taxEscrowed), taxId: p.taxParcel || '' };
    out.taxes = (tax.annualAmount != null || tax.taxId || tax.dueDate) ? tax : null;
    // Utilities — synced tab authoritative for provider/account/status; else keep
    // local structure. The per-property note still rides on the Properties column.
    if (utilByP) {
      const u = {};
      (utilByP[p.id] || []).forEach(r => { if (r.type) u[r.type] = { provider: r.provider || '', account: r.account || '', status: r.status || '' }; });
      out.utilities = Object.keys(u).length ? u : null;
    } else {
      out.utilities = local.utilities || null;
    }
    if (p.utilityNote) { out.utilities = { ...(out.utilities || {}), note: p.utilityNote }; }

    // HOAs → rebuild rows into the global hoas array
    [[p.hoa1Name, p.hoa1Url, p.hoa1User, p.hoa1Pass, p.hoa1Monthly], [p.hoa2Name, p.hoa2Url, p.hoa2User, p.hoa2Pass, p.hoa2Monthly]]
      .forEach(([name, url, user, pass, monthly]) => {
        if (name || url || user || pass || monthly != null) {
          rebuiltHoas.push({ id: 'hoa' + (hoaSeq.n++), propertyId: p.id, name: name || '', website: url || '', username: user || '', password: pass || '', monthly: num(monthly), lastVerified: '' });
        }
      });

    // strip the flattened helper columns off the property record
    ['insCarrier','insPolicy','insPremium','insRenewal','insAgent','insAgentPhone',
     'loanLender','loanNumber','loanPayment','loanBalance','loanRate','loanMaturity','loanEscrowTaxes','loanEscrowIns','loanContact',
     'taxAnnual','taxDueDate','taxEscrowed','taxParcel','utilityNote',
     'carryMortgage','carryHOA','carryTax','carryInsurance',
     'hoa1Name','hoa1Url','hoa1User','hoa1Pass','hoa1Monthly','hoa2Name','hoa2Url','hoa2User','hoa2Pass','hoa2Monthly'].forEach(k => delete out[k]);
    return out;
  });

  // Tenants — rent-change history is no longer synced; keep local if present.
  const localTenants = {};
  (Store.state.tenants || []).forEach(t => { localTenants[t.id] = t; });
  state.tenants = !tabPresent('Tenants') ? (Store.state.tenants || []) : (tabs.Tenants).map(t => {
    const out = { ...t };
    out.rentHistory = rentHistByT
      ? (rentHistByT[t.id] || []).slice().sort(byOrd).map(h => ({ rowId: h.rowId, effectiveDate: h.effectiveDate || '', amount: h.amount ?? 0, note: h.note || '' }))
      : ((localTenants[t.id] && localTenants[t.id].rentHistory) || []);
    return out;
  });

  state.rentLedger = !tabPresent('RentLedger') ? (Store.state.rentLedger || []) : (tabs.RentLedger).map(r => {
    const out = { ...r };
    // linkedTxIds round-trips as a comma-joined string; rebuild the array so the
    // legacy-migration in validateRentLinks doesn't fire (and mark dirty) on every open.
    if (typeof out.linkedTxIds === 'string') out.linkedTxIds = out.linkedTxIds ? out.linkedTxIds.split(',').map(x => x.trim()).filter(Boolean) : [];
    else if (!Array.isArray(out.linkedTxIds)) out.linkedTxIds = out.linkedTxId ? [out.linkedTxId] : [];
    out.reducedCharge = !!out.reducedCharge;
    out.noAutoMatch = !!out.noAutoMatch;
    return out;
  });
  // The Sheet can carry duplicate / mixed-format ledger rows (same tenant+month posted
  // many times). Collapse them on the way in so a pull never re-introduces the repeats
  // the load-time migration just cleaned up.
  if (typeof dedupeRentLedger === 'function') dedupeRentLedger(state);

  // Transactions — splits are no longer a synced tab; keep any local splits by id.
  const localTx = {};
  (Store.state.transactions || []).forEach(t => { localTx[t.id] = t; });
  // Wipe guard: an EMPTY Transactions tab (wrong sheet, botched copy, cleared tab)
  // must not erase a populated local ledger. Keep local; the next push restores the tab.
  const _sheetTxRows = Array.isArray(tabs.Transactions) ? tabs.Transactions : [];
  if (_sheetTxRows.length === 0 && (Store.state.transactions || []).length > 25) {
    state.transactions = Store.state.transactions;
    if (window.SyncEngine) SyncEngine.dirty = true;  // push local ledger back to the Sheet
  } else {
  state.transactions = !tabPresent('Transactions') ? (Store.state.transactions || []) : (tabs.Transactions).map(tx => {
    const out = { ...tx };
    if (splitsByTx) {
      const sp = (splitsByTx[tx.id] || []).slice().sort(byOrd);
      if (sp.length) out.splits = sp.map(x => ({ rowId: x.rowId, project: x.project || '', amount: x.amount ?? 0, category: x.category || '', bucket: x.bucket || '' }));
    } else if (localTx[tx.id] && localTx[tx.id].splits) {
      out.splits = localTx[tx.id].splits;
    }
    return out;
  });
  }

  // A pull can re-introduce standalone copies of split slices — drop them here too.
  if (typeof dedupeSplitMaterializations === 'function') dedupeSplitMaterializations(state);

  // HOAs were rebuilt from the flat hoa1/hoa2 columns during the Properties pass.
  state.hoas = tabPresent('Properties') ? rebuiltHoas : (Store.state.hoas || []);

  // Contractors — 1099 history no longer synced; keep local. YTD recomputed from transactions.
  const localContractors = {};
  (Store.state.contractors || []).forEach(c => { localContractors[c.id] = c; });
  state.contractors = !tabPresent('Contractors') ? (Store.state.contractors || []) : (tabs.Contractors).map(c => {
    const out = { ...c };
    out.ten99History = ten99ByC
      ? (ten99ByC[c.id] || []).map(h => ({ taxYear: h.taxYear ?? null, status: h.status || '', issuedDate: h.issuedDate || '', amountReported: h.amountReported ?? null }))
      : ((localContractors[c.id] && localContractors[c.id].ten99History) || []);
    out.ytd = state.transactions
      .filter(t => t.payee === c.name && t.category === 'Contractor Payment')
      .reduce((a,t) => a + Math.abs(t.amount), 0);
    out.jobs = state.transactions
      .filter(t => t.payee === c.name && t.category === 'Contractor Payment').length;
    return out;
  });

  // Refis: same absent-column fail-safe as Exchanges below. Without it, a column the
  // server never returns (never provisioned, or dropped into skipFields after a
  // rejection) blanks the field on EVERY device on the next pull.
  const localRefi = {};
  (Store.state.refis || []).forEach(r => { localRefi[r.id] = r; });
  state.refis = tabPresent('Refis')
    ? tabs.Refis.map(r => preserveMissingKeys(r, localRefi[r.id] || {}, 'Refis', audit))
    : (Store.state.refis || []);
  // Exchanges: a stale/un-migrated bridge must never wipe newer fields. Preserve any
  // local field the Sheet didn't return a column for, and keep local draws if the
  // ExchangeDraws tab is absent — mirrors the Insurance/Loan/Tax fail-safe above.
  const localExch = {};
  (Store.state.exchanges || []).forEach(x => { localExch[x.id] = x; });
  const hasDrawsTab = Array.isArray(tabs.ExchangeDraws);
  state.exchanges = !tabPresent('Exchanges') ? (Store.state.exchanges || []) : (tabs.Exchanges).map(e => {
    const local = localExch[e.id] || {};
    const out = preserveMissingKeys(e, local, 'Exchanges', audit, ['draws']);
    // Draws live in their own tab. Tab PRESENT → authoritative (even if empty for this
    // exchange). Tab ABSENT (old bridge) → preserve whatever is on this device.
    if (hasDrawsTab) {
      const draws = tabs.ExchangeDraws
        .filter(d => d.exchangeId === e.id)
        .map(d => ({ drawId: d.drawId || (e.id + '#' + d.ord), propId: d.propId || '', amount: d.amount, date: d.date || '', note: d.note || '' }));
      if (draws.length) out.draws = draws; else delete out.draws;
    } else if (local.draws && local.draws.length) {
      out.draws = local.draws;
    }
    return out;
  });
  state.leads = tabPresent('Leads') ? tabs.Leads : (Store.state.leads || []);

  // Offers — rebuild the nested concessions object from flat columns. Spread `o` first
  // so any column added to the schema later survives a pull even if it isn't named
  // explicitly below (the old hard whitelist silently dropped due-diligence fields).
  state.offers = !tabPresent('Offers') ? (Store.state.offers || []) : (tabs.Offers).map(o => ({
    ...o,
    id: o.id, propertyId: o.propertyId, date: o.date,
    buyer: o.buyer, buyerAgent: o.buyerAgent, agentContact: o.agentContact,
    offerPrice: o.offerPrice, earnestMoney: o.earnestMoney,
    financing: o.financing, closeDate: o.closeDate, status: o.status,
    dueDiligenceFee: o.dueDiligenceFee != null && o.dueDiligenceFee !== '' ? Number(o.dueDiligenceFee) : null,
    dueDiligenceDays: o.dueDiligenceDays != null && o.dueDiligenceDays !== '' ? Number(o.dueDiligenceDays) : null,
    dueDiligenceDate: o.dueDiligenceDate || null,
    closingCosts: o.closingCosts,
    concessions: {
      closingCost:  o.concClosingCost  || 0,
      repairCredit: o.concRepairCredit || 0,
      homeWarranty: o.concHomeWarranty || 0,
      rateBuydown:  o.concRateBuydown  || 0,
      other:        o.concOther        || 0,
    },
    contingencies: Array.isArray(o.contingencies)
      ? o.contingencies
      : (o.contingencies ? String(o.contingencies).split(',').map(x => x.trim()).filter(Boolean) : []),
    driveUrl: o.driveUrl || '',
    notes: o.notes,
    updatedAt: o.updatedAt || null,
    concClosingCost: undefined, concRepairCredit: undefined, concHomeWarranty: undefined,
    concRateBuydown: undefined, concOther: undefined, netToSeller: undefined,
  })).map(o => { Object.keys(o).forEach(k => { if (o[k] === undefined) delete o[k]; }); return o; });

  // Lists — one consolidated tab split back into the managed lists + accounts + team.
  const listRows = tabs.Lists || [];
  const pickList = type => listRows.filter(r => r.list === type)
    .map(r => ({ id: r.id, label: r.label, ...(r.kind ? { kind: r.kind } : {}), archived: truthy(r.archived), isDefault: truthy(r.isDefault) }));
  if (Array.isArray(tabs.Lists) && listRows.length > 0) {
    const pt = pickList('propertyType');
    state.lists = {
      categories:     pickList('category'),
      paymentSources: pickList('paymentSource'),
      loanTypes:      pickList('loanType'),
      vestingLLCs:    pickList('vestingLLC'),
      propertyTypes:  pt.length ? pt : ((Store.state.lists && Store.state.lists.propertyTypes) || []),
    };
    const accts = listRows.filter(r => r.list === 'account').map(r => ({ id: r.id, label: r.label || '', kind: r.kind || 'checking' }));
    state.accounts = accts.length ? accts : ((Store.state.accounts && Store.state.accounts.length) ? Store.state.accounts : window.SEED.accounts);
    const team = listRows.filter(r => r.list === 'team').map(r => r.label).filter(Boolean);
    state.team = team.length ? team : ((Store.state.team && Store.state.team.length) ? Store.state.team : window.SEED.team);
  } else {
    state.lists    = Store.state.lists || JSON.parse(JSON.stringify(window.SEED.lists || {}));
    state.accounts = (Store.state.accounts && Store.state.accounts.length) ? Store.state.accounts : window.SEED.accounts;
    state.team     = (Store.state.team && Store.state.team.length) ? Store.state.team : window.SEED.team;
  }

  // Web accounts (vendor / portal logins)
  state.webAccounts = Array.isArray(tabs.WebAccounts)
    ? tabs.WebAccounts.map(r => ({ id: r.id, org: r.org || '', url: r.url || '', username: r.username || '', password: r.password || '', email: r.email || '', notes: r.notes || '', updatedAt: r.updatedAt || null }))
    : (Store.state.webAccounts || []);

  // A server list can hold two rows under one record id (a list provisioned
  // without its key column produced exactly that). Importing both would show the
  // same payment or absence twice, so collapse on the way in: newest write wins.
  const keepLatestById = rows => {
    const keep = new Map();
    for (const r of rows) {
      const id = String(r.id);
      const prev = keep.get(id);
      if (!prev || String(r.updatedAt || '') >= String(prev.updatedAt || '')) keep.set(id, r);
    }
    return [...keep.values()];
  };

  // Spend log — checks written and phone sales. Operational only: never feeds
  // reports or P&L, which read imported bank transactions.
  state.spendLog = Array.isArray(tabs.SpendLog)
    ? keepLatestById(tabs.SpendLog.filter(r => r && r.id != null && r.id !== '').map(r => ({ id: r.id, date: r.date || '', time: r.time || '', method: r.method === 'check' ? 'check' : 'phone',
        amount: Number(r.amount) || 0, vendor: r.vendor || '', contractorId: r.contractorId || '', contractorName: r.contractorName || '',
        propertyId: r.propertyId || '', cardLast4: r.cardLast4 == null ? '' : String(r.cardLast4), checkNumber: r.checkNumber == null ? '' : String(r.checkNumber),
        note: r.note || '', voided: r.voided === true || r.voided === 'TRUE' || r.voided === 'true', updatedAt: r.updatedAt || null })))
    : (Store.state.spendLog || []);

  state.employees = Array.isArray(tabs.Employees)
    ? keepLatestById(tabs.Employees.filter(r => r && r.id != null && r.id !== '').map(r => ({ id: r.id, name: r.name || '', updatedAt: r.updatedAt || null })))
    : (Store.state.employees || []);

  state.timeOff = Array.isArray(tabs.TimeOff)
    ? keepLatestById(tabs.TimeOff.filter(r => r && r.id != null && r.id !== '').map(r => ({ id: r.id, employeeId: r.employeeId || '', type: r.type || 'pto',
        startDate: r.startDate || '', endDate: r.endDate || r.startDate || '',
        halfDay: r.halfDay === true || r.halfDay === 'TRUE' || r.halfDay === 'true',
        note: r.note || '', updatedAt: r.updatedAt || null })))
    : (Store.state.timeOff || []);

  // Pipeline statuses — present tab authoritative; absent/empty keeps local, then seed.
  if (Array.isArray(tabs.Statuses) && tabs.Statuses.length) {
    state.statuses = tabs.Statuses.map(r => ({
      code:   String(r.code || '').trim(),
      label:  r.label || r.code,
      lane:   r.lane || 'pipeline',
      system: r.system === true || r.system === 'true' || r.system === 'TRUE' || r.system === 1 || r.system === '1',
      tone:   r.tone ? String(r.tone).trim() : null,
    })).filter(s => s.code);
    // SharePoint returns list items in arbitrary order — restore the canonical
    // lane order (pipeline → rental → archive), codes alphabetical within lane.
    const laneRank = { pipeline: 0, rental: 1, archive: 2 };
    state.statuses.sort((a, b) => (laneRank[a.lane] ?? 3) - (laneRank[b.lane] ?? 3) || a.code.localeCompare(b.code));
  }
  if (!Array.isArray(state.statuses) || !state.statuses.length) {
    state.statuses = (Store.state.statuses && Store.state.statuses.length)
      ? Store.state.statuses : defaultStatuses();
  }

  // "Today" is a client-side clock, not Sheet data — never freeze it to the seed date
  // on a pull (that's what showed May 27). Use the real current date, and never move
  // backward from a later local value.
  const realToday = new Date().toISOString().slice(0, 10);
  state.today = (Store.state && Store.state.today && Store.state.today > realToday)
    ? Store.state.today : realToday;

  // Auto-tag rules — now a synced tab (ordered by Ord). Fail-safe: if the tab is
  // absent (older bridge), keep this device's rules; if there are none either,
  // leave unset so ensureAutoTagRules() seeds the built-in defaults later.
  if (childTab('AutoTagRules')) {
    state.autoTagRules = tabs.AutoTagRules.slice().sort(byOrd).map(r => ({
      id: r.id, pattern: r.pattern || '', category: r.category || '',
      payee: r.payee || '', project: r.project || '', conf: r.conf ?? 80,
    }));
  } else if (Array.isArray(Store.state && Store.state.autoTagRules)) {
    state.autoTagRules = Store.state.autoTagRules;
  }

  // ─── Never-synced local rows survive a pull ───
  // Every collection above rebuilds itself from the pulled rows, so a row that
  // exists ONLY on this device — an import whose push failed, was throttled, or
  // was interrupted — vanished on the next pull even though it was never on the
  // server to delete. (The earlier guards covered a MISSING or EMPTY tab, not
  // individual local-only rows.)
  //
  // A local row missing from the pull is one of two things:
  //   deleted elsewhere → the server has acknowledged it before (it's in ServerAck)
  //   never pushed      → the server has never confirmed it
  // Keep only the second kind, skipping anything tombstoned. The rescued ids are
  // recorded on the state so the caller can drop them from its post-pull baseline
  // (otherwise they'd look already-saved and never get written) and flush.
  //
  // In SharePoint mode SPSync._items[tab] is an even stronger signal: it maps
  // RecID → SharePoint item id only for rows that genuinely exist server-side.
  const spItems = (window.SPSync && SPSync.liveOn && SPSync.liveOn() && SPSync._items) || null;
  {
    const tombAt = new Map();
    (Store.state.tombstones || []).forEach(t => {
      const k = t.coll + ':' + t.id, at = String(t.at || '');
      if (!tombAt.has(k) || at > tombAt.get(k)) tombAt.set(k, at);
    });
    const rescued = {};
    for (const [tab, coll] of Object.entries(MERGED_COLLECTIONS)) {
      if (!Array.isArray(tabs[tab]) || !Array.isArray(state[coll])) continue;
      const pulled = new Set(state[coll].map(r => String(r && r.id)));
      // Every row the server just handed us is confirmed; anything it no longer
      // lists is no longer confirmed. Do this BEFORE the test below so the very
      // first pull bootstraps an accurate picture.
      const ackedBefore = ServerAck.known(tab);
      const spIdx = spItems && spItems[tab];
      ServerAck.syncTab(tab, [...pulled]);
      // No prior knowledge and no SharePoint index: can't distinguish a remote
      // delete from a failed push, so keep the old conservative behaviour.
      if (!ackedBefore && !spIdx) continue;
      for (const r of (Store.state[coll] || [])) {
        if (!r || r.id == null) continue;
        const id = String(r.id);
        if (pulled.has(id)) continue;
        // A tombstone only suppresses the rescue if the delete is newer than the
        // record; a re-created record outlives an older delete.
        const tomb = tombAt.get(tab + ':' + id);
        if (tomb != null && !(String(r.updatedAt || '') > tomb)) continue;
        const serverHadIt = spIdx ? spIdx.has(id) : ackedBefore.has(id);
        if (serverHadIt) continue;          // genuinely deleted elsewhere
        state[coll].push(r);
        (rescued[tab] = rescued[tab] || []).push(id);
      }
    }
    if (Object.keys(rescued).length) state._rescued = rescued;
  }

  // ── Wipe guard, generalized ──────────────────────────────────────────────────
  // Transactions had this guard; Properties and the other big lists did not, and
  // that gap erased a whole portfolio. tabPresent() only catches a MISSING tab —
  // an EMPTY one (`[]`) is Array.isArray-true, so it mapped to [] and wiped local.
  // A present-but-empty tab is never a real mass deletion; it means a wrong sheet,
  // a cleared tab, a header-only read, or a partial/throttled fetch. Keep local and
  // mark dirty so the next push restores the tab.
  [['Properties', 'properties', 3], ['Tenants', 'tenants', 3], ['RentLedger', 'rentLedger', 5],
   ['Contractors', 'contractors', 3], ['Refis', 'refis', 2], ['Exchanges', 'exchanges', 2],
   ['Maintenance', 'maintenance', 3], ['Offers', 'offers', 3], ['Leads', 'leads', 3],
   ['SpendLog', 'spendLog', 5], ['Employees', 'employees', 2], ['WebAccounts', 'webAccounts', 2],
  ].forEach(([tab, key, min]) => {
    const rows = tabs[tab];
    if (!Array.isArray(rows) || rows.length !== 0) return;
    const local = Store.state[key] || [];
    if (local.length > min && (state[key] || []).length === 0) {
      state[key] = local;
      if (window.SyncEngine) SyncEngine.dirty = true;
      try { console.warn('[sync] ' + tab + ' tab came back EMPTY — kept ' + local.length + ' local rows and queued a push.'); } catch (e) {}
    }
  });

  return state;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SyncEngine — orchestration so sync feels automatic & impossible to forget.
// Single-user-across-devices model: safe to auto-push/pull (no concurrent editors).
//
//   status: 'local-only' | 'synced' | 'dirty' | 'syncing' | 'remote-newer'
//           | 'offline' | 'error'
//
// Clock-independent freshness: we remember the SERVER's lastWriteAt string from
// our last successful sync (lastSheetWriteAt). On open, if the sheet's current
// lastWriteAt differs, the sheet changed elsewhere → pull (or flag a conflict if
// we also have unsaved local edits).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const BACKEND_KEY = 'atmore-sync-backend';

const SyncEngine = {
  status: 'local-only',
  message: '',
  lastSyncedAt: null,      // client clock — for "saved 2m ago"
  lastSheetWriteAt: null,  // server clock string — for change detection
  lastSheetPropCount: null,// server's Properties row count — for the empty-overwrite guard
  dirty: false,
  _gen: 0,          // bumps on every local change — detects edits made mid-push
  _subs: [],
  _pushTimer: null,
  _applyingRemote: false,
  _started: false,

  // Exactly ONE backend may write. A machine that has been moved to SharePoint keeps
  // its old Apps Script URL in localStorage, and that alone used to be enough to keep
  // this engine live — it would push local state over the Sheet and, worse, pull a
  // stale/emptied Sheet back over good local data. The backend is now explicit.
  backend() {
    try {
      const pinned = localStorage.getItem(BACKEND_KEY);
      if (pinned === 'sheet' || pinned === 'sharepoint') return pinned;
    } catch (e) {}
    // Not pinned: SharePoint. The Sheet is retired, so it never becomes active by
    // accident — only by an explicit pin from the Integration screen. Worst case here is
    // local-only saving, which loses nothing; the opposite default overwrites real data.
    return 'sharepoint';
  },
  setBackend(which) {
    try { localStorage.setItem(BACKEND_KEY, which === 'sharepoint' ? 'sharepoint' : 'sheet'); } catch (e) {}
    this.refreshConfig();
  },
  sheetLive() { return this.backend() === 'sheet'; },

  autoOn() { return this.sheetLive() && Sync.isConfigured() && (Sync.config.autoSync !== false); },

  // ── Per-row change stamping ─────────────────────────────────────────────
  // The bridge merges the Sheet row-by-row on updatedAt (newer wins), so a
  // device with a stale local snapshot can only overwrite rows it actually
  // edited more recently — not blanket-replace everyone else's work. Before
  // each save we diff every merged collection against its last-known
  // signature: changed/new rows get stamped, vanished rows get a tombstone.
  _rowSigs: null,
  _sigOf(row) { return JSON.stringify(row, (k, v) => k === 'updatedAt' ? undefined : v); },
  // HOAs sync as columns ON the Properties tab but live in their own local
  // collection — fold them into the property's signature so editing an HOA
  // stamps the property row (otherwise the change could lose a merge).
  _rowSigFor(tab, row) {
    let sig = this._sigOf(row);
    if (tab === 'Properties') sig += '|' + JSON.stringify((Store.state.hoas || []).filter(h => h.propertyId === row.id));
    return sig;
  },
  _initSigs() {
    this._rowSigs = {};
    for (const [tab, coll] of Object.entries(MERGED_COLLECTIONS)) {
      const m = new Map();
      (Store.state[coll] || []).forEach(r => { if (r && r.id != null) m.set(String(r.id), this._rowSigFor(tab, r)); });
      this._rowSigs[tab] = m;
    }
  },
  _stampChanges() {
    if (this._applyingRemote) return;
    if (!this._rowSigs) { this._initSigs(); return; }   // first save after load: baseline only
    const now = new Date().toISOString();
    const tombs = (Store.state.tombstones = Store.state.tombstones || []);
    for (const [tab, coll] of Object.entries(MERGED_COLLECTIONS)) {
      const m = this._rowSigs[tab] || (this._rowSigs[tab] = new Map());
      const liveIds = new Set();
      (Store.state[coll] || []).forEach(r => {
        if (!r || r.id == null) return;
        const id = String(r.id);
        liveIds.add(id);
        const sig = this._rowSigFor(tab, r);
        if (m.get(id) !== sig) { r.updatedAt = now; m.set(id, sig); }
      });
      // Split by INTENT, not by absence. This is the mint site that actually runs
      // (the Sheet engine); inferring a delete from "id is no longer in the list" turned
      // every wholesale array replacement — a repair pass, a bad load, a wipe — into
      // hundreds of deletions, and those are now authoritative on pull, so they would
      // strip rows from a restore. A row deleted through the app carries a record from
      // markDeleted() and is honoured at any scale; an unexplained disappearance is
      // dropped from the baseline WITHOUT a tombstone once it exceeds the plausible
      // size for a hand deletion.
      const gone = [...m.keys()].filter(id => !liveIds.has(id));
      const intended = gone.filter(id => (typeof wasDeletedOnPurpose === 'function') && wasDeletedOnPurpose(coll, id));
      const unexplained = gone.filter(id => intended.indexOf(id) < 0);
      // On a build that records intent at every delete site, an unexplained vanish is
      // by definition not a user action — never mint for it, at any size. The size
      // fallback survives only for stores whose deletions predate intent recording.
      const legacy = !(Store.state && Store.state._intentSince);
      const bulkLoss = legacy ? unexplained.length > Math.max(5, Math.ceil(m.size * 0.25)) : unexplained.length > 0;
      const honoured = bulkLoss ? intended : gone;
      if (bulkLoss) {
        unexplained.forEach(id => m.delete(id));
        try { console.warn('[sync] ' + tab + ': ' + unexplained.length + ' of ' + m.size + ' rows vanished with no delete on record — treating as data loss, no deletions recorded.'); } catch (e) {}
      }
      for (const id of honoured) {
        // The deletion record is keyed by the STORE COLLECTION name, which is what
        // resolves it later (state[coll]). This used to record the sheet-tab name
        // instead ('Properties' rather than 'properties'), so state[coll] was
        // undefined and every one of these deletes was silently inert — which is
        // how a row deleted here could be re-adopted from a pull that still
        // carried it.
        m.delete(id);
        // Dedupe: this used to push blindly, so one id could accumulate many records.
        const dup = tombs.find(t => t && t.coll === coll && String(t.id) === String(id));
        if (dup) dup.at = now; else tombs.push({ coll, id, at: now });
      }
    }
    // Retention matches the bridge's 60 days.
    const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    // Drop the mis-keyed records the old code wrote. They never applied to
    // anything, so removing them changes no behaviour — it only stops them
    // accumulating. They are deliberately NOT repaired into working ones: waking
    // up months of deletes that never took effect could remove records that are
    // legitimately on screen today.
    const tabNames = new Set(Object.keys(MERGED_COLLECTIONS));
    if (tombs.some(t => tabNames.has(t.coll))) Store.state.tombstones = (Store.state.tombstones || []).filter(t => !tabNames.has(t.coll));
    if ((Store.state.tombstones || []).some(t => (t.at || '') < cutoff)) Store.state.tombstones = Store.state.tombstones.filter(t => (t.at || '') >= cutoff);
  },

  start() {
    if (this._started) return;
    this._started = true;
    // SharePoint live mode: SPSync (sharepoint.jsx) owns persistence + status;
    // the Sheet engine stands down entirely (manual export stays available).
    if (window.SPSync && SPSync.liveOn()) { SPSync.start(); return; }
    const c = Sync.loadConfig();
    this.lastSyncedAt = c.lastSyncedAt || null;
    this.lastSheetWriteAt = c.lastSheetWriteAt || null;
    this._initSigs();   // baseline row signatures — loading must not stamp anything

    // Hook persistence through the registry, so the SharePoint engine can listen
    // too. These used to be competing monkey-patches behind one boolean.
    Store.onPreSave('stampRows', () => SyncEngine._stampChanges());
    Store.onPostSave('sheets', () => SyncEngine._onLocalChange());

    // Listeners install BEFORE the not-configured early return. They used to sit
    // after it, so a device that connected the Sheet mid-session (Integration →
    // Sync → paste the URL) got no background poll and no unload flush for the
    // rest of the session — its edits only left the machine on the next reload.
    // Both handlers re-check isConfigured() every time they fire, so installing
    // them early costs nothing while unconfigured.
    this._installListeners();

    if (!Sync.isConfigured()) { this._set('local-only', 'Saved on this device only'); return; }
    if (!this.sheetLive()) { this._set('local-only', 'Sheet sync is off — SharePoint is this account\u2019s backend'); return; }
    this._set('synced', 'Connected');
    if (this.autoOn()) this.openSync();
  },

  _installListeners() {
    if (this._listening) return;
    this._listening = true;

    // Poll for manual Sheet edits while the app is open: if the Sheet's
    // lastWriteAt moved and we have no local edits, pull it in.
    setInterval(() => {
      if (!Sync.isConfigured() || !this.autoOn()) return;
      if (this.dirty || this.status === 'syncing' || this.status === 'remote-newer' || this.status === 'blocked' || this.status === 'stale') return;
      Sync.meta().then(m => {
        if (m && m.minAppBuild > APP_BUILD) { this._set('stale', 'A newer version of the app is available — refresh this page to keep saving.'); return; }
        const sheetAt = m && m.lastWriteAt;
        this._noteSheetCounts(m);
        if (sheetAt && this.lastSheetWriteAt && sheetAt !== this.lastSheetWriteAt && !this.dirty) this.pullNow();
      }).catch(() => {});
    }, 60000);

    // Catch the "closed before a push finished" case.
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty && this.autoOn()) {
        // Best-effort flush; also warn so work isn't lost on a flaky connection.
        this.pushNow();
        e.preventDefault();
        e.returnValue = '';
      }
    });
  },

  on(fn) { this._subs.push(fn); return () => { this._subs = this._subs.filter(f => f !== fn); }; },
  // A broken LOCAL save outranks every other status. Without this gate the
  // storage-full warning was overwritten microseconds after it was set — the
  // wrapper around Store.save calls _onLocalChange() right after, which sets
  // 'Saving…'. So once the single alert was dismissed the bar affirmatively
  // reassured the user it was saving while nothing could be written to disk.
  // Only a save that actually succeeds clears this (Store.save resets the flag).
  _set(status, message = '') {
    if (window.Store && Store._saveFailed && status !== 'local-broken') {
      // 'local-broken', NOT 'error': the pill's click handler treats 'error' as an
      // auth problem and opens a Microsoft sign-in prompt, which cannot fix a full
      // disk. Keeping the distinct status is what routes the click to the storage
      // guidance and shows the "Can't save here" label.
      status = 'local-broken';
      message = 'This computer can\u2019t save locally — its browser storage is full. Recent changes live only in this tab: keep it open until they reach SharePoint.';
    }
    this.status = status; this.message = message; this._subs.forEach(f => f(this));
  },

  _onLocalChange() {
    if (this._applyingRemote) return;          // pulls shouldn't mark dirty
    if (!Sync.isConfigured()) return;          // stay local-only
    if (!this.sheetLive()) return;             // SharePoint owns the pill; don't claim it
    this.dirty = true;
    this._gen++;
    if (!this.autoOn()) { this._set('dirty', 'Unsaved changes'); return; }
    this._set('dirty', 'Saving…');
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.pushNow(), 2500);  // debounce bursts of edits
  },

  // Persisted high-water marks: the largest count this device has ever legitimately
  // held (or seen on the Sheet) for each big list. Only ever raised, never lowered by
  // a bad read — that is the whole point.
  _HW_KEY: 'atmore-sync-highwater-v1',
  _hw() { try { return JSON.parse(localStorage.getItem(this._HW_KEY)) || {}; } catch (e) { return {}; } },
  _BIG_LISTS: [
    ['properties',   'property',    'properties',   3],
    ['transactions', 'transaction', 'transactions', 25],
    ['tenants',      'tenant',      'tenants',      3],
    ['rentLedger',   'rent row',    'rent rows',    5],
    ['contractors',  'contractor',  'contractors',  3],
  ],
  // A user-forced push (the "Click to resolve" path) is an explicit assertion that
  // this local state is the truth. Re-baseline DOWN to it, otherwise a deliberate
  // bulk deletion wedges saving: mark stays at the old high, every auto-push blocks.
  resetHighWater() {
    const hw = {};
    for (const [key] of this._BIG_LISTS) hw[key] = (Store.state[key] || []).length;
    try { localStorage.setItem(this._HW_KEY, JSON.stringify(hw)); } catch (e) {}
    this.lastSheetCounts = {};
    for (const [key] of this._BIG_LISTS) this.lastSheetCounts[key] = hw[key];
  },
  // Call after a confirmed-good sync (push or pull) — raises the marks.
  noteHighWater() {
    const hw = this._hw();
    let changed = false;
    for (const [key] of this._BIG_LISTS) {
      const n = (Store.state[key] || []).length;
      if (n > (hw[key] || 0)) { hw[key] = n; changed = true; }
    }
    for (const [key] of this._BIG_LISTS) {
      const sn = this.lastSheetCounts && this.lastSheetCounts[key];
      if (typeof sn === 'number' && sn > (hw[key] || 0)) { hw[key] = sn; changed = true; }
    }
    if (changed) { try { localStorage.setItem(this._HW_KEY, JSON.stringify(hw)); } catch (e) {} }
  },
  // Distinct property ids referenced by dependent records. Unfalsifiable: tenants,
  // rent rows and tagged transactions can only name a property that once existed.
  _referencedPropCount() {
    const s = Store.state || {};
    const ids = new Set();
    (s.tenants || []).forEach(t => { if (t && t.propertyId) ids.add(String(t.propertyId)); });
    (s.rentLedger || []).forEach(r => { if (r && r.propertyId) ids.add(String(r.propertyId)); });
    // Transaction `project` tags are FREE TEXT — typos, short names and dead tags mean
    // the distinct count runs far above the real portfolio (168 vs 43 here), so they are
    // reported for context but never used as the threshold. Only real foreign-key ids
    // from tenants and rent rows count as evidence.
    const byAddr = new Set();
    (s.transactions || []).forEach(t => { if (t && t.project) byAddr.add(String(t.project).trim().toLowerCase()); });
    return { ids: ids.size, addrs: byAddr.size };
  },
  // Returns a human message if the local store lost a large fraction of any big list.
  _massLossCheck() {
    const hw = this._hw();
    // Evidence test first — it survives a wrong mark and a wiped Sheet alike.
    const ref = this._referencedPropCount();
    const localProps = (Store.state.properties || []).length;
    const evidence = ref.ids;
    if (evidence >= 4 && localProps < Math.ceil(evidence * 0.5)) {
      return 'Save paused — this device has ' + localProps + ' propert' + (localProps === 1 ? 'y' : 'ies') +
             ', but its tenants, rent rows and transactions still refer to ' + evidence + '.';
    }
    for (const [key, one, many, floor] of this._BIG_LISTS) {
      // Whichever is larger: what this device once held, or what the Sheet holds now.
      // Relying on the persisted mark alone meant a cleared-storage device (new browser
      // profile, private window, fresh install before its first pull) had no mark, so
      // an empty store pushed freely — the exact case the guard exists for.
      const high = Math.max(hw[key] || 0, (this.lastSheetCounts && this.lastSheetCounts[key]) || 0);
      if (high < Math.max(4, floor)) continue;          // too small to judge
      const n = (Store.state[key] || []).length;
      if (n < Math.ceil(high * 0.5)) {
        return 'Save paused — this device has ' + n + ' ' + (n === 1 ? one : many) +
               ' but had ' + high + ' before.';
      }
    }
    return null;
  },

  // The server's own row counts, per list. The push guard needs these because the
  // persisted high-water mark lives in localStorage — the very thing that gets
  // cleared, corrupted, or is simply absent on a new browser profile or fresh
  // install. A populated Sheet must still protect a device whose mark is gone.
  lastSheetCounts: {},
  _noteSheetCounts(m) {
    if (!m || !m.counts) return;
    const map = { Properties: 'properties', Transactions: 'transactions', Tenants: 'tenants', RentLedger: 'rentLedger', Contractors: 'contractors' };
    Object.keys(map).forEach(tab => {
      const n = m.counts[tab];
      if (typeof n === 'number' && n >= 0) this.lastSheetCounts[map[tab]] = n;
    });
    if (m.counts.Properties != null) this.lastSheetPropCount = m.counts.Properties;
  },
  async pushNow(force) {
    if (!Sync.isConfigured()) return;
    if (!this.sheetLive()) { this._set('local-only', 'Sheet sync is off — SharePoint is this account\u2019s backend'); return; }
    clearTimeout(this._pushTimer);
    // Fail-safe: refuse to overwrite a populated Sheet with near-empty local data
    // (corrupted localStorage, a bad load, a race on open). The push replaces the
    // whole Sheet, so a blank local state would wipe everyone's records.
    if (!force) {
      // Compare against a PERSISTED high-water mark, not the server's current count.
      // The old check read lastSheetPropCount, so the moment one empty push landed
      // (or the count refreshed from the now-empty sheet) sheetN became 0, the
      // `>= 4` test failed, and the guard could never fire again — every later empty
      // push sailed through. A high-water mark only rises, so it stays honest.
      // It also covers every big list: a store emptied of transactions or tenants
      // used to push freely because only properties were checked.
      const blocked = this._massLossCheck();
      if (blocked) {
        this.dirty = true;
        this._set('blocked', blocked + ' Click to resolve.');
        return;
      }
    }
    // If the Sheet moved since we last saw it (another device or a hand edit),
    // the bridge merges per-row — push ours, then pull the merged result so
    // this device also adopts the other side's newer rows.
    let pullMergedAfter = false;
    if (!force) {
      try {
        const m = await Sync.meta();
        const sheetAt = m && m.lastWriteAt;
        if (sheetAt && this.lastSheetWriteAt && sheetAt !== this.lastSheetWriteAt) pullMergedAfter = true;
      } catch (e) {}
    }
    this._set('syncing', 'Saving to Sheet…');
    const genAtPush = this._gen;   // snapshot: edits after this point need another push
    try {
      const res = await Sync.push(Store.state);
      // If an edit landed while the write was in flight, it may not be in what we
      // just sent — stay dirty and push again right away instead of losing it.
      if (this._gen !== genAtPush) {
        this.lastSyncedAt = new Date().toISOString();
        if (res && res.lastWriteAt) this.lastSheetWriteAt = res.lastWriteAt;
        Sync.saveConfig({ lastSyncedAt: this.lastSyncedAt, lastSheetWriteAt: this.lastSheetWriteAt });
        this._set('dirty', 'Saving…');
        clearTimeout(this._pushTimer);
        this._pushTimer = setTimeout(() => this.pushNow(), 400);
        return;
      }
      this.dirty = false;
      // The Sheet now holds these rows — record the acknowledgement so a later
      // pull can tell a remote delete from a push that never landed.
      for (const [tab, coll] of Object.entries(MERGED_COLLECTIONS)) {
        ServerAck.add(tab, (Store.state[coll] || []).map(r => r && r.id).filter(id => id != null));
      }
      this.lastSyncedAt = new Date().toISOString();
      this.lastSheetPropCount = (Store.state.properties || []).length;  // Sheet now matches local
      // Record the sheet's new timestamp so our own write isn't later mistaken for
      // an outside edit. Old bridge versions don't return lastWriteAt — ask meta.
      if (res && res.lastWriteAt) this.lastSheetWriteAt = res.lastWriteAt;
      else { try { const m = await Sync.meta(); if (m && m.lastWriteAt) this.lastSheetWriteAt = m.lastWriteAt; } catch (e) {} }
      Sync.saveConfig({ lastSyncedAt: this.lastSyncedAt, lastSheetWriteAt: this.lastSheetWriteAt });
      if (pullMergedAfter) { await this.pullNow(); return; }   // adopt the merged result
      if (force) this.resetHighWater(); else this.noteHighWater();
      this._set('synced', 'All changes saved');
    } catch (e) {
      if (String(e.message).indexOf('OUTDATED_BUILD') >= 0) {
        this.dirty = true;   // edits are kept locally; they save after the refresh
        this._set('stale', 'This device is running an outdated version — refresh the page to save.');
        return;
      }
      this._set('error', 'Save failed — retrying…');
      clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => this.pushNow(), 15000);  // retry on reconnect
    }
  },

  // Explicit user override of the empty-overwrite guard.
  forcePush() { return this.pushNow(true); },

  async pullNow() {
    if (!Sync.isConfigured()) return;
    // A pull from the retired Sheet is the dangerous direction: it overwrites good local
    // data with whatever the abandoned Sheet still holds.
    if (!this.sheetLive()) { this._set('local-only', 'Sheet sync is off — SharePoint is this account\u2019s backend'); return; }
    this._set('syncing', 'Loading latest…');
    try {
      const data = await Sync.pull();
      const newState = deserializeFromSheet(data);
      // Honour this device's deletions BEFORE the snapshot is committed, and keep the
      // delete pending so the next push removes the rows from the Sheet too.
      const revived = dropTombstonedFromSheet(newState);
      this._applyingRemote = true;
      Store.state = Store.ensureShape(newState);
      Store.save();
      Store.notify();
      this._applyingRemote = false;
      this._initSigs();   // pulled rows are the new baseline — must not restamp as local edits
      this.dirty = false;
      // A resurrected row was dropped above, so the Sheet still holds it — keep the
      // delete pending. Clearing dirty here is what made the deletion unrecoverable:
      // the row was persisted back and the push that would remove it never ran.
      if (revived) {
        this.dirty = true;
        clearTimeout(this._pushTimer);
        this._pushTimer = setTimeout(() => this.pushNow(), 600);
      }
      // Rows this device had that the Sheet didn't (a push that failed or was
      // interrupted — e.g. a bank import). deserializeFromSheet kept them; open a
      // baseline gap so they're stamped and pushed instead of adopted as synced.
      const resc = newState._rescued;
      if (resc) {
        delete Store.state._rescued;
        let n = 0;
        for (const [tab, ids] of Object.entries(resc)) {
          const m = this._rowSigs && this._rowSigs[tab];
          if (m) ids.forEach(id => { m.delete(String(id)); n++; });
        }
        if (n) {
          this.dirty = true;
          this._set('dirty', 'Saving ' + n + ' unsaved record' + (n === 1 ? '' : 's') + '…');
          clearTimeout(this._pushTimer);
          this._pushTimer = setTimeout(() => this.pushNow(), 600);
        }
      }
      this.lastSyncedAt = new Date().toISOString();
      try { const m = await Sync.meta(); if (m && m.lastWriteAt) this.lastSheetWriteAt = m.lastWriteAt; this._noteSheetCounts(m); } catch (e) {}
      Sync.saveConfig({ lastSyncedAt: this.lastSyncedAt, lastSheetWriteAt: this.lastSheetWriteAt });
      // The rescue above may have set dirty (records this device still has to push).
      // Declaring 'synced' here would overwrite that and claim everything is up.
      this.noteHighWater();
      if (this.dirty) this._set('dirty', 'Saving records the Sheet didn\u2019t have…');
      else this._set('synced', 'Loaded latest from Sheet');
    } catch (e) {
      this._applyingRemote = false;
      this._set('error', 'Couldn’t load: ' + e.message);
    }
  },

  // On app open: reconcile this device with the Sheet.
  async openSync() {
    if (!Sync.isConfigured()) return;
    if (!this.sheetLive()) { this._set('local-only', 'Sheet sync is off — SharePoint is this account\u2019s backend'); return; }
    this._set('syncing', 'Checking Sheet…');
    try {
      const m = await Sync.meta();
      if (m && m.minAppBuild > APP_BUILD) { this._set('stale', 'A newer version of the app is available — refresh this page to keep saving.'); return; }
      const sheetAt = m && m.lastWriteAt ? m.lastWriteAt : null;
      const totalRows = m && m.counts ? Object.values(m.counts).reduce((a, n) => a + (n || 0), 0) : 0;
      this._noteSheetCounts(m);
      const firstContact = !this.lastSyncedAt;   // never synced from this device/URL

      // First time connecting to this Sheet: seed it if empty, otherwise adopt it.
      if (firstContact) {
        if (totalRows === 0) {
          await this.pushNow();               // empty Sheet → upload this device's data
        } else if (this.dirty) {
          this._set('remote-newer', 'Sheet already has data — choose which to keep');
        } else {
          await this.pullNow();               // existing Sheet → adopt it
        }
        return;
      }

      const sheetChanged = sheetAt && sheetAt !== this.lastSheetWriteAt;
      if (sheetChanged && !this.dirty) {
        await this.pullNow();                 // someone updated the Sheet elsewhere
      } else if (sheetChanged && this.dirty) {
        await this.pushNow();                 // bridge merges per-row; pushNow pulls the result
      } else if (this.dirty) {
        await this.pushNow();                 // we have edits the Sheet doesn't
      } else {
        if (!this.lastSheetWriteAt && sheetAt) { this.lastSheetWriteAt = sheetAt; Sync.saveConfig({ lastSheetWriteAt: sheetAt }); }
        this._set('synced', 'Up to date');
      }
    } catch (e) {
      this._set('offline', 'Can’t reach Sheet');
    }
  },

  // Called when the user connects/disconnects in the Integration screen.
  refreshConfig() {
    const c = Sync.config || {};
    this.lastSyncedAt = c.lastSyncedAt || null;        // re-read (a new URL clears these)
    this.lastSheetWriteAt = c.lastSheetWriteAt || null;
    if (!Sync.isConfigured()) { this.dirty = false; this._set('local-only', 'Saved on this device only'); return; }
    if (!this.sheetLive()) { this.dirty = false; this._set('local-only', 'Sheet sync is off — SharePoint is this account\u2019s backend'); return; }
    this._set('synced', 'Connected');
    if (this.autoOn()) this.openSync();
  },
};

// ─── Local backup / restore (safety net independent of the Sheet) ───
function downloadBackup() {
  const blob = new Blob([JSON.stringify({ _backup: 1, exportedAt: new Date().toISOString(), data: Store.state }, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'atmore-backup-' + (window.TODAY ? TODAY() : new Date().toISOString().slice(0,10)) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function restoreBackupFromText(text) {
  const parsed = JSON.parse(text);
  // Accept our backup wrapper, the localStorage {_v,data} shape, or a raw state object.
  const state = parsed.data ? parsed.data : parsed;
  if (!state || !Array.isArray(state.properties)) throw new Error('Not a valid backup file.');
  // A backup exported before spendLog/employees/timeOff/hoas existed — or any
  // hand-trimmed file — passes the check above while lacking collections the app
  // dereferences unguarded, which crashes the property page on open. This is the
  // data-RECOVERY path, so it must be the least likely thing in the app to break.
  Store.state = Store.ensureShape(state);
  Store.save();
  Store.notify();
  return (state.properties || []).length;
}

Sync.loadConfig();
window.Sync = Sync;
window.SyncEngine = SyncEngine;
window.deserializeFromSheet = deserializeFromSheet;
window.ServerAck = ServerAck;
window.serializeForSheet = serializeForSheet;
window.auditSyncFields = auditSyncFields;
window.downloadBackup = downloadBackup;
window.restoreBackupFromText = restoreBackupFromText;
window.MERGED_COLLECTIONS = MERGED_COLLECTIONS;
