// screens/transactions.jsx — table+filters PLUS editable auto-tag rules sidebar

// Special project-resolution tokens shown in the rule editor.
const PROJECT_TOKENS = [
  { value: '',              label: 'Leave blank' },
  { value: 'extract',       label: 'Auto-detect property from description' },
  { value: 'extract-zelle', label: 'Extract Zelle sender as tenant' },
  { value: 'multiple',      label: 'Multiple (split across properties)' },
];
const PROJECT_TOKEN_LABEL = PROJECT_TOKENS.reduce((m, t) => { if (t.value) m[t.value] = t.label; return m; }, {});

// Column sort accessors. Splits sort to the end of category/property groupings.
const TX_SORT = {
  date:     t => t.date || '',
  acct:     t => t.acct || '',
  desc:     t => (t.desc || '').toLowerCase(),
  payee:    t => (t.payee || '').toLowerCase(),
  amount:   t => t.amount || 0,
  category: t => (t.splits && t.splits.length) ? '\uffff' : (t.category || '\ufffe'),
  project:  t => (t.splits && t.splits.length) ? 'multiple' : (t.project || '\ufffe'),
};

// Columns available on the main transactions table. `always` columns can't be hidden;
// mirrors the Properties-list column model so the two tables behave the same way.
const TX_LIST_COLUMNS = [
  { key: 'date',     label: 'Date',        always: true },
  { key: 'acct',     label: 'Acct' },
  { key: 'desc',     label: 'Description', always: true },
  { key: 'payee',    label: 'Payee' },
  { key: 'amount',   label: 'Amount', num: true, always: true },
  { key: 'category', label: 'Category' },
  { key: 'project',  label: 'Property' },
];
const TX_LIST_COLS_KEY = 'atmore-tx-list-columns-v1';

function TransactionsScreen() {
  const store = useStore();
  const rules = getAutoTagRules();
  const [search, setSearch] = useState('');
  const [acctFilter, setAcctFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [onlyUntagged, setOnlyUntagged] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [txFocus, setTxFocus] = useState(() => takeFocus('transactions'));
  const txFocusSet = txFocus ? new Set(liveFocusIds(txFocus)) : null;
  const [splitting, setSplitting] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [editingRule, setEditingRule] = useState(null);
  const [addingRule, setAddingRule] = useState(false);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState(() => {
    try { const saved = localStorage.getItem(TX_LIST_COLS_KEY); if (saved) return JSON.parse(saved); } catch (e) {}
    return TX_LIST_COLUMNS.map(c => c.key);
  });
  const showCol = key => visibleCols.includes(key);
  function toggleCol(key) {
    const col = TX_LIST_COLUMNS.find(c => c.key === key);
    if (col?.always) return;
    const next = visibleCols.includes(key) ? visibleCols.filter(k => k !== key) : [...visibleCols, key];
    setVisibleCols(next);
    localStorage.setItem(TX_LIST_COLS_KEY, JSON.stringify(next));
  }
  function resetCols() {
    const next = TX_LIST_COLUMNS.map(c => c.key);
    setVisibleCols(next);
    localStorage.setItem(TX_LIST_COLS_KEY, JSON.stringify(next));
  }

  function clickHeader(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'date' || key === 'amount' ? 'desc' : 'asc'); }
  }

  // Filter
  let rows = store.transactions.slice();
  rows = rows.filter(t => {
    if (txFocusSet) return txFocusSet.has(t.id);
    if (acctFilter !== 'all' && t.acct !== acctFilter) return false;
    if (catFilter !== 'all' && t.category !== catFilter) return false;
    if (onlyUntagged && t.category && t.project) return false;
    if (showSelectedOnly && !selected.has(t.id)) return false;
    if (search) {
      const hay = `${t.desc} ${t.payee} ${t.category} ${t.project}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  const sv = TX_SORT[sortKey] || TX_SORT.date;
  rows.sort((a,b) => {
    const av = sv(a), bv = sv(b);
    let cmp;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    if (cmp === 0 && sortKey !== 'date') cmp = (a.date || '').localeCompare(b.date || '');
    return sortDir === 'asc' ? cmp : -cmp;
  });
  const filteredIds = rows.map(r => r.id);   // every match (before the display cap)
  const filteredCount = filteredIds.length;
  rows = rows.slice(0, 100); // cap for performance

  const Th = ({ k, label, num }) => (
    <th className={num ? 'num' : ''} style={{cursor: 'pointer', userSelect: 'none'}} onClick={() => clickHeader(k)}>
      {label}{sortKey === k && <span style={{marginLeft: 4, color: 'var(--blue)'}}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  function toggleRow(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (rows.every(r => selected.has(r.id))) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  }
  function selectAllMatching() { setSelected(new Set(filteredIds)); }
  function clearSelection() { setSelected(new Set()); setShowSelectedOnly(false); }
  function viewSelected() {
    // Clear other filters so every selected row is guaranteed to show.
    setSearch(''); setAcctFilter('all'); setCatFilter('all'); setOnlyUntagged(false);
    setShowSelectedOnly(true);
  }
  const selectedVisible = rows.filter(r => selected.has(r.id)).length;
  const selectedHidden = selected.size - selectedVisible;
  const allSel = rows.length > 0 && rows.every(r => selected.has(r.id));
  const someSel = rows.some(r => selected.has(r.id)) && !allSel;
  const allMatchingSel = filteredCount > 0 && filteredIds.every(id => selected.has(id));
  const moreBeyondShown = filteredCount > rows.length;

  const categories = ['all', ...new Set(store.transactions.map(t => t.category).filter(Boolean))];
  const untaggedTotal = untaggedTransactions().length;

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Transactions</div>
          <h1>Unified ledger · {store.transactions.length} entries</h1>
        </div>
        <div className="row gap-8">
          <Btn kind="ghost" sz="sm" onClick={() => {
            // Flatten splits inline
            const flat = [];
            store.transactions.forEach(t => {
              if (t.splits && t.splits.length) {
                t.splits.forEach((s, i) => {
                  flat.push({ ...t, amount: s.amount, category: s.category, project: s.project, splitOf: t.id + ' (' + (i+1) + '/' + t.splits.length + ')' });
                });
              } else {
                flat.push({ ...t, splitOf: '' });
              }
            });
            downloadCSV('transactions.csv', flat, [
              { key: 'date', label: 'Date' },
              { key: 'acct', label: 'Account' },
              { key: 'desc', label: 'Description' },
              { key: 'payee', label: 'Payee' },
              { key: 'amount', label: 'Amount' },
              { key: 'category', label: 'Category' },
              { key: 'project', label: 'Property' },
              { key: 'splitOf', label: 'Split of' },
            ]);
          }}>⤓ Export CSV</Btn>
          <Btn kind="ghost" sz="sm" onClick={() => setAdding(true)}>+ Add manual</Btn>
          <Btn kind="primary" sz="sm" onClick={() => nav('/bank-import')}>⤓ Bank import</Btn>
        </div>
      </div>

      <div className="row gap-16 items-start">
        {/* main */}
        <div className="grow col gap-16" style={{minWidth: 0}}>
          <Card>
            {txFocus ? (
              <div className="card__body row gap-12 items-center wrap" style={{background: txFocusSet && txFocusSet.size === 0 ? 'rgba(74,122,86,0.08)' : 'rgba(154,102,24,0.06)', borderLeft: '3px solid ' + (txFocusSet && txFocusSet.size === 0 ? 'var(--sage-deep, var(--sage))' : 'var(--ochre)')}}>
                {txFocusSet && txFocusSet.size === 0 ? (
                  <span style={{fontWeight: 500}}>✓ All flagged transactions resolved</span>
                ) : (
                  <span style={{fontWeight: 500}}>Showing {txFocusSet.size} flagged transaction{txFocusSet.size === 1 ? '' : 's'}{txFocusSet.size > rows.length ? ` · first ${rows.length} below` : ''}</span>
                )}
                <span className="small dim" style={{textWrap: 'pretty'}}>— {txFocus.label}</span>
                <div className="grow"/>
                <Btn sz="sm" kind="ghost" onClick={() => setTxFocus(null)}>Show all transactions</Btn>
              </div>
            ) : (
            <div className="card__body row gap-12 items-center wrap">
              <input className="input" placeholder="Search description, payee, category…" value={search} onChange={e => setSearch(e.target.value)} style={{flex: '1 1 240px'}}/>
              <select className="select" value={acctFilter} onChange={e => setAcctFilter(e.target.value)}>
                <option value="all">All accounts</option>
                {store.accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <select className="select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
              </select>
              <Tag tone={onlyUntagged ? 'solid-brick' : 'ghost'} style={{cursor: 'pointer'}}>
                <span onClick={() => setOnlyUntagged(v => !v)}>
                  {onlyUntagged ? '✓ ' : ''}Untagged only ({untaggedTotal})
                </span>
              </Tag>
              <div className="grow"/>
              <div style={{position: 'relative'}}>
                <Btn sz="sm" kind="ghost" onClick={() => setColumnsOpen(v => !v)}>Columns ▾</Btn>
                {columnsOpen && (
                  <>
                    <div onClick={() => setColumnsOpen(false)} style={{position: 'fixed', inset: 0, zIndex: 40}}/>
                    <div style={{position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 41, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, boxShadow: '0 6px 24px rgba(28,26,20,0.15)', minWidth: 200, padding: '6px 0'}}>
                      <div className="row between items-center" style={{padding: '6px 14px', borderBottom: '1px solid var(--rule)'}}>
                        <span className="up dim">Columns</span>
                        <button onClick={resetCols} className="tiny" style={{background: 'transparent', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit'}}>Reset</button>
                      </div>
                      {TX_LIST_COLUMNS.map(c => {
                        const isOn = visibleCols.includes(c.key);
                        return (
                          <label key={c.key} className="row gap-8 items-center"
                            style={{padding: '6px 14px', cursor: c.always ? 'default' : 'pointer', opacity: c.always ? 0.6 : 1, fontSize: 13}}
                            onMouseOver={e => { if (!c.always) e.currentTarget.style.background = 'var(--paper-3)'; }}
                            onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                            <input type="checkbox" checked={isOn} disabled={c.always} onChange={() => toggleCol(c.key)}/>
                            <span>{c.label}</span>
                            {c.always && <span className="tiny dim" style={{marginLeft: 'auto'}}>required</span>}
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              <span className="small dim">Showing {rows.length}</span>
            </div>
            )}
          </Card>

          <Card className="pad-0">
            {selected.size > 0 && (
              <div className="row items-center gap-10" style={{padding: '8px 14px', background: 'var(--blue-tint)', borderBottom: '1px solid var(--rule-soft)', fontSize: 12.5}}>
                <span style={{fontWeight: 600, color: 'var(--blue-deep)'}}>{selected.size} selected</span>
                {!showSelectedOnly && selectedHidden > 0 && (
                  <React.Fragment>
                    <span className="dim">— {selectedVisible > 0 ? `${selectedVisible} shown, ` : ''}{selectedHidden} not on this screen.</span>
                    <button onClick={viewSelected}
                      style={{background: 'transparent', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline', padding: 0}}>
                      View selected
                    </button>
                  </React.Fragment>
                )}
                {showSelectedOnly && (
                  <React.Fragment>
                    <span className="dim">— showing only selected.</span>
                    <button onClick={() => setShowSelectedOnly(false)}
                      style={{background: 'transparent', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline', padding: 0}}>
                      Show all
                    </button>
                  </React.Fragment>
                )}
                {!showSelectedOnly && allSel && moreBeyondShown && !allMatchingSel && (
                  <React.Fragment>
                    <span className="dim">— only the {rows.length} shown.</span>
                    <button onClick={selectAllMatching}
                      style={{background: 'transparent', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline', padding: 0}}>
                      Select all {filteredCount} matching
                    </button>
                  </React.Fragment>
                )}
                {!showSelectedOnly && allMatchingSel && moreBeyondShown && (
                  <span className="dim">— all {filteredCount} matching transactions selected.</span>
                )}
                <div className="grow"/>
                <button onClick={clearSelection}
                  style={{background: 'transparent', border: 'none', color: 'var(--blue-deep)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5}}>Clear</button>
              </div>
            )}
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width: 30}}>
                    <input type="checkbox" checked={allSel} title="Select all shown" ref={el => { if (el) el.indeterminate = someSel; }} onChange={toggleAll}/>
                  </th>
                  <Th k="date" label="Date"/>
                  {showCol('acct') && <Th k="acct" label="Acct"/>}
                  <Th k="desc" label="Description"/>
                  {showCol('payee') && <Th k="payee" label="Payee"/>}
                  <Th k="amount" label="Amount" num/>
                  {showCol('category') && <Th k="category" label="Category"/>}
                  {showCol('project') && <Th k="project" label="Property"/>}
                  <th style={{width: 130}}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const untagged = !t.category || !t.project;
                  const suggestion = autoSuggest(t);
                  const isSel = selected.has(t.id);
                  const isSplit = t.splits && t.splits.length > 0;
                  const isExp = expanded.has(t.id);
                  return (
                    <React.Fragment key={t.id}>
                    <tr
                      style={isSel ? {background: 'var(--blue-tint)'} : isSplit ? {background: 'rgba(52,99,127,0.05)'} : untagged ? {background: 'rgba(154,102,24,0.04)'} : null}
                      onClick={(e) => { if (e.target.type === 'checkbox' || e.target.tagName === 'BUTTON') return; toggleRow(t.id); }}>
                      <td><input type="checkbox" checked={isSel} onChange={() => toggleRow(t.id)}/></td>
                      <td className="mono small">{fmtDate(t.date)}</td>
                      {showCol('acct') && <td className="mono small dim">{t.acct}</td>}
                      <td className="small" style={{maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{t.desc}</td>
                      {showCol('payee') && <td className="small dim">{t.payee || '—'}</td>}
                      <td className="num mono" style={{color: t.amount < 0 ? 'var(--brick)' : 'var(--sage)'}}>{fmtMoney(t.amount)}</td>
                      {showCol('category') && <td>
                        {isSplit ? <Tag tone="blue">{t.splits.length} splits</Tag>
                          : t.category ? <Tag tone="ghost">{t.category}</Tag>
                          : <Tag tone="ochre" title={`Suggestion: ${suggestion.category}`}>{suggestion.category ? `?  ${suggestion.category}` : '?  unknown'}</Tag>}
                      </td>}
                      {showCol('project') && <td>
                        {isSplit ? (
                          <button onClick={() => { const n = new Set(expanded); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setExpanded(n); }}
                            style={{background: 'transparent', border: '1px solid var(--blue-soft)', color: 'var(--blue-deep)', borderRadius: 999, padding: '2px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 500}}>
                            multiple · {isExp ? '▴' : '▾'}
                          </button>
                        ) : t.project ? (
                          t.project === 'multiple' ? <Tag tone="blue">multiple</Tag> : <Tag tone="blue">{t.project}</Tag>
                        ) : <Tag tone="ochre">{suggestion.project ? `?  ${suggestion.project}` : '?  unassigned'}</Tag>}
                      </td>}
                      <td>
                        <div className="row gap-4">
                          <Btn sz="sm" kind="ghost" onClick={(e) => { e.stopPropagation(); setEditing(t); }}>Edit</Btn>
                          <Btn sz="sm" kind="ghost" onClick={(e) => { e.stopPropagation(); setSplitting(t); }}>{isSplit ? 'Split…' : 'Split'}</Btn>
                        </div>
                      </td>
                    </tr>
                    {isSplit && isExp && t.splits.map((sp, idx) => (
                      <tr key={t.id + '-s' + idx} style={{background: 'var(--paper-3)'}}>
                        <td></td>
                        <td></td>
                        {showCol('acct') && <td></td>}
                        <td className="small dim" style={{paddingLeft: 28}}>↳ split</td>
                        {showCol('payee') && <td></td>}
                        <td className="num mono small" style={{color: sp.amount < 0 ? 'var(--brick)' : 'var(--sage)'}}>{fmtMoney(sp.amount)}</td>
                        {showCol('category') && <td><Tag tone="ghost">{sp.category || '—'}</Tag></td>}
                        {showCol('project') && <td className="small dim">↳ {sp.project}</td>}
                        <td></td>
                      </tr>
                    ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (txFocus
              ? <div className="card__body"><Empty icon="✓" title="Nothing left to review" sub="Every flagged transaction has been corrected. Use “Show all transactions” to return to the full ledger."/></div>
              : <div className="card__body"><Empty title="No transactions match" sub="Try clearing filters."/></div>)}
          </Card>
        </div>

        {/* sidebar — auto-tag rules + recently tagged */}
        <div className="col gap-16" style={{width: 320, flexShrink: 0}}>
          <Card accent>
            <CardHead title="Auto-tag rules" right={
              <div className="row gap-6 items-center">
                <Tag tone="ghost">{rules.length}</Tag>
                <Btn sz="sm" kind="ghost" onClick={() => setAddingRule(true)}>+ Add</Btn>
              </div>}/>
            <div className="card__body">
              <div className="small dim mb-12">Applied to new imports top-to-bottom — the first match wins, and you confirm the rest. Drag priority with the arrows.</div>
              <div className="col gap-8">
                {rules.length === 0 && <div className="small dim">No rules yet. Add one to auto-suggest categories on import.</div>}
                {rules.map((r, i) => (
                  <div key={r.id} className="col" style={{padding: '8px 10px', background: 'var(--paper-3)', borderRadius: 4, fontSize: 12}}>
                    <div className="row gap-6 items-center between">
                      <div className="row gap-6 items-center" style={{minWidth: 0}}>
                        <span className="mono tiny dim">match</span>
                        <span className="mono" style={{fontSize: 11, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{r.pattern}</span>
                      </div>
                      <div className="row gap-2 items-center shrink-0">
                        <button title="Move up" disabled={i === 0} onClick={() => moveAutoTagRule(r.id, -1)} style={{background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--ink-3)' : 'var(--ink-2)', padding: '0 2px', fontSize: 11}}>▲</button>
                        <button title="Move down" disabled={i === rules.length - 1} onClick={() => moveAutoTagRule(r.id, 1)} style={{background: 'none', border: 'none', cursor: i === rules.length - 1 ? 'default' : 'pointer', color: i === rules.length - 1 ? 'var(--ink-3)' : 'var(--ink-2)', padding: '0 2px', fontSize: 11}}>▼</button>
                      </div>
                    </div>
                    <div className="row gap-6 items-center mt-4">
                      <span className="mono tiny dim">→ cat</span>
                      <span style={{color: 'var(--blue)', fontWeight: 500}}>{r.category}</span>
                      {r.conf != null && <span className="mono tiny dim">· {r.conf}%</span>}
                    </div>
                    {r.payee && (
                      <div className="row gap-6 items-center">
                        <span className="mono tiny dim">→ payee</span>
                        <span style={{color: 'var(--blue)'}}>{r.payee}</span>
                      </div>
                    )}
                    {r.project && (
                      <div className="row gap-6 items-center">
                        <span className="mono tiny dim">→ proj</span>
                        <span style={{color: 'var(--blue)'}}>{PROJECT_TOKEN_LABEL[r.project] || r.project}</span>
                      </div>
                    )}
                    <div className="row gap-10 items-center mt-6">
                      <button onClick={() => setEditingRule(r.id)} style={{background: 'none', border: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', font: 'inherit', fontSize: 11}}>Edit</button>
                      <button onClick={() => { if (confirm('Delete this rule?')) deleteAutoTagRule(r.id); }} style={{background: 'none', border: 'none', padding: 0, color: 'var(--brick)', cursor: 'pointer', font: 'inherit', fontSize: 11}}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row mt-12">
                <button onClick={() => { if (confirm('Reset auto-tag rules to the built-in defaults? Your custom rules will be lost.')) resetAutoTagRules(); }} style={{background: 'none', border: 'none', padding: 0, color: 'var(--ink-3)', cursor: 'pointer', font: 'inherit', fontSize: 11, textDecoration: 'underline'}}>Reset to defaults</button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Recently tagged"/>
            <div className="card__body col gap-6">
              {store.transactions.filter(t => t.category && t.project).slice(0, 8).map(t => (
                <div key={t.id} className="col" style={{paddingBottom: 6, borderBottom: '1px solid var(--rule-soft)'}}>
                  <div className="row gap-6 items-baseline">
                    <span className="mono tiny dim">{fmtDate(t.date)}</span>
                    <span className="small grow" style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{t.desc.slice(0, 36)}</span>
                  </div>
                  <div className="row gap-6 items-center mt-2">
                    <Tag tone="ghost">{t.category}</Tag>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      {selected.size > 0 && <BulkActionBar selectedIds={[...selected]} onClear={clearSelection}/>}
      {splitting && <SplitTransactionModal tx={splitting} onClose={() => setSplitting(null)}/>}
      {editing && <TransactionEditor tx={editing} onClose={() => setEditing(null)}/>}
      {adding && <TransactionEditor onClose={() => setAdding(false)}/>}
      {addingRule && <AutoTagRuleEditor onClose={() => setAddingRule(false)}/>}
      {editingRule && <AutoTagRuleEditor rule={getAutoTagRules().find(r => r.id === editingRule)} onClose={() => setEditingRule(null)}/>}
    </div>
  );
}

function BulkActionBar({ selectedIds, onClear }) {
  const store = useStore();
  const [showCat, setShowCat] = useState(false);
  const [showProj, setShowProj] = useState(false);
  const [cat, setCat] = useState('');
  const [proj, setProj] = useState('');

  const total = store.transactions
    .filter(t => selectedIds.includes(t.id))
    .reduce((a,t) => a + t.amount, 0);

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--ink)', color: 'white',
      padding: '10px 16px', borderRadius: 8,
      boxShadow: '0 8px 24px rgba(28,26,20,0.3)',
      display: 'flex', alignItems: 'center', gap: 16,
      zIndex: 50, fontSize: 13,
    }}>
      <span style={{fontWeight: 600}}>{selectedIds.length} selected</span>
      <span style={{color: 'var(--ink-4)'}}>·</span>
      <span className="mono" style={{color: total < 0 ? '#e9a59a' : '#a9c098'}}>Net {fmtMoney(total, {sign: true})}</span>
      <span style={{color: 'var(--ink-4)'}}>·</span>

      <select className="select" style={{background: 'var(--ink-2)', color: 'white', borderColor: 'var(--ink-3)'}}
        value={cat} onChange={e => setCat(e.target.value)}>
        <option value="">Set category…</option>
        {getList('categories').map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
      </select>
      {cat && <button onClick={() => { bulkTagTransactions(selectedIds, {category: cat}); setCat(''); }}
        style={{background: 'var(--blue)', color: 'white', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 500}}>Apply</button>}

      <select className="select" style={{background: 'var(--ink-2)', color: 'white', borderColor: 'var(--ink-3)'}}
        value={proj} onChange={e => setProj(e.target.value)}>
        <option value="">Set property…</option>
        <option value="multiple">multiple · split</option>
        {OVERHEAD_PROJECTS.map(o => <option key={o} value={o}>{o}</option>)}
        {store.properties.map(p => <option key={p.id} value={p.address}>{p.address}</option>)}
      </select>
      {proj && <button onClick={() => { bulkTagTransactions(selectedIds, {project: proj}); setProj(''); }}
        style={{background: 'var(--blue)', color: 'white', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 500}}>Apply</button>}

      <span style={{color: 'var(--ink-4)'}}>·</span>
      <button onClick={() => { if (confirm(`Delete ${selectedIds.length} transactions?`)) { bulkDeleteTransactions(selectedIds); onClear(); } }}
        style={{background: 'transparent', color: '#e9a59a', border: '1px solid #e9a59a', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 500}}>Delete</button>
      <button onClick={onClear}
        style={{background: 'transparent', color: 'var(--ink-4)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, marginLeft: 4}}>Clear</button>
    </div>
  );
}

function autoSuggest(t) {
  for (const r of getAutoTagRules()) {
    const re = compileAutoTagRule(r);
    if (re && re.test(t.desc)) {
      let project = r.project;
      if (project === 'extract') {
        // Try find a property keyword in the description
        const prop = Store.state.properties.find(p =>
          t.desc.toLowerCase().includes(p.address.split(/\s+/)[0].toLowerCase() + ' ' + (p.address.split(/\s+/)[1] || '').toLowerCase().slice(0,3))
        );
        project = prop ? prop.address : '';
      } else if (project === 'extract-zelle') {
        const m = t.desc.match(/zelle payment from\s+([A-Z\s]+?)\s+(for|conf)/i);
        if (m) project = 'tenant: ' + m[1].trim();
        else project = '';
      }
      return { category: r.category, project };
    }
  }
  return { category: '', project: '' };
}

// ────── Auto-tag rule editor ──────
function AutoTagRuleEditor({ rule, onClose }) {
  const editing = !!rule;
  const store = useStore();
  const [pattern, setPattern] = useState(rule?.pattern || '');
  const [category, setCategory] = useState(rule?.category || '');
  const [payee, setPayee] = useState(rule?.payee || '');
  const [conf, setConf] = useState(rule?.conf != null ? rule.conf : 80);
  const isTokenProj = !rule || rule.project === '' || PROJECT_TOKENS.some(t => t.value === rule.project);
  const [projMode, setProjMode] = useState(isTokenProj ? (rule?.project || '') : 'specific');
  const [specificProp, setSpecificProp] = useState(isTokenProj ? '' : (rule?.project || ''));

  // Validate the regex live.
  let regexError = '';
  try { new RegExp(pattern, 'i'); } catch (e) { regexError = e.message; }
  const sampleHits = pattern && !regexError
    ? store.transactions.filter(t => { try { return new RegExp(pattern, 'i').test(t.desc); } catch (e) { return false; } }).slice(0, 3)
    : [];

  function save() {
    const project = projMode === 'specific' ? specificProp : projMode;
    const payload = { pattern: pattern.trim(), category, payee: payee.trim(), project, conf: Number(conf) };
    if (editing) updateAutoTagRule(rule.id, payload);
    else addAutoTagRule(payload);
    onClose();
  }

  return (
    <Modal title={editing ? 'Edit auto-tag rule' : 'New auto-tag rule'} onClose={onClose}>
      <div className="col gap-12">
        <div>
          <div className="up dim mb-4">Match pattern <span className="dim" style={{textTransform: 'none', letterSpacing: 0}}>(matched against the transaction description, case-insensitive)</span></div>
          <input className="input mono" value={pattern} onChange={e => setPattern(e.target.value)} autoFocus placeholder="e.g. lowes|home depot" style={{width: '100%'}}/>
          {regexError
            ? <div className="tiny mt-4" style={{color: 'var(--brick)'}}>Invalid pattern: {regexError}</div>
            : <div className="tiny dim mt-4">Use <span className="mono">|</span> for “or” (e.g. <span className="mono">amazon|amzn</span>). Plain text works too.</div>}
        </div>
        <div>
          <div className="up dim mb-4">Category</div>
          <ManagedSelect listKey="categories" value={category} onChange={setCategory} style={{width: '100%'}}/>
        </div>
        <div>
          <div className="up dim mb-4">Payee <span className="dim" style={{textTransform: 'none', letterSpacing: 0}}>(optional — the merchant/person this maps to)</span></div>
          <input className="input" value={payee} onChange={e => setPayee(e.target.value)} placeholder="e.g. Lowe's, Duke Energy" style={{width: '100%'}}/>
          <div className="tiny dim mt-4">Leave blank to auto-derive the payee from the description on import.</div>
        </div>
        <div>
          <div className="up dim mb-4">Property / project</div>
          <select className="select" value={projMode} onChange={e => setProjMode(e.target.value)} style={{width: '100%'}}>
            {PROJECT_TOKENS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            <option value="specific">A specific property…</option>
          </select>
          {projMode === 'specific' && (
            <select className="select mt-8" value={specificProp} onChange={e => setSpecificProp(e.target.value)} style={{width: '100%'}}>
              <option value="">— pick property —</option>
              {store.properties.map(p => <option key={p.id} value={p.address}>{p.address}</option>)}
            </select>
          )}
        </div>
        <div>
          <div className="row between items-baseline mb-4">
            <div className="up dim">Confidence</div>
            <div className="mono small">{conf}%</div>
          </div>
          <input type="range" min="0" max="99" value={conf} onChange={e => setConf(e.target.value)} style={{width: '100%'}}/>
          <div className="tiny dim mt-4">Higher = stronger suggestion on import. It never auto-commits — you still confirm every row.</div>
        </div>
        {pattern && !regexError && (
          <div style={{padding: '10px 12px', background: 'var(--paper-3)', borderRadius: 6, border: '1px solid var(--rule)'}}>
            <div className="up dim mb-4">Preview · {sampleHits.length ? 'matches in your data' : 'no current matches'}</div>
            {sampleHits.map(t => (
              <div key={t.id} className="small mono" style={{color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{t.desc.slice(0, 48)}</div>
            ))}
          </div>
        )}
        <div className="row gap-8 mt-8">
          {editing && <Btn kind="danger" sz="sm" onClick={() => { if (confirm('Delete this rule?')) { deleteAutoTagRule(rule.id); onClose(); } }}>Delete</Btn>}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!pattern.trim() || !category || !!regexError} onClick={save}>{editing ? 'Save rule' : 'Add rule'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

Object.assign(window, { AutoTagRuleEditor });

window.TransactionsScreen = TransactionsScreen;