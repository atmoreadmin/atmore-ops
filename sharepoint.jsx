// sharepoint.jsx — Microsoft 365 / SharePoint Lists backend.
// Phase 1: sign-in, list provisioning, one-time migration. The live per-item
// sync engine flips over after migration is verified (Sheets keeps running
// in parallel until then).
const SP_KEY = 'atmore-sp-config-v1';
const SP_TENANT = {
  clientId: 'bef98184-5dbb-4cf0-b9be-36afddf256a9',
  tenantId: 'ba48db99-6736-4958-817b-d3535df0929c',
  siteHost: 'atmorepropertiesllc.sharepoint.com',
  sitePath: '/sites/atmoreoperations',
};
const SP_SCOPES = ['Sites.ReadWrite.All', 'User.Read'];
// 'id' collides with SharePoint's own item id — our record id lives in RecID.
const SP_RENAME = { id: 'RecID' };
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
    try { this.config = { ...SP_TENANT, ...(JSON.parse(localStorage.getItem(SP_KEY)) || {}) }; }
    catch (e) { this.config = { ...SP_TENANT }; }
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
  signOut() { const a = this.account(); if (a) this.msalApp().logoutPopup({ account: a }).catch(() => {}); },
  async token() {
    const account = this.account();
    if (!account) throw new Error('Not signed in');
    try { return (await this.msalApp().acquireTokenSilent({ scopes: SP_SCOPES, account })).accessToken; }
    catch (e) { return (await this.msalApp().acquireTokenPopup({ scopes: SP_SCOPES })).accessToken; }
  },

  async graph(path, opts = {}) {
    const t = await this.token();
    const res = await fetch('https://graph.microsoft.com/v1.0' + path, {
      ...opts,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (res.status === 429 || res.status === 503) {   // throttled — wait and retry once
      const wait = Math.min(30, parseInt(res.headers.get('Retry-After') || '5', 10));
      await new Promise(r => setTimeout(r, wait * 1000));
      return this.graph(path, opts);
    }
    if (res.status === 204) return null;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j.error && j.error.message) || ('Graph ' + res.status));
    return j;
  },

  async siteId() {
    if (this.config.siteId) return this.config.siteId;
    const s = await this.graph('/sites/' + this.config.siteHost + ':' + this.config.sitePath);
    this.saveConfig({ siteId: s.id, siteName: s.displayName });
    return s.id;
  },

  _columnDef(key, type) {
    const name = spField(key);
    const def = { name, indexed: SP_INDEXED.has(name) };
    if (type === 'money' || type === 'number') def.number = {};
    else if (type === 'bool') def.boolean = {};
    // dates + everything else stay text: the app stores ISO strings and
    // compares them as strings — no timezone drift through SharePoint.
    else def.text = {};
    return def;
  },

  // Create every list from SHEET_SCHEMA (idempotent — fills in whatever is missing).
  async provision(onLog) {
    const sid = await this.siteId();
    const existing = await this.graph('/sites/' + sid + '/lists?$select=id,displayName&$top=250');
    const byName = {};
    (existing.value || []).forEach(l => { byName[l.displayName] = l.id; });
    const listIds = { ...(this.config.listIds || {}) };
    for (const [tabName, def] of Object.entries(window.SHEET_SCHEMA)) {
      const cols = def.columns.map(c => this._columnDef(c.key, c.type));
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
        const created = await this.graph('/sites/' + sid + '/lists', {
          method: 'POST',
          body: JSON.stringify({ displayName: tabName, list: { template: 'genericList' }, columns: cols }),
        });
        listIds[tabName] = created.id;
        onLog(tabName + ' — created (' + cols.length + ' columns)');
      }
    }
    this.saveConfig({ listIds, provisionedAt: new Date().toISOString() });
    return listIds;
  },

  _titleFor(row) {
    return String(row.address || row.desc || row.title || row.name || row.label || row.org || row.buyer || row.month || row.pattern || row.key || row.id || '·').slice(0, 250);
  },
  _fieldsFor(tabName, row) {
    const fields = { Title: this._titleFor(row) };
    for (const [k, v] of Object.entries(row)) {
      if (v == null || v === '') continue;
      fields[spField(k)] = Array.isArray(v) ? v.join(',') : v;
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
        const slice = rows.slice(i, i + 20);
        const requests = slice.map((r, j) => ({
          id: String(j + 1), method: 'POST',
          url: '/sites/' + sid + '/lists/' + lid + '/items',
          headers: { 'Content-Type': 'application/json' },
          body: { fields: this._fieldsFor(tabName, r) },
        }));
        const res = await this.graph('/$batch', { method: 'POST', body: JSON.stringify({ requests }) });
        const failed = (res.responses || []).filter(x => x.status >= 400);
        if (failed.length) throw new Error(tabName + ' row ' + (i + Number(failed[0].id)) + ': ' + JSON.stringify(failed[0].body && failed[0].body.error && failed[0].body.error.message || failed[0].status));
        n += slice.length;
        done += slice.length;
        onProgress(done, grand, tabName + ': ' + n + '/' + rows.length);
      }
      totals[tabName] = n;
      onLog(tabName + ' — ' + n + ' items ✓');
    }
    this.saveConfig({ migratedAt: new Date().toISOString(), migrateTotals: totals });
    return totals;
  },
};
SP.loadConfig();

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
        <CardHead title="What happens after migration"/>
        <div className="card__body small" style={{color: 'var(--ink-2)', lineHeight: 1.7, maxWidth: 720}}>
          Once the data is in and the counts check out, the app's live sync switches from the Sheet to SharePoint: per-item writes, year-scoped loading (current year by default, a year picker for history), and per-user identity on every change. The Google Sheet then becomes a read-only export for reporting and backup. That switch ships as the next app update — run the three steps above first.
        </div>
      </Card>
    </div>
  );
}
Object.assign(window, { SP, SharePointView });
