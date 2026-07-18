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
  _fieldsFor(tabName, row) {
    const fields = { Title: this._titleFor(row) };
    const types = this._typeMap(tabName);
    for (const [k, v] of Object.entries(row)) {
      if (v == null || v === '') continue;
      const t = types[k];
      let out;
      if (Array.isArray(v)) out = v.join(',');
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

  // Pull every list, rebuild app state, rebaseline all signatures + item indexes.
  async pull() {
    this._set('syncing', 'Loading from SharePoint…');
    const tabs = {};
    this._items = {}; this._childItems = {};
    const allTabs = [...SP_PARENT_TABS, ...Object.keys(SP_CHILD_TABS), ...SP_CONFIG_TABS];
    for (const tabName of allTabs) {
      const items = await this._fetchList(tabName);
      tabs[tabName] = items.map(it => this._rowFromItem(tabName, it));
      const idx = new Map();
      items.forEach((it, i) => { const rid = (it.fields || {}).RecID; if (rid != null) idx.set(String(rid), it.id); });
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
    }
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
    SyncEngine.lastSyncedAt = new Date().toISOString();
    this._set('synced', 'Loaded from SharePoint');
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
      const listIds = SP.config.listIds || {};
      const payload = serializeForSheet(Store.state).tabs;
      // Collect every parent-tab operation, then send in $batch chunks — bank
      // imports create hundreds of rows at once and must not go one-by-one.
      const ops = [];
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
          const fields = SP._fieldsFor(t, r);
          if (idx.has(id)) ops.push({ method: 'PATCH', url: '/sites/' + sid + '/lists/' + lid + '/items/' + idx.get(id) + '/fields', body: fields, tab: t, recId: id, sig });
          else ops.push({ method: 'POST', url: '/sites/' + sid + '/lists/' + lid + '/items', body: { fields }, tab: t, recId: id, sig });
        }
        for (const id of [...m.keys()]) {
          if (live.has(id)) continue;
          if (idx.has(id)) ops.push({ method: 'DELETE', url: '/sites/' + sid + '/lists/' + lid + '/items/' + idx.get(id), tab: t, recId: id, del: true });
          else m.delete(id);
        }
      }
      let pending = ops, attempt = 0;
      while (pending.length) {
        const next = [];
        for (let i = 0; i < pending.length; i += 20) {
          const slice = pending.slice(i, i + 20);
          if (ops.length > 25) this._set('syncing', 'Saving… ' + Math.min(ops.length, i + 20 + (ops.length - pending.length)) + '/' + ops.length);
          const requests = slice.map((op, j) => ({ id: String(j + 1), method: op.method, url: op.url, headers: op.body ? { 'Content-Type': 'application/json' } : undefined, body: op.body }));
          const res = await SP.graph('/$batch', { method: 'POST', body: JSON.stringify({ requests }) });
          (res.responses || []).forEach(x => {
            const op = slice[Number(x.id) - 1]; if (!op) return;
            if (x.status === 429 || x.status === 503) { next.push(op); return; }
            if (x.status >= 400) throw new Error(op.tab + ' ' + op.method + ' failed: ' + JSON.stringify(x.body && x.body.error && x.body.error.message || x.status));
            const m = this._sigs[op.tab]; const idx = this._items[op.tab];
            if (op.del) { idx.delete(op.recId); m.delete(op.recId); return; }
            if (op.method === 'POST' && x.body && x.body.id) idx.set(op.recId, x.body.id);
            m.set(op.recId, op.sig);
          });
          if (pending.length > 20) await new Promise(r => setTimeout(r, 350));
        }
        pending = next;
        if (pending.length) {
          if (++attempt > 8) throw new Error('Still throttled after 8 retries — changes are kept locally and will retry.');
          this._set('syncing', 'Saving… (throttled, pausing)');
          await new Promise(r => setTimeout(r, Math.min(60, 5 * attempt) * 1000));
        }
      }
      // Child rows: resync the whole group whenever a parent's children changed.
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
        const existing = await this._fetchList(t);
        for (const it of existing) await SP.graph('/sites/' + sid + '/lists/' + lid + '/items/' + it.id, { method: 'DELETE' }).catch(() => {});
        for (const r of (payload[t] || [])) await SP.graph('/sites/' + sid + '/lists/' + lid + '/items', { method: 'POST', body: JSON.stringify({ fields: SP._fieldsFor(t, r) }) });
        this._cfgSigs[t] = sig;
      }
      SyncEngine.dirty = false;
      SyncEngine.lastSyncedAt = new Date().toISOString();
      this._set('synced', 'All changes saved');
    } catch (e) {
      const auth = /token|sign|auth|login|interaction/i.test(String(e.message || e));
      this._set('error', auth ? 'Microsoft sign-in expired — click here to sign in again' : 'Save failed — retrying… (' + (e.message || e) + ')');
      if (!auth) this._queueFlush(15000);
    } finally {
      this._flushing = false;
    }
  },

  _queueFlush(ms) { clearTimeout(this._pushTimer); this._pushTimer = setTimeout(() => this.flush(), ms); },
  _set(status, message) { SyncEngine._set(status, message); },

  _onLocalChange() {
    if (SyncEngine._applyingRemote) return;
    SyncEngine.dirty = true;
    this._set('dirty', 'Saving…');
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
      if (SP.config.schemaVer !== 2) {
        this._set('syncing', 'Updating list columns…');
        await SP.provision(() => {});
        SP.saveConfig({ schemaVer: 2 });
      }
      await this.pull();
    } catch (e) {
      this._set('error', 'SharePoint unreachable: ' + (e.message || e));
    }
    // Adopt other people's edits: re-pull when the tab regains focus after
    // being idle, and on a slow interval — writes are per-item, so pulls are
    // purely additive freshness, never a conflict mechanism.
    const freshen = () => {
      if (SyncEngine.dirty || this._flushing) return;
      if (Date.now() - this._lastPullAt < 4 * 60000) return;
      this.pull().catch(() => {});
    };
    window.addEventListener('focus', freshen);
    setInterval(freshen, 5 * 60000);
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
            <div className="mono tiny" style={{background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', maxHeight: 180, overflowY: 'auto', lineHeight: 1.7}}>
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
      <Card>
        <CardHead title={cfg.liveSync ? 'Live on SharePoint' : 'What happens after migration'}/>
        <div className="card__body col gap-10">
        <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.7, maxWidth: 720}}>
          {cfg.liveSync
            ? 'Every change saves as its own SharePoint list item, tagged to the signed-in user. Other people\u2019s edits are picked up when the app opens, when the tab regains focus, and every few minutes. The Google Sheet no longer updates automatically \u2014 use the export button for a reporting/backup snapshot.'
            : 'Once the data is in and the counts check out, step 4 flips this device\u2019s live sync to SharePoint: per-item writes, and per-user identity on every change. The Google Sheet then becomes a read-only export for reporting and backup.'}
        </div>
        {cfg.liveSync && Sync.isConfigured() && (
          <div className="row gap-8">
            <Btn kind="ghost" disabled={!!busy} onClick={() => run('export', async () => { addLog('Exporting snapshot to Google Sheet…'); await Sync.push(Store.state); addLog('Sheet snapshot updated ✓'); })}>{busy === 'export' ? 'Exporting…' : 'Export snapshot to Google Sheet'}</Btn>
          </div>
        )}
        </div>
      </Card>
    </div>
  );
}
Object.assign(window, { SP, SharePointView });
