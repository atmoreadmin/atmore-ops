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
// Bump whenever SHEET_SCHEMA gains a list or column. Every device re-runs the
// idempotent provision once on its next sync and adopts the new shape.
// 5 = added SpendLog, Employees, TimeOff.
// 6 = those three were created without their RecID column; re-provision + repair.
const SP_SCHEMA_VER = 6;
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
    // textType 'plain' is essential: rich text HTML-encodes and <div>-wraps what it
    // stores, which corrupts JSON-in-a-cell values (task checklists) on the way back.
    else def.text = def.indexed ? {} : { allowMultipleLines: true, textType: 'plain' };
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
      } else {
        // Create the list BARE, then add columns through the same verified path
        // used below. Columns passed inline to list-creation are best-effort:
        // Graph can silently drop ones it won't accept in that payload (notably
        // anything marked indexed), and a list that comes back missing RecID has
        // no record-id column — every later pull looks unrecognized and every push
        // re-POSTs it, duplicating the whole list on each sync.
        let created;
        try {
          created = await this.graph('/sites/' + sid + '/lists', {
            method: 'POST',
            body: JSON.stringify({ displayName: tabName, list: { template: 'genericList' } }),
          });
        } catch (e) { throw new Error('Creating list "' + tabName + '" failed: ' + (e.message || e)); }
        listIds[tabName] = created.id;
        onLog(tabName + ' — created');
      }

      // Add whatever columns the list does not have yet, one at a time, and
      // verify afterwards. Idempotent for both branches above.
      const lid = listIds[tabName];
      const have = await this.graph('/sites/' + sid + '/lists/' + lid + '/columns?$select=name&$top=200');
      const haveNames = new Set((have.value || []).map(c => c.name));
      let added = 0;
      for (const col of cols.filter(c => !haveNames.has(c.name))) {
        try {
          await this.graph('/sites/' + sid + '/lists/' + lid + '/columns', { method: 'POST', body: JSON.stringify(col) });
          added++;
        } catch (e) {
          // An indexed column can be refused on some sites; the index is an
          // optimization, the column is not. Retry without it.
          if (!col.indexed) throw new Error('Adding column "' + col.name + '" to "' + tabName + '" failed: ' + (e.message || e));
          const plain = { ...col }; delete plain.indexed;
          await this.graph('/sites/' + sid + '/lists/' + lid + '/columns', { method: 'POST', body: JSON.stringify(plain) });
          added++;
        }
      }
      // RecID carries our record identity. Without it the list cannot be synced
      // at all, so fail loudly here rather than duplicating rows later.
      if (added) {
        const after = await this.graph('/sites/' + sid + '/lists/' + lid + '/columns?$select=name&$top=200');
        const names = new Set((after.value || []).map(c => c.name));
        if (!names.has('RecID')) throw new Error('List "' + tabName + '" is missing its RecID column and cannot sync safely.');
      }
      onLog(tabName + (added ? ' — ' + added + ' column' + (added === 1 ? '' : 's') + ' added ✓' : ' — ok ✓'));
    }
    this.saveConfig({ listIds, provisionedAt: new Date().toISOString() });
    return listIds;
  },

  // Lists provisioned before the multiline fix have 255-char text columns, and
  // lists provisioned before the plain-text fix have rich-text columns that
  // HTML-mangle stored JSON. PATCH both once.
  async repairTextColumns(onLog) {
    if (this.config.textColsRepairedV2) return;
    const sid = await this.siteId();
    for (const [tabName, lid] of Object.entries(this.config.listIds || {})) {
      const cols = await this.graph('/sites/' + sid + '/lists/' + lid + '/columns?$top=200');
      const toFix = (cols.value || []).filter(c => c.text && !c.readOnly && !c.indexed && c.name !== 'Title'
        && (!c.text.allowMultipleLines || c.text.textType !== 'plain'));
      for (const c of toFix) {
        await this.graph('/sites/' + sid + '/lists/' + lid + '/columns/' + c.id, { method: 'PATCH', body: JSON.stringify({ text: { allowMultipleLines: true, textType: 'plain' } }) }).catch(() => {});
      }
      if (toFix.length) onLog(tabName + ' — ' + toFix.length + ' text columns widened / set to plain text');
    }
    // Columns blacklisted for "value too long" are fine now that they are multiline.
    this.saveConfig({ textColsRepaired: true, textColsRepairedV2: true, skipFields: {}, skipFieldsAt: null });
    if (window.SPSync) { SPSync._skipRetryAt = 0; try { SPSync._resigAll(); } catch (e) {} }
  },

  // One-time repair for lists provisioned without their RecID column. Those rows
  // carry no record identity: the server copies can never be matched to a local
  // record, and each pull re-imported them as new. Delete the keyless server rows
  // and drop the id-less local duplicates they produced, then let the next push
  // upload the surviving records cleanly.
  async repairKeylessRows(onLog) {
    const log = onLog || (() => {});
    if (this.config.keylessRepairedAt) return 0;
    const sid = await this.siteId();
    let removed = 0;
    for (const t of SP_PARENT_TABS) {
      const lid = (this.config.listIds || {})[t];
      if (!lid) continue;
      let items = [];
      try { items = await SPSync._fetchList(t); } catch (e) { continue; }
      const keyless = items.filter(it => (it.fields || {}).RecID == null);
      // Every row keyless on a non-empty list = the column was missing entirely.
      // A few keyless rows on an otherwise healthy list are hand-added rows, and
      // deleting those would destroy someone's manual entry — leave them alone.
      if (!keyless.length || keyless.length !== items.length) continue;
      for (const it of keyless) {
        await this.graph('/sites/' + sid + '/lists/' + lid + '/items/' + it.id, { method: 'DELETE' }).catch(() => {});
        removed++;
      }
      log(t + ' — cleared ' + keyless.length + ' unidentifiable row' + (keyless.length === 1 ? '' : 's'));
    }
    // Local side: drop records that came back id-less, and collapse any record
    // duplicated under one id (last write wins, matching the merge elsewhere).
    Store.update(s => {
      for (const coll of Object.values(window.MERGED_COLLECTIONS || {})) {
        if (!Array.isArray(s[coll])) continue;
        const seen = new Map();
        for (const r of s[coll]) {
          const id = r && r.id != null ? String(r.id) : '';
          if (!id) continue;
          const prev = seen.get(id);
          if (!prev || String(r.updatedAt || '') >= String(prev.updatedAt || '')) seen.set(id, r);
        }
        if (seen.size !== s[coll].length) s[coll] = [...seen.values()];
      }
    });
    this.saveConfig({ keylessRepairedAt: new Date().toISOString() });
    if (window.SPSync) { SPSync._sigs = {}; SPSync._brokenKey = {}; }
    return removed;
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
    // A column SharePoint refuses outright (wrong type, locked, corrupt) cannot be
    // fixed in place — Graph will not change a column's type. Rather than lose the
    // field forever we write it to a replacement column and read from there.
    const alias = (this.config.fieldAlias || {})[tabName] || {};
    for (const [k, v] of Object.entries(row)) {
      if (skip.includes(spField(k))) continue;   // column SharePoint keeps rejecting
      // Resolve the destination column ONCE: a clear that still targets the original
      // column leaves the alias holding the old text, which then wins on the next
      // read and resurrects the value the user just deleted.
      const dest = alias[spField(k)] || spField(k);
      if (v == null || v === '') { if (clearEmpty && types[k] !== undefined) fields[dest] = null; continue; }
      const t = types[k];
      let out;
      if (Array.isArray(v)) { if (!v.length) { if (clearEmpty && types[k] !== undefined) fields[dest] = null; continue; } out = v.join(','); }
      else if (t === 'money' || t === 'number') {
        out = Number(String(v).replace(/[$,]/g, ''));
        // Not a number — the value cannot go into a SharePoint number column. It
        // used to be dropped in silence, which is how date-shaped junk in a money
        // field stayed local-only forever. Record it so Integration can show it,
        // and say so once per field per session.
        if (!isFinite(out)) {
          const key = tabName + '.' + k;
          this.noteUnsaved(tabName, row.id, k, v);
          this._badNumLogged = this._badNumLogged || new Set();
          if (!this._badNumLogged.has(key) && window.SPSync) {
            this._badNumLogged.add(key);
            SPSync.logLine('\u26a0 ' + key + ' holds "' + String(v).slice(0, 24) + '", which is not a number — that field cannot save to SharePoint until it is corrected (Settings → Reconcile lists them)');
          }
          continue;
        }
        this.clearUnsaved(tabName, row.id, k);
      }
      else if (t === 'bool') out = (v === true || v === 'TRUE' || v === 'true' || v === 1);
      else out = String(v);
      fields[dest] = out;
    }
    const yk = SP_YR_SOURCE[tabName];
    if (yk && row[yk]) { const y = parseInt(String(row[yk]).slice(0, 4), 10); if (y) fields.Yr = y; }
    return fields;
  },

  // Values that silently could not be written. Persisted so the warning survives
  // a reload — a field that never reaches SharePoint is invisible otherwise.
  _unsaved: (() => { try { return JSON.parse(localStorage.getItem('sp_unsaved') || '{}'); } catch (e) { return {}; } })(),
  _saveUnsaved() { try { localStorage.setItem('sp_unsaved', JSON.stringify(this._unsaved)); } catch (e) {} },
  noteUnsaved(tab, id, field, value) {
    const k = tab + '|' + id + '|' + field;
    const prev = this._unsaved[k];
    if (prev && prev.value === String(value)) return;
    this._unsaved[k] = { tab, id: String(id), field, value: String(value), at: Date.now() };
    this._saveUnsaved();
  },
  clearUnsaved(tab, id, field) {
    const k = tab + '|' + id + '|' + field;
    if (!this._unsaved[k]) return;
    delete this._unsaved[k];
    this._saveUnsaved();
  },
  unsavedList() { return Object.values(this._unsaved); },

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
const SP_PARENT_TABS = ['Properties', 'Transactions', 'Tenants', 'RentLedger', 'Contractors', 'Refis', 'Exchanges', 'Leads', 'Offers', 'Tasks', 'Maintenance', 'WebAccounts', 'SpendLog', 'Employees', 'TimeOff'];
window.SP_PARENT_TABS_PUBLIC = SP_PARENT_TABS;   // sync-health.jsx compares these lists
// Sheet-tab name -> Store collection name (conflict resolution writes back through this).
// Detail lists that merge row-by-row instead of the whole group being replaced.
// key() must be stable across machines: either a minted id, or a natural key
// that cannot collide (utilities are one per type; 1099s one per tax year).
const SP_DETAIL_MERGE = {
  ExchangeDraws:     { key: r => r.drawId ? String(r.drawId) : '', fields: ['exchangeId', 'propId', 'amount', 'date', 'note'], ordBy: r => String(r.exchangeId || '') },
  StageHistory:      { key: r => r.rowId ? String(r.rowId) : '', fields: ['propertyId', 'from', 'to', 'at', 'note', 'by'], ordBy: r => String(r.propertyId || '') },
  FeeItems:          { key: r => r.rowId ? String(r.rowId) : '', fields: ['propertyId', 'kind', 'label', 'amount'], ordBy: r => String(r.propertyId || '') + '|' + String(r.kind || '') },
  TransactionSplits: { key: r => r.rowId ? String(r.rowId) : '', fields: ['txId', 'project', 'category', 'amount', 'bucket'], ordBy: r => String(r.txId || '') },
  TenantRentHistory: { key: r => r.rowId ? String(r.rowId) : '', fields: ['tenantId', 'effectiveDate', 'amount', 'note'], ordBy: r => String(r.tenantId || '') },
  Utilities:         { key: r => (r.propertyId && r.type) ? r.propertyId + '|' + r.type : '', fields: ['provider', 'account', 'status'] },
  ContractorTen99:   { key: r => (r.contractorId && r.taxYear != null) ? r.contractorId + '|' + r.taxYear : '', fields: ['status', 'issuedDate', 'amountReported'] },
};

// Sheet-tab name -> Store collection name (conflict resolution and tombstones
// write back through this). Overlaid with sync.jsx's MERGED_COLLECTIONS where
// available so the two maps cannot drift apart — they did: Tasks lives in
// state.reminders, and a stale 'tasks' here silently disabled both features.
const SP_COLL = Object.assign({ Properties: 'properties', Transactions: 'transactions', Tenants: 'tenants', RentLedger: 'rentLedger', Contractors: 'contractors', Refis: 'refis', Exchanges: 'exchanges', Leads: 'leads', Offers: 'offers', Tasks: 'reminders', Maintenance: 'maintenance', WebAccounts: 'webAccounts' },
  (typeof MERGED_COLLECTIONS !== 'undefined' ? MERGED_COLLECTIONS : null));

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
  _ready: false,       // first pull of the session has landed — edits are safe to merge
  _offlineAck: false,  // user chose to work without reaching SharePoint
  _started: false,

  liveOn() { return !!(SP.config || SP.loadConfig()).liveSync && !!SP.config.migratedAt; },
  setLive(on) { SP.saveConfig({ liveSync: !!on }); },

  // SP item fields → sheet-shaped row (inverse of SP._fieldsFor)
  _rowFromItem(tabName, item) {
    const fields = item.fields || {};
    const row = {};
    const cols = ((window.SHEET_SCHEMA[tabName] || {}).columns || []);
    const alias = (SP.config.fieldAlias || {})[tabName] || {};
    cols.forEach(c => {
      const sp = spField(c.key);
      // Prefer the replacement column when the item carries one. This deliberately
      // does NOT require local alias config: the device that created the alias is
      // the only one that knows about it, so every other device has to discover it
      // from the data itself or it would read the dead original column forever.
      const altName = alias[sp] || (sp + 'Text');
      const hasAlt = fields[altName] != null && fields[altName] !== '';
      let v = hasAlt ? fields[altName] : fields[sp];
      if (v == null || v === '') { row[c.key] = null; return; }
      // A column that was rich text at some point returns HTML-encoded, <div>-wrapped
      // text. Undo that here so values (notes, and JSON cells like the task checklist)
      // read back exactly as they were written.
      if (typeof v === 'string' && /<(?:div|p|br|span|font)\b|&(?:quot|amp|lt|gt|apos|nbsp|#34|#39);/i.test(v)
          && typeof unrichText === 'function') v = unrichText(v);
      // deserializeFromSheet expects the Sheet's shapes: TRUE/FALSE strings for bools
      row[c.key] = (v === true) ? 'TRUE' : (v === false) ? 'FALSE' : v;
    });
    if (fields.updatedAt) row.updatedAt = fields.updatedAt;
    return row;
  },

  // Learn aliases from the pulled rows: a device that had to move a field to a
  // replacement column recorded that only in ITS OWN local config, so everyone
  // else must pick it up from the items or they will keep writing to the dead
  // original column and keep getting rejected.
  _adoptAliases(tabName, items) {
    if (!items || !items.length) return;
    const seen = new Set();
    items.slice(0, 25).forEach(it => Object.keys(it.fields || {}).forEach(k => seen.add(k)));
    const cols = ((window.SHEET_SCHEMA[tabName] || {}).columns || []);
    const cfg = { ...(SP.config.fieldAlias || {}) };
    const forTab = { ...(cfg[tabName] || {}) };
    let added = 0;
    cols.forEach(c => {
      const sp = spField(c.key);
      if (forTab[sp]) return;
      if (seen.has(sp + 'Text')) { forTab[sp] = sp + 'Text'; added++; }
    });
    if (!added) return;
    cfg[tabName] = forTab;
    SP.saveConfig({ fieldAlias: cfg });
    this.logLine('Picked up ' + added + ' replacement column(s) for ' + tabName + ' \u2713');
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
    // Two server items under one record id (what a list provisioned without its
    // key column produced). The map can only point at one, so the other is
    // invisible to every future push and gets re-imported on every pull. Keep
    // the newest and queue the rest for deletion.
    const byRid = new Map();
    items.forEach(it => {
      const rid = (it.fields || {}).RecID;
      if (rid == null) return;
      const k = String(rid);
      const prev = byRid.get(k);
      const stamp = it => String((it.fields || {}).updatedAt || (it.lastModifiedDateTime || ''));
      if (!prev) { byRid.set(k, it); return; }
      const [keep, drop] = stamp(it) >= stamp(prev) ? [it, prev] : [prev, it];
      byRid.set(k, keep);
      (this._dupItems = this._dupItems || {})[tabName] = (this._dupItems[tabName] || []).concat(drop.id);
    });
    byRid.forEach((it, rid) => idx.set(rid, it.id));
    this._items[tabName] = idx;
    // A list holding rows where none carry a RecID has lost its record-id column.
    // Nothing can be matched, so an unguarded push would POST every local row as
    // new on every sync. Flag it; the push skips the tab and provision repairs it.
    this._brokenKey = this._brokenKey || {};
    if (items.length && idx.size === 0 && !SP_CHILD_TABS[tabName] && !SP_CONFIG_TABS.includes(tabName)) this._brokenKey[tabName] = true;
    else delete this._brokenKey[tabName];
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
    this._ready = true;
    // Rows this device deleted that the server still has. Drop them from the
    // snapshot (otherwise they reappear) and remember to re-send the delete.
    const revived = this._dropTombstoned(newState);
    if (SyncEngine.dirty) {
      // Edits landed while we were pulling, or this device has unsaved work.
      // Taking the remote snapshot wholesale would erase our edits; keeping
      // local wholesale would revert everyone else's (the old behaviour — the
      // next flush pushed every field where we merely DIFFERED from the server,
      // not the fields we actually changed). Three-way merge instead: the
      // baseline is what the server last told us, so per field we can tell
      // "I changed it" from "they changed it" and only genuine both-changed
      // collisions need a human.
      const merged = this._merge3(newState);
      SyncEngine._applyingRemote = true;
      Store.state = merged.state;
      Store.save();
      Store.notify();
      SyncEngine._applyingRemote = false;
      this._baseline(newState);
      this._reissueDeletes(revived);
      if (merged.tookTheirs) this.logLine('Merged ' + merged.tookTheirs + ' field(s) changed by someone else');
      if (merged.conflicts) this.logLine('\u26a0 ' + merged.conflicts + ' field(s) changed in two places at once — kept yours, flagged for review (Settings \u2192 Integration)');
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
    if (this._reissueDeletes(revived)) {
      SyncEngine.dirty = true;
      this.logLine('Re-sending ' + revived.length + ' deletion' + (revived.length === 1 ? '' : 's') + ' SharePoint still had');
      this._set('dirty', 'Saving…');
      this._queueFlush(500);
      return;
    }
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
    // One-time column repair for lists provisioned as rich text (they HTML-mangle
    // stored JSON, e.g. task checklists). No-op after the first successful pass.
    if (!SP.config.textColsRepairedV2) {
      try { await SP.repairTextColumns(l => this.logLine(l)); } catch (e) {}
    }
    const listIds = SP.config.listIds || {};
    for (const tabName of allTabs) {
      const items = await this._fetchList(tabName);
      this._adoptAliases(tabName, items);
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
      // Same as the full pull: a replacement column created on another machine is
      // only discoverable from the data, and _rowFromItem below must already know
      // about it or it reads the abandoned original column.
      this._adoptAliases(t, items);
      tabs[t] = items.map(it => this._rowFromItem(t, it));
      this._indexTab(t, items);
    }
    this.logLine('Picked up ' + changed + ' change' + (changed === 1 ? '' : 's') + ' from SharePoint');
    this._finishPull(tabs, [], 'Updated from SharePoint');
  },

  // Field-level three-way merge of local edits against a freshly pulled remote
  // snapshot. base = the rows the server last handed us (this._sigs), so for
  // every field we can distinguish "I changed it" from "they changed it".
  //   mine === base  -> I didn't touch it, take theirs
  //   theirs === base -> they didn't touch it, keep mine
  //   both moved     -> real collision: keep mine, flag it for review
  _merge3(remoteState) {
    const eq = (a, b) => {
      // Use Reconcile's comparison: the local side holds the app's shapes (true,
      // "$1,200") and the remote side SharePoint's (TRUE, 1200). Comparing them as
      // raw text made every checkbox and hand-typed amount look changed, which
      // turned honest edits into bogus "changed in two places" review cards.
      if (window.reconSame) return reconSame(a, b);
      const n = v => (v == null || v === '') ? '' : (Array.isArray(v) ? v.join(',') : String(v));
      return n(a) === n(b);
    };
    const localTabs = serializeForSheet(Store.state).tabs;
    const remoteTabs = serializeForSheet(remoteState).tabs;
    const outTabs = {};
    let conflicts = 0, tookTheirs = 0;
    for (const t of Object.keys(remoteTabs)) {
      const det = SP_DETAIL_MERGE[t];
      if (det) {
        // Detail rows with a stable identity: merge row-by-row rather than
        // letting one side's whole group win. Added here → keep; added there →
        // adopt; deleted here (present in the baseline, gone locally) → stays
        // deleted; edited on both sides → keep mine and flag it.
        const base = new Map();
        try { JSON.parse((this._detailBase || {})[t] || '[]').forEach(r => base.set(det.key(r), r)); } catch (e) {}
        const loc = new Map((localTabs[t] || []).filter(r => r && det.key(r)).map(r => [det.key(r), r]));
        const rem = new Map((remoteTabs[t] || []).filter(r => r && det.key(r)).map(r => [det.key(r), r]));
        const rows = [];
        for (const [k, r] of rem) {
          const mine = loc.get(k);
          if (!mine) { if (!base.has(k)) rows.push(r); continue; }
          const was = base.get(k);
          const out = { ...r };
          for (const f of det.fields) {
            if (eq(mine[f], r[f])) { out[f] = mine[f]; continue; }
            if (!was) { out[f] = mine[f]; continue; }
            if (eq(mine[f], was[f])) { out[f] = r[f]; tookTheirs++; continue; }
            if (eq(r[f], was[f])) { out[f] = mine[f]; continue; }
            out[f] = mine[f];
            this.noteConflict(t, k, f, mine[f], r[f], was[f]);
            conflicts++;
          }
          rows.push(out);
        }
        for (const [k, r] of loc) if (!rem.has(k)) rows.push(r);
        if (det.ordBy) {
          const seen = {};
          rows.forEach(r => { const g = det.ordBy(r); r.ord = (seen[g] = (seen[g] == null ? 0 : seen[g] + 1)); });
        }
        outTabs[t] = rows;
        continue;
      }
      if (!SP_PARENT_TABS.includes(t)) { outTabs[t] = localTabs[t] || remoteTabs[t]; continue; }
      const base = (this._sigs && this._sigs[t]) || new Map();
      const loc = new Map((localTabs[t] || []).filter(r => r && r.id != null).map(r => [String(r.id), r]));
      const rem = new Map((remoteTabs[t] || []).filter(r => r && r.id != null).map(r => [String(r.id), r]));
      const rows = [];
      for (const [id, r] of rem) {
        const mineRow = loc.get(id);
        if (!mineRow) {
          // Gone locally. If the baseline had it we deleted it on purpose —
          // let the delete stand. If not, it is new to us: take it.
          if (!base.has(id)) rows.push(r);
          continue;
        }
        let baseRow = null;
        try { const s = base.get(id); if (s && s[0] !== '\u0000') baseRow = JSON.parse(s); } catch (e) {}
        const out = { ...r };
        const keys = new Set([...Object.keys(mineRow), ...Object.keys(r)]);
        for (const k of keys) {
          const mine = mineRow[k], theirs = r[k];
          if (eq(mine, theirs)) { out[k] = mine; continue; }
          if (!baseRow) {
            // No baseline for this row (first pull of the session, or the row was
            // re-baselined by a column repair). We cannot tell who changed what, so
            // keep local — but this is exactly how an incoming edit used to vanish
            // in silence, so flag it for review instead of deciding quietly.
            out[k] = mine;
            this.noteConflict(t, id, k, mine, theirs, '');
            conflicts++;
            continue;
          }
          const was = baseRow[k];
          if (eq(mine, was)) { out[k] = theirs; tookTheirs++; continue; }
          if (eq(theirs, was)) { out[k] = mine; continue; }
          out[k] = mine;
          this.noteConflict(t, id, k, mine, theirs, was);
          conflicts++;
        }
        rows.push(out);
      }
      for (const [id, r] of loc) if (!rem.has(id)) rows.push(r);   // created here, not pushed yet
      outTabs[t] = rows;
    }
    for (const t of Object.keys(localTabs)) if (!(t in outTabs)) outTabs[t] = localTabs[t];
    if (conflicts) this._saveConflicts();
    return { state: deserializeFromSheet({ tabs: outTabs }), conflicts, tookTheirs };
  },

  // Both-sides-changed collisions, kept until a human resolves them.
  _conflicts: (() => { try { return JSON.parse(localStorage.getItem('sp_conflicts') || '{}'); } catch (e) { return {}; } })(),
  _saveConflicts() { try { localStorage.setItem('sp_conflicts', JSON.stringify(this._conflicts)); } catch (e) {} },
  noteConflict(tab, id, field, mine, theirs, was) {
    this._conflicts[tab + '|' + id + '|' + field] = {
      tab, id: String(id), field,
      mine: mine == null ? '' : String(mine),
      theirs: theirs == null ? '' : String(theirs),
      was: was == null ? '' : String(was),
      at: Date.now(),
    };
  },
  conflictList() { return Object.values(this._conflicts).sort((a, b) => b.at - a.at); },
  // Write a chosen value back into state. Parent records are top-level; detail
  // rows are nested inside their parent and keyed by their stable id (or, for
  // utilities and 1099s, by the composite natural key stored in the conflict).
  _applyConflict(s, c, v) {
    const id = String(c.id), f = c.field;
    const findIn = (arr, k) => (arr || []).find(r => r && String(r[k]) === id);
    const coll = SP_COLL[c.tab];
    if (coll) {
      const rec = (s[coll] || []).find(x => String(x.id) === id);
      if (!rec) return false;
      rec[f] = v; return true;
    }
    switch (c.tab) {
      case 'ExchangeDraws':
        for (const e of (s.exchanges || [])) { const r = findIn(e.draws, 'drawId'); if (r) { r[f] = v; return true; } }
        return false;
      case 'StageHistory':
        for (const p of (s.properties || [])) { const r = findIn(p.stageHistory, 'rowId'); if (r) { r[f] = v; return true; } }
        return false;
      case 'FeeItems':
        for (const p of (s.properties || [])) {
          const r = findIn(p.purchaseFeeItems, 'rowId') || findIn(p.saleFeeItems, 'rowId');
          if (r) { r[f] = v; return true; }
        }
        return false;
      case 'TransactionSplits':
        for (const tx of (s.transactions || [])) { const r = findIn(tx.splits, 'rowId'); if (r) { r[f] = v; return true; } }
        return false;
      case 'TenantRentHistory':
        for (const tn of (s.tenants || [])) { const r = findIn(tn.rentHistory, 'rowId'); if (r) { r[f] = v; return true; } }
        return false;
      case 'Utilities': {
        const [pid, type] = id.split('|');
        const p = (s.properties || []).find(x => String(x.id) === pid);
        if (!p || !type) return false;
        p.utilities = p.utilities || {};
        p.utilities[type] = p.utilities[type] || {};
        p.utilities[type][f] = v;
        return true;
      }
      case 'ContractorTen99': {
        const [cid, yr] = id.split('|');
        const con = (s.contractors || []).find(x => String(x.id) === cid);
        const h = con && (con.ten99History || []).find(x => String(x.taxYear) === yr);
        if (!h) return false;
        h[f] = v; return true;
      }
    }
    return false;
  },
  resolveConflict(key, take) {
    const c = this._conflicts[key]; if (!c) return true;
    if (take !== 'theirs') { delete this._conflicts[key]; this._saveConflicts(); return true; }
    const col = ((window.SHEET_SCHEMA[c.tab] || {}).columns || []).find(x => x.key === c.field);
    let v = c.theirs;
    if (col && (col.type === 'money' || col.type === 'number')) v = v === '' ? null : Number(v);
    else if (col && col.type === 'bool') v = (v === 'true' || v === 'TRUE' || v === '1');
    else if (col && col.type === 'array') v = v ? v.split(',').map(x => x.trim()).filter(Boolean) : [];
    let applied = false;
    Store.update(s => { applied = this._applyConflict(s, c, v); });
    // A resolution that cannot find its row must NOT disappear — that would be
    // the same silent failure this whole feature exists to prevent.
    if (!applied) {
      this.logLine('\u26a0 Could not apply their value for ' + c.tab + ' \u00b7 ' + c.field + ' \u2014 that row no longer exists here');
      return false;
    }
    delete this._conflicts[key];
    this._saveConflicts();
    return true;
  },

  // Deletions this device has made. Kept in the app's own state (so they ride
  // along to other machines) and honoured on every pull.
  noteTombstone(tab, id) {
    const coll = SP_COLL[tab]; if (!coll) return;
    const s = Store.state; if (!s) return;
    s.tombstones = s.tombstones || [];
    const key = coll + ':' + String(id);
    if (s.tombstones.some(t => (t.coll + ':' + t.id) === key)) return;
    s.tombstones.push({ coll, id: String(id), at: new Date().toISOString() });
  },

  // Strip rows a tombstone says were deleted here. Returns the removed rows as
  // {tab, id} so the delete can be re-sent to a server that still has them.
  _dropTombstoned(state) {
    const tombs = (Store.state && Store.state.tombstones) || [];
    if (!tombs.length) return [];
    const tabFor = {};
    Object.entries(SP_COLL).forEach(([tab, coll]) => { tabFor[coll] = tab; });
    const byColl = {};
    tombs.forEach(t => { (byColl[t.coll] = byColl[t.coll] || new Set()).add(String(t.id)); });
    const removed = [];
    for (const [coll, ids] of Object.entries(byColl)) {
      const arr = state[coll];
      if (!Array.isArray(arr)) continue;   // resolve against real state, not the tab table
      const kept = arr.filter(r => {
        if (r && ids.has(String(r.id))) {
          // Only rows whose tab we know can have their DELETE re-sent; the row
          // is dropped either way so it cannot reappear on screen.
          if (tabFor[coll]) removed.push({ tab: tabFor[coll], id: String(r.id) });
          return false;
        }
        return true;
      });
      if (kept.length !== arr.length) state[coll] = kept;
    }
    return removed;
  },

  // Put a deleted row's id back in the baseline so the next flush sees
  // "baseline has it, live state doesn't" and issues the DELETE.
  _reissueDeletes(revived) {
    if (!revived || !revived.length) return 0;
    revived.forEach(({ tab, id }) => {
      const m = this._sigs && this._sigs[tab];
      if (m && !m.has(id)) m.set(id, '\u0000deleted');
    });
    return revived.length;
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
    // Per-row baseline for the detail lists: the merge needs each row's
    // last-known server state to tell an add apart from a delete.
    this._detailBase = {};
    Object.keys(SP_DETAIL_MERGE).forEach(t => { this._detailBase[t] = JSON.stringify(payload[t] || []); });
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
        const lid = listIds[t];
        if (!lid) { this.logLine(t + ' — no list on SharePoint yet; nothing saved for it. Run Create columns & backfill.'); continue; }
        // Key column missing (see _indexTab): pushing as-is would duplicate every
        // row, but skipping forever loses the list silently — which is exactly how
        // a logged day off can vanish with no error anywhere. Repair in place:
        // re-provision the column, clear the unidentifiable rows, then push the
        // whole list fresh.
        if ((this._brokenKey || {})[t]) {
          this.logLine(t + ' — record-id column missing; repairing before saving…');
          try {
            await SP.provision(() => {});
            const stale = await this._fetchList(t);
            let cleared = 0;
            for (const it of stale) {
              if ((it.fields || {}).RecID != null) continue;
              await SP.graph('/sites/' + sid + '/lists/' + lid + '/items/' + it.id, { method: 'DELETE' }).catch(() => {});
              cleared++;
            }
            delete this._brokenKey[t];
            this._sigs[t] = new Map();          // nothing up there is trusted — re-send all
            this._items[t] = new Map();
            this.logLine(t + ' — repaired' + (cleared ? ', cleared ' + cleared + ' unidentifiable row' + (cleared === 1 ? '' : 's') : '') + '; re-sending every row ✓');
          } catch (e) {
            this.logLine(t + ' — could not repair (' + (e.message || e) + '). Nothing was saved for this list.');
            continue;
          }
        }
        // Extra server items sharing one record id, spotted while indexing. Left
        // alone they reappear on every pull as a duplicate record.
        const dups = ((this._dupItems || {})[t] || []);
        if (dups.length) {
          for (const itemId of dups) {
            await SP.graph('/sites/' + sid + '/lists/' + lid + '/items/' + itemId, { method: 'DELETE' }).catch(() => {});
          }
          this.logLine('Removed ' + dups.length + ' duplicate row' + (dups.length === 1 ? '' : 's') + ' from ' + t + ' ✓');
          this._dupItems[t] = [];
        }
        const m = this._sigs[t];
        const idx = this._items[t] || (this._items[t] = new Map());
        const live = new Set();
        const forced = (this._forceRepush || {})[t] || null;
        for (const r of (payload[t] || [])) {
          if (r.id == null) continue;
          const id = String(r.id);
          live.add(id);
          const sig = JSON.stringify(r);
          if (m.get(id) === sig && !(forced && forced.has(id))) continue;
          const isUpdate = idx.has(id);
          let fields = SP._fieldsFor(t, r, { clearEmpty: isUpdate });
          if (isUpdate) {
            // PATCH only the fields that actually changed — smaller payloads, cheaper server cost.
            // A FORCED row is the exception: its signature is unchanged by definition, so the
            // diff would come out empty and nothing would be sent. Send every field instead —
            // the whole point of forcing is to rewrite values SharePoint never received.
            const oldSig = (forced && forced.has(id)) ? null : m.get(id);
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
        if (forced) delete this._forceRepush[t];   // one full rewrite per request, not every save
        for (const id of [...m.keys()]) {
          if (live.has(id)) continue;
          // Record the deletion locally as well as sending it. The baseline drops
          // the id once the DELETE succeeds, so without a tombstone a later pull
          // that still carries the row reads it as "new to us" and re-adopts it.
          this.noteTombstone(t, id);
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
      this._provisionedForMissing = false;
      this._set('synced', 'All changes saved');
      const parts = [];
      if (ops.length) parts.push(ops.length + ' record change' + (ops.length === 1 ? '' : 's'));
      if (childGroups) parts.push(childGroups + ' detail group' + (childGroups === 1 ? '' : 's'));
      if (cfgTabs) parts.push('settings');
      if (parts.length) this.logLine('Saved ' + parts.join(', ') + ' \u2713');
      this._maybeBackup();
    } catch (e) {
      const auth = /token|sign|auth|login|interaction/i.test(String(e.message || e));
      // A column the schema knows about but this SharePoint list has never seen
      // (a new build adding a field). Create the missing columns once, then
      // retry immediately instead of failing every save until someone notices.
      const missingCol = /is not recognized|Field '\w+' is not/i.test(String(e.message || e));
      if (missingCol && !auth && !this._provisionedForMissing) {
        this._provisionedForMissing = true;
        this.logLine('New column missing in SharePoint — creating it…');
        try {
          await SP.provision(m => this.logLine('  ' + m));
          SP.saveConfig({ skipFields: {}, skipFieldsAt: null });
          this.logLine('Columns created — retrying the save');
          this._queueFlush(600);
          return;
        } catch (pe) { this.logLine('\u2717 Could not create the column: ' + (pe.message || pe)); }
      }
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
    // fire, but force a re-push so each row rewrites all of its fields. This must
    // NOT overwrite the signatures — they are also the merge baseline.
    this.forceRepush(tabs);
    this.logLine('Skipped columns cleared — re-sending those records ✓');
  },

  _queueFlush(ms) { clearTimeout(this._pushTimer); this._pushTimer = setTimeout(() => this.flush(), ms); },
  _set(status, message) { SyncEngine._set(status, message); },

  // A write SharePoint rejected with 400: figure out WHICH column it choked on.
  // Missing columns get created; a column that still fails on its own is
  // recorded and skipped from then on, so one bad column can't wedge all saves.
  // A text column created as single-line caps at 255 characters. A checklist JSON
  // grows past that as items are added, the PATCH 400s, and the old code blacklisted
  // the whole column — so checklists synced while short and silently stopped once
  // they grew. Widen the offending column in place and retry before giving up.
  // Graph cannot change an existing column's type, so a column of the wrong type
  // (or one SharePoint rejects for any other reason) is unusable forever. Create a
  // fresh plain-text column and record it as this field's home; reads and writes
  // both follow the alias from then on. Returns the new column name.
  async _aliasColumn(base, tab, name) {
    const cfg = { ...(SP.config.fieldAlias || {}) };
    const forTab = { ...(cfg[tab] || {}) };
    if (forTab[name]) return forTab[name];
    let shape = '(unknown type)';
    try {
      const r = await SP.graph(base + '/columns?$select=name,text,number,boolean,dateTime,choice,calculated,readOnly&$top=250');
      const col = (r.value || []).find(c => c.name === name);
      if (col) shape = ['text','number','boolean','dateTime','choice','calculated'].filter(k => col[k]).join('/') + (col.readOnly ? ' read-only' : '');
    } catch (e) {}
    const alt = name + 'Text';
    try {
      await SP.graph(base + '/columns', { method: 'POST', body: JSON.stringify({ name: alt, text: { allowMultipleLines: true, textType: 'plain' } }) });
    } catch (e) {
      // Already there from an earlier attempt is fine; anything else is fatal.
      if (!/exist|duplicate/i.test(String(e.message || e))) return null;
    }
    forTab[name] = alt; cfg[tab] = forTab;
    SP.saveConfig({ fieldAlias: cfg });
    this.logLine('\u26a0 ' + tab + '.' + name + ' in SharePoint is ' + shape + ' and cannot hold this value \u2014 moved to a new column "' + alt + '"; syncing resumes there \u2713');
    this._types = null;
    this.forceRepush([tab]);
    return alt;
  },

  async _widenTextColumn(base, tab, name) {
    try {
      const r = await SP.graph(base + '/columns?$select=id,name,text,readOnly&$top=250');
      const col = (r.value || []).find(c => c.name === name);
      if (!col || !col.text || col.readOnly) return false;
      if (col.text.allowMultipleLines && col.text.textType === 'plain') return false;
      await SP.graph(base + '/columns/' + col.id, { method: 'PATCH', body: JSON.stringify({ text: { allowMultipleLines: true, textType: 'plain' } }) });
      this.logLine('Widened ' + tab + '.' + name + ' in SharePoint (long values now fit) \u2713');
      return true;
    } catch (e) { return false; }
  },

  // Force a re-push of rows whose values may never have landed (after a column
  // repair). Tracked SEPARATELY from _sigs: _sigs doubles as the three-way-merge
  // baseline, so clobbering it with sentinels makes the next pull treat every
  // remote edit as unattributable and keep local — silently dropping other
  // people's work. Never overwrite a signature to force a write.
  _forceRepush: null,
  forceRepush(tabs) {
    this._forceRepush = this._forceRepush || {};
    for (const t of (tabs && tabs.length ? tabs : Object.keys(this._sigs || {}))) {
      const m = this._sigs && this._sigs[t]; if (!m) continue;
      this._forceRepush[t] = new Set([...m.keys()]);
    }
    this._queueFlush(800);
  },
  _resigAll() { this.forceRepush(); },

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
            catch (e2) {
              // A rejected field is almost always the COLUMN's shape, not the data.
              // Try to make the column fit before writing the field off: widen it,
              // then fall back to a replacement column.
              let saved = false;
              if (typeof v === 'string' && await this._widenTextColumn(base, tab, k)) {
                try { await SP.graph(op.url, { method: 'PATCH', body: JSON.stringify({ [k]: v }) }); saved = true; }
                catch (e4) {}
              }
              if (!saved && typeof v === 'string') {
                const alt = await this._aliasColumn(base, tab, k);
                if (alt) {
                  try { await SP.graph(op.url, { method: 'PATCH', body: JSON.stringify({ [alt]: v }) }); saved = true; }
                  catch (e5) {}
                }
              }
              if (!saved) noteBad(tab, k, String(e2.message || e2).slice(0, 90));
            }
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

  // True while this device must not be edited: live sync is on but we have not
  // yet heard from SharePoint this session, so there is no merge baseline.
  blocking() { return this.liveOn() && !this._ready && !this._offlineAck; },
  workOffline() {
    this._offlineAck = true;
    this.logLine('\u26a0 Working without SharePoint \u2014 edits stay on this computer until it reconnects');
    this._set('offline', 'Offline — changes held on this computer');
  },

  _onLocalChange() {
    if (SyncEngine._applyingRemote) return;
    SyncEngine.dirty = true;
    this._set('dirty', 'Saving…');
    // No baseline yet this session (first pull still in flight, or it failed).
    // Without one the merge cannot tell "I changed it" from "it was always
    // different", so a stale copy would push its whole worldview. Hold the
    // write until the pull lands; the UI blocks editing during this window.
    if (!this._ready) { this._queueFlush(4000); return; }
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
    if (window.SyncHealth) SyncHealth.schedule();
    if (!Store.__syncHooked) {
      const origSave = Store.save.bind(Store);
      Store.save = () => { SyncEngine._stampChanges(); origSave(); SPSync._onLocalChange(); };
      Store.__syncHooked = true;
    }
    SyncEngine._initSigs();
    try {
      if (!SP.account()) { this._set('error', 'SharePoint sign-in needed — open Integration → SharePoint'); return; }
      // Schema catch-up: lists provisioned by an older build may lack columns
      // this build writes (e.g. updatedAt), or may be missing entirely (a new
      // build added SpendLog / Employees / TimeOff). provision() is idempotent
      // and only creates what's absent. A version bump forces every device to
      // run it once; the missing-list check is the safety net for when someone
      // forgets to bump — without it a whole new list silently never syncs.
      const schemaMissingList = Object.keys(window.SHEET_SCHEMA || {}).some(t => !(SP.config.listIds || {})[t]);
      if (SP.config.schemaVer !== SP_SCHEMA_VER || schemaMissingList) {
        this._set('syncing', 'Updating lists…');
        await SP.provision(() => {});
        SP.saveConfig({ schemaVer: SP_SCHEMA_VER });
        // Lists created by the build that provisioned them without a RecID column
        // left unmatchable rows on the server and id-less copies locally. Clean
        // both up once, now that provision has restored the column.
        this._set('syncing', 'Repairing lists…');
        await SP.repairKeylessRows(() => {}).catch(() => {});
        // A newly created list starts empty on the server. Clearing the push
        // signatures makes the next push send every local row instead of
        // diffing against a baseline that says "already up there".
        this._sigs = {};
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
            <span className="tiny" style={{color: 'var(--ink-3)', alignSelf: 'center'}}>build b20</span>
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
      {!!SPSync.conflictList().length && (
      <Card>
        <CardHead title="Changed in two places" right={<Tag tone="brick">{SPSync.conflictList().length} to review</Tag>}/>
        <div className="card__body col gap-8">
          <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>Someone else changed these fields while you were changing them too. <b>Your value was kept</b> and theirs is shown alongside — nothing was lost, but one of the two is wrong. Pick the right one.</div>
          <div className="col gap-8" style={{maxHeight: 320, overflowY: 'auto'}}>
            {SPSync.conflictList().map(c => (
              <div key={c.tab + c.id + c.field} className="row gap-8 items-center" style={{background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', flexWrap: 'wrap'}}>
                <div className="mono tiny" style={{minWidth: 210}}>{c.tab} · {c.id} · <b>{c.field}</b></div>
                <div className="tiny" style={{color: 'var(--ink-2)'}}>yours <b>{c.mine || '(blank)'}</b> · theirs <b>{c.theirs || '(blank)'}</b> · was {c.was || '(blank)'}</div>
                <div className="row gap-8" style={{marginLeft: 'auto'}}>
                  <Btn sz="sm" kind="ghost" onClick={() => { SPSync.resolveConflict(c.tab + '|' + c.id + '|' + c.field, 'mine'); addLog('Kept your value for ' + c.field + ' on ' + c.id); }}>Keep mine</Btn>
                  <Btn sz="sm" kind="ghost" onClick={() => { SPSync.resolveConflict(c.tab + '|' + c.id + '|' + c.field, 'theirs') ? addLog('Took their value for ' + c.field + ' on ' + c.id) : addLog('\u2717 Could not apply their value for ' + c.field + ' on ' + c.id + ' — that row no longer exists here'); }}>Take theirs</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
      )}
      {!!SP.unsavedList().length && (
      <Card>
        <CardHead title="Values that cannot save" right={<Tag tone="brick">{SP.unsavedList().length} field{SP.unsavedList().length === 1 ? '' : 's'}</Tag>}/>
        <div className="card__body col gap-8">
          <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>These fields hold something that is not a number, so SharePoint rejects them and the app skips them. They stay on this computer only. Fix the value — Reconcile can recover date-shaped amounts automatically — and it saves on the next change.</div>
          <div className="mono tiny" style={{background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', maxHeight: 220, overflowY: 'auto', lineHeight: 1.8}}>
            {SP.unsavedList().map(u => <div key={u.tab + u.id + u.field}>{u.tab} · {u.id} · {u.field} = "{u.value.slice(0, 24)}"</div>)}
          </div>
          <div className="row gap-8">
            <Btn kind="primary" onClick={() => nav('/reconcile')}>Open Reconcile…</Btn>
            <Btn kind="ghost" onClick={() => { SP._unsaved = {}; SP._saveUnsaved(); addLog('Cleared the cannot-save list — it repopulates on the next save if the values are still bad.'); }}>Clear list</Btn>
          </div>
        </div>
      </Card>
      )}
      {!!cfg.migratedAt && <SyncHealthCard nav={nav}/>}
      {!!cfg.migratedAt && (
      <Card>
        <CardHead title="Re-send everything" right={<Tag tone="ghost">repair</Tag>}/>
        <div className="card__body col gap-8">
          <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>Rewrites every record to SharePoint, field by field, and clears any column the app had given up on. Use it when Sync health reports whole columns missing on the server.</div>
          <div className="row gap-8">
            <Btn kind="ghost" disabled={busy === 'resend'} onClick={() => run('resend', async () => {
              SP.saveConfig({ skipFields: {}, skipFieldsAt: null });
              SPSync._skipRetryAt = 0;
              addLog('Cleared the skip list — re-sending every record…');
              SPSync.forceRepush();
            })}>{busy === 'resend' ? 'Re-sending…' : 'Re-send all records'}</Btn>
          </div>
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
              SPSync.forceRepush(Object.keys(cfg.skipFields || {}));
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
