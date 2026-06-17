// app.jsx — main shell with hash-based routing

const { useState, useEffect, useMemo } = React;

// Routing — simple hash-based
function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/dashboard');
  useEffect(() => {
    const handler = () => setHash(window.location.hash || '#/dashboard');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  return hash.replace(/^#/, '') || '/dashboard';
}

function nav(path) {
  window.location.hash = path;
}
window.nav = nav;

// Always-visible sync status — discovery + live state, so saving is never a mystery.
const SYNC_VIS = {
  'local-only':  { dot: 'var(--ink-3)', label: 'Local only',     spin: false },
  'synced':      { dot: 'var(--sage)',  label: 'Saved',          spin: false },
  'dirty':       { dot: 'var(--ochre)', label: 'Unsaved',        spin: false },
  'syncing':     { dot: 'var(--blue)',  label: 'Syncing',        spin: true  },
  'remote-newer':{ dot: 'var(--ochre)', label: 'Sheet is newer', spin: false },
  'offline':     { dot: 'var(--ink-3)', label: 'Offline',        spin: false },
  'error':       { dot: 'var(--brick)', label: 'Sync error',     spin: false },
  'blocked':     { dot: 'var(--brick)', label: 'Save paused',    spin: false },
};

function relTime(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return '1m ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 7200) return '1h ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

function SyncIndicator() {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const off = SyncEngine.on(() => force(n => n + 1));
    const tick = setInterval(() => force(n => n + 1), 30000); // keep "saved 2m ago" fresh
    return () => { off(); clearInterval(tick); };
  }, []);

  const st = SyncEngine.status;
  const vis = SYNC_VIS[st] || SYNC_VIS['local-only'];
  const synced = st === 'synced' && SyncEngine.lastSyncedAt;
  const detail = st === 'synced' && SyncEngine.lastSyncedAt ? relTime(SyncEngine.lastSyncedAt)
    : st === 'local-only' ? 'set up sync'
    : SyncEngine.message || vis.label;

  function onClick() {
    if (st === 'remote-newer') {
      if (confirm('The Google Sheet has newer data than this device.\n\nLoad the Sheet version? Your unsaved local changes will be replaced.\n\n(Cancel to keep local — then use Push on the Sync screen to overwrite the Sheet.)')) {
        SyncEngine.pullNow();
        return;
      }
    }
    if (st === 'error' || st === 'offline') { SyncEngine.openSync(); return; }
    if (st === 'blocked') {
      const localN = (Store.state.properties || []).length;
      if (confirm(`Saving is paused as a safety check.\n\nThis device has ${localN} propert${localN === 1 ? 'y' : 'ies'}, noticeably fewer than the Google Sheet. Saving now would REPLACE the Sheet's data with what's on this device.\n\nOK = replace the Sheet anyway (use only if this device is correct).\nCancel = keep the Sheet and load its data here instead (recommended).`)) {
        SyncEngine.forcePush();
      } else {
        SyncEngine.pullNow();
      }
      return;
    }
    nav('/integration');
  }

  const title = st === 'local-only'
    ? 'Your data is saved only in this browser. Click to set up cross-device sync with Google Sheets.'
    : st === 'synced' ? 'All changes saved to the Google Sheet · click for sync settings'
    : st === 'remote-newer' ? 'The Sheet was updated on another device — click to load it'
    : st === 'blocked' ? 'Saving paused: this device has far fewer properties than the Sheet — click to resolve'
    : SyncEngine.message;

  return (
    <button onClick={onClick} title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
        background: st === 'local-only' ? 'transparent' : 'var(--paper-2)',
        border: '1px solid ' + (st === 'error' || st === 'blocked' ? 'var(--brick)' : st === 'remote-newer' || st === 'dirty' ? 'var(--ochre)' : 'var(--rule)'),
        color: 'var(--ink-2)', fontFamily: 'inherit', fontSize: 12,
      }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: vis.dot, flexShrink: 0,
        animation: vis.spin ? 'syncpulse 1s ease-in-out infinite' : 'none',
      }}/>
      <span style={{fontWeight: 500}}>{vis.label}</span>
      <span className="dim" style={{fontSize: 11}}>· {detail}</span>
    </button>
  );
}

const NAV = [
  { path: '/dashboard',    label: 'Dashboard' },
  { path: '/calendar',     label: 'Calendar' },
  { sep: true },
  { path: '/properties',   label: 'Properties' },
  { path: '/rent',         label: 'Rent Roll' },
  { sep: true },
  { path: '/transactions', label: 'Transactions' },
  { path: '/contractors',  label: 'Contractors' },
  { path: '/tax-binder',   label: 'Tax Binder' },
];

// View switch for the Properties workspace. List/Board are two views of the
// property set; 1031/Refi are the property-linked workflows, tucked here
// instead of cluttering the top nav.
function PropViewToggle({ view }) {
  const seg = (v, path, label) => (
    <button className={'seg__btn' + (view === v ? ' seg__btn--active' : '')}
      onClick={() => { if (view !== v) nav(path); }}>{label}</button>
  );
  return (
    <div className="seg">
      {seg('list', '/properties', '☰ List')}
      {seg('board', '/pipeline', '▦ Board')}
      <span style={{width:1, background:'var(--rule)', margin:'2px 4px', alignSelf:'stretch'}}/>
      {seg('1031', '/exch1031', '1031')}
      {seg('refi', '/refi', 'Refi')}
    </div>
  );
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "showSeedNote": true
}/*EDITMODE-END*/;

function App() {
  const store = useStore();
  const route = useRoute();
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [searchOpen, setSearchOpen] = React.useState(false);

  // Boot the sync engine once (auto-pull on open / auto-push on change when configured).
  React.useEffect(() => { SyncEngine.start(); }, []);

  // Global Cmd+K / Ctrl+K / '/' listener
  React.useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT' && !e.target.isContentEditable) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Counts for nav badges
  const counts = useMemo(() => {
    const month = getCurrentMonth();
    const monthLedger = getLedgerForMonth(month);
    const vacateDue = monthLedger.filter(r => r.status === 'vacate-due').length;
    const untagged = untaggedTransactions().length;
    const today = TODAY();
    const tasksDue = (Store.state.reminders || []).filter(r => !r.done && r.dueDate && daysBetween(today, r.dueDate) <= 7).length;
    return { vacateDue, untagged, tasksDue };
  }, [store]);

  // Route resolution
  const segs = route.split('/').filter(Boolean);
  const top = segs[0] || 'dashboard';

  let screen;
  if (top === 'property') {
    screen = <PropertyScreen propertyId={segs[1]} subtab={segs[2] || 'capture'} />;
  } else if (top === 'dashboard') {
    screen = <DashboardScreen />;
  } else if (top === 'calendar') {
    screen = <CalendarScreen />;
  } else if (top === 'rent') {
    screen = <RentRollScreen />;
  } else if (top === 'pipeline') {
    screen = <PipelineScreen />;
  } else if (top === 'properties') {
    screen = <PropertiesListScreen />;
  } else if (top === 'transactions') {
    screen = <TransactionsScreen />;
  } else if (top === 'bank-import') {
    screen = <BankImportScreen />;
  } else if (top === 'contractors') {
    screen = <ContractorsScreen />;
  } else if (top === 'exch1031') {
    screen = <Exch1031Screen />;
  } else if (top === 'refi') {
    screen = <RefiScreen />;
  } else if (top === 'notice') {
    screen = <NoticeScreen />;
  } else if (top === 'tax-binder') {
    screen = <TaxBinderScreen />;
  } else if (top === 'settings') {
    screen = <SettingsScreen />;
  } else if (top === 'integration') {
    screen = <IntegrationScreen />;
  } else {
    screen = <DashboardScreen />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__row">
          <AtmoreLogo />
          <div className="grow" />
          <div className="row gap-12 items-center">
            <span className="small dim">Today · {fmtDate(TODAY(), {full:true})}</span>
            <SyncIndicator />
            <button onClick={() => setSearchOpen(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', background: 'var(--paper-2)',
                border: '1px solid var(--rule)', borderRadius: 6,
                cursor: 'pointer', color: 'var(--ink-3)',
                fontFamily: 'inherit', fontSize: 13, minWidth: 200,
              }}>
              <span>⌕</span><span>Search…</span><span style={{flex: 1}}/>
              <span className="kbd" style={{fontFamily: 'IBM Plex Mono, monospace', fontSize: 10}}>⌘K</span>
            </button>
            <Btn sz="sm" kind="ghost" onClick={() => nav('/bank-import')}>⤓ Bank import</Btn>
            <Btn sz="sm" kind="ghost" onClick={() => nav('/settings')} title="Settings & integration">⚙</Btn>
          </div>
        </div>
        <nav className="topbar__tabs">
          {NAV.map((n, i) => {
            if (n.sep) return <div key={'sep'+i} style={{width:1, background:'var(--rule)', margin:'6px 12px 12px', alignSelf:'stretch'}}/>;
            const active = (top === n.path.slice(1)) || (['property','pipeline','exch1031','refi'].includes(top) && n.path === '/properties');
            let count = null, alert = false;
            if (n.path === '/rent' && counts.vacateDue) { count = counts.vacateDue; alert = true; }
            if (n.path === '/transactions' && counts.untagged) { count = counts.untagged; alert = true; }
            if (n.path === '/calendar' && counts.tasksDue) { count = counts.tasksDue; alert = true; }
            return (
              <div key={n.path}
                onClick={() => nav(n.path)}
                className={'tab' + (active ? ' tab--active' : '') + (alert ? ' tab--alert' : '')}>
                {n.label}
                {count != null && <span className="tab__count">{count}</span>}
              </div>
            );
          })}
        </nav>
      </header>

      <main className="page">{screen}</main>

      <TweaksPanel>
        <TweakSection label="Prototype controls" />
        <TweakButton label="Reset to seed data" onClick={() => Store.reset()} />
        <TweakButton label="Start with blank workspace" onClick={() => {
          if (confirm('Wipe all local data and start fresh? (This won\'t touch your Google Sheet.)')) Store.blank();
        }} />
        <p className="small dim" style={{margin:'8px 0', lineHeight: 1.5}}>
          The prototype writes changes to your browser's local storage. Reset to bring back the original seed data.
        </p>
        <TweakSection label="Data source"/>
        <p className="small dim" style={{margin:'4px 0', lineHeight:1.5}}>
          In production this will read/write the Google Sheet directly. For now, all data is a snapshot loaded from your real spreadsheets.
        </p>
      </TweaksPanel>
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)}/>}
    </div>
  );
}

// Simple properties list screen (entry point to property detail)
// Available columns for the Properties table
const PROP_COLUMNS = [
  { key: 'stage',          label: 'Stage',          alwaysShow: true,
    render: (p) => <StatusBadge code={p.statusCode} full/>,
    sortValue: (p) => p.statusCode },
  { key: 'address',        label: 'Address',        alwaysShow: true,
    render: (p) => <span className="addr">{p.address}</span>,
    sortValue: (p) => (p.address || '').toLowerCase() },
  { key: 'type',           label: 'Type',           default: true,
    render: (p) => <span className="small">{p.type}</span>,
    sortValue: (p) => p.type || '' },
  { key: 'city',           label: 'City',           default: true,
    render: (p) => <span className="small dim">{p.city}</span>,
    sortValue: (p) => (p.city || '').toLowerCase() },
  { key: 'assigned',       label: 'Assigned',       default: true,
    render: (p) => p.assigned ? <span className="row gap-6 items-center"><Av name={p.assigned}/><span className="small">{p.assigned}</span></span> : <span className="dim small">—</span>,
    sortValue: (p) => p.assigned || '' },
  { key: 'loan',           label: 'Loan',           default: true,
    render: (p) => <span className="small dim">{p.loanType || '—'}</span>,
    sortValue: (p) => p.loanType || '' },
  { key: 'purchase',       label: 'Purchase',       default: true, numeric: true,
    render: (p) => <span className="small mono">{p.purchasePrice ? fmtMoney(Math.abs(p.purchasePrice)) : '—'}</span>,
    sortValue: (p) => Math.abs(p.purchasePrice || 0) },
  { key: 'rehab',          label: 'Rehab',          default: true, numeric: true,
    render: (p) => <span className="small mono">{p.rehab ? fmtMoney(p.rehab) : '—'}</span>,
    sortValue: (p) => p.rehab || 0 },
  { key: 'vestingLLC',     label: 'Vesting LLC',    numeric: false,
    render: (p) => <span className="small dim">{p.vestingLLC || '—'}</span>,
    sortValue: (p) => p.vestingLLC || '' },
  { key: 'county',         label: 'County',
    render: (p) => <span className="small dim">{p.county || '—'}</span>,
    sortValue: (p) => p.county || '' },
  { key: 'state',          label: 'State',
    render: (p) => <span className="small dim">{p.state || '—'}</span>,
    sortValue: (p) => p.state || '' },
  { key: 'zip',            label: 'Zip',
    render: (p) => <span className="small mono dim">{p.zip || '—'}</span>,
    sortValue: (p) => p.zip || '' },
  { key: 'lockbox',        label: 'Lockbox',
    render: (p) => <span className="small mono dim">{p.lockbox || '—'}</span>,
    sortValue: (p) => p.lockbox || '' },
  { key: 'ddDate',         label: 'DD date',
    render: (p) => <span className="small mono dim">{fmtDate(p.ddDate)}</span>,
    sortValue: (p) => p.ddDate || '' },
  { key: 'signingDate',    label: 'Signing',
    render: (p) => <span className="small mono dim">{fmtDate(p.signingDate)}{p.closingTime ? ' · ' + p.closingTime : ''}</span>,
    sortValue: (p) => p.signingDate || '' },
  { key: 'purchaseDate',   label: 'Purchase date',
    render: (p) => <span className="small mono dim">{fmtDate(p.purchaseDate)}</span>,
    sortValue: (p) => p.purchaseDate || '' },
  { key: 'salesDate',      label: 'Sale date',
    render: (p) => <span className="small mono dim">{fmtDate(p.salesDate)}</span>,
    sortValue: (p) => p.salesDate || '' },
  { key: 'salesPrice',     label: 'Sale price',     numeric: true,
    render: (p) => <span className="small mono">{p.salesPrice ? fmtMoney(p.salesPrice) : '—'}</span>,
    sortValue: (p) => p.salesPrice || 0 },
  { key: 'grossProfit',    label: 'Net profit',     numeric: true,
    render: (p) => <span className="small mono" style={{color: p.grossProfit > 0 ? 'var(--sage)' : p.grossProfit < 0 ? 'var(--brick)' : 'var(--ink-3)'}}>{p.grossProfit ? fmtMoney(p.grossProfit, {sign: true}) : '—'}</span>,
    sortValue: (p) => p.grossProfit || 0 },
  { key: 'attorney',       label: 'Attorney',
    render: (p) => <span className="small dim">{p.attorney || '—'}</span>,
    sortValue: (p) => p.attorney || '' },
  { key: 'daysInStage',    label: 'Days in stage',  numeric: true,
    render: (p) => { const d = daysInCurrentStage(p); return <span className="small mono dim">{d != null ? d + 'd' : '—'}</span>; },
    sortValue: (p) => daysInCurrentStage(p) ?? -1 },
  { key: 'driveUrl',       label: 'Drive folder',
    render: (p) => p.driveUrl ? <a className="small" href={p.driveUrl} target="_blank" onClick={e => e.stopPropagation()}>↗</a> : <span className="small dim">—</span>,
    sortValue: (p) => p.driveUrl ? 1 : 0 },
  { key: 'notes',          label: 'Notes',
    render: (p) => <span className="small dim">{(p.notes || '—').slice(0, 60)}{(p.notes || '').length > 60 ? '…' : ''}</span>,
    sortValue: (p) => p.notes || '' },
];

const PROP_COLS_KEY = 'atmore-prop-columns-v1';

function PropertiesListScreen() {
  const store = useStore();
  const [filter, setFilter] = useState('');
  const [focus, setFocus] = useState(() => takeFocus('properties'));
  const [stage, setStage] = useState('all');
  const [showArchive, setShowArchive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sortKey, setSortKey] = useState('stage');
  const [sortDir, setSortDir] = useState('asc');
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem(PROP_COLS_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return PROP_COLUMNS.filter(c => c.default || c.alwaysShow).map(c => c.key);
  });

  function toggleCol(key) {
    const col = PROP_COLUMNS.find(c => c.key === key);
    if (col?.alwaysShow) return;
    let next;
    if (visibleCols.includes(key)) next = visibleCols.filter(k => k !== key);
    else next = [...visibleCols, key];
    setVisibleCols(next);
    localStorage.setItem(PROP_COLS_KEY, JSON.stringify(next));
  }

  function resetCols() {
    const next = PROP_COLUMNS.filter(c => c.default || c.alwaysShow).map(c => c.key);
    setVisibleCols(next);
    localStorage.setItem(PROP_COLS_KEY, JSON.stringify(next));
  }

  // Preserve canonical column order
  const activeCols = PROP_COLUMNS.filter(c => visibleCols.includes(c.key));

  function clickHeader(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const sortCol = PROP_COLUMNS.find(c => c.key === sortKey);
  const archiveCodes = getStatuses().filter(s => s.lane === 'archive').map(s => s.code);
  const rentalCodes = getStatuses().filter(s => s.lane === 'rental').map(s => s.code);
  const focusSet = focus ? new Set(liveFocusIds(focus)) : null;
  const props = store.properties.filter(p => {
    if (focusSet) {
      if (!focusSet.has(p.id)) return false;
      if (filter && !p.address.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    }
    const archived = archiveCodes.includes(p.statusCode);
    if (archived && !showArchive) return false;
    if (!archived && stage !== 'all' && p.statusCode !== stage) return false;
    if (archived && stage !== 'all' && stage !== p.statusCode) return false;
    if (filter && !p.address.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (!sortCol) return 0;
    const av = sortCol.sortValue(a);
    const bv = sortCol.sortValue(b);
    let cmp;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const activeProps = store.properties.filter(p => !archiveCodes.includes(p.statusCode));
  const archivedCount = store.properties.filter(p => archiveCodes.includes(p.statusCode)).length;
  const stages = ['all', ...STATUS_ORDER, ...rentalCodes, ...(showArchive ? archiveCodes : [])];
  const stageCounts = {};
  store.properties.forEach(p => { stageCounts[p.statusCode] = (stageCounts[p.statusCode]||0)+1; });

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Properties</div>
          <h1>All properties · {activeProps.length}{showArchive ? ` + ${archivedCount} archived` : ''}</h1>
        </div>
        <div className="row gap-8 items-center">
          <PropViewToggle view="list"/>
          <Btn kind="ghost" sz="sm" onClick={() => {
            downloadCSV('properties.csv', props, [
              { key: 'statusCode', label: 'Stage' },
              { key: 'address', label: 'Address' },
              { key: 'city', label: 'City' },
              { key: 'state', label: 'State' },
              { key: 'type', label: 'Type' },
              { key: 'assigned', label: 'Assigned' },
              { key: 'loanType', label: 'Loan type' },
              { key: 'purchasePrice', label: 'Purchase price' },
              { key: 'rehab', label: 'Rehab' },
              { key: 'salesPrice', label: 'Sale price' },
              { key: 'vestingLLC', label: 'Vesting LLC' },
            ]);
          }}>⤓ Export CSV</Btn>
          <Tag tone={showArchive ? 'solid-blue' : 'ghost'} style={{cursor: 'pointer'}}>
            <span onClick={() => setShowArchive(v => !v)}>{showArchive ? '✓ ' : ''}Show archive ({archivedCount})</span>
          </Tag>
          <Btn onClick={() => setAdding(true)}>+ Add property</Btn>
        </div>
      </div>

      <Card className="mb-16">
        {focus ? (
          <div className="card__body row gap-12 items-center wrap" style={{background: focusSet && focusSet.size === 0 ? 'rgba(74,122,86,0.08)' : 'rgba(154,102,24,0.06)', borderLeft: '3px solid ' + (focusSet && focusSet.size === 0 ? 'var(--sage-deep, var(--sage))' : 'var(--ochre)')}}>
            {focusSet && focusSet.size === 0 ? (
              <span style={{fontWeight: 500}}>✓ All flagged properties resolved</span>
            ) : (
              <span style={{fontWeight: 500}}>Showing {props.length} flagged propert{props.length === 1 ? 'y' : 'ies'}{focusSet && focusSet.size > props.length ? ` of ${focusSet.size}` : ''}</span>
            )}
            <span className="small dim" style={{textWrap: 'pretty'}}>— {focus.label}</span>
            <div className="grow" />
            {!(focusSet && focusSet.size === 0) && <input className="input" placeholder="Search within…" value={filter} onChange={e => setFilter(e.target.value)} style={{flex: '0 1 220px'}}/>}
            <Btn sz="sm" kind="ghost" onClick={() => { setFocus(null); setFilter(''); }}>Show all properties</Btn>
          </div>
        ) : (
          <div className="card__body row gap-12 items-center wrap">
            <input className="input" placeholder="Search address, city…" value={filter} onChange={e => setFilter(e.target.value)} style={{flex:'1 1 240px'}}/>
            <Segmented value={stage} options={stages.map(s => ({value:s, label: s==='all' ? `All (${activeProps.length})` : `${s} (${stageCounts[s]||0})`}))} onChange={setStage}/>
            <div className="grow" />
            <div style={{position: 'relative'}}>
            <Btn sz="sm" kind="ghost" onClick={() => setColumnsOpen(v => !v)}>Columns ▾</Btn>
            {columnsOpen && (
              <>
                <div onClick={() => setColumnsOpen(false)} style={{position: 'fixed', inset: 0, zIndex: 40}}/>
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 41,
                  background: 'var(--paper)', border: '1px solid var(--rule)',
                  borderRadius: 6, boxShadow: '0 6px 24px rgba(28,26,20,0.15)',
                  minWidth: 240, maxHeight: 480, overflowY: 'auto',
                  padding: '6px 0',
                }}>
                  <div className="row between items-center" style={{padding: '6px 14px', borderBottom: '1px solid var(--rule)'}}>
                    <span className="up dim">Columns</span>
                    <button onClick={resetCols} className="tiny" style={{background: 'transparent', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit'}}>Reset</button>
                  </div>
                  {PROP_COLUMNS.map(c => {
                    const isOn = visibleCols.includes(c.key);
                    return (
                      <label key={c.key} className="row gap-8 items-center"
                        style={{padding: '6px 14px', cursor: c.alwaysShow ? 'default' : 'pointer', opacity: c.alwaysShow ? 0.6 : 1, fontSize: 13}}
                        onMouseOver={e => { if (!c.alwaysShow) e.currentTarget.style.background = 'var(--paper-3)'; }}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                        <input type="checkbox" checked={isOn} disabled={c.alwaysShow} onChange={() => toggleCol(c.key)}/>
                        <span>{c.label}</span>
                        {c.alwaysShow && <span className="tiny dim" style={{marginLeft: 'auto'}}>required</span>}
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <span className="small dim">Showing {props.length}</span>
          </div>
        )}
      </Card>

      <Card>
        {focus && props.length === 0 ? (
          <Empty icon="✓" title="Nothing left to review"
            sub="Every flagged property has been corrected. Use “Show all properties” above to return to the full list."/>
        ) : (
        <table className="tbl">
          <thead>
            <tr>
              {activeCols.map(c => (
                <th key={c.key} className={c.numeric ? 'num' : ''}
                  style={{cursor: 'pointer', userSelect: 'none'}}
                  onClick={() => clickHeader(c.key)}>
                  {c.label}
                  {sortKey === c.key && <span style={{marginLeft: 4, color: 'var(--blue)'}}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.map(p => (
              <tr key={p.id} onClick={() => nav('/property/'+p.id)}>
                {activeCols.map(c => (
                  <td key={c.key} className={c.numeric ? 'num' : ''}>{c.render(p)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </Card>
      {adding && <AddPropertyModal onClose={() => setAdding(false)}/>}
    </div>
  );
}

window.PropertiesListScreen = PropertiesListScreen;

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
