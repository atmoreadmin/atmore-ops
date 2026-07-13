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
      body: JSON.stringify({ action: 'write', payload }),
    });
    const data = await res.json();
    if (data.ok === false) throw new Error(data.error || 'Push failed');
    return data;
  },
};

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
        else if (c.type === 'bool') out[c.key] = !!v;
        else out[c.key] = v;
      }
      return out;
    });
    tabs[tabName] = rows;
  }
  return { _v: 1, sentAt: new Date().toISOString(), tabs };
}

// Convert pulled { tabs: {...} } → app state shape
function deserializeFromSheet(pulledData) {
  if (!pulledData || !pulledData.tabs) throw new Error('Empty or malformed response');
  const tabs = pulledData.tabs;
  const state = JSON.parse(JSON.stringify(window.SEED));  // start from seed shape
  state.uiState = Store.state.uiState || { selectedPropertyId: null, propertyTab: 'summary' };
  // The maintenance log stays local-only (not a Sheet tab); carry it across a pull
  // so a remote refresh never wipes it. Tasks DO sync — see the Tasks tab below.
  // Tasks/reminders now sync via the Tasks tab. Fail-safe: if the tab is absent
  // (older bridge not yet migrated), keep this device's tasks so nothing is lost.
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
        checklist: (() => { try { const a = JSON.parse(r.checklist || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } })(),
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
        status: m.status || 'open',
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
  state.properties = (tabs.Properties || []).map(p => {
    const out = { ...p };
    const local = localProps[p.id] || {};
    // Columns the Sheet doesn't have yet (bridge not migrated) come back with the
    // key entirely ABSENT from the pulled row. Keep this device's local value for
    // those instead of erasing it. (Blank cells DO come back as null and win.)
    for (const k of Object.keys(local)) {
      if (!(k in out)) out[k] = local[k];
    }
    // Stage history isn't synced anymore — keep local, or seed one entry for a fresh import.
    // Stage history — synced tab authoritative; else keep local; else seed one entry.
    if (stageByP) {
      const sh = (stageByP[p.id] || []).slice().sort(byOrd)
        .map(h => ({ from: h.from || null, to: h.to || null, at: h.at || '', note: h.note || '', by: h.by || '' }));
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
      out.purchaseFeeItems = items.filter(r => r.kind === 'purchase').slice().sort(byOrd).map(r => ({ label: r.label || '', amount: r.amount ?? 0 }));
      out.saleFeeItems = items.filter(r => r.kind === 'sale').slice().sort(byOrd).map(r => ({ label: r.label || '', amount: r.amount ?? 0 }));
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
     'hoa1Name','hoa1Url','hoa1User','hoa1Pass','hoa1Monthly','hoa2Name','hoa2Url','hoa2User','hoa2Pass','hoa2Monthly'].forEach(k => delete out[k]);
    return out;
  });

  // Tenants — rent-change history is no longer synced; keep local if present.
  const localTenants = {};
  (Store.state.tenants || []).forEach(t => { localTenants[t.id] = t; });
  state.tenants = (tabs.Tenants || []).map(t => {
    const out = { ...t };
    out.rentHistory = rentHistByT
      ? (rentHistByT[t.id] || []).slice().sort(byOrd).map(h => ({ effectiveDate: h.effectiveDate || '', amount: h.amount ?? 0, note: h.note || '' }))
      : ((localTenants[t.id] && localTenants[t.id].rentHistory) || []);
    return out;
  });

  state.rentLedger = tabs.RentLedger || [];
  // The Sheet can carry duplicate / mixed-format ledger rows (same tenant+month posted
  // many times). Collapse them on the way in so a pull never re-introduces the repeats
  // the load-time migration just cleaned up.
  if (typeof dedupeRentLedger === 'function') dedupeRentLedger(state);

  // Transactions — splits are no longer a synced tab; keep any local splits by id.
  const localTx = {};
  (Store.state.transactions || []).forEach(t => { localTx[t.id] = t; });
  state.transactions = (tabs.Transactions || []).map(tx => {
    const out = { ...tx };
    if (splitsByTx) {
      const sp = (splitsByTx[tx.id] || []).slice().sort(byOrd);
      if (sp.length) out.splits = sp.map(x => ({ project: x.project || '', amount: x.amount ?? 0, category: x.category || '' }));
    } else if (localTx[tx.id] && localTx[tx.id].splits) {
      out.splits = localTx[tx.id].splits;
    }
    return out;
  });

  // HOAs were rebuilt from the flat hoa1/hoa2 columns during the Properties pass.
  state.hoas = rebuiltHoas;

  // Contractors — 1099 history no longer synced; keep local. YTD recomputed from transactions.
  const localContractors = {};
  (Store.state.contractors || []).forEach(c => { localContractors[c.id] = c; });
  state.contractors = (tabs.Contractors || []).map(c => {
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

  state.refis = tabs.Refis || [];
  // Exchanges: a stale/un-migrated bridge must never wipe newer fields. Preserve any
  // local field the Sheet didn't return a column for, and keep local draws if the
  // ExchangeDraws tab is absent — mirrors the Insurance/Loan/Tax fail-safe above.
  const localExch = {};
  (Store.state.exchanges || []).forEach(x => { localExch[x.id] = x; });
  const hasDrawsTab = Array.isArray(tabs.ExchangeDraws);
  state.exchanges = (tabs.Exchanges || []).map(e => {
    const local = localExch[e.id] || {};
    const out = { ...e };
    // Flat fields: if the Sheet has no column for it, the pulled row won't have the key
    // at all (blank cells come back as null). In that case keep the local value.
    for (const k of Object.keys(local)) {
      if (k !== 'draws' && !(k in e)) out[k] = local[k];
    }
    // Draws live in their own tab. Tab PRESENT → authoritative (even if empty for this
    // exchange). Tab ABSENT (old bridge) → preserve whatever is on this device.
    if (hasDrawsTab) {
      const draws = tabs.ExchangeDraws
        .filter(d => d.exchangeId === e.id)
        .map(d => ({ propId: d.propId || '', amount: d.amount, date: d.date || '', note: d.note || '' }));
      if (draws.length) out.draws = draws; else delete out.draws;
    } else if (local.draws && local.draws.length) {
      out.draws = local.draws;
    }
    return out;
  });
  state.leads = tabs.Leads || [];

  // Offers — rebuild the nested concessions object from flat columns
  state.offers = (tabs.Offers || []).map(o => ({
    id: o.id, propertyId: o.propertyId, date: o.date,
    buyer: o.buyer, buyerAgent: o.buyerAgent, agentContact: o.agentContact,
    offerPrice: o.offerPrice, earnestMoney: o.earnestMoney,
    financing: o.financing, closeDate: o.closeDate, status: o.status,
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
  }));

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
    ? tabs.WebAccounts.map(r => ({ id: r.id, org: r.org || '', username: r.username || '', password: r.password || '', email: r.email || '', notes: r.notes || '' }))
    : (Store.state.webAccounts || []);

  // Pipeline statuses — present tab authoritative; absent/empty keeps local, then seed.
  if (Array.isArray(tabs.Statuses) && tabs.Statuses.length) {
    state.statuses = tabs.Statuses.map(r => ({
      code:   String(r.code || '').trim(),
      label:  r.label || r.code,
      lane:   r.lane || 'pipeline',
      system: r.system === true || r.system === 'true' || r.system === 'TRUE' || r.system === 1 || r.system === '1',
      tone:   r.tone ? String(r.tone).trim() : null,
    })).filter(s => s.code);
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
const SyncEngine = {
  status: 'local-only',
  message: '',
  lastSyncedAt: null,      // client clock — for "saved 2m ago"
  lastSheetWriteAt: null,  // server clock string — for change detection
  lastSheetPropCount: null,// server's Properties row count — for the empty-overwrite guard
  dirty: false,
  _subs: [],
  _pushTimer: null,
  _applyingRemote: false,
  _started: false,

  autoOn() { return Sync.isConfigured() && (Sync.config.autoSync !== false); },

  start() {
    if (this._started) return;
    this._started = true;
    const c = Sync.loadConfig();
    this.lastSyncedAt = c.lastSyncedAt || null;
    this.lastSheetWriteAt = c.lastSheetWriteAt || null;

    // Hook persistence: every local save marks us dirty + schedules a push.
    if (!Store.__syncHooked) {
      const origSave = Store.save.bind(Store);
      Store.save = () => { origSave(); SyncEngine._onLocalChange(); };
      Store.__syncHooked = true;
    }

    if (!Sync.isConfigured()) { this._set('local-only', 'Saved on this device only'); return; }
    this._set('synced', 'Connected');
    if (this.autoOn()) this.openSync();

    // Poll for manual Sheet edits while the app is open: if the Sheet's
    // lastWriteAt moved and we have no local edits, pull it in.
    setInterval(() => {
      if (!Sync.isConfigured() || !this.autoOn()) return;
      if (this.dirty || this.status === 'syncing' || this.status === 'remote-newer' || this.status === 'blocked') return;
      Sync.meta().then(m => {
        const sheetAt = m && m.lastWriteAt;
        if (m && m.counts && m.counts.Properties != null) this.lastSheetPropCount = m.counts.Properties;
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
  _set(status, message = '') { this.status = status; this.message = message; this._subs.forEach(f => f(this)); },

  _onLocalChange() {
    if (this._applyingRemote) return;          // pulls shouldn't mark dirty
    if (!Sync.isConfigured()) return;          // stay local-only
    this.dirty = true;
    if (!this.autoOn()) { this._set('dirty', 'Unsaved changes'); return; }
    this._set('dirty', 'Saving…');
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.pushNow(), 2500);  // debounce bursts of edits
  },

  async pushNow(force) {
    if (!Sync.isConfigured()) return;
    clearTimeout(this._pushTimer);
    // Fail-safe: refuse to overwrite a populated Sheet with near-empty local data
    // (corrupted localStorage, a bad load, a race on open). The push replaces the
    // whole Sheet, so a blank local state would wipe everyone's records.
    if (!force) {
      const localN = (Store.state.properties || []).length;
      const sheetN = this.lastSheetPropCount;
      if (sheetN != null && sheetN >= 4 && localN < Math.ceil(sheetN * 0.5)) {
        this.dirty = true;
        this._set('blocked', `Save paused — this device has ${localN} propert${localN === 1 ? 'y' : 'ies'} but the Sheet has ${sheetN}. Click to resolve.`);
        return;
      }
    }
    // Manual-edit guard: if the Sheet was edited by hand since our last sync
    // (its lastWriteAt moved), don't blind-overwrite it — surface a choice.
    if (!force) {
      try {
        const m = await Sync.meta();
        const sheetAt = m && m.lastWriteAt;
        if (sheetAt && this.lastSheetWriteAt && sheetAt !== this.lastSheetWriteAt) {
          this.dirty = true;
          this._set('remote-newer', 'Sheet was edited directly — choose which to keep');
          return;
        }
      } catch (e) {}
    }
    this._set('syncing', 'Saving to Sheet…');
    try {
      const res = await Sync.push(Store.state);
      this.dirty = false;
      this.lastSyncedAt = new Date().toISOString();
      this.lastSheetPropCount = (Store.state.properties || []).length;  // Sheet now matches local
      if (res && res.wroteAt) this.lastSheetWriteAt = res.wroteAt;
      Sync.saveConfig({ lastSyncedAt: this.lastSyncedAt, lastSheetWriteAt: this.lastSheetWriteAt });
      this._set('synced', 'All changes saved');
    } catch (e) {
      this._set('error', 'Save failed — retrying…');
      clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => this.pushNow(), 15000);  // retry on reconnect
    }
  },

  // Explicit user override of the empty-overwrite guard.
  forcePush() { return this.pushNow(true); },

  async pullNow() {
    if (!Sync.isConfigured()) return;
    this._set('syncing', 'Loading latest…');
    try {
      const data = await Sync.pull();
      const newState = deserializeFromSheet(data);
      this._applyingRemote = true;
      Store.state = newState;
      Store.save();
      Store.notify();
      this._applyingRemote = false;
      this.dirty = false;
      this.lastSyncedAt = new Date().toISOString();
      try { const m = await Sync.meta(); if (m && m.lastWriteAt) this.lastSheetWriteAt = m.lastWriteAt; if (m && m.counts && m.counts.Properties != null) this.lastSheetPropCount = m.counts.Properties; } catch (e) {}
      Sync.saveConfig({ lastSyncedAt: this.lastSyncedAt, lastSheetWriteAt: this.lastSheetWriteAt });
      this._set('synced', 'Loaded latest from Sheet');
    } catch (e) {
      this._applyingRemote = false;
      this._set('error', 'Couldn’t load: ' + e.message);
    }
  },

  // On app open: reconcile this device with the Sheet.
  async openSync() {
    if (!Sync.isConfigured()) return;
    this._set('syncing', 'Checking Sheet…');
    try {
      const m = await Sync.meta();
      const sheetAt = m && m.lastWriteAt ? m.lastWriteAt : null;
      const totalRows = m && m.counts ? Object.values(m.counts).reduce((a, n) => a + (n || 0), 0) : 0;
      if (m && m.counts && m.counts.Properties != null) this.lastSheetPropCount = m.counts.Properties;
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
        this._set('remote-newer', 'Sheet has newer data — choose which to keep');
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
  Store.state = state;
  Store.save();
  Store.notify();
  return (state.properties || []).length;
}

Sync.loadConfig();
window.Sync = Sync;
window.SyncEngine = SyncEngine;
window.deserializeFromSheet = deserializeFromSheet;
window.serializeForSheet = serializeForSheet;
window.downloadBackup = downloadBackup;
window.restoreBackupFromText = restoreBackupFromText;
