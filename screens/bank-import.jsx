// screens/bank-import.jsx — 4-step CSV import wizard

// Known merchants → clean payee names. Checked before the generic cleaner so the
// common cases come out tidy. A value can be a string or a fn(match) for captures.
function titleCasePayee(s) {
  return (s || '').toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
}
const KNOWN_MERCHANTS = [
  [/lowe'?s/i,                'Lowe’s'],
  [/home\s*depot/i,           'Home Depot'],
  [/amazon|amzn/i,            'Amazon'],
  [/wal-?mart/i,              'Walmart'],
  [/turbotenant/i,            'TurboTenant'],
  [/duke[-\s]?energy/i,       'Duke Energy'],
  [/lendinghome|kiavi/i,      'LendingHome'],
  [/microsoft|msft/i,         'Microsoft'],
  [/cash\s*app/i,             'Cash App'],
  [/sba\s*loan/i,             'SBA'],
  [/csi community/i,          'CSI Community Mgmt'],
  [/zelle payment from\s+([a-z\s]+?)\s+(for|conf)/i, m => 'Zelle: ' + titleCasePayee(m[1].trim())],
  [/zelle/i,                  'Zelle'],
  [/\bhcv\b|housing/i,        'Housing Authority'],
];
// Best-effort payee from a raw bank description.
function derivePayee(desc) {
  if (!desc) return '';
  for (const [re, val] of KNOWN_MERCHANTS) {
    const m = desc.match(re);
    if (m) return typeof val === 'function' ? val(m) : val;
  }
  let s = desc.split('#')[0];
  s = s.replace(/\b(des|id|indn|conf|ppd|ccd)\s*[:#]\s*\S*/gi, ' '); // strip ACH noise tokens
  s = s.replace(/\b\d{3,}\b/g, ' ');                                  // long account/conf numbers
  s = s.replace(/[*]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter(Boolean).slice(0, 3);
  s = words.join(' ');
  return s ? titleCasePayee(s).slice(0, 40) : '';
}

// Project-resolution tokens are kept out of the stored rule and applied here.
function biAutoSuggest(t, properties) {
  const rules = (typeof getAutoTagRules === 'function' ? getAutoTagRules() : []);
  for (const r of rules) {
    const re = compileAutoTagRule(r);
    if (re && re.test(t.desc)) {
      let project = r.project;
      if (project === 'extract') {
        const prop = (properties || []).find(p =>
          t.desc.toLowerCase().includes(p.address.split(/\s+/)[0].toLowerCase() + ' ' + (p.address.split(/\s+/)[1] || '').toLowerCase().slice(0,3))
        );
        project = prop ? prop.address : '';
      } else if (project === 'extract-zelle') {
        const m = t.desc.match(/zelle payment from\s+([A-Z\s]+?)\s+(for|conf)/i);
        if (m) project = 'tenant: ' + m[1].trim();
        else project = '';
      }
      return { category: r.category, project, payee: r.payee || derivePayee(t.desc), conf: r.conf != null ? r.conf : 80 };
    }
  }
  return { category: '', project: '', payee: derivePayee(t.desc), conf: 0 };
}

function parseCSV(text, opts = {}) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  // Parse header — find which column is which by name
  const headerCells = parseCSVLine(lines[0]).map(c => c.trim().toLowerCase());
  const isHeader = headerCells.some(c => /date|amount|acct|description|desc|posted|debit|credit/i.test(c));

  let dateIdx, acctIdx, descIdx, amountIdx, debitIdx, creditIdx, payeeIdx;
  let startIdx = 0;

  if (isHeader) {
    startIdx = 1;
    headerCells.forEach((h, i) => {
      if (dateIdx == null && /^(date|posted date|transaction date|post date|trans date)$/i.test(h)) dateIdx = i;
      if (acctIdx == null && /^(acct|account|account ?number)$/i.test(h)) acctIdx = i;
      if (payeeIdx == null && /^(payee|merchant|name)$/i.test(h)) payeeIdx = i;
      if (descIdx == null && /^(description|desc|memo|payee|details|name)$/i.test(h)) descIdx = i;
      if (amountIdx == null && /^amount$/i.test(h)) amountIdx = i;
      if (debitIdx == null && /^debit$/i.test(h)) debitIdx = i;
      if (creditIdx == null && /^credit$/i.test(h)) creditIdx = i;
    });
    // Fallback: first date-looking column
    if (dateIdx == null) headerCells.forEach((h, i) => { if (dateIdx == null && h.includes('date')) dateIdx = i; });
  } else {
    // No header — assume legacy Date, Acct, Description, Amount order
    dateIdx = 0; acctIdx = 1; descIdx = 2; amountIdx = 3;
  }

  const rows = [];
  for (let i = startIdx; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (cells.length < 2) continue;
    const date = normalizeDate((cells[dateIdx] || '').trim());
    if (!date) continue;
    const acct = ((acctIdx != null ? cells[acctIdx] : '') || '').trim();
    const desc = ((descIdx != null ? cells[descIdx] : '') || '').trim();
    let amount;
    if (amountIdx != null) {
      amount = parseFloat((cells[amountIdx] || '0').replace(/[,$"]/g, '')) || 0;
    } else {
      // Split debit/credit columns — debit is positive expense, credit is positive income
      const d = parseFloat((cells[debitIdx] || '0').replace(/[,$"]/g, '')) || 0;
      const c = parseFloat((cells[creditIdx] || '0').replace(/[,$"]/g, '')) || 0;
      amount = c - d;
    }
    if (opts.invertSign) amount = -amount;
    const payee = ((payeeIdx != null && payeeIdx !== descIdx) ? cells[payeeIdx] : '') || '';
    rows.push({ date, acct, desc, amount, payee: payee.trim() });
  }
  return rows;
}
function parseCSVLine(line) {
  // Simple CSV parser handling double-quoted fields
  const out = [];
  let cur = '', inQ = false;
  for (let i=0; i<line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function normalizeDate(s) {
  if (!s) return null;
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try M/D/YYYY or MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, '0'), dd = m[2].padStart(2, '0');
    return m[3] + '-' + mm + '-' + dd;
  }
  return null;
}

// ────── Sample CSV (the format the user already exports) ──────
const SAMPLE_CSV = `Date,Acct,Description,Amount
5/27/2026,1272,Zelle payment from SOKLEACKA CHHIT for 9604 VINCA Conf# T0Z123,1600.00
5/26/2026,1272,TURBOTENANT.COM RENT,1700.00
5/26/2026,1272,HCV DES:CharlottHA ID: INDN:ATMORE ENTERPRISES,5687.00
5/25/2026,3521,LOWES #02352 hardware for argyle,-207.37
5/25/2026,3521,HOME DEPOT #3603,-411.22
5/24/2026,1272,Check 4641,-2880.00
5/22/2026,1272,LendingHome Serv 34835144,-2638.13
5/22/2026,1272,LendingHome Serv 35140887,-1634.17
5/20/2026,1272,SBA LOAN payment,-750.00
5/19/2026,3521,AMAZON MKTPL,-184.79
5/18/2026,1272,CSI Community Mgmt,-439.18
5/18/2026,3521,CASH APP*TECH 1,-149.35
5/17/2026,4956,Microsoft-G137963358,-84.48
5/15/2026,2810,Counter Credit,607.21
5/15/2026,1272,SPI*DUKE-ENERGY Charlotte morningside,-218.40`;

function BankImportScreen() {
  const store = useStore();
  const [step, setStep] = useState(1);
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [taggedRows, setTaggedRows] = useState([]);
  const [committed, setCommitted] = useState(0);
  const [invertSign, setInvertSign] = useState(false);
  const [autoTagOnLoad, setAutoTagOnLoad] = useState(false);

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      setCsvText(e.target.result);
      processCSV(e.target.result);
    };
    reader.readAsText(file);
  }
  function processCSV(text) {
    const rows = parseCSV(text, { invertSign });
    setParsedRows(rows);
    const tagged = rows.map(r => {
      const s = biAutoSuggest(r, store.properties);
      const dup = isDuplicateTransaction(r.date, r.amount, r.desc);
      // Compute suggestions for later but only fill if autoTagOnLoad
      return {
        ...r,
        category: autoTagOnLoad ? s.category : '',
        project:  autoTagOnLoad ? s.project  : '',
        payee: r.payee || s.payee || '',
        conf: s.conf,
        suggCategory: s.category,
        suggProject:  s.project,
        suggPayee:    r.payee || s.payee || '',
        accept: s.conf >= 80,
        duplicate: dup, skip: dup,
      };
    });
    setTaggedRows(tagged);
    setStep(2);
  }
  function loadSample() {
    setCsvText(SAMPLE_CSV);
    processCSV(SAMPLE_CSV);
  }
  function commit() {
    const toAdd = taggedRows.filter(r => !r.skip).map(r => ({
      date: r.date, acct: r.acct, desc: r.desc, amount: r.amount,
      payee: r.payee, category: r.category, project: r.project,
      batch: 'import-' + TODAY(),
    }));
    commitImportRows(toAdd);
    setCommitted(toAdd.length);
    setStep(5);
  }

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Bank import</div>
          <h1>{step === 5 ? `Imported ${committed} rows` : 'Import bank transactions'}</h1>
        </div>
        {step < 5 && step > 1 && <Btn kind="ghost" sz="sm" onClick={() => { setStep(1); setCsvText(''); setParsedRows([]); setTaggedRows([]); }}>Start over</Btn>}
      </div>

      {/* Stepper */}
      {step < 5 && (
        <Card className="mb-16">
          <div className="card__body" style={{padding: '14px 18px'}}>
            <div className="row gap-12 items-center">
              {[
                {n: 1, label: 'Upload CSV'},
                {n: 2, label: 'Match accounts'},
                {n: 3, label: 'Auto-tag preview'},
                {n: 4, label: 'Confirm & commit'},
              ].map((s, i, arr) => (
                <React.Fragment key={s.n}>
                  <div className="row gap-8 items-center">
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: s.n <= step ? 'var(--blue)' : 'var(--paper-3)',
                      color: s.n <= step ? 'white' : 'var(--ink-3)',
                      border: '2px solid ' + (s.n <= step ? 'var(--blue)' : 'var(--rule)'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: 12,
                    }}>{s.n < step ? '✓' : s.n}</div>
                    <span style={{fontWeight: s.n === step ? 600 : 500, color: s.n <= step ? 'var(--ink)' : 'var(--ink-3)', fontSize: 13}}>{s.label}</span>
                  </div>
                  {i < arr.length - 1 && <div style={{flex: 1, height: 2, background: s.n < step ? 'var(--blue)' : 'var(--rule)'}}/>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </Card>
      )}

      {step === 1 && <StepUpload onFile={loadFile} csvText={csvText} setCsvText={setCsvText} onProcess={() => processCSV(csvText)} onSample={loadSample} invertSign={invertSign} setInvertSign={setInvertSign} autoTagOnLoad={autoTagOnLoad} setAutoTagOnLoad={setAutoTagOnLoad}/>}
      {step === 2 && <StepAccounts rows={parsedRows} onBack={() => setStep(1)} onNext={() => setStep(3)}/>}
      {step === 3 && <StepPreview rows={taggedRows} setRows={setTaggedRows} onBack={() => setStep(2)} onNext={() => setStep(4)}/>}
      {step === 4 && <StepCommit rows={taggedRows} onBack={() => setStep(3)} onCommit={commit}/>}
      {step === 5 && <StepDone count={committed} onAnother={() => { setStep(1); setCsvText(''); setParsedRows([]); setTaggedRows([]); setCommitted(0); }}/>}
    </div>
  );
}

// ────── Step 1: Upload ──────
function StepUpload({ onFile, csvText, setCsvText, onProcess, onSample, invertSign, setInvertSign, autoTagOnLoad, setAutoTagOnLoad }) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = React.useRef(null);
  return (
    <div className="row gap-16 items-start">
      <Card className="grow">
        <div className="card__body">
          <h3 className="serif" style={{fontSize: 17, fontWeight: 500, margin: 0, marginBottom: 12}}>Upload your bank CSV</h3>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
            style={{
              border: '2px dashed ' + (dragOver ? 'var(--blue)' : 'var(--rule)'),
              background: dragOver ? 'var(--blue-tint)' : 'var(--paper-3)',
              borderRadius: 8, padding: 40, textAlign: 'center', cursor: 'pointer',
            }}>
            <div className="serif" style={{fontSize: 24, fontWeight: 500, color: 'var(--ink-2)'}}>Drop CSV here</div>
            <div className="small dim mt-4">or click to browse</div>
            <input ref={fileRef} type="file" accept=".csv" style={{display: 'none'}}
              onChange={e => e.target.files[0] && onFile(e.target.files[0])}/>
          </div>

          <div className="row gap-8 items-center mt-12 small dim">
            <div>or paste CSV text below</div>
            <div className="grow"/>
            <Btn sz="sm" kind="ghost" onClick={onSample}>Load sample (15 rows)</Btn>
          </div>

          <textarea
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder="Date,Acct,Description,Amount&#10;5/27/2026,1272,Zelle from..."
            rows="10"
            className="input mono"
            style={{width: '100%', marginTop: 8, fontSize: 12, lineHeight: 1.5}}/>

          {csvText && (
            <div className="col gap-8 mt-12">
              <label className="row gap-6 items-center small" style={{cursor: 'pointer'}}>
                <input type="checkbox" checked={invertSign} onChange={e => setInvertSign(e.target.checked)}/>
                <span><strong>Invert sign</strong> <span className="dim">(credit card statements where charges show positive)</span></span>
              </label>
              <label className="row gap-6 items-center small" style={{cursor: 'pointer'}}>
                <input type="checkbox" checked={autoTagOnLoad} onChange={e => setAutoTagOnLoad(e.target.checked)}/>
                <span><strong>Auto-tag on load</strong> <span className="dim">(off — leave category/property blank; you can apply suggestions later)</span></span>
              </label>
              <div className="row gap-12 items-center mt-4">
                <span className="small dim">{csvText.split('\n').filter(l => l.trim()).length} lines</span>
                <div className="grow"/>
                <Btn kind="primary" onClick={onProcess}>Parse & continue →</Btn>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card style={{width: 320, flexShrink: 0}}>
        <CardHead title="Expected format"/>
        <div className="card__body">
          <div className="small" style={{lineHeight: 1.6, color: 'var(--ink-2)'}}>
            <p style={{margin: '0 0 8px 0'}}>Four columns, in this order:</p>
            <code className="mono small" style={{display: 'block', background: 'var(--paper-3)', padding: 10, borderRadius: 4, fontSize: 11}}>
              Date, Acct, Description, Amount
            </code>
            <p style={{margin: '12px 0 6px 0'}}>Dates can be <code className="mono">M/D/YYYY</code> or <code className="mono">YYYY-MM-DD</code>.</p>
            <p style={{margin: '6px 0'}}>Amount is signed — negative for charges, positive for deposits.</p>
            <p style={{margin: '6px 0'}}>Header row is optional — auto-detected.</p>
            <p style={{margin: '6px 0'}}>Payee is auto-derived from the description (and from auto-tag rules). Add a <code className="mono">Payee</code> column to set it explicitly.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ────── Step 2: Match accounts ──────
function StepAccounts({ rows, onBack, onNext }) {
  const store = useStore();
  const accts = {};
  rows.forEach(r => { accts[r.acct] = (accts[r.acct] || 0) + 1; });
  const accountIds = new Set(store.accounts.map(a => a.id));
  const unmatched = Object.keys(accts).filter(a => !accountIds.has(a));

  return (
    <Card>
      <CardHead title={`Account matching · ${rows.length} rows across ${Object.keys(accts).length} accounts`}/>
      <div className="card__body">
        <div className="col gap-8 mb-16">
          {Object.entries(accts).map(([acct, n]) => {
            const known = store.accounts.find(a => a.id === acct);
            return (
              <div key={acct} className="row gap-12 items-center" style={{padding: '10px 12px', background: 'var(--paper-3)', borderRadius: 4}}>
                <span className="mono">{acct}</span>
                <span className="small dim">{n} rows</span>
                <div className="grow"/>
                {known
                  ? <span className="row gap-8 items-center"><Tag tone="sage">✓ matched</Tag><span className="small">{known.label}</span></span>
                  : <Tag tone="ochre">⚠ unmatched — will be added</Tag>}
              </div>
            );
          })}
        </div>
        {unmatched.length > 0 && (
          <div className="small dim mb-16">
            {unmatched.length} unrecognized account{unmatched.length===1?'':'s'} will be added to your account list on commit.
          </div>
        )}
        <div className="row gap-8">
          <Btn kind="ghost" onClick={onBack}>← Back</Btn>
          <div className="grow"/>
          <Btn kind="primary" onClick={onNext}>Continue to auto-tag →</Btn>
        </div>
      </div>
    </Card>
  );
}

// ────── Step 3: Preview ──────
function StepPreview({ rows, setRows, onBack, onNext }) {
  const store = useStore();
  const [addingPropRow, setAddingPropRow] = useState(null);
  const auto = rows.filter(r => r.conf >= 80 && !r.duplicate);
  const review = rows.filter(r => r.conf > 0 && r.conf < 80 && !r.duplicate);
  const unknown = rows.filter(r => r.conf === 0 && !r.duplicate);
  const dupes = rows.filter(r => r.duplicate);

  function applyAllSuggestions() {
    setRows(rows.map(r => ({
      ...r,
      category: r.category || r.suggCategory || '',
      project:  r.project  || r.suggProject  || '',
      payee:    r.payee    || r.suggPayee    || '',
    })));
  }
  function applyHighConfidenceOnly() {
    setRows(rows.map(r => r.conf >= 80 ? ({
      ...r,
      category: r.category || r.suggCategory || '',
      project:  r.project  || r.suggProject  || '',
      payee:    r.payee    || r.suggPayee    || '',
    }) : r));
  }
  function clearAllTags() {
    setRows(rows.map(r => ({ ...r, category: '', project: '' })));
  }

  function patchRow(i, patch) {
    const next = rows.slice();
    next[i] = { ...next[i], ...patch };
    setRows(next);
  }
  function acceptAll() {
    setRows(rows.map(r => r.conf > 0 ? { ...r } : r));
  }

  return (
    <React.Fragment>
    <Card>
      <CardHead title="Auto-tag preview" right={
        <div className="row gap-8 items-center">
          <Btn sz="sm" kind="ghost" onClick={clearAllTags}>Clear all tags</Btn>
          <Btn sz="sm" kind="ghost" onClick={applyHighConfidenceOnly}>Apply high-confidence</Btn>
          <Btn sz="sm" onClick={applyAllSuggestions}>Apply all suggestions</Btn>
        </div>
      }/>
      <div className="card__body" style={{padding: 0}}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{width: 30}}></th>
              <th>Date</th>
              <th>Acct</th>
              <th>Description</th>
              <th>Payee</th>
              <th className="num">Amount</th>
              <th>Category</th>
              <th>Property</th>
              <th>Conf.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isLowConf = r.conf < 80;
              return (
                <tr key={i} style={r.duplicate ? {background: 'rgba(148,57,42,0.07)', opacity: 0.7} : isLowConf ? {background: 'rgba(154,102,24,0.05)'} : null}>
                  <td>
                    {r.duplicate
                      ? <input type="checkbox" checked={!r.skip} onChange={() => patchRow(i, {skip: !r.skip})} title="Possible duplicate — check to import anyway"/>
                      : null}
                  </td>
                  <td className="mono small">{fmtDate(r.date)}</td>
                  <td className="mono small dim">{r.acct}</td>
                  <td className="small" style={{maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {r.duplicate && <Tag tone="brick" style={{marginRight: 6}}>dup</Tag>}
                    {r.desc}
                  </td>
                  <td>
                    <input className="input" value={r.payee || ''} onChange={e => patchRow(i, {payee: e.target.value})} placeholder="—" style={{minWidth: 120, fontSize: 12}}/>
                  </td>
                  <td className="num mono" style={{color: r.amount < 0 ? 'var(--brick)' : 'var(--sage)'}}>{fmtMoney(r.amount)}</td>
                  <td>
                    <ManagedSelect listKey="categories" value={r.category} onChange={v => patchRow(i, {category: v})} style={{minWidth: 140, fontSize: 12}}/>
                  </td>
                  <td>
                    <select className="select" value={r.project} style={{minWidth: 140, fontSize: 12}}
                      onChange={e => {
                        if (e.target.value === '__add__') { setAddingPropRow(i); return; }
                        patchRow(i, {project: e.target.value});
                      }}>
                      <option value="">— unassigned —</option>
                      {r.project && r.project !== 'multiple' && !OVERHEAD_PROJECTS.includes(r.project) && !store.properties.some(p => p.address === r.project) && (
                        <option value={r.project}>{r.project}</option>
                      )}
                      <option value="multiple">multiple · split</option>
                      <optgroup label="Overhead">
                        {OVERHEAD_PROJECTS.map(o => <option key={o} value={o}>{o}</option>)}
                      </optgroup>
                      <optgroup label="Properties">
                        {store.properties.map(p => <option key={p.id} value={p.address}>{p.address}</option>)}
                      </optgroup>
                      <option value="__add__">+ Add new property…</option>
                    </select>
                  </td>
                  <td>
                    {r.conf >= 80 ? <Tag tone="sage">{r.conf}%</Tag>
                      : r.conf > 0 ? <Tag tone="ochre">{r.conf}%</Tag>
                      : <Tag tone="brick">—</Tag>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card__body row gap-8" style={{borderTop: '1px solid var(--rule)'}}>
        <Btn kind="ghost" onClick={onBack}>← Back</Btn>
        <div className="grow"/>
        <span className="small dim">Edit any row above before continuing.</span>
        <Btn kind="primary" onClick={onNext}>Continue to commit →</Btn>
      </div>
    </Card>
    {addingPropRow != null && <AddPropertyModal
      onClose={() => setAddingPropRow(null)}
      onCreated={addr => patchRow(addingPropRow, {project: addr})}/>}
    </React.Fragment>
  );
}

// ────── Step 4: Commit ──────
function StepCommit({ rows, onBack, onCommit }) {
  const taggedFull = rows.filter(r => r.category && r.project).length;
  const partial = rows.filter(r => r.category && !r.project).length;
  const untagged = rows.filter(r => !r.category).length;
  return (
    <Card>
      <CardHead title="Ready to commit"/>
      <div className="card__body">
        <div className="grid g-3 mb-16">
          <div style={{padding: '16px 18px', background: 'var(--sage-soft)', borderRadius: 6}}>
            <div className="up" style={{color: 'var(--sage)'}}>Fully tagged</div>
            <div className="serif mt-4" style={{fontSize: 28, color: 'var(--sage)', fontWeight: 500}}>{taggedFull}</div>
            <div className="small mt-2" style={{color: 'var(--ink-2)'}}>category + property</div>
          </div>
          <div style={{padding: '16px 18px', background: 'var(--ochre-soft)', borderRadius: 6}}>
            <div className="up" style={{color: 'var(--ochre)'}}>Partial</div>
            <div className="serif mt-4" style={{fontSize: 28, color: 'var(--ochre)', fontWeight: 500}}>{partial}</div>
            <div className="small mt-2" style={{color: 'var(--ink-2)'}}>category only — will go to triage</div>
          </div>
          <div style={{padding: '16px 18px', background: 'var(--brick-soft)', borderRadius: 6}}>
            <div className="up" style={{color: 'var(--brick)'}}>Untagged</div>
            <div className="serif mt-4" style={{fontSize: 28, color: 'var(--brick)', fontWeight: 500}}>{untagged}</div>
            <div className="small mt-2" style={{color: 'var(--ink-2)'}}>need manual triage</div>
          </div>
        </div>

        <div className="small dim mb-16" style={{lineHeight: 1.6, maxWidth: 600}}>
          Untagged and partial rows will appear in the <a onClick={() => nav('/transactions')} style={{cursor: 'pointer'}}>Transactions</a> triage queue after commit.
          All {rows.length} rows will be added to your ledger and tagged with batch <span className="mono">import-{TODAY()}</span>.
        </div>

        <div className="row gap-8">
          <Btn kind="ghost" onClick={onBack}>← Back to preview</Btn>
          <div className="grow"/>
          <Btn kind="primary" sz="lg" onClick={onCommit}>Commit {rows.length} transactions</Btn>
        </div>
      </div>
    </Card>
  );
}

// ────── Step 5: Done ──────
function StepDone({ count, onAnother }) {
  return (
    <Card accent>
      <div className="card__body" style={{padding: 32, textAlign: 'center'}}>
        <div style={{fontSize: 36, color: 'var(--sage)', marginBottom: 8}}>✓</div>
        <h2 className="serif" style={{margin: 0, fontSize: 24, fontWeight: 500}}>{count} transactions imported</h2>
        <p style={{color: 'var(--ink-2)', maxWidth: 460, margin: '12px auto'}}>
          High-confidence rows are tagged and ready. Anything in the triage queue is waiting in Transactions.
        </p>
        <div className="row gap-8 center" style={{justifyContent: 'center'}}>
          <Btn kind="ghost" onClick={onAnother}>Import another CSV</Btn>
          <Btn onClick={() => nav('/transactions')}>Open transactions →</Btn>
          <Btn kind="primary" onClick={() => nav('/dashboard')}>Back to dashboard</Btn>
        </div>
      </div>
    </Card>
  );
}

window.BankImportScreen = BankImportScreen;
