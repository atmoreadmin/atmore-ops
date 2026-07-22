// screens/contractors.jsx — address book + 1099 prep

function ContractorsScreen() {
  const [view, setView] = useState('book'); // 'book' or 'ten99'

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Contractors</div>
          <h1>{view === 'book' ? 'Address book' : '1099 prep'}</h1>
        </div>
        <Segmented
          value={view}
          options={[{value:'book', label:'Address book'}, {value:'ten99', label:'1099 prep'}]}
          onChange={setView}/>
      </div>

      {view === 'book' ? <AddressBook/> : <Ten99Prep/>}
    </div>
  );
}

// ────── Address book view ──────
function AddressBook() {
  const store = useStore();
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState(() => takeFocus('contractors'));
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sortKey, setSortKey] = useState('ytd');
  const [sortDir, setSortDir] = useState('desc');

  function clickHeader(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'ytd' || key === 'jobs' ? 'desc' : 'asc'); }
  }
  const CB_SORT = {
    name:   c => (c.name || '').toLowerCase(),
    entity: c => ENTITY_LABEL[c.entityType] || '',
    w9:     c => (c.w9OnFile ? 2 : (c.ytd >= 600 || c.isAttorney) ? 0 : 1),
    ytd:    c => c.ytd || 0,
    jobs:   c => c.jobs || 0,
  };
  const Th = ({ k, label, num }) => (
    <th className={num ? 'num' : ''} style={{cursor: 'pointer', userSelect: 'none'}} onClick={() => clickHeader(k)}>
      {label}{sortKey === k && <span style={{marginLeft: 4, color: 'var(--blue)'}}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  const sv = CB_SORT[sortKey] || CB_SORT.ytd;
  const focusSet = focus ? new Set(liveFocusIds(focus)) : null;
  const all = store.contractors
    .filter(c => focusSet ? focusSet.has(c.id) : true)
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.specialty||'').toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => {
      const av = sv(a), bv = sv(b);
      let cmp;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      if (cmp === 0 && sortKey !== 'ytd') cmp = (b.ytd||0) - (a.ytd||0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  const total = all.reduce((a,c) => a + c.ytd, 0);
  const ten99 = store.contractors.filter(c => c.ytd >= 600 && !['scorp','ccorp'].includes(c.entityType));

  return (
    <>
      <Card className="mb-16">
        <div className="row" style={{padding: '4px 0'}}>
          <div className="stat grow">
            <div className="stat__label">Contractors</div>
            <div className="stat__value">{store.contractors.length}</div>
          </div>
          <div className="stat stat--brick grow">
            <div className="stat__label">YTD paid (all)</div>
            <div className="stat__value">{fmtMoney(store.contractors.reduce((a,c)=>a+c.ytd,0))}</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Top contractor</div>
            <div className="stat__value" style={{fontSize: 18}}>{all[0]?.name || '—'}</div>
            <div className="stat__sub">{all[0] ? fmtMoney(all[0].ytd) : ''}</div>
          </div>
          <div className="stat stat--blue grow">
            <div className="stat__label">1099 candidates</div>
            <div className="stat__value">{ten99.length}</div>
            <div className="stat__sub">paid ≥ $600 · non-corp</div>
          </div>
        </div>
      </Card>

      <div className="row gap-16 items-start">
        <Card className="grow">
          <CardHead title={focus ? `Flagged contractors · ${all.length}` : 'All contractors'} right={
            <div className="row gap-8 items-center shrink-0">
              {focus && <Btn sz="sm" kind="ghost" onClick={() => setFocus(null)} style={{whiteSpace: 'nowrap'}}>Show all</Btn>}
              <input className="input" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{minWidth: 160}}/>
              <Btn sz="sm" onClick={() => setAdding(true)} style={{whiteSpace: 'nowrap'}}>+ Add</Btn>
            </div>
          }/>
          <table className="tbl">
            <thead>
              <tr>
                <Th k="name" label="Contractor"/>
                <Th k="entity" label="Entity"/>
                <Th k="w9" label="W-9"/>
                <Th k="ytd" label="YTD" num/>
                <th>Share</th>
                <Th k="jobs" label="Jobs" num/>
              </tr>
            </thead>
            <tbody>
              {all.map(c => {
                const status = ten99Status(c, parseInt(TODAY().slice(0,4)));
                return (
                  <tr key={c.id} onClick={() => setSelected(c.id)} style={selected === c.id ? {background: 'var(--paper-3)'} : null}>
                    <td>
                      <div className="row gap-8 items-center">
                        <Av name={c.name}/>
                        <span className="serif" style={{fontSize: 14, fontWeight: 500}}>{c.name}</span>
                        {c.isAttorney && <Tag tone="ghost">attorney</Tag>}
                      </div>
                    </td>
                    <td><Tag tone={c.entityType === 'unknown' ? 'ochre' : 'ghost'}>{ENTITY_LABEL[c.entityType] || 'Unknown'}</Tag></td>
                    <td>{c.w9OnFile ? <Tag tone="sage">✓ on file</Tag> : (c.ytd >= 600 || c.isAttorney) ? <Tag tone="brick">missing</Tag> : <span className="small dim">—</span>}</td>
                    <td className="num mono">{fmtMoney(c.ytd)}</td>
                    <td><Progress pct={c.ytd / Math.max(total, 1) * 100}/></td>
                    <td className="num mono small">{c.jobs}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <div style={{width: 360, flexShrink: 0}}>
          {(() => {
            const selC = selected ? store.contractors.find(c => c.id === selected) : null;
            return selC ? (
              <ContractorDetail contractor={selC} onEdit={() => setEditing(selected)} onClose={() => setSelected(null)}/>
            ) : (
              <Card>
                <div className="card__body">
                  <Empty title="Select a contractor" sub="Click any row to see jobs, payment history, and 1099 status."/>
                </div>
              </Card>
            );
          })()}
        </div>
      </div>

      <div className="small dim mt-16" style={{maxWidth: 700}}>
        Contractors update automatically as you tag transactions with category <em>Contractor Payment</em>. YTD totals, job counts, and property lists are computed live.
      </div>

      {adding && <ContractorForm onClose={() => setAdding(false)}/>}
      {editing && <ContractorForm contractor={store.contractors.find(c => c.id === editing)} onClose={() => setEditing(null)}/>}
    </>
  );
}

function ContractorDetail({ contractor, onEdit, onClose }) {
  const store = useStore();
  const year = parseInt(TODAY().slice(0,4));
  const status = ten99Status(contractor, year);
  const txs = store.transactions.filter(t => t.payee && t.payee.trim() === contractor.name && t.category === 'Contractor Payment').sort((a,b) => b.date.localeCompare(a.date));
  const byProp = {};
  txs.forEach(t => { if (t.project) byProp[t.project] = (byProp[t.project] || 0) + Math.abs(t.amount); });
  const propList = Object.entries(byProp).sort((a,b) => b[1] - a[1]);

  return (
    <Card>
      <CardHead title={contractor.name} right={<div className="row gap-4"><Btn sz="sm" kind="ghost" onClick={onEdit}>Edit</Btn><Btn sz="sm" kind="ghost" onClick={onClose}>✕</Btn></div>}/>
      <div className="card__body col gap-14">
        <div className="row gap-10 items-start">
          <Av name={contractor.name} size={48}/>
          <div className="grow">
            <div className="serif" style={{fontSize: 18, fontWeight: 500, lineHeight: 1.1}}>{contractor.name}</div>
            <div className="small dim mt-4">{contractor.specialty || 'No specialty set'}</div>
            <div className="row gap-12 mt-8 small">
              <span>📞 {contractor.phone || '—'}</span>
              <span>✉ {contractor.email || '—'}</span>
            </div>
          </div>
        </div>

        <div className="row gap-12" style={{padding: '12px 0', borderTop: '1px solid var(--rule-soft)', borderBottom: '1px solid var(--rule-soft)'}}>
          <div>
            <div className="up dim">YTD paid</div>
            <div className="serif" style={{fontSize: 20, fontWeight: 500, color: 'var(--brick)'}}>{fmtMoney(contractor.ytd)}</div>
          </div>
          <div>
            <div className="up dim">Jobs</div>
            <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{contractor.jobs}</div>
          </div>
          <div>
            <div className="up dim">Avg check</div>
            <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{contractor.jobs ? fmtMoney(Math.round(contractor.ytd / contractor.jobs)) : '—'}</div>
          </div>
        </div>

        {/* 1099 panel */}
        <div style={{padding: 12, background: 'var(--paper-3)', borderRadius: 4}}>
          <div className="row between items-center mb-8">
            <div className="up" style={{color: 'var(--ink-2)'}}>1099 status · tax year {year}</div>
            <Tag tone={ten99StatusTone(status)}>{ten99StatusLabel(status)}</Tag>
          </div>
          <div className="col gap-4 small">
            <div className="row between"><span className="dim">Entity type</span><span>{ENTITY_LABEL[contractor.entityType] || 'Unknown'}{contractor.isAttorney ? ' · attorney' : ''}</span></div>
            <div className="row between"><span className="dim">W-9 on file</span><span>{contractor.w9OnFile ? (contractor.w9Date ? `✓ since ${fmtDate(contractor.w9Date)}` : '✓ yes') : '— no'}</span></div>
            <div className="row between"><span className="dim">TIN / EIN</span><span className="mono">{contractor.tin || '—'}</span></div>
          </div>
          {status === 'w9_missing' && (
            <div className="small mt-8" style={{color: 'var(--brick)', fontWeight: 500}}>⚠ Get a W-9 before next payment.</div>
          )}
          {status === 'ready' && (
            <Btn kind="primary" sz="sm" style={{marginTop: 10, width: '100%'}}
              onClick={() => markTen99Issued(contractor.id, year, TODAY())}>Mark 1099 issued for {year}</Btn>
          )}
          {status === 'issued' && (() => {
            const h = contractor.ten99History.find(h => h.taxYear === year);
            return <div className="small mt-8 dim">Issued {fmtDate(h.issuedDate, {full: true})} · reported {fmtMoney(h.amountReported)}</div>;
          })()}
        </div>

        <div>
          <div className="up dim mb-8">Properties worked · {propList.length}</div>
          <div className="col gap-4">
            {propList.length === 0 ? <div className="small dim">No properties yet</div> :
              propList.slice(0, 6).map(([prop, amt]) => (
                <div key={prop} className="row between items-baseline" style={{paddingBottom: 4, borderBottom: '1px solid var(--rule-soft)'}}>
                  <span className="small" style={{maxWidth: 220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{prop}</span>
                  <span className="mono small">{fmtMoney(amt)}</span>
                </div>
              ))
            }
          </div>
        </div>

        <div>
          <div className="up dim mb-8">Recent payments</div>
          <div className="col gap-4">
            {txs.slice(0, 5).map(t => (
              <div key={t.id} className="row gap-8 items-baseline" style={{paddingBottom: 4, borderBottom: '1px solid var(--rule-soft)'}}>
                <span className="mono tiny dim" style={{width: 50}}>{fmtDate(t.date)}</span>
                <span className="small grow" style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t.desc.slice(0, 30)}</span>
                <span className="mono small" style={{color: 'var(--brick)'}}>{fmtMoney(t.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ContractorForm({ contractor, onClose }) {
  const [name, setName] = useState(contractor?.name || '');
  const [phone, setPhone] = useState(contractor?.phone || '');
  const [email, setEmail] = useState(contractor?.email || '');
  const [specialty, setSpecialty] = useState(contractor?.specialty || '');
  const [entityType, setEntityType] = useState(contractor?.entityType || 'unknown');
  const [w9OnFile, setW9OnFile] = useState(!!contractor?.w9OnFile);
  const [w9Date, setW9Date] = useState(contractor?.w9Date || '');
  const [tin, setTin] = useState(contractor?.tin || '');
  const [mailingAddress, setMailingAddress] = useState(contractor?.mailingAddress || '');
  const [isAttorney, setIsAttorney] = useState(!!contractor?.isAttorney);
  const [paidByCardOnly, setPaidByCardOnly] = useState(!!contractor?.paidByCardOnly);
  const [notes, setNotes] = useState(contractor?.notes || '');
  const editing = !!contractor;

  return (
    <Modal title={editing ? 'Edit contractor' : 'Add contractor'} onClose={onClose}>
      <div className="col gap-12">
        <div>
          <div className="up dim mb-4">Name</div>
          <input className="input" value={name} onChange={e => setName(e.target.value)} style={{width: '100%'}} autoFocus/>
        </div>
        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Phone</div>
            <input className="input" value={phone} onChange={e => setPhone(e.target.value)} style={{width: '100%'}}/>
          </div>
          <div>
            <div className="up dim mb-4">Email</div>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)} style={{width: '100%'}}/>
          </div>
        </div>
        <div>
          <div className="up dim mb-4">Specialty</div>
          <input className="input" value={specialty} onChange={e => setSpecialty(e.target.value)} style={{width: '100%'}}
            placeholder="e.g. Electrician, Drywall, Full GC"/>
        </div>

        <div className="divider" style={{margin: '4px 0'}}/>
        <div className="up dim">For 1099 reporting</div>

        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Entity type</div>
            <select className="select" value={entityType} onChange={e => setEntityType(e.target.value)} style={{width: '100%'}}>
              {ENTITY_OPTS.map(o => <option key={o} value={o}>{ENTITY_LABEL[o]}</option>)}
            </select>
          </div>
          <div>
            <div className="up dim mb-4">TIN / EIN <span className="dim" style={{textTransform:'none', letterSpacing:0}}>(optional)</span></div>
            <input className="input" value={tin} onChange={e => setTin(e.target.value)} style={{width: '100%', fontFamily: 'IBM Plex Mono, monospace'}}
              placeholder="**-***1234"/>
          </div>
        </div>

        <div className="grid g-2 items-end">
          <div>
            <label className="row gap-6 items-center" style={{cursor: 'pointer'}}>
              <input type="checkbox" checked={w9OnFile} onChange={e => setW9OnFile(e.target.checked)}/>
              <span style={{fontSize: 13, fontWeight: 500}}>W-9 on file</span>
            </label>
          </div>
          {w9OnFile && (
            <div>
              <div className="up dim mb-4">W-9 date received</div>
              <input className="input" type="date" value={w9Date} onChange={e => setW9Date(e.target.value)} style={{width: '100%'}}/>
            </div>
          )}
        </div>

        <div className="col gap-6">
          <label className="row gap-6 items-center" style={{cursor: 'pointer'}}>
            <input type="checkbox" checked={isAttorney} onChange={e => setIsAttorney(e.target.checked)}/>
            <span style={{fontSize: 13}}>Attorney <span className="dim">(always needs 1099 ≥ $600, regardless of entity)</span></span>
          </label>
          <label className="row gap-6 items-center" style={{cursor: 'pointer'}}>
            <input type="checkbox" checked={paidByCardOnly} onChange={e => setPaidByCardOnly(e.target.checked)}/>
            <span style={{fontSize: 13}}>Paid by credit card / Venmo Business only <span className="dim">(exempt — processor issues 1099-K)</span></span>
          </label>
        </div>

        <div>
          <div className="up dim mb-4">Mailing address <span className="dim" style={{textTransform:'none', letterSpacing:0}}>(for 1099 form)</span></div>
          <textarea className="input" rows="2" value={mailingAddress} onChange={e => setMailingAddress(e.target.value)} style={{width: '100%'}}/>
        </div>

        <div>
          <div className="up dim mb-4">Notes</div>
          <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} style={{width: '100%'}} rows="2"/>
        </div>

        <div className="row gap-8 mt-8 items-center">
          {editing && (
            <Btn kind="ghost" onClick={() => {
              const hasHistory = (contractor.ytd > 0) || ((contractor.ten99History || []).length > 0);
              const msg = hasHistory
                ? `Delete ${contractor.name}? This removes their contact card, W-9/TIN, and 1099 history. Tagged payments stay on your transactions but will no longer roll up to a contractor.`
                : `Delete ${contractor.name}? This removes their contact card.`;
              if (confirm(msg)) { deleteContractor(contractor.id); onClose(); }
            }} style={{color: 'var(--brick)'}}>Delete</Btn>
          )}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!name} onClick={() => {
            const patch = { name, phone, email, specialty, entityType, w9OnFile, w9Date: w9OnFile ? w9Date : null, tin, mailingAddress, isAttorney, paidByCardOnly, notes };
            if (editing) updateContractor(contractor.id, patch);
            else addContractor(patch);
            onClose();
          }}>{editing ? 'Save' : 'Add contractor'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ────── 1099 Prep view ──────
function Ten99Prep() {
  const store = useStore();
  const [year, setYear] = useState(parseInt(TODAY().slice(0,4)));
  const [editing, setEditing] = useState(null);

  // Group contractors by status for this year
  const byStatus = { w9_missing: [], ready: [], issued: [], exempt_corp: [], exempt_card: [], not_required: [] };
  store.contractors.forEach(c => {
    const s = ten99Status(c, year);
    byStatus[s].push(c);
  });

  const actionNeeded = byStatus.w9_missing.length + byStatus.ready.length;
  const issuedAmt = byStatus.issued.reduce((a,c) => a + (c.ten99History.find(h => h.taxYear === year)?.amountReported || 0), 0);

  return (
    <div>
      <Card className="mb-16">
        <div className="row" style={{padding: '4px 0'}}>
          <div className={'stat grow ' + (byStatus.w9_missing.length ? 'stat--brick' : '')}>
            <div className="stat__label">W-9 missing</div>
            <div className="stat__value">{byStatus.w9_missing.length}</div>
            <div className="stat__sub">paid ≥ $600 but no W-9</div>
          </div>
          <div className={'stat grow ' + (byStatus.ready.length ? '' : '')} style={byStatus.ready.length ? {background: 'var(--ochre-soft)'} : null}>
            <div className="stat__label" style={{color: byStatus.ready.length ? 'var(--ochre)' : null}}>Ready to issue</div>
            <div className="stat__value" style={{color: byStatus.ready.length ? 'var(--ochre)' : null}}>{byStatus.ready.length}</div>
            <div className="stat__sub">have W-9, need 1099</div>
          </div>
          <div className="stat stat--sage grow">
            <div className="stat__label">Issued</div>
            <div className="stat__value">{byStatus.issued.length}</div>
            <div className="stat__sub">{fmtMoney(issuedAmt)} reported</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Exempt</div>
            <div className="stat__value">{byStatus.exempt_corp.length + byStatus.exempt_card.length}</div>
            <div className="stat__sub">corp or card-only</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Tax year</div>
            <div className="row gap-6 items-baseline">
              <Btn sz="sm" kind="ghost" onClick={() => setYear(y => y-1)}>←</Btn>
              <div className="serif" style={{fontSize: 26, fontWeight: 500, fontFeatureSettings: 'tnum'}}>{year}</div>
              <Btn sz="sm" kind="ghost" onClick={() => setYear(y => y+1)}>→</Btn>
            </div>
          </div>
        </div>
      </Card>

      {actionNeeded === 0 && byStatus.issued.length > 0 && (
        <Card accent className="mb-16">
          <div className="card__body row gap-12 items-center" style={{background: 'var(--sage-soft)'}}>
            <div style={{fontSize: 24, color: 'var(--sage)'}}>✓</div>
            <div className="grow">
              <div style={{fontWeight: 500}}>All set for {year}</div>
              <div className="small dim">No outstanding 1099 actions. Filing deadline reminder: Jan 31, {year+1}.</div>
            </div>
          </div>
        </Card>
      )}

      <Ten99Section
        title="W-9 missing — get one before next payment"
        tone="brick"
        contractors={byStatus.w9_missing}
        year={year}
        empty="No contractors are blocked on a missing W-9."
        action={(c) => <Btn sz="sm" kind="ghost" onClick={() => setEditing(c.id)}>Add W-9 →</Btn>}
        emptyTone="sage"
      />

      <Ten99Section
        title="Ready to issue"
        tone="ochre"
        contractors={byStatus.ready}
        year={year}
        empty="Nothing ready to issue right now."
        action={(c) => <Btn sz="sm" kind="primary" onClick={() => markTen99Issued(c.id, year, TODAY())}>Mark issued</Btn>}
        bulk={byStatus.ready.length > 1 ? (
          <Btn sz="sm" onClick={() => byStatus.ready.forEach(c => markTen99Issued(c.id, year, TODAY()))}>Mark all {byStatus.ready.length} issued today</Btn>
        ) : null}
      />

      <Ten99Section
        title="Issued"
        tone="sage"
        contractors={byStatus.issued}
        year={year}
        empty="No 1099s issued yet for this year."
        action={(c) => {
          const h = c.ten99History.find(h => h.taxYear === year);
          return <span className="small dim mono">{fmtDate(h?.issuedDate)}</span>;
        }}
        secondary={(c) => {
          const h = c.ten99History.find(h => h.taxYear === year);
          return <Btn sz="sm" kind="ghost" onClick={() => unmarkTen99Issued(c.id, year)}>Undo</Btn>;
        }}
      />

      <Ten99Section
        title="Exempt — no 1099 needed"
        tone="ghost"
        contractors={[...byStatus.exempt_corp, ...byStatus.exempt_card]}
        year={year}
        collapsed
        empty=""
        action={(c) => <Tag tone="ghost">{c.paidByCardOnly ? 'card payments' : ENTITY_LABEL[c.entityType]}</Tag>}
      />

      <Ten99Section
        title="Under $600 threshold"
        tone="ghost"
        contractors={byStatus.not_required}
        year={year}
        collapsed
        empty=""
      />

      <div className="small dim mt-20" style={{maxWidth: 700, lineHeight: 1.6}}>
        <strong>Filing deadline:</strong> 1099-NEC forms must be issued to recipients and filed with the IRS by January 31, {year+1}. Edit any contractor to update their entity type, W-9 status, or TIN.
      </div>

      {editing && <ContractorForm contractor={store.contractors.find(c => c.id === editing)} onClose={() => setEditing(null)}/>}
    </div>
  );
}

function Ten99Section({ title, tone, contractors, year, empty, action, secondary, bulk, collapsed }) {
  const [open, setOpen] = useState(!collapsed);
  if (contractors.length === 0 && !empty) return null;
  return (
    <Card className="mb-12">
      <div className="card__head" style={{cursor: collapsed ? 'pointer' : 'default'}} onClick={() => collapsed && setOpen(v => !v)}>
        <div className="row gap-8 items-center">
          <h3 className="serif" style={{fontSize: 16, fontWeight: 500, margin: 0}}>{title}</h3>
          <Tag tone={tone}>{contractors.length}</Tag>
          {collapsed && <span className="dim small">{open ? '▴' : '▾'}</span>}
        </div>
        {bulk}
      </div>
      {open && (
        contractors.length === 0 ? (
          empty && <div className="card__body"><div className="small dim">{empty}</div></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Contractor</th>
                <th>Entity</th>
                <th className="num">YTD paid</th>
                <th>TIN</th>
                <th style={{width: 160, whiteSpace: 'nowrap'}}></th>
                <th style={{width: 80}}></th>
              </tr>
            </thead>
            <tbody>
              {contractors.sort((a,b) => b.ytd - a.ytd).map(c => (
                <tr key={c.id}>
                  <td>
                    <div className="row gap-8 items-center">
                      <Av name={c.name}/>
                      <span className="serif" style={{fontSize: 14, fontWeight: 500}}>{c.name}</span>
                      {c.isAttorney && <Tag tone="ghost">attorney</Tag>}
                    </div>
                  </td>
                  <td className="small">{ENTITY_LABEL[c.entityType]}</td>
                  <td className="num mono">{fmtMoney(c.ytd)}</td>
                  <td className="mono small dim">{c.tin || '—'}</td>
                  <td style={{whiteSpace: 'nowrap'}}>{action && action(c)}</td>
                  <td style={{whiteSpace: 'nowrap'}}>{secondary && secondary(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </Card>
  );
}

window.ContractorsScreen = ContractorsScreen;
