// screens/reconcile.jsx — Divergence report.
// Answers one question before any rebuild: where does THIS computer disagree with
// SharePoint? Compares record-by-record and field-by-field, shows both values side
// by side, and lets you pick a winner per field. Run it on every computer.

const RECON_PARENTS = ['Properties', 'Transactions', 'Tenants', 'RentLedger', 'Contractors', 'Refis', 'Exchanges', 'Leads', 'Offers', 'Tasks', 'Maintenance', 'WebAccounts'];
const RECON_COLL = { Properties: 'properties', Transactions: 'transactions', Tenants: 'tenants', RentLedger: 'rentLedger', Contractors: 'contractors', Refis: 'refis', Exchanges: 'exchanges', Leads: 'leads', Offers: 'offers', Tasks: 'reminders', Maintenance: 'maintenance', WebAccounts: 'webAccounts' };
const SP_VIEW_LIMIT = 5000;

// Blank is blank however it is spelled. Numbers compare numerically so "1200" and
// 1200 are not reported as a difference; everything else compares as trimmed text.
function reconBlank(v) { return v == null || v === '' || (Array.isArray(v) && !v.length); }
// SharePoint returns booleans as TRUE/FALSE, the app stores true/false, and an
// unset checkbox reads as blank. All three mean the same thing — comparing them as
// raw text buries the real differences under hundreds of false alarms.
function reconBool(v) {
  const s = String(v).trim().toLowerCase();
  return s === 'true' ? true : s === 'false' ? false : null;
}
function reconSame(a, b) {
  const ba = reconBool(a), bb = reconBool(b);
  if (ba !== null || bb !== null) {
    const na = ba !== null ? ba : (reconBlank(a) ? false : null);
    const nb = bb !== null ? bb : (reconBlank(b) ? false : null);
    if (na !== null && nb !== null) return na === nb;
  }
  if (reconBlank(a) && reconBlank(b)) return true;
  if (reconBlank(a) !== reconBlank(b)) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    const norm = x => (Array.isArray(x) ? x : String(x).split(',')).map(s => String(s).trim()).filter(Boolean).sort().join('|');
    return norm(a) === norm(b);
  }
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na === nb;
  return String(a).trim() === String(b).trim();
}
function reconShow(v) {
  if (reconBlank(v)) return '(blank)';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
function reconLabel(tab, row) {
  if (!row) return '';
  if (tab === 'Properties') return row.address || row.id;
  if (tab === 'Transactions') return [row.date, row.payee].filter(Boolean).join(' · ') || row.id;
  if (tab === 'Refis') return [row.lender, row.propertyId].filter(Boolean).join(' · ') || row.id;
  if (tab === 'Exchanges') return row.relinquishedAddress || row.id;
  if (tab === 'Tenants') return row.name || row.id;
  return row.name || row.title || row.address || row.id;
}

// Google Sheets stores a date as a day count from 1899-12-30. During the Sheets →
// SharePoint migration some money values were tagged as dates, so $10,000 was written
// as 1927-05-18. The conversion is exactly invertible (whole dollars — any cents were
// the fractional part of the day and did not survive being written as a date).
const RECON_SHEET_EPOCH = Date.UTC(1899, 11, 30);
function reconDateToAmount(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
  if (!m) return null;
  const days = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - RECON_SHEET_EPOCH) / 86400000);
  return (days >= 0 && days < 10000000) ? days : null;
}

function ReconcileScreen() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [report, setReport] = useState(null);
  const [progress, setProgress] = useState('');
  const [openTabs, setOpenTabs] = useState({});

  const live = !!(window.SPSync && SPSync.liveOn && SPSync.liveOn());

  async function compare() {
    setBusy(true); setErr(''); setReport(null);
    try {
      const local = serializeForSheet(Store.state).tabs;
      const tabs = [];
      let totalDiff = 0, onlyHere = 0, onlyThere = 0;
      for (const t of RECON_PARENTS) {
        setProgress('Reading ' + t + '…');
        let items = [];
        try { items = await SPSync._fetchList(t); }
        catch (e) { tabs.push({ tab: t, unreadable: (e.message || String(e)) }); continue; }
        const server = new Map();
        items.forEach(it => {
          const row = SPSync._rowFromItem(t, it);
          if (row && row.id != null) server.set(String(row.id), row);
        });
        const cols = ((window.SHEET_SCHEMA[t] || {}).columns || []).map(c => c.key).filter(k => k !== 'id');
        const localRows = local[t] || [];
        const seen = new Set();
        const diffs = [], missingThere = [], missingHere = [];
        for (const r of localRows) {
          if (r.id == null) continue;
          const id = String(r.id);
          seen.add(id);
          const s = server.get(id);
          if (!s) { missingThere.push({ id, label: reconLabel(t, r) }); continue; }
          for (const k of cols) {
            if (reconSame(r[k], s[k])) continue;
            diffs.push({ id, label: reconLabel(t, r), field: k, mine: r[k], theirs: s[k] });
          }
        }
        for (const [id, s] of server) if (!seen.has(id)) missingHere.push({ id, label: reconLabel(t, s) });
        // Money/number columns holding something that isn't a number are dropped
        // silently on push (Number('1927-05-18') is NaN), so they can never reach
        // SharePoint and nothing ever reports it. Surface them explicitly.
        const numCols = ((window.SHEET_SCHEMA[t] || {}).columns || []).filter(c => c.type === 'money' || c.type === 'number');
        const badNums = [];
        for (const r of localRows) {
          for (const c of numCols) {
            const v = r[c.key];
            if (reconBlank(v) || Array.isArray(v)) continue;
            if (isFinite(Number(String(v).replace(/[$,]/g, '')))) continue;
            badNums.push({ id: String(r.id), label: reconLabel(t, r), field: c.key, value: v, recovered: reconDateToAmount(v) });
          }
        }
        totalDiff += diffs.length; onlyHere += missingThere.length; onlyThere += missingHere.length;
        tabs.push({ tab: t, here: localRows.length, there: server.size, diffs, missingThere, missingHere, badNums });
      }
      setReport({ tabs, totalDiff, onlyHere, onlyThere, at: new Date().toLocaleString() });
    } catch (e) {
      setErr(e.message || String(e));
    } finally { setBusy(false); setProgress(''); }
  }

  // Keep this computer's value: invalidate the row's sync signature so the next
  // save rewrites every field of that record to SharePoint.
  function keepMine(tab, id) {
    const m = window.SPSync && SPSync._sigs && SPSync._sigs[tab];
    if (m) m.set(String(id), '\u0000recon');
    SyncEngine.dirty = true;
    if (window.SPSync) SPSync._queueFlush(400);
    dropRows(tab, r => r.id === id);
  }
  // Take SharePoint's value into this computer's record.
  function keepTheirs(tab, id, field, value) {
    const coll = RECON_COLL[tab]; if (!coll) return;
    const col = ((window.SHEET_SCHEMA[tab] || {}).columns || []).find(c => c.key === field);
    let v = value;
    if (col && col.type === 'array' && typeof v === 'string') v = v.split(',').map(s => s.trim()).filter(Boolean);
    if (reconBlank(v)) v = (col && (col.type === 'money' || col.type === 'number')) ? null : '';
    Store.update(s => {
      const rec = (s[coll] || []).find(x => String(x.id) === String(id));
      if (rec) rec[field] = v;
    });
    dropRows(tab, r => r.id === id && r.field === field);
  }
  function dropRows(tab, pred) {
    setReport(rep => rep && ({ ...rep, tabs: rep.tabs.map(t => t.tab !== tab ? t : ({ ...t, diffs: (t.diffs || []).filter(d => !pred(d)) })) }));
  }

  // Write the recovered dollar amount back over the date-shaped value.
  function repairNum(tab, id, field, amount) {
    const coll = RECON_COLL[tab]; if (!coll) return;
    Store.update(s => {
      const rec = (s[coll] || []).find(x => String(x.id) === String(id));
      if (rec) rec[field] = amount;
    });
    setReport(rep => rep && ({ ...rep, tabs: rep.tabs.map(t => t.tab !== tab ? t : ({ ...t, badNums: (t.badNums || []).filter(b => !(b.id === id && b.field === field)) })) }));
  }

  function exportCsv() {
    if (!report) return;
    const q = v => '"' + String(reconShow(v)).replace(/"/g, '""') + '"';
    const lines = ['List,Record,Label,Field,This computer,SharePoint'];
    report.tabs.forEach(t => {
      (t.diffs || []).forEach(d => lines.push([t.tab, d.id, d.label, d.field, reconShow(d.mine), reconShow(d.theirs)].map(q).join(',')));
      (t.missingThere || []).forEach(r => lines.push([t.tab, r.id, r.label, '(whole record)', 'present', 'missing'].map(q).join(',')));
      (t.missingHere || []).forEach(r => lines.push([t.tab, r.id, r.label, '(whole record)', 'missing', 'present'].map(q).join(',')));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'divergence-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const clean = report && report.totalDiff === 0 && report.onlyHere === 0 && report.onlyThere === 0;

  return (
    <div className="page col gap-16">
      <div className="section-h"><div>
        <div className="crumbs">Settings</div>
        <h1>Reconcile</h1>
        <div className="small" style={{color: 'var(--ink-2)', maxWidth: 760, lineHeight: 1.6}}>
          Compares what this computer holds against what SharePoint holds, record by record and field by field.
          Nothing changes until you choose a winner. Run this on each computer before any migration — the results
          tell us which machine to trust.
        </div>
      </div></div>

      <Card>
        <CardHead title="Compare" right={report ? <Tag tone={clean ? 'sage' : 'ochre'}>{clean ? 'in agreement' : report.totalDiff + report.onlyHere + report.onlyThere + ' to review'}</Tag> : null}/>
        <div className="card__body col gap-12">
          {!live && <div className="small" style={{color: 'var(--brick)'}}>SharePoint live sync is off, so there is nothing to compare against. Turn it on in Settings → Integration first.</div>}
          <div className="row gap-8 items-center" style={{flexWrap: 'wrap'}}>
            <Btn kind="primary" disabled={busy || !live} onClick={compare}>{busy ? (progress || 'Comparing…') : 'Compare with SharePoint'}</Btn>
            {report && <Btn kind="ghost" onClick={exportCsv}>Export differences (CSV)</Btn>}
            {report && <span className="tiny" style={{color: 'var(--ink-3)'}}>checked {report.at}</span>}
          </div>
          {err && <div className="small" style={{color: 'var(--brick)'}}>{err}</div>}
          {report && clean && <div className="small" style={{color: 'var(--sage)'}}>✓ Every record and every field on this computer matches SharePoint.</div>}
        </div>
      </Card>

      {report && (
      <Card>
        <CardHead title="Record counts" right={<span className="tiny" style={{color: 'var(--ink-3)'}}>SharePoint view limit is {SP_VIEW_LIMIT.toLocaleString()} per list</span>}/>
        <div className="card__body">
          <table className="tbl">
            <thead><tr><th>List</th><th className="num">This computer</th><th className="num">SharePoint</th><th className="num">Differing fields</th><th>Status</th></tr></thead>
            <tbody>
              {report.tabs.map(t => {
                const gap = (t.missingThere || []).length + (t.missingHere || []).length;
                const near = Math.max(t.here || 0, t.there || 0) > SP_VIEW_LIMIT * 0.8;
                return (
                  <tr key={t.tab}>
                    <td>{t.tab}</td>
                    <td className="num">{t.unreadable ? '—' : (t.here || 0).toLocaleString()}</td>
                    <td className="num">{t.unreadable ? '—' : (t.there || 0).toLocaleString()}</td>
                    <td className="num">{t.unreadable ? '—' : ((t.diffs || []).length || '')}</td>
                    <td>
                      {t.unreadable ? <Tag tone="brick">unreadable</Tag>
                        : gap ? <Tag tone="ochre">{gap} record{gap === 1 ? '' : 's'} on one side only</Tag>
                        : (t.diffs || []).length ? <Tag tone="ochre">fields differ</Tag>
                        : <Tag tone="sage">match</Tag>}
                      {near && <Tag tone="brick">near list limit</Tag>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      {report && !!report.tabs.some(t => (t.badNums || []).length) && (
      <Card>
        <CardHead title="Values SharePoint can never accept" right={<Tag tone="brick">needs a decision</Tag>}/>
        <div className="card__body col gap-8">
          <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 760}}>
            These are money fields holding something that isn’t a number. The save skips them silently, so they
            have never reached SharePoint and never will — which is why they look fine here and blank everywhere else.
            Anything showing a recovered amount was a dollar figure written as a date during the Google Sheets
            migration; repairing converts it back (whole dollars — cents did not survive being stored as a date).
          </div>
          {!!report.tabs.some(t => (t.badNums || []).some(b => b.recovered != null)) && (
            <div className="row gap-8">
              <Btn kind="primary" onClick={() => {
                const all = report.tabs.flatMap(t => (t.badNums || []).filter(b => b.recovered != null).map(b => ({ ...b, tab: t.tab })));
                if (!confirm('Repair ' + all.length + ' value(s) back to dollar amounts?\n\nEach is converted from its date form. You can review them individually first if you prefer.')) return;
                all.forEach(b => repairNum(b.tab, b.id, b.field, b.recovered));
              }}>Repair all recoverable values</Btn>
            </div>
          )}
          <table className="tbl">
            <thead><tr><th>List</th><th>Record</th><th>Field</th><th>Value stored here</th><th className="num">Recovered</th><th></th></tr></thead>
            <tbody>
              {report.tabs.flatMap(t => (t.badNums || []).map((b, i) => (
                <tr key={t.tab + b.id + b.field + i}>
                  <td className="small">{t.tab}</td>
                  <td><div className="small">{b.label}</div><div className="tiny mono" style={{color: 'var(--ink-3)'}}>{b.id}</div></td>
                  <td className="mono tiny">{b.field}</td>
                  <td className="small" style={{color: 'var(--brick)'}}>{reconShow(b.value)}</td>
                  <td className="num small">{b.recovered != null ? '$' + b.recovered.toLocaleString() : '—'}</td>
                  <td>{b.recovered != null && <Btn sz="sm" kind="ghost" onClick={() => repairNum(t.tab, b.id, b.field, b.recovered)}>Repair</Btn>}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      {report && report.tabs.filter(t => (t.diffs || []).length || (t.missingThere || []).length || (t.missingHere || []).length).map(t => (
      <Card key={t.tab}>
        <CardHead title={t.tab} right={<Btn sz="sm" kind="ghost" onClick={() => setOpenTabs(o => ({ ...o, [t.tab]: !o[t.tab] }))}>{openTabs[t.tab] ? 'Hide' : 'Show'}</Btn>}/>
        {openTabs[t.tab] && (
        <div className="card__body col gap-12">
          {!!(t.missingThere || []).length && (
            <div className="col gap-4">
              <div className="small" style={{fontWeight: 600}}>On this computer only — never reached SharePoint ({t.missingThere.length})</div>
              <div className="mono tiny" style={{background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', maxHeight: 160, overflowY: 'auto', lineHeight: 1.8}}>
                {t.missingThere.map(r => <div key={r.id}>{r.id} — {r.label}</div>)}
              </div>
              <div className="row gap-8">
                <Btn sz="sm" kind="primary" onClick={() => t.missingThere.forEach(r => keepMine(t.tab, r.id))}>Push all of these to SharePoint</Btn>
              </div>
            </div>
          )}
          {!!(t.missingHere || []).length && (
            <div className="col gap-4">
              <div className="small" style={{fontWeight: 600}}>In SharePoint only — missing from this computer ({t.missingHere.length})</div>
              <div className="mono tiny" style={{background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', maxHeight: 160, overflowY: 'auto', lineHeight: 1.8}}>
                {t.missingHere.map(r => <div key={r.id}>{r.id} — {r.label}</div>)}
              </div>
              <div className="small" style={{color: 'var(--ink-3)'}}>A normal refresh brings these in. If they never arrive, that record is the one to investigate.</div>
            </div>
          )}
          {!!(t.diffs || []).length && (
            <table className="tbl">
              <thead><tr><th>Record</th><th>Field</th><th>This computer</th><th>SharePoint</th><th>Keep</th></tr></thead>
              <tbody>
                {t.diffs.map((d, i) => (
                  <tr key={d.id + d.field + i}>
                    <td><div className="small">{d.label}</div><div className="tiny mono" style={{color: 'var(--ink-3)'}}>{d.id}</div></td>
                    <td className="mono tiny">{d.field}</td>
                    <td className="small">{reconShow(d.mine)}</td>
                    <td className="small">{reconShow(d.theirs)}</td>
                    <td>
                      <div className="row gap-8">
                        <Btn sz="sm" kind="ghost" onClick={() => keepMine(t.tab, d.id)}>Mine</Btn>
                        <Btn sz="sm" kind="ghost" onClick={() => keepTheirs(t.tab, d.id, d.field, d.theirs)}>SharePoint</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        )}
      </Card>
      ))}
    </div>
  );
}
