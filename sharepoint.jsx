// sharepoint.jsx — Microsoft 365 / SharePoint Lists backend.
// Phase 1: sign-in, list provisioning, one-time migration. The live per-item
// sync engine flips over after migration is verified (Sheets keeps running
// in parallel until then).
const SP_KEY = 'atmore-sp-config-v1';
const SP_TENANT = {
  clientId: 'bef98184-5dbb-4cf0-b9be-36afddf256a9',
  tenantId: 'ba48db99-6736-4958-817b-d3535df0929c',
  siteHost: 'atmorepropertiesllc.sharepoint.com',
  sitePath: '/sites/AtmoreOps',
};
// Sites.Manage.All: Graph's create-list call requires it (ReadWrite.All only
// covers items in existing lists — reads succeed, provisioning gets denied).
const SP_SCOPES = ['Sites.Manage.All', 'Sites.ReadWrite.All', 'User.Read'];
// 'id' collides with SharePoint's own item id — our record id lives in RecID.
const SP_RENAME = { id: 'RecID', title: 'RecTitle' };
const spField = k => SP_RENAME[k] || k;
// Columns indexed at creation so year/property-scoped queries stay fast past
// SharePoint's 5,000-item view threshold.
const SP_INDEXED = new Set(['RecID', 'propertyId', 'tenantId', 'txId', 'exchangeId', 'contractorId', 'date', 'month', 'Yr']);
// Lists that get a derived, indexed Yr (year) number column for year filtering.
const SP_YR_SOURCE = { Transactions: 'date', RentLedger: 'month', Maintenance: 'date', StageHistory: 'at' };

const SP = {
  config: null,
  _msal: null,

  loadConfig() {
    try { this.config = { ...(JSON.parse(localStorage.getItem(SP_KEY)) || {}), ...SP_TENANT }; }
    catch (e) { this.config = { ...SP_TENANT }; }
    // Site changed since this browser last connected → cached ids belong to the
    // old site and must not be reused.
    if (this.config.siteId && this.config.sitePathUsed !== SP_TENANT.sitePath) {
      delete this.config.siteId; delete this.config.siteName; delete this.config.listIds;
      delete this.config.provisionedAt; delete this.config.migratedAt; delete this.config.migrateTotals;
      this.config.sitePathUsed = SP_TENANT.sitePath;
      localStorage.setItem(SP_KEY, JSON.stringify(this.config));
    }
    return this.config;
  },
  saveConfig(patch) {
    this.config = { ...(this.config || this.loadConfig()), ...patch };
    localStorage.setItem(SP_KEY, JSON.stringify(this.config));
  },

  available() { return typeof msal !== 'undefined'; },
  msalApp() {
    if (!this._msal) {
      const c = this.config || this.loadConfig();
      this._msal = new msal.PublicClientApplication({
        auth: { clientId: c.clientId, authority: 'https://login.microsoftonline.com/' + c.tenantId, redirectUri: window.location.origin + window.location.pathname },
        cache: { cacheLocation: 'localStorage' },
      });
    }
    return this._msal;
  },
  account() { const a = this.msalApp().getAllAccounts(); return a.length ? a[0] : null; },
  async signIn() {
    const res = await this.msalApp().loginPopup({ scopes: SP_SCOPES, prompt: 'select_account' });
    return res.account;
  },
  // Decode the access token and report the permissions Microsoft actually put
  // in it — pinpoints consent problems ("Access denied" with correct-looking
  // setup usually means the token is missing Sites.ReadWrite.All).
  async tokenScopes() {
    const t = await this.token(true);
    try { return (JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).scp || '').split(' '); }
    catch (e) { return []; }
  },
  signOut() { const a = this.account(); if (a) this.msalApp().logoutPopup({ account: a }).catch(() => {}); },
  async token(fresh) {
    const account = this.account();
    if (!account) throw new Error('Not signed in');
    if (!fresh) {
      try { return (await this.msalApp().acquireTokenSilent({ scopes: SP_SCOPES, account })).accessToken; }
      catch (e) {}
    }
    // forceRefresh skips every cache — the token comes straight from Microsoft
    // with the CURRENT consent state (a cached token predating admin consent
    // keeps failing until it expires otherwise).
    try { return (await this.msalApp().acquireTokenSilent({ scopes: SP_SCOPES, account, forceRefresh: true })).accessToken; }
    catch (e) { return (await this.msalApp().acquireTokenPopup({ scopes: SP_SCOPES, prompt: 'consent' })).accessToken; }
  },

  async graph(path, opts = {}, _attempt = 0) {
    const t = await this.token();
    const res = await fetch('https://graph.microsoft.com/v1.0' + path, {
      ...opts,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    // Proactive pacing: SharePoint advertises quota via RateLimit headers.
    // When ≥80% consumed it sends them — flag it so flush() slows down BEFORE 429s.
    const rlLimit = parseFloat(res.headers.get('RateLimit-Limit'));
    const rlRemaining = parseFloat(res.headers.get('RateLimit-Remaining'));
    if (rlLimit > 0) this._quotaLow = (rlRemaining / rlLimit) < 0.2;
    if ((res.status === 429 || res.status === 503) && _attempt < 5) {   // throttled — bounded retries
      const wait = Math.min(30, parseInt(res.headers.get('Retry-After') || '5', 10));
      await new Promise(r => setTimeout(r, wait * 1000));
      return this.graph(path, opts, _attempt + 1);
    }
    if (res.status === 204) return null;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(((j.error && j.error.code) ? j.error.code + ': ' : '') + ((j.error && j.error.message) || ('Graph ' + res.status)));
    return j;
  },

  async siteId() {
    // Always resolve by path — a cached id can silently point at a previous
    // site (reads on the path succeed while writes on the stale id get denied).
    const s = await this.graph('/sites/' + this.config.siteHost + ':' + this.config.sitePath);
    if (this.config.siteId && this.config.siteId !== s.id) {
      // site changed → cached list ids belong to the old site
      delete this.config.listIds; delete this.config.provisionedAt; delete this.config.migratedAt; delete this.config.migrateTotals;
    }
    this.saveConfig({ siteId: s.id, siteName: s.displayName, sitePathUsed: SP_TENANT.sitePath });
    return s.id;
  },

  _columnDef(key, type) {
    const name = spField(key);
    const def = { name, indexed: SP_INDEXED.has(name) };
    if (type === 'money' || type === 'number') def.number = {};
    else if (type === 'bool') def.boolean = {};
    // dates + everything else stay text: the app stores ISO strings and
    // compares them as strings — no timezone drift through SharePoint.
    // Multiline: single-line text caps at 255 chars; notes/URLs exceed it.
    // Exception: indexed columns must stay single-line (SharePoint can't index
    // multiline) — they're all short ids/dates, so the 255 cap is harmless.
    else def.text = def.indexed ? {} : { allowMultipleLines: true };
    return def;
  },

  // Create every list from SHEET_SCHEMA (idempotent — fills in whatever is missing).
  async provision(onLog) {
    const sid = await this.siteId();
    onLog('Site id: ' + String(sid).slice(0, 40) + '…');
    // Probe: bare list, no custom columns. If THIS fails, Graph writes are
    // blocked at the tenant/site level; if it succeeds, the problem is in our
    // column definitions and the per-list log below will name the list.
    try {
      const probe = await this.graph('/sites/' + sid + '/lists', { method: 'POST', body: JSON.stringify({ displayName: 'GraphWriteTest', list: { template: 'genericList' } }) });
      onLog('Write probe ✓ (test list created)');
      await this.graph('/sites/' + sid + '/lists/' + probe.id, { method: 'DELETE' }).catch(() => {});
    } catch (e) {
      throw new Error('Write probe failed — Graph cannot create lists on this site: ' + (e.message || e));
    }
    let existing;
    try { existing = await this.graph('/sites/' + sid + '/lists?$select=id,displayName&$top=250'); }
    catch (e) { throw new Error('Listing existing lists failed: ' + (e.message || e)); }
    const byName = {};
    (existing.value || []).forEach(l => { byName[l.displayName] = l.id; });
    const listIds = { ...(this.config.listIds || {}) };
    for (const [tabName, def] of Object.entries(window.SHEET_SCHEMA)) {
      const cols = def.columns.map(c => this._columnDef(c.key, c.type));
      cols.push({ name: 'updatedAt', text: {} });   // per-record edit stamp (live sync + Sheet export)
      if (SP_YR_SOURCE[tabName]) cols.push({ name: 'Yr', indexed: true, number: {} });
      if (byName[tabName]) {
        listIds[tabName] = byName[tabName];
        // add any columns the list doesn't have yet
        const have = await this.graph('/sites/' + sid + '/lists/' + byName[tabName] + '/columns?$select=name&$top=200');
        const haveNames = new Set((have.value || []).map(c => c.name));
        for (const col of cols.filter(c => !haveNames.has(c.name))) {
          await this.graph('/sites/' + sid + '/lists/' + byName[tabName] + '/columns', { method: 'POST', body: JSON.stringify(col) });
        }
        onLog(tabName + ' — exists ✓');
      } else {
        let created;
        try {
          created = await this.graph('/sites/' + sid + '/lists', {
            method: 'POST',
            body: JSON.stringify({ displayName: tabName, list: { template: 'genericList' }, columns: cols }),
          });
        } catch (e) { throw new Error('Creating list "' + tabName + '" failed: ' + (e.message || e)); }
        listIds[tabName] = created.id;
        onLog(tabName + ' — created (' + cols.length + ' columns)');
      }
    }
    this.saveConfig({ listIds, provisionedAt: new Date().toISOString() });
    return listIds;
  },

  // Lists provisioned before the multiline fix have 255-char text columns —
  // PATCH them once so long values import.
  async repairTextColumns(onLog) {
    if (this.config.textColsRepaired) return;
    const sid = await this.siteId();
    for (const [tabName, lid] of Object.entries(this.config.listIds || {})) {
      const cols = await this.graph('/sites/' + sid + '/lists/' + lid + '/columns?$top=200');
      const toFix = (cols.value || []).filter(c => c.text && !c.text.allowMultipleLines && !c.readOnly && !c.indexed && c.name !== 'Title');
      for (const c of toFix) {
        await this.graph('/sites/' + sid + '/lists/' + lid + '/columns/' + c.id, { method: 'PATCH', body: JSON.stringify({ text: { allowMultipleLines: true } }) }).catch(() => {});
      }
      if (toFix.length) onLog(tabName + ' — ' + toFix.length + ' text columns widened');
    }
    this.saveConfig({ textColsRepaired: true });
  },

  _titleFor(row) {
    return String(row.address || row.desc || row.title || row.name || row.label || row.org || row.buyer || row.month || row.pattern || row.key || row.id || '·').slice(0, 250);
  },
  _typeMap(tabName) {
    if (!this._types) this._types = {};
    if (!this._types[tabName]) {
      const m = {};
      ((window.SHEET_SCHEMA[tabName] || {}).columns || []).forEach(c => { m[c.key] = c.type; });
      this._types[tabName] = m;
    }
    return this._types[tabName];
  },
  // opts.clearEmpty: emit an explicit null for fields the user blanked out. Without
  // it an empty value is simply absent from the PATCH, SharePoint keeps whatever it
  // had, and the next pull "auto-fills" the field the user just cleared. Creates
  // (POST) leave empties out entirely — there is nothing there to clear.
  _fieldsFor(tabName, row, opts) {
    const clearEmpty = !!(opts && opts.clearEmpty);
    const fields = { Title: this._titleFor(row) };
    const types = this._typeMap(tabName);
    const skip = (this.config.skipFields || {})[tabName] || [];
    for (const [k, v] of Object.entries(row)) {
      if (skip.includes(spField(k))) continue;   // column SharePoint keeps rejecting
      if (v == null || v === '') { if (clearEmpty && types[k] !== undefined) fields[spField(k)] = null; continue; }
      const t = types[k];
      let out;
      if (Array.isArray(v)) { if (!v.length) { if (clearEmpty && types[k] !== undefined) fields[spField(k)] = null; continue; } out = v.join(','); }
      else if (t === 'money' || t === 'number') { out = Number(String(v).replace(/[$,]/g, '')); if (!isFinite(out)) continue; }
      else if (t === 'bool') out = (v === true || v === 'TRUE' || v === 'true' || v === 1);
      else out = String(v);
      fields[spField(k)] = out;
    }
    const yk = SP_YR_SOURCE[tabName];
    if (yk && row[yk]) { const y = parseInt(String(row[yk]).slice(0, 4), 10); if (y) fields.Yr = y; }
    return fields;
  },

  async listItemCount(tabName) {
    const sid = await this.siteId();
    const lid = (this.config.listIds || {})[tabName];
    if (!lid) return null;
    const r = await this.graph('/sites/' + sid + '/lists/' + lid + '/items?$select=id&$top=1');
    return (r.value || []).length;   // 0 = empty, 1 = has at least one
  },

  // One-time copy of the full current dataset into the Lists.
  async migrate(onLog, onProgress) {
    const sid = await this.siteId();
    await this.repairTextColumns(onLog);
    const listIds = this.config.listIds || {};
    const payload = serializeForSheet(Store.state);
    delete payload.tabs.Tombstones;   // per-item storage doesn't need deletion records
    const tabNames = Object.keys(payload.tabs).filter(t => listIds[t]);
    const totals = {};
    let done = 0;
    const grand = tabNames.reduce((a, t) => a + payload.tabs[t].length, 0);
    for (const tabName of tabNames) {
      const rows = payload.tabs[tabName];
      const lid = listIds[tabName];
      if (!rows.length) { totals[tabName] = 0; continue; }
      // refuse to double-import
      const probe = await this.graph('/sites/' + sid + '/lists/' + lid + '/items?$select=id&$top=1');
      if ((probe.value || []).length) { onLog(tabName + ' — already has items, skipped (clear the list to re-import)'); continue; }
      let n = 0;
      for (let i = 0; i < rows.length; i += 20) {
        let pending = rows.slice(i, i + 20);
        let attempt = 0;
        while (pending.length) {
          const requests = pending.map((r, j) => ({
            id: String(j + 1), method: 'POST',
            url: '/sites/' + sid + '/lists/' + lid + '/items',
            headers: { 'Content-Type': 'application/json' },
            body: { fields: this._fieldsFor(tabName, r) },
          }));
          const res = await this.graph('/$batch', { method: 'POST', body: JSON.stringify({ requests }) });
          const throttled = [];
          let hardFail = null;
          (res.responses || []).forEach(x => {
            if (x.status === 429 || x.status === 503) throttled.push(pending[Number(x.id) - 1]);
            else if (x.status >= 400 && !hardFail) hardFail = { row: pending[Number(x.id) - 1], body: x.body, status: x.status };
          });
          if (hardFail) throw new Error(tabName + ' "' + this._titleFor(hardFail.row || {}) + '": ' + JSON.stringify(hardFail.body && hardFail.body.error && hardFail.body.error.message || hardFail.status));
          const ok = pending.length - throttled.length;
          n += ok; done += ok;
          onProgress(done, grand, tabName + ': ' + n + '/' + rows.length + (throttled.length ? ' (throttled — pausing…)' : ''));
          pending = throttled;
          if (pending.length) {
            if (++attempt > 8) throw new Error(tabName + ': still throttled after 8 retries — wait a few minutes and run Migrate again (already-imported lists are skipped).');
            await new Promise(r => setTimeout(r, Math.min(60, 5 * attempt) * 1000));
          }
        }
        // gentle pacing between batches keeps us under SharePoint's write limits
        await new Promise(r => setTimeout(r, 350));
      }
      totals[tabName] = n;
      onLog(tabName + ' — ' + n + ' items ✓');
    }
    this.saveConfig({ migratedAt: new Date().toISOString(), migrateTotals: totals });
    return totals;
  },
};
SP.loadConfig();

// ━━━ SPSync — live per-item sync engine ━━━
// Replaces the Sheet engine when enabled (SyncEngine.start delegates here).
// Writes touch ONE list item per changed record — no whole-document saves, so
// the entire "one device overwrites everyone" failure class is gone. Reads
// pull all lists on open and rebuild state through deserializeFromSheet (the
// items round-trip the exact sheet-tab row shape).
const SP_CONFIG_TABS = ['Lists', 'Statuses', 'AutoTagRules', 'CompletedEvents'];
const SP_CHILD_TABS = { StageHistory: ['Properties', 'propertyId'], FeeItems: ['Properties', 'propertyId'], Utilities: ['Properties', 'propertyId'], TransactionSplits: ['Transactions', 'txId'], TenantRentHistory: ['Tenants', 'tenantId'], ContractorTen99: ['Contractors', 'contractorId'], ExchangeDraws: ['Exchanges', 'exchangeId'] };
const SP_PARENT_TABS = ['Properties', 'Transactions', 'Tenants', 'RentLedger', 'Contractors', 'Refis', 'Exchanges', 'Leads', 'Offers', 'Tasks', 'Maintenance', 'WebAccounts'];

const SPSync = {
  _sigs: null,        // tab -> Map(recId -> row JSON) — change detection between saves
  _items: null,       // tab -> Map(recId -> SP item id)
  _childItems: null,  // childTab -> Map(parentId -> [SP item ids])
  _childSigs: null,   // childTab -> Map(parentId -> group JSON)
  _cfgSigs: null,     // configTab -> whole-tab JSON
  _rawItems: null,    // tab -> Map(SP item id -> {id, fields}) — cache delta merges into
  _delta: null,       // tab -> Graph deltaLink (relative) for incremental pulls
  _log: (() => { try { return JSON.parse(localStorage.getItem('sp_activity') || '[]'); } catch (e) { return []; } })(),
  _pushTimer: null,
  _flushing: false,
  _lastPullAt: 0,
  _started: false,

  liveOn() { return !!(SP.config || SP.loadConfig()).liveSync && !!SP.config.migratedAt; },
  setLive(on) { SP.saveConfig({ liveSync: !!on }); },

  // SP item fields → sheet-shaped row (inverse of SP._fieldsFor)
  _rowFromItem(tabName, item) {
    const fields = item.fields || {};
    const row = {};
    const cols = ((window.SHEET_SCHEMA[tabName] || {}).columns || []);
    cols.forEach(c => {
      const v = fields[spField(c.key)];
      if (v == null || v === '') { row[c.key] = null; return; }
      // deserializeFromSheet expects the Sheet's shapes: TRUE/FALSE strings for bools
      row[c.key] = (v === true) ? 'TRUE' : (v === false) ? 'FALSE' : v;
    });
    if (fields.updatedAt) row.updatedAt = fields.updatedAt;
    return row;
  },

  async _fetchList(tabName) {
    const sid = await SP.siteId();
    const lid = (SP.config.listIds || {})[tabName];
    if (!lid) return [];
    let url = '/sites/' + sid + '/lists/' + lid + '/items?expand=fields&$top=500';
    const items = [];
    while (url) {
      const r = await SP.graph(url);
      (r.value || []).forEach(x => items.push(x));
      url = r['@odata.nextLink'] ? r['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '') : null;
    }
    return items;
  },

  logLine(line) {
    this._log.push({ at: new Date().toISOString(), line });
    if (this._log.length > 60) this._log.splice(0, this._log.length - 60);
    try { localStorage.setItem('sp_activity', JSON.stringify(this._log)); } catch (e) {}
  },

  // Daily backup snapshot to the Google Sheet (only while live on SharePoint).
  async _maybeBackup() {
    try {
      if (!this.liveOn() || typeof Sync === 'undefined' || !Sync.isConfigured()) return;
      const last = Number(localStorage.getItem('sp_backup_at') || 0);
      if (Date.now() - last < 24 * 3600 * 1000) return;
      localStorage.setItem('sp_backup_at', String(Date.now()));
      await Sync.push(Store.state);
      this.logLine('Daily backup snapshot exported to Google Sheet \u2713');
    } catch (e) {
      try { localStorage.setItem('sp_backup_at', String(Date.now() - 22 * 3600 * 1000)); } catch (e2) {}
      this.logLine('Daily Sheet backup failed: ' + (e.message || e) + ' \u2014 will retry in ~2h');
    }
  },

  _indexTab(tabName, items) {
    const idx = new Map();
    items.forEach(it => { const rid = (it.fields || {}).RecID; if (rid != null) idx.set(String(rid), it.id); });
    this._items[tabName] = idx;
    const child = SP_CHILD_TABS[tabName];
    if (child) {
      const byParent = new Map();
      items.forEach(it => {
        const pid = String((it.fields || {})[child[1]] || '');
        if (!byParent.has(pid)) byParent.set(pid, []);
        byParent.get(pid).push(it.id);
      });
      this._childItems[tabName] = byParent;
    }
  },

  // Apply a pulled snapshot: rebuild app state, rebaseline, surface status.
  _finishPull(tabs, bigLists, doneMsg) {
    const newState = deserializeFromSheet({ tabs });
    this._lastPullAt = Date.now();
    if (SyncEngine.dirty) {
      // Edits landed while we were pulling (typically during the slow initial
      // load). Applying the remote snapshot would erase them — instead keep
      // local state, baseline against the REMOTE rows, and flush: the diff
      // then writes exactly the local edits to SharePoint.
      this._baseline(newState);
      this._set('dirty', 'Saving…');
      this._queueFlush(500);
      return;
    }
    SyncEngine._applyingRemote = true;
    Store.state = newState;
    Store.save();
    Store.notify();
    SyncEngine._applyingRemote = false;
    this._baseline();
    SyncEngine.dirty = false;
    // Rows this device had that SharePoint didn't (a push that failed, was
    // throttled, or was interrupted — e.g. a bank import). deserializeFromSheet
    // kept them; drop them from the fresh baseline so the diff sees them as new
    // records to create, then flush. Without this they'd look already-saved and
    // silently disappear on the next pull.
    const resc = newState._rescued;
    if (resc) {
      delete Store.state._rescued;
      let n = 0;
      for (const [tab, ids] of Object.entries(resc)) {
        const m = this._sigs && this._sigs[tab];
        if (m) ids.forEach(id => { m.delete(String(id)); n++; });
      }
      if (n) {
        SyncEngine.dirty = true;
        this.logLine('Kept ' + n + ' record' + (n === 1 ? '' : 's') + ' SharePoint did not have yet — saving them now');
        this._set('dirty', 'Saving…');
        this._queueFlush(500);
        return;
      }
    }
    SyncEngine.lastSyncedAt = new Date().toISOString();
    if (bigLists.length) this._set('synced', '⚠ Approaching SharePoint\u2019s 5,000-item list limit: ' + bigLists.join(', ') + ' — time to archive older records');
    else this._set('synced', doneMsg);
  },

  // Grab a delta cursor (no data) so later refreshes only fetch what changed.
  async _grabDelta(tabName, sid, lid) {
    for (const q of ['?token=latest&expand=fields', '?token=latest']) {
      try {
        const d = await SP.graph('/sites/' + sid + '/lists/' + lid + '/items/delta' + q);
        const link = d['@odata.deltaLink'];
        if (link) { this._delta[tabName] = link.replace('https://graph.microsoft.com/v1.0', ''); return; }
      } catch (e) {}
    }
  },

  // Pull every list, rebuild app state, rebaseline all signatures + item indexes.
  async pull() {
    this._set('syncing', 'Loading from SharePoint…');
    const tabs = {};
    this._items = {}; this._childItems = {}; this._rawItems = {}; this._delta = {};
    const allTabs = [...SP_PARENT_TABS, ...Object.keys(SP_CHILD_TABS), ...SP_CONFIG_TABS];
    const bigLists = [];
    const sid = await SP.siteId();
    const listIds = SP.config.listIds || {};
    for (const tabName of allTabs) {
      const items = await this._fetchList(tabName);
      // Tripwire: warn well before SharePoint's 5,000-item list view threshold
      // so there's time to partition (e.g. archive old Transactions by year).
      if (items.length >= 4000) bigLists.push(tabName + ' (' + items.length.toLocaleString() + ')');
      const raw = new Map();
      items.forEach(it => raw.set(String(it.id), { id: it.id, fields: it.fields || {} }));
      this._rawItems[tabName] = raw;
      tabs[tabName] = items.map(it => this._rowFromItem(tabName, it));
      this._indexTab(tabName, items);
      if (listIds[tabName]) await this._grabDelta(tabName, sid, listIds[tabName]);
    }
    this.logLine('Full reload from SharePoint (' + allTabs.length + ' lists)');
    this._finishPull(tabs, bigLists, 'Loaded from SharePoint');
  },

  // Incremental refresh: ask each list only for what changed since last time.
  // Falls back to a full pull if any cursor is missing or expired.
  async deltaPull() {
    if (this._flushing) return;
    if (!this._delta || !this._rawItems || !Object.keys(this._delta).length) return this.pull();
    const sid = await SP.siteId();
    const listIds = SP.config.listIds || {};
    let changed = 0;
    try {
      for (const t of Object.keys(this._delta)) {
        const raw = this._rawItems[t]; if (!raw) return this.pull();
        let url = this._delta[t]; let nextLink = null;
        while (url) {
          const r = await SP.graph(url);
          for (const it of (r.value || [])) {
            const key = String(it.id);
            if (it.deleted) { if (raw.delete(key)) changed++; continue; }
            let fields = it.fields;
            if (!fields) {
              try { const full = await SP.graph('/sites/' + sid + '/lists/' + listIds[t] + '/items/' + it.id + '?expand=fields'); fields = full.fields; }
              catch (e) { if (/404/.test(String(e.message || e))) { if (raw.delete(key)) changed++; continue; } throw e; }
            }
            raw.set(key, { id: it.id, fields: fields || {} });
            changed++;
          }
          nextLink = r['@odata.deltaLink'] || nextLink;
          url = r['@odata.nextLink'] ? r['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '') : null;
        }
        if (nextLink) this._delta[t] = nextLink.replace('https://graph.microsoft.com/v1.0', '');
      }
    } catch (e) {
      this.logLine('Quick refresh failed (' + (e.message || e) + ') — doing a full reload');
      return this.pull();
    }
    this._lastPullAt = Date.now();
    if (!changed) { if (SyncEngine.dirty) this._queueFlush(500); return; }
    const tabs = {};
    for (const [t, raw] of Object.entries(this._rawItems)) {
      const items = [...raw.values()];
      tabs[t] = items.map(it => this._rowFromItem(t, it));
      this._indexTab(t, items);
    }
    this.logLine('Picked up ' + changed + ' change' + (changed === 1 ? '' : 's') + ' from SharePoint');
    this._finishPull(tabs, [], 'Updated from SharePoint');
  },

  _baseline(state) {
    const payload = serializeForSheet(state || Store.state).tabs;
    this._sigs = {}; this._childSigs = {}; this._cfgSigs = {};
    SP_PARENT_TABS.forEach(t => {
      const m = new Map();
      (payload[t] || []).forEach(r => { if (r.id != null) m.set(String(r.id), JSON.stringify(r)); });
      this._sigs[t] = m;
    });
    Object.entries(SP_CHILD_TABS).forEach(([t, [, fk]]) => {
      const groups = new Map();
      (payload[t] || []).forEach(r => { const k = String(r[fk] || ''); groups.set(k, (groups.get(k) || '') + JSON.stringify(r)); });
      this._childSigs[t] = groups;
    });
    SP_CONFIG_TABS.forEach(t => { this._cfgSigs[t] = JSON.stringify(payload[t] || []); });
  },

  // Diff current state against the baseline → per-item Graph operations.
  async flush() {
    if (this._flushing) { this._queueFlush(800); return; }
    if (!this._sigs) { this._queueFlush(3000); return; }   // initial load still running — retry, never drop
    this._flushing = true;
    this._set('syncing', 'Saving…');
    try {
      const sid = await SP.siteId();
      await this._retrySkipped();
      const listIds = SP.config.listIds || {};
      const payload = serializeForSheet(Store.state).tabs;
      // Collect every parent-tab operation, then send in $batch chunks — bank
      // imports create hundreds of rows at once and must not go one-by-one.
      const ops = [];
      // Recover from a lost POST response: if a previous flush died mid-batch
      // while creating items, the create may have landed without us recording the
      // item id — a blind retry would duplicate the row. Re-index those lists by
      // RecID first so the retry PATCHes the existing item instead.
      for (const t of [...(this._recheck || new Set())]) {
        if (!listIds[t]) continue;
        try {
          const items = await this._fetchList(t);
          const idx = this._items[t] || (this._items[t] = new Map());
          items.forEach(it => { const rid = (it.fields || {}).RecID; if (rid != null && !idx.has(String(rid))) idx.set(String(rid), it.id); });
          this._recheck.delete(t);
        } catch (e) {}
      }
      for (const t of SP_PARENT_TABS) {
        const lid = listIds[t]; if (!lid) continue;
        const m = this._sigs[t];
        const idx = this._items[t] || (this._items[t] = new Map());
        const live = new Set();
        for (const r of (payload[t] || [])) {
          if (r.id == null) continue;
          const id = String(r.id);
          live.add(id);
          const sig = JSON.stringify(r);
          if (m.get(id) === sig) continue;
          const isUpdate = idx.has(id);
          let fields = SP._fieldsFor(t, r, { clearEmpty: isUpdate });
          if (isUpdate) {
            // PATCH only the fields that actually changed — smaller payloads, cheaper server cost.
            const oldSig = m.get(id);
            if (oldSig) {
              try {
                const oldFields = SP._fieldsFor(t, JSON.parse(oldSig), { clearEmpty: true });
                const diff = {};
                for (const [k, v] of Object.entries(fields)) if (JSON.stringify(v) !== JSON.stringify(oldFields[k])) diff[k] = v;
                if (Object.keys(diff).length === 0) { m.set(id, sig); continue; }
                fields = diff;
              } catch (e) {}
            }
            ops.push({ method: 'PATCH', url: '/sites/' + sid + '/lists/' + lid + '/items/' + idx.get(id) + '/fields', body: fields, tab: t, recId: id, sig });
          }
          else ops.push({ method: 'POST', url: '/sites/' + sid + '/lists/' + lid + '/items', body: { fields }, tab: t, recId: id, sig });
        }
        for (const id of [...m.keys()]) {
          if (live.has(id)) continue;
          if (idx.has(id)) ops.push({ method: 'DELETE', url: '/sites/' + sid + '/lists/' + lid + '/items/' + idx.get(id), tab: t, recId: id, del: true });
          else m.delete(id);
        }
      }
      let pending = ops, attempt = 0, badOps = [], repairRounds = 0;
      while (pending.length) {
        const next = [];
        for (let i = 0; i < pending.length; i += 20) {
          const slice = pending.slice(i, i + 20);
          if (ops.length > 25) this._set('syncing', 'Saving… ' + Math.min(ops.length, i + 20 + (ops.length - pending.length)) + '/' + ops.length);
          const requests = slice.map((op, j) => ({ id: String(j + 1), method: op.method, url: op.url, headers: op.body ? { 'Content-Type': 'application/json' } : undefined, body: op.body }));
          let res;
          try { res = await SP.graph('/$batch', { method: 'POST', body: JSON.stringify({ requests }) }); }
          catch (e) {
            // Network died mid-batch — any POST in it may have landed server-side
            // without a recorded id. Flag those lists for re-indexing next flush.
            slice.forEach(op => { if (op.method === 'POST') (this._recheck = this._recheck || new Set()).add(op.tab); });
            throw e;
          }
          (res.responses || []).forEach(x => {
            const op = slice[Number(x.id) - 1]; if (!op) return;
            if (x.status === 429 || x.status === 503) { next.push(op); return; }
            // DELETE of an already-gone item (another device or an earlier retry
            // beat us to it) — the goal state is achieved; treat as success.
            // PATCH of an item deleted server-side (partner removed it while we
            // edited): recreate it — the surviving edit wins over the delete.
            // 409 resourceModified: the item changed server-side mid-write
            // (another device, or our own overlapping retry). Requeue quietly —
            // the next pass writes against the fresh version. No user-facing error.
            if (x.status === 409) { next.push(op); return; }
            if (x.status === 404 && op.method === 'PATCH' && !op.del) {
              const ii = this._items[op.tab]; if (ii) ii.delete(op.recId);
              try {
                const listUrl = op.url.slice(0, op.url.indexOf('/items/'));
                next.push({ method: 'POST', url: listUrl + '/items', body: { fields: SP._fieldsFor(op.tab, JSON.parse(op.sig)) }, tab: op.tab, recId: op.recId, sig: op.sig });
              } catch (e) {}
              return;
            }
            if (x.status === 404 && op.del) {
              const mm = this._sigs[op.tab]; const ii = this._items[op.tab];
              ii.delete(op.recId); mm.delete(op.recId); return;
            }
            if (x.status >= 400) {
              console.error('SP sync op failed', { status: x.status, error: x.body && x.body.error, sent: op.body });
              const err = (x.body && x.body.error) || {};
              const detail = [err.code, err.message, err.innerError && err.innerError.code].filter(Boolean).join(' / ');
              const sent = op.body ? ' — fields sent: ' + Object.keys(op.body.fields || op.body).join(', ') : '';
              // A 400 means SharePoint refused one of the COLUMNS, not the record.
              // Retrying the same body forever can't help — hand it to the repair
              // pass, which finds the offending column, adds it if it's missing,
              // and drops it from syncing if SharePoint still won't take it.
              if (x.status === 400 && op.body && !op.del) { badOps.push(op); return; }
              throw new Error(op.tab + ' ' + op.method + ' failed (' + x.status + '): ' + (detail || 'unknown') + sent);
            }
            const m = this._sigs[op.tab]; const idx = this._items[op.tab];
            if (op.del) { idx.delete(op.recId); m.delete(op.recId); return; }
            if (op.method === 'POST' && x.body && x.body.id) idx.set(op.recId, x.body.id);
            m.set(op.recId, op.sig);
          });
          // Wider spacing between large-import batches; wider still when the
          // RateLimit headers say quota is nearly spent.
          if (pending.length > 20) await new Promise(r => setTimeout(r, SP._quotaLow ? 3000 : 1000));
        }
        pending = next;
        if (pending.length) {
          if (++attempt > 8) throw new Error('Still throttled after 8 retries — changes are kept locally and will retry.');
          this._set('syncing', 'Saving… (throttled, pausing)');
          this.logLine('SharePoint throttled — pausing ' + Math.min(60, 5 * attempt) + 's before retrying');
          await new Promise(r => setTimeout(r, Math.min(60, 5 * attempt) * 1000));
        } else if (badOps.length && repairRounds < 3) {
          repairRounds++;
          const retry = await this._repairFields(badOps);
          badOps = [];
          pending = retry;
        } else if (badOps.length) {
          this.logLine('\u2717 ' + badOps.length + ' change(s) SharePoint would not accept — see column notes above');
          badOps = [];
        }
      }
      // Child rows: resync the whole group whenever a parent's children changed.
      let childGroups = 0, cfgTabs = 0;
      for (const [t, [, fk]] of Object.entries(SP_CHILD_TABS)) {
        const lid = listIds[t]; if (!lid) continue;
        const groups = new Map();
        const rowsBy = new Map();
        for (const r of (payload[t] || [])) {
          const k = String(r[fk] || '');
          groups.set(k, (groups.get(k) || '') + JSON.stringify(r));
          if (!rowsBy.has(k)) rowsBy.set(k, []);
          rowsBy.get(k).push(r);
        }
        const old = this._childSigs[t] || new Map();
        const itemsBy = this._childItems[t] || (this._childItems[t] = new Map());
        const keys = new Set([...groups.keys(), ...old.keys()]);
        for (const k of keys) {
          if (groups.get(k) === old.get(k)) continue;
          childGroups++;
          for (const iid of (itemsBy.get(k) || [])) await SP.graph('/sites/' + sid + '/lists/' + lid + '/items/' + iid, { method: 'DELETE' }).catch(() => {});
          const newIds = [];
          for (const r of (rowsBy.get(k) || [])) {
            const created = await SP.graph('/sites/' + sid + '/lists/' + lid + '/items', { method: 'POST', body: JSON.stringify({ fields: SP._fieldsFor(t, r) }) });
            newIds.push(created.id);
          }
          itemsBy.set(k, newIds);
          if (groups.has(k)) old.set(k, groups.get(k)); else old.delete(k);
        }
        this._childSigs[t] = old;
      }
      // Config tabs: low-volume settings — rewrite the list when anything changed.
      for (const t of SP_CONFIG_TABS) {
        const lid = listIds[t]; if (!lid) continue;
        const sig = JSON.stringify(payload[t] || []);
        if (this._cfgSigs[t] === sig) continue;
        cfgTabs++;
        const existing = await this._fetchList(t);
        for (const it of existing) await SP.graph('/sites/' + sid + '/lists/' + lid + '/items/' + it.id, { method: 'DELETE' }).catch(() => {});
        for (const r of (payload[t] || [])) await SP.graph('/sites/' + sid + '/lists/' + lid + '/items', { method: 'POST', body: JSON.stringify({ fields: SP._fieldsFor(t, r) }) });
        this._cfgSigs[t] = sig;
      }
      SyncEngine.dirty = false;
      SyncEngine.lastSyncedAt = new Date().toISOString();
      this._set('synced', 'All changes saved');
      const parts = [];
      if (ops.length) parts.push(ops.length + ' record change' + (ops.length === 1 ? '' : 's'));
      if (childGroups) parts.push(childGroups + ' detail group' + (childGroups === 1 ? '' : 's'));
      if (cfgTabs) parts.push('settings');
      if (parts.length) this.logLine('Saved ' + parts.join(', ') + ' \u2713');
      this._maybeBackup();
    } catch (e) {
      const auth = /token|sign|auth|login|interaction/i.test(String(e.message || e));
      this._set('error', auth ? 'Microsoft sign-in expired — click here to sign in again' : 'Save failed — retrying… (' + (e.message || e) + ')');
      this.logLine('\u2717 Save failed: ' + (e.message || e) + (auth ? ' — sign-in needed' : ' — will retry'));
      if (!auth) this._queueFlush(15000);
    } finally {
      this._flushing = false;
    }
  },

  // Force a re-push of records that hold a value in a field SharePoint never
  // received (newly-declared schema column). Drops those rows from the sync
  // baseline so the next flush sees them as changed and writes every field.
  backfillFields(findings, onLog) {
    const payload = serializeForSheet(Store.state).tabs;
    let n = 0;
    for (const f of (findings || [])) {
      const m = this._sigs && this._sigs[f.tab];
      if (!m) continue;
      const keys = f.fields.map(x => x.field);
      for (const r of (payload[f.tab] || [])) {
        if (r.id == null) continue;
        const has = keys.some(k => { const v = r[k]; return v !== null && v !== undefined && v !== ''; });
        if (!has) continue;
        if (m.delete(String(r.id))) n++;
      }
    }
    if (onLog) onLog(n ? 'Queued ' + n + ' record(s) for a full re-push…' : 'No local records still hold those values — nothing to backfill.');
    if (n) this._queueFlush(300);
    return n;
  },

  // Skipped columns must never be permanent. A rejection is usually a column that is
  // missing or was provisioned with the wrong type — both fixed by re-provisioning.
  // Left alone, the field keeps saving locally and silently stops leaving this device,
  // which reads to the user as "my 1031/refi data erases itself on the other computer".
  async _retrySkipped() {
    const cfg = SP.config || {};
    const skip = cfg.skipFields || {};
    const tabs = Object.keys(skip).filter(t => (skip[t] || []).length);
    if (!tabs.length) return;
    const last = this._skipRetryAt || Date.parse(cfg.skipFieldsAt || '') || 0;
    if (Date.now() - last < 20 * 60000) return;
    this._skipRetryAt = Date.now();
    this.logLine('Re-creating ' + tabs.length + ' skipped column set(s) in SharePoint…');
    try { await SP.provision(() => {}); } catch (e) { return; }
    SP.saveConfig({ skipFields: {}, skipFieldsAt: null });
    // Force a full re-push of those tabs: keep the keys so pending deletions still
    // fire, but invalidate every signature so each row rewrites all of its fields.
    for (const t of tabs) {
      const m = this._sigs && this._sigs[t];
      if (m) for (const k of [...m.keys()]) m.set(k, '\u0000retry');
    }
    this.logLine('Skipped columns cleared — re-sending those records ✓');
  },

  _queueFlush(ms) { clearTimeout(this._pushTimer); this._pushTimer = setTimeout(() => this.flush(), ms); },
  _set(status, message) { SyncEngine._set(status, message); },

  // A write SharePoint rejected with 400: figure out WHICH column it choked on.
  // Missing columns get created; a column that still fails on its own is
  // recorded and skipped from then on, so one bad column can't wedge all saves.
  async _repairFields(list) {
    const out = [];
    const skipCfg = { ...(SP.config.skipFields || {}) };
    const colCache = {};
    const noteBad = (tab, name, why) => {
      skipCfg[tab] = [...new Set([...(skipCfg[tab] || []), name])];
      this.logLine('\u26a0 ' + tab + '.' + name + ' rejected by SharePoint (' + why + ') — that column will stop syncing; everything else saves normally');
    };
    for (const op of list) {
      const base = op.url.split('/items')[0];
      const body = op.body.fields || op.body;
      const tab = op.tab;
      if (colCache[tab] === undefined) {
        try {
          const c = await SP.graph(base + '/columns?$select=name&$top=250');
          colCache[tab] = new Set((c.value || []).map(k => k.name));
        } catch (e) { colCache[tab] = null; }
      }
      const have = colCache[tab];
      // 1. Create any column this list is missing (list provisioned before the
      //    field existed in the app).
      if (have) {
        const types = SP._typeMap(tab);
        for (const name of Object.keys(body)) {
          if (name === 'Title' || have.has(name) || (skipCfg[tab] || []).includes(name)) continue;
          const key = Object.keys(types).find(k => spField(k) === name);
          const def = key ? SP._columnDef(key, types[key]) : { name, text: { allowMultipleLines: true } };
          try {
            await SP.graph(base + '/columns', { method: 'POST', body: JSON.stringify(def) });
            have.add(name);
            this.logLine('Added missing column ' + tab + '.' + name + ' to SharePoint \u2713');
          } catch (e) { noteBad(tab, name, 'column missing and could not be created'); }
        }
      }
      const clean = () => {
        const f = {}; const bad = skipCfg[tab] || [];
        Object.entries(body).forEach(([k, v]) => { if (!bad.includes(k)) f[k] = v; });
        return f;
      };
      // 2. PATCH ops can be probed directly: retry the cleaned set, and if it
      //    still fails, send each field alone to name the culprit.
      if (op.method === 'PATCH') {
        let fields = clean();
        try { await SP.graph(op.url, { method: 'PATCH', body: JSON.stringify(fields) }); }
        catch (e) {
          for (const [k, v] of Object.entries(fields)) {
            if (k === 'Title') continue;
            try { await SP.graph(op.url, { method: 'PATCH', body: JSON.stringify({ [k]: v }) }); }
            catch (e2) { noteBad(tab, k, String(e2.message || e2).slice(0, 90)); }
          }
          fields = clean();
          try { await SP.graph(op.url, { method: 'PATCH', body: JSON.stringify(fields) }); } catch (e3) {}
        }
      }
      out.push({ ...op, body: op.method === 'POST' ? { fields: clean() } : clean() });
    }
    SP.saveConfig({ skipFields: skipCfg, skipFieldsAt: Object.keys(skipCfg).length ? new Date().toISOString() : null });
    return out;
  },

  _onLocalChange() {
    if (SyncEngine._applyingRemote) return;
    SyncEngine.dirty = true;
    this._set('dirty', 'Saving…');
    // Stale-tab guard: this tab hasn't seen SharePoint in a while — re-baseline
    // against the server first so an old session can't save stale data. The
    // pull keeps the local edits and flushes them right after (dirty path).
    if (this._lastPullAt && !this._flushing && Date.now() - this._lastPullAt > 30 * 60000) {
      this.logLine('Tab was idle — refreshing from SharePoint before saving');
      this.deltaPull().catch(() => { this._queueFlush(2500); });
      return;
    }
    this._queueFlush(2500);
  },

  async start() {
    if (this._started) return;
    this._started = true;
    if (!Store.__syncHooked) {
      const origSave = Store.save.bind(Store);
      Store.save = () => { SyncEngine._stampChanges(); origSave(); SPSync._onLocalChange(); };
      Store.__syncHooked = true;
    }
    SyncEngine._initSigs();
    try {
      if (!SP.account()) { this._set('error', 'SharePoint sign-in needed — open Integration → SharePoint'); return; }
      // One-time schema catch-up: lists provisioned by an older build may lack
      // columns this build writes (e.g. updatedAt). provision() is idempotent
      // and only adds what's missing.
      if (SP.config.schemaVer !== 4) {
        this._set('syncing', 'Updating list columns…');
        await SP.provision(() => {});
        SP.saveConfig({ schemaVer: 4 });
      }
      await this.pull();
      this._maybeBackup();
    } catch (e) {
      this._set('error', 'SharePoint unreachable: ' + (e.message || e));
      this.logLine('\u2717 SharePoint unreachable: ' + (e.message || e));
    }
    // Adopt other people's edits: re-pull when the tab regains focus after
    // being idle, and on a slow interval — delta cursors make each check a
    // handful of tiny \u201cwhat changed?\u201d requests, never a full reload.
    const freshen = () => {
      if (SyncEngine.dirty || this._flushing) return;
      if (Date.now() - this._lastPullAt < 3 * 60000) return;
      this.deltaPull().catch(() => {});
      this._maybeBackup();
    };
    window.addEventListener('focus', freshen);
    setInterval(freshen, 4 * 60000);
    window.addEventListener('beforeunload', e => {
      if (SyncEngine.dirty) { this.flush(); e.preventDefault(); e.returnValue = ''; }
    });
  },
};
window.SPSync = SPSync;

function SharePointView() {
  const [account, setAccount] = useState(() => { try { return SP.available() ? SP.account() : null; } catch (e) { return null; } });
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);
  const [progress, setProgress] = useState(null);
  const [dups, setDups] = useState(null);
  const [drift, setDrift] = useState(null);
  const [dupBusy, setDupBusy] = useState('');
  const [act, setAct] = useState(() => (SPSync._log || []).slice());
  React.useEffect(() => { const t = setInterval(() => setAct((SPSync._log || []).slice()), 2000); return () => clearInterval(t); }, []);
  const cfg = SP.config;
  const onProd = window.location.hostname === 'atmoreadmin.github.io';
  const addLog = line => setLog(l => [...l.slice(-30), line]);

  async function run(name, fn) {
    setBusy(name);
    try { await fn(); }
    catch (e) { addLog('✗ ' + (e.message || e)); }
    finally { setBusy(''); setProgress(null); }
  }
  const stepDone = { signin: !!account, provision: !!cfg.provisionedAt, migrate: !!cfg.migratedAt };

  // Duplicate check: same-RecID items are the fingerprint of a sync retry that
  // saved one record twice. Records that merely look alike are never flagged.
  async function scanDups() {
    setDupBusy('scan'); setDups(null);
    try {
      const listIds = cfg.listIds || {};
      const groups = []; let scanned = 0;
      for (const t of SP_PARENT_TABS) {
        if (!listIds[t]) continue;
        const items = await SPSync._fetchList(t); scanned++;
        const byRid = new Map();
        items.forEach(it => { const rid = (it.fields || {}).RecID; if (rid == null) return; const k = String(rid); if (!byRid.has(k)) byRid.set(k, []); byRid.get(k).push(it); });
        for (const [rid, list] of byRid) {
          if (list.length < 2) continue;
          // Keeper: the copy the app is actively pointing at; else the oldest (lowest item id)
          const liveId = (SPSync._items && SPSync._items[t]) ? SPSync._items[t].get(rid) : null;
          let keep = list.find(it => String(it.id) === String(liveId));
          if (!keep) keep = list.slice().sort((a, b) => Number(a.id) - Number(b.id))[0];
          const f = keep.fields || {};
          const label = [f.RecTitle || f.name || f.payee || f.address || '', f.date || f.month || '', f.amount != null ? '$' + Number(f.amount).toLocaleString() : ''].filter(Boolean).join(' · ');
          groups.push({ tab: t, rid, keepId: keep.id, extras: list.filter(it => it !== keep).map(it => it.id), label, note: (list.length) + ' copies, keeping 1' });
        }
      }
      // Detail rows (transaction splits, fee items, …) have no RecID — flag a
      // parent group only when SharePoint holds MORE rows than the app does AND
      // the surplus rows are exact copies of another row. Only the copies go.
      const payload = serializeForSheet(Store.state).tabs;
      for (const [t, [, fk]] of Object.entries(SP_CHILD_TABS)) {
        if (!listIds[t]) continue;
        const items = await SPSync._fetchList(t); scanned++;
        const fkSp = spField(fk);
        const cols = ((window.SHEET_SCHEMA[t] || {}).columns || []).map(c => spField(c.key));
        const localBy = new Map();
        (payload[t] || []).forEach(r => { const k = String(r[fk] || ''); localBy.set(k, (localBy.get(k) || 0) + 1); });
        const spBy = new Map();
        items.forEach(it => { const k = String((it.fields || {})[fkSp] || ''); if (!spBy.has(k)) spBy.set(k, []); spBy.get(k).push(it); });
        for (const [k, list] of spBy) {
          const surplus = list.length - (localBy.get(k) || 0);
          if (surplus <= 0) continue;
          const clusters = new Map();
          list.forEach(it => { const f = it.fields || {}; const key = JSON.stringify(cols.map(c => f[c] ?? null)); if (!clusters.has(key)) clusters.set(key, []); clusters.get(key).push(it); });
          const extras = [];
          for (const cl of clusters.values()) {
            cl.sort((a, b) => Number(a.id) - Number(b.id));
            while (cl.length > 1 && extras.length < surplus) extras.push(cl.shift().id);
          }
          if (extras.length) groups.push({ tab: t, rid: t + ':' + k, keepId: null, extras, label: 'detail rows — ' + list.length + ' in SharePoint vs ' + (localBy.get(k) || 0) + ' in the app', note: 'removing ' + extras.length + ' identical extra' + (extras.length === 1 ? '' : 's') });
        }
      }
      setDups({ groups, scanned });
      addLog(groups.length ? 'Duplicate scan: ' + groups.length + ' record(s) saved more than once' : 'Duplicate scan: all clean across ' + scanned + ' lists');
    } catch (e) { addLog('\u2717 Duplicate scan: ' + (e.message || e)); }
    finally { setDupBusy(''); }
  }
  async function cleanDups() {
    const extras = dups.groups.flatMap(g => g.extras.map(id => ({ tab: g.tab, id })));
    if (!confirm('Remove ' + extras.length + ' duplicate cop' + (extras.length === 1 ? 'y' : 'ies') + ' from SharePoint?\n\nOne copy of every record is kept \u2014 the one the app is actively using. Nothing in the app itself changes.')) return;
    setDupBusy('clean');
    try {
      const sid = await SP.siteId(); const listIds = cfg.listIds || {};
      let ok = 0, fail = 0;
      for (const x of extras) {
        try { await SP.graph('/sites/' + sid + '/lists/' + listIds[x.tab] + '/items/' + x.id, { method: 'DELETE' }); ok++; }
        catch (e) { if (/404/.test(String(e.message || e))) ok++; else fail++; }
      }
      addLog('Duplicate cleanup: removed ' + ok + (fail ? ' \u2014 ' + fail + ' failed (rescan and retry)' : ' \u2713'));
      SPSync.logLine('Duplicate cleanup: removed ' + ok + ' extra cop' + (ok === 1 ? 'y' : 'ies'));
      if (SPSync.liveOn()) { try { await SPSync.pull(); } catch (e) {} }
      await scanDups();
    } finally { setDupBusy(''); }
  }
  const dupExtras = dups ? dups.groups.reduce((a, g) => a + g.extras.length, 0) : 0;

  return (
    <div className="col gap-16">
      <Card>
        <CardHead title="SharePoint Lists · new backend" right={account ? <Tag tone="green">{account.username}</Tag> : <Tag tone="ghost">Not signed in</Tag>}/>
        <div className="card__body col gap-12">
          <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>
            Each record becomes its own SharePoint list item — edits touch one item at a time, so two people editing different records can never overwrite each other. Setup runs once, in order: sign in, create the lists, copy the data over. Google Sheets keeps syncing in parallel until the switch is flipped.
          </div>
          {!onProd && <div className="small" style={{color: 'var(--ochre)'}}>Microsoft sign-in only works on the production site (https://atmoreadmin.github.io/atmore-ops/) — that URL is what's registered with Microsoft. This preview can't authenticate.</div>}
          <div className="row gap-8" style={{flexWrap: 'wrap'}}>
            <Btn kind={stepDone.signin ? 'ghost' : 'primary'} disabled={!!busy || !SP.available()}
              onClick={() => run('signin', async () => { const a = await SP.signIn(); setAccount(a); addLog('Signed in as ' + a.username); const sid = await SP.siteId(); addLog('Site connected: ' + (SP.config.siteName || sid)); })}>
              {stepDone.signin ? '1 · Signed in ✓' : '1 · Sign in with Microsoft'}</Btn>
            <Btn kind={stepDone.signin && !stepDone.provision ? 'primary' : 'ghost'} disabled={!!busy || !account}
              onClick={() => run('provision', async () => { addLog('Creating lists…'); await SP.provision(addLog); addLog('Provision complete ✓'); })}>
              {busy === 'provision' ? 'Creating lists…' : stepDone.provision ? '2 · Lists created ✓' : '2 · Create the lists'}</Btn>
            <Btn kind={stepDone.provision && !stepDone.migrate ? 'primary' : 'ghost'} disabled={!!busy || !account || !cfg.provisionedAt}
              onClick={() => run('migrate', async () => { addLog('Copying data…'); const t = await SP.migrate(addLog, (d, g, line) => setProgress({ d, g, line })); addLog('Migration complete ✓ — ' + Object.values(t).reduce((a, n) => a + n, 0) + ' items'); })}>
              {busy === 'migrate' ? 'Copying…' : stepDone.migrate ? '3 · Data migrated ✓' : '3 · Migrate the data'}</Btn>
            <Btn kind={stepDone.migrate && !cfg.liveSync ? 'primary' : 'ghost'} disabled={!!busy || !cfg.migratedAt}
              onClick={() => {
                if (!cfg.liveSync && !confirm('Switch live sync to SharePoint?\n\nFrom then on this device saves each change to SharePoint per-record. The Google Sheet stops receiving automatic updates (manual export stays available), and every device must be signed in with Microsoft.\n\nThe page will reload.')) return;
                if (cfg.liveSync && !confirm('Switch back to Google Sheets sync? The page will reload.')) return;
                SPSync.setLive(!cfg.liveSync);
                window.location.reload();
              }}>
              {cfg.liveSync ? '4 · Live on SharePoint ✓ (click to revert)' : '4 · Switch live sync to SharePoint'}</Btn>
            {account && <Btn kind="ghost" disabled={!!busy}
              onClick={() => run('check', async () => {
                addLog('Fetching a fresh token…');
                const scopes = await SP.tokenScopes();
                addLog('Token permissions: ' + (scopes.join(', ') || '(none)'));
                if (scopes.indexOf('Sites.Manage.All') < 0) { addLog('✗ Sites.Manage.All is MISSING from the token — add it in Entra → API permissions (Delegated) and grant admin consent.'); return; }
                if (scopes.indexOf('Sites.ReadWrite.All') < 0) { addLog('✗ Sites.ReadWrite.All is MISSING from the token — admin consent has not been granted (or was granted on the wrong app). Fix in Entra → App registrations → API permissions.'); return; }
                addLog('✓ Sites.ReadWrite.All present — testing site access…');
                const s = await SP.graph('/sites/' + SP.config.siteHost + ':' + SP.config.sitePath);
                addLog('✓ Site reachable: ' + s.displayName);
              })}>Check permissions</Btn>}
            {account && <Btn kind="ghost" disabled={!!busy} onClick={() => { SP.signOut(); setAccount(null); }}>Sign out</Btn>}
          </div>
          {progress && (
            <div className="col gap-4">
              <div className="tiny mono dim">{progress.line}</div>
              <div style={{height: 6, background: 'var(--paper-3)', borderRadius: 3, overflow: 'hidden'}}>
                <div style={{height: '100%', width: Math.round(100 * progress.d / Math.max(1, progress.g)) + '%', background: 'var(--sage)', transition: 'width .3s'}}></div>
              </div>
            </div>
          )}
          {log.length > 0 && (
            <div className="mono tiny" style={{background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', maxHeight: 180, overflowY: 'auto', lineHeight: 1.7}}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardHead title="Connection details"/>
        <div className="card__body col gap-6 mono small" style={{color: 'var(--ink-2)'}}>
          <div>Site &nbsp;&nbsp;&nbsp;{'https://' + cfg.siteHost + cfg.sitePath}</div>
          <div>App ID &nbsp;{cfg.clientId}</div>
          <div>Tenant &nbsp;{cfg.tenantId}</div>
          {cfg.migratedAt && <div>Migrated {cfg.migratedAt.slice(0, 16).replace('T', ' ')} — {Object.entries(cfg.migrateTotals || {}).map(([t, n]) => t + ' ' + n).join(' · ')}</div>}
        </div>
      </Card>
      {!!cfg.migratedAt && (
      <Card>
        <CardHead title="Duplicate check" right={dups ? (dups.groups.length ? <Tag tone="brick">{dups.groups.length} duplicated</Tag> : <Tag tone="sage">Clean</Tag>) : null}/>
        <div className="card__body col gap-10">
          <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>
            Finds records saved to SharePoint more than once — copies that share the same internal record ID, the fingerprint of a sync retry. Two genuinely separate charges with the same name, amount and date have different record IDs and are never flagged. Nothing is deleted without confirmation.
          </div>
          <div className="row gap-8" style={{flexWrap: 'wrap'}}>
            <Btn kind={dups && dupExtras ? 'ghost' : 'primary'} disabled={!!busy || !!dupBusy || !account} onClick={scanDups}>{dupBusy === 'scan' ? 'Scanning…' : dups ? 'Rescan' : 'Scan for duplicates'}</Btn>
            {dupExtras > 0 && <Btn kind="primary" disabled={!!busy || !!dupBusy} onClick={cleanDups}>{dupBusy === 'clean' ? 'Removing…' : 'Remove ' + dupExtras + ' extra cop' + (dupExtras === 1 ? 'y' : 'ies') + ' · keep one of each'}</Btn>}
          </div>
          {dups && dups.groups.length === 0 && <div className="small" style={{color: 'var(--sage)'}}>✓ No duplicates — every record appears exactly once across {dups.scanned} lists.</div>}
          {dups && dups.groups.length > 0 && (
            <div className="mono tiny" style={{background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', maxHeight: 220, overflowY: 'auto', lineHeight: 1.8}}>
              {dups.groups.map((g, i) => <div key={i}>{g.tab} · {g.label || g.rid} — {g.note}</div>)}
            </div>
          )}
        </div>
      </Card>
      )}
      {!!cfg.migratedAt && (
      <Card>
        <CardHead title="Unsynced field check" right={drift ? (drift.findings.length ? <Tag tone="brick">{drift.findings.reduce((a, f) => a + f.fields.length, 0)} field(s)</Tag> : <Tag tone="sage">All fields sync</Tag>) : null}/>
        <div className="card__body col gap-10">
          <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>
            Runs your real records through a save-and-reload round trip and reports any field that had a value going in but came back empty — the signature of a field with no SharePoint column, which saves locally and then blanks on the next sync. Read-only: nothing is written or changed.
          </div>
          <div className="row gap-8" style={{flexWrap: 'wrap'}}>
            <Btn kind={drift ? 'ghost' : 'primary'} disabled={!!busy} onClick={() => { const r = auditSyncFields(); setDrift(r); addLog(r.error ? '✗ Field check: ' + r.error : (r.findings.length ? 'Field check: ' + r.findings.reduce((a, f) => a + f.fields.length, 0) + ' field(s) not syncing' : 'Field check: every field round-trips ✓')); }}>{drift ? 'Re-check' : 'Check for unsynced fields'}</Btn>
            <span className="tiny" style={{color: 'var(--ink-3)', alignSelf: 'center'}}>build b8</span>
            <Btn kind="ghost" disabled={!!busy} onClick={() => nav('/reconcile')}>Compare with SharePoint…</Btn>
            {drift && <Btn kind="primary" disabled={!!busy} onClick={() => run('backfill', async () => {
              addLog('Creating any missing columns…');
              await SP.provision(addLog);
              SP.saveConfig({ skipFields: {} });
              // Duplicate ids make two rows fight over one record — re-mint before pushing.
              let dupFixed = 0;
              Store.update(s => { dupFixed = dedupeIds(s, { deep: true }); });
              if (dupFixed) {
                addLog('Repaired ' + dupFixed + ' duplicate record id(s):');
                idRepairLog(Store.state).slice(-dupFixed).forEach(c => addLog('  ' + c.coll + ': ' + c.from + ' → ' + c.to + ' (children stayed with the original ' + c.from + ')'));
              }
              const n = SPSync.backfillFields(drift.findings, addLog);
              addLog(n ? 'Re-push started — watch Recent sync activity, then Re-check.' : 'Nothing queued.');
            })}>{busy === 'backfill' ? 'Backfilling…' : 'Create columns & backfill'}</Btn>}
          </div>
          {drift && drift.error && <div className="small" style={{color: 'var(--brick)'}}>{drift.error}</div>}
          {drift && !drift.error && drift.findings.length === 0 && <div className="small" style={{color: 'var(--sage)'}}>✓ Every field on every record survives a full save-and-reload.</div>}
          {drift && drift.findings.length > 0 && (
            <div className="mono tiny" style={{background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', maxHeight: 260, overflowY: 'auto', lineHeight: 1.8}}>
              {drift.findings.map(f => f.fields.map(x => (
                <div key={f.tab + x.field}>{x.dup
                  ? f.tab + ' · duplicate record id — ' + x.count + ' id(s) used twice (' + x.sample + '); rows overwrite each other on sync'
                  : f.tab + ' · ' + x.field + ' — ' + (x.serverMissing
                    ? 'SharePoint returned no column on the last pull for ' + x.count + ' record(s); kept from this device only — other computers show it blank'
                    : 'lost on ' + x.count + ' of ' + f.records + ' record(s)' + (x.inSchema ? ' (column exists — pull is dropping it)' : ' (no SharePoint column)'))}</div>
              )))}
            </div>
          )}
        </div>
      </Card>
      )}
      {!!cfg.migratedAt && !!Object.keys(cfg.skipFields || {}).length && (
      <Card>
        <CardHead title="Columns not syncing" right={<Tag tone="ochre">needs attention</Tag>}/>
        <div className="card__body col gap-8">
          <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>SharePoint refused these columns, so the app skips them to keep everything else saving. The data is safe in this browser but is <b>not</b> reaching SharePoint — another computer will show these fields blank. The app now re-creates them and retries automatically every 20 minutes; use the button to retry immediately.</div>
          <div className="mono tiny" style={{background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', lineHeight: 1.8}}>
            {Object.entries(cfg.skipFields || {}).map(([t, names]) => <div key={t}>{t} — {names.join(', ')}</div>)}
          </div>
          <div className="row gap-8">
            <Btn kind="ghost" disabled={!!busy} onClick={() => run('fixcols', async () => {
              addLog('Re-checking skipped columns…');
              await SP.provision(addLog);
              SP.saveConfig({ skipFields: {}, skipFieldsAt: null });
              SPSync._skipRetryAt = 0;
              for (const t of Object.keys(cfg.skipFields || {})) {
                const m = SPSync._sigs && SPSync._sigs[t];
                if (m) for (const k of [...m.keys()]) m.set(k, '\u0000retry');
              }
              SPSync._queueFlush(400);
              addLog('Cleared — re-sending every record in those lists ✓');
            })}>{busy === 'fixcols' ? 'Re-checking…' : 'Repair columns & try again'}</Btn>
          </div>
        </div>
      </Card>
      )}
      {!!cfg.migratedAt && (
      <Card>
        <CardHead title="Recent sync activity" right={SPSync._lastPullAt ? <Tag tone="ghost">checked {new Date(SPSync._lastPullAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</Tag> : null}/>
        <div className="card__body col gap-8">
          {act.length === 0 ? (
            <div className="small" style={{color: 'var(--ink-3)'}}>Nothing yet — entries appear as the app syncs.</div>
          ) : (
            <div className="mono tiny" style={{background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', maxHeight: 220, overflowY: 'auto', lineHeight: 1.8}}>
              {act.slice().reverse().map((e, i) => <div key={i}><span style={{color: 'var(--ink-3)'}}>{e.at.slice(5, 16).replace('T', ' ')}</span> {e.line}</div>)}
            </div>
          )}
        </div>
      </Card>
      )}
      <Card>
        <CardHead title={cfg.liveSync ? 'Live on SharePoint' : 'What happens after migration'}/>
        <div className="card__body col gap-10">
        <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.7, maxWidth: 720}}>
          {cfg.liveSync
            ? 'Every change saves as its own SharePoint list item, tagged to the signed-in user. Other people\u2019s edits are picked up when the app opens, when the tab regains focus, and every few minutes. The Google Sheet no longer updates automatically \u2014 use the export button for a reporting/backup snapshot.'
            : 'Once the data is in and the counts check out, step 4 flips this device\u2019s live sync to SharePoint: per-item writes, and per-user identity on every change. The Google Sheet then becomes a read-only export for reporting and backup.'}
        </div>
        {cfg.liveSync && Sync.isConfigured() && (
          <div className="col gap-6">
            <div className="row gap-8">
              <Btn kind="ghost" disabled={!!busy} onClick={() => run('export', async () => { addLog('Exporting snapshot to Google Sheet…'); await Sync.push(Store.state); addLog('Sheet snapshot updated ✓'); })}>{busy === 'export' ? 'Exporting…' : 'Export snapshot to Google Sheet'}</Btn>
            </div>
            <div className="tiny" style={{color: 'var(--ink-3)'}}>A backup snapshot also goes to the Google Sheet automatically once a day{Number(localStorage.getItem('sp_backup_at') || 0) ? ' — last: ' + new Date(Number(localStorage.getItem('sp_backup_at'))).toLocaleString() : ''}.</div>
          </div>
        )}
        </div>
      </Card>
    </div>
  );
}
Object.assign(window, { SP, SharePointView });
