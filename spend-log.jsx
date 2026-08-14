// screens/spend-log.jsx — real-time register of money going out: checks written
// and phone sales (vendor purchases authorized by phone). Deliberately separate
// from the books: nothing here posts to reports, P&L or property costs.

const SPEND_RANGE_KEY = 'atmore-spend-range-v1';
const SPEND_SORT_KEY = 'atmore-spend-sort-v1';
const SPEND_PAYEE_KEY = 'atmore-spend-payees-v1';

function SpendLogScreen() {
  useStore();
  const today = TODAY();
  const [range, setRange] = useState(() => localStorage.getItem(SPEND_RANGE_KEY) || 'today');
  const [custom, setCustom] = useState({ from: addDaysISO(today, -30), to: today });
  const [adding, setAdding] = useState(null);
  const [summary, setSummary] = useState(false);
  // Sort choice sticks per person, same as the range filter — a coworker who works the
  // log by check number shouldn't have to re-pick it every visit.
  const [payeeSel, setPayeeSel] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SPEND_PAYEE_KEY) || 'null');
      if (Array.isArray(raw)) return new Set(raw.filter(x => typeof x === 'string'));
    } catch (e) {}
    return new Set();
  });
  const [payeeOpen, setPayeeOpen] = useState(false);
  const [payeeSearch, setPayeeSearch] = useState('');
  const [sort, setSort] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SPEND_SORT_KEY) || 'null');
      if (raw && typeof raw.key === 'string') return { key: raw.key, dir: raw.dir === 'asc' ? 'asc' : 'desc' };
    } catch (e) {}
    return { key: 'date', dir: 'desc' };
  });

  function setRangeP(v) { setRange(v); localStorage.setItem(SPEND_RANGE_KEY, v); }
  function setPayeeSelP(next) {
    setPayeeSel(next);
    try { localStorage.setItem(SPEND_PAYEE_KEY, JSON.stringify([...next])); } catch (e) {}
  }
  function togglePayee(name) {
    const next = new Set(payeeSel);
    if (next.has(name)) next.delete(name); else next.add(name);
    setPayeeSelP(next);
  }
  function clickHeader(key) {
    setSort(s => {
      // Second click on the same column reverses it; a new column starts in the
      // direction that's useful first — biggest money and newest dates at the top.
      const next = s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: (key === 'amount' || key === 'date' || key === 'ref') ? 'desc' : 'asc' };
      try { localStorage.setItem(SPEND_SORT_KEY, JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }

  const bounds = range === 'today' ? { from: today, to: today }
    : range === 'week' ? { from: weekStartISO(today), to: weekEndISO(today) }
    : { from: custom.from, to: custom.to };

  const rangeEntries = spendEntries(bounds.from, bounds.to);
  // An em dash reads fine inside a column, but not as a filter option or a chip.
  const payeeKey = e => { const n = spendPayeeName(e); return (!n || n === '—') ? '(no payee)' : n; };
  // Every payee in the range with its own count and total, so the filter doubles as a
  // per-vendor readout — the usual question is "how much went to this vendor".
  const payeeStats = [];
  rangeEntries.forEach(e => {
    const name = payeeKey(e);
    let p = payeeStats.find(x => x.name === name);
    if (!p) { p = { name, count: 0, total: 0 }; payeeStats.push(p); }
    p.count++;
    p.total += e.voided ? 0 : (Number(e.amount) || 0);
  });
  payeeStats.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  // A selected payee with nothing in this range still gets a row, so it stays visible and
  // clearable instead of being an invisible filter hiding rows you expected to see.
  payeeSel.forEach(n => { if (!payeeStats.some(p => p.name === n)) payeeStats.push({ name: n, count: 0, total: 0, absent: true }); });

  const payeeActive = payeeSel.size > 0;
  const entries = payeeActive
    ? rangeEntries.filter(e => payeeSel.has(payeeKey(e)))
    : rangeEntries;
  const todayEntries = spendEntries(today, today);
  const weekEntries = spendEntries(weekStartISO(today), weekEndISO(today));
  const gaps = checkSequenceGaps();
  const lastCheck = lastCheckNumber();

  const checksToday = todayEntries.filter(e => e.method === 'check' && !e.voided).length;
  const phoneToday = todayEntries.filter(e => e.method === 'phone' && !e.voided).length;

  // Sort values per column. Voided entries stay in place — they're part of the record.
  const sortVals = {
    date:   e => (e.date || '') + ' ' + (e.time || ''),
    method: e => (e.method === 'check' ? 'Check' : 'Phone'),
    ref:    e => e.method === 'check' ? (parseInt(e.checkNumber, 10) || 0) : (parseInt(e.cardLast4, 10) || 0),
    payee:  e => spendPayeeName(e) || '',
    picker: e => spendPickerName(e) || '',
    prop:   e => spendPropertyLabel(e) || '',
    amount: e => e.amount || 0,
  };
  const groupByDay = sort.key === 'date';
  const sorted = entries.slice().sort((a, b) => {
    const get = sortVals[sort.key] || sortVals.date;
    const av = get(a), bv = get(b);
    let cmp;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    // Stable, readable ties: fall back to newest first so equal amounts don't shuffle.
    if (cmp === 0 && sort.key !== 'date') cmp = -String(sortVals.date(a)).localeCompare(String(sortVals.date(b)));
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  // Group by day so each day carries its own subtotal. Only meaningful under a date sort.
  const days = [];
  if (groupByDay) {
    sorted.forEach(e => {
      let g = days.find(d => d.date === e.date);
      if (!g) { g = { date: e.date, items: [] }; days.push(g); }
      g.items.push(e);
    });
  }

  const payeeMenu = payeeStats.filter(p => !payeeSearch || p.name.toLowerCase().includes(payeeSearch.toLowerCase()));

  const Th = ({ k, label, num, width }) => (
    <th className={num ? 'num' : ''} style={{width, cursor: 'pointer', userSelect: 'none'}}
      title={'Sort by ' + label.toLowerCase()} onClick={() => clickHeader(k)}>
      {label}{sort.key === k && <span style={{marginLeft: 4, color: 'var(--blue)'}}>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  return (
    <div>
      <div className="row between items-end mb-16" style={{gap: 24, paddingBottom: 14, borderBottom: '2px solid var(--rule)'}}>
        <div>
          <div className="crumbs">Spend log</div>
          <div className="serif" style={{fontSize: 46, fontWeight: 600, lineHeight: 1, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', marginTop: 4}}>
            {fmtMoney(spendTotal(todayEntries))}
          </div>
          <div className="small dim" style={{marginTop: 5}}>
            Today · {todayEntries.length} {todayEntries.length === 1 ? 'entry' : 'entries'}
            {todayEntries.length ? ` · ${checksToday} check${checksToday === 1 ? '' : 's'}, ${phoneToday} phone sale${phoneToday === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <div className="row gap-28" style={{paddingBottom: 4}}>
          <div>
            <div className="up">This week</div>
            <div className="mono" style={{fontSize: 18, fontWeight: 600}}>{fmtMoney(spendTotal(weekEntries))}</div>
          </div>
          <div>
            <div className="up">Last check no.</div>
            <div className="mono" style={{fontSize: 18, fontWeight: 600}}>{lastCheck == null ? '—' : lastCheck}</div>
          </div>
        </div>
        <div className="row gap-8 items-center">
          <Segmented value={range} onChange={setRangeP}
            options={[{value:'today', label:'Today'}, {value:'week', label:'This week'}, {value:'custom', label:'Custom'}]}/>
          <div style={{position: 'relative'}}>
            <Btn sz="sm" kind={payeeActive ? 'primary' : undefined} onClick={() => { setPayeeOpen(o => !o); setPayeeSearch(''); }}>
              {payeeActive ? 'Payees · ' + payeeSel.size : 'All payees'} ▾
            </Btn>
            {payeeOpen && (
              <>
                <div style={{position: 'fixed', inset: 0, zIndex: 40}} onClick={() => setPayeeOpen(false)}></div>
                <div className="card" style={{position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 41, width: 330, maxHeight: 400, display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(0,0,0,.16)'}}>
                  <div style={{padding: '10px 12px', borderBottom: '1px solid var(--rule)'}}>
                    <input className="input" style={{width: '100%'}} placeholder="Find a payee or vendor"
                      value={payeeSearch} onChange={ev => setPayeeSearch(ev.target.value)}/>
                  </div>
                  <div style={{overflowY: 'auto', padding: '4px 0'}}>
                    {payeeMenu.map(p => (
                      <label key={p.name} className="row between items-center" style={{gap: 10, padding: '6px 12px', cursor: 'pointer'}}>
                        <span className="row items-center" style={{gap: 8, minWidth: 0}}>
                          <input type="checkbox" checked={payeeSel.has(p.name)} onChange={() => togglePayee(p.name)}/>
                          <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{p.name}</span>
                        </span>
                        <span className="small dim mono" style={{whiteSpace: 'nowrap'}}>
                          {p.absent ? 'none here' : p.count + ' · ' + fmtMoney(p.total)}
                        </span>
                      </label>
                    ))}
                    {!payeeMenu.length && <div className="small dim" style={{padding: '10px 12px'}}>No payee matches that.</div>}
                  </div>
                  <div className="row between items-center" style={{padding: '8px 12px', borderTop: '1px solid var(--rule)'}}>
                    <button className="linkbtn" onClick={() => setPayeeSelP(new Set())}>Show all</button>
                    <button className="linkbtn" onClick={() => setPayeeSelP(new Set(payeeStats.filter(p => !p.absent).map(p => p.name)))}>Select all listed</button>
                  </div>
                </div>
              </>
            )}
          </div>
          <Btn sz="sm" onClick={() => setSummary(true)}>Weekly summary</Btn>
          <Btn kind="primary" sz="sm" onClick={() => setAdding({})}>+ Log payment</Btn>
        </div>
      </div>

      {range === 'custom' && (
        <div className="row gap-8 items-center mb-12">
          <span className="up">From</span>
          <input type="date" className="input" value={custom.from} onChange={e => setCustom(c => ({...c, from: e.target.value}))}/>
          <span className="up">To</span>
          <input type="date" className="input" value={custom.to} onChange={e => setCustom(c => ({...c, to: e.target.value}))}/>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="mb-12" style={{fontSize: 12, fontWeight: 600, color: 'var(--brick)'}}>
          ⚠ Gap in the check sequence — {gaps.length === 1 ? 'check no. ' + gaps[0] + ' was' : 'check nos. ' + gaps.slice(0, 6).join(', ') + (gaps.length > 6 ? '…' : '') + ' were'} never logged. If written, add {gaps.length === 1 ? 'it' : 'them'}; if destroyed, log and void.
        </div>
      )}

      {payeeActive && (
        <div className="row items-center wrap mb-12" style={{gap: 8}}>
          <span className="up">Showing only</span>
          {[...payeeSel].map(n => (
            <button key={n} className="tag" style={{cursor: 'pointer'}} title="Remove this payee from the filter" onClick={() => togglePayee(n)}>{n} ✕</button>
          ))}
          <button className="linkbtn" onClick={() => setPayeeSelP(new Set())}>Clear</button>
          <span className="small dim">
            {entries.length} of {rangeEntries.length} {rangeEntries.length === 1 ? 'entry' : 'entries'} · <strong className="mono">{fmtMoney(spendTotal(entries))}</strong>
          </span>
        </div>
      )}

      {entries.length > 0 && !groupByDay && (
        <div className="row between items-center mb-8">
          <div className="small dim">
            Sorted by {({date:'date', method:'type', ref:'reference', payee:'payee', picker:'who picked it up', prop:'property', amount:'amount'})[sort.key]}
            {' · '}{sort.dir === 'asc' ? 'low to high' : 'high to low'}
            {' · '}<button className="linkbtn" onClick={() => clickHeader('date')}>back to day view</button>
          </div>
          <div className="small">{entries.length} {entries.length === 1 ? 'entry' : 'entries'} · <strong className="mono">{fmtMoney(spendTotal(entries))}</strong></div>
        </div>
      )}

      {!entries.length ? (
        <Card><div className="card__body">
          {payeeActive && rangeEntries.length > 0 ? (
            <Empty title="No entries for the payees you picked"
              sub={'This range has ' + rangeEntries.length + (rangeEntries.length === 1 ? ' entry' : ' entries') + ', but none match the payee filter.'}
              action={<Btn sz="sm" onClick={() => setPayeeSelP(new Set())}>Show all payees</Btn>}/>
          ) : (
            <Empty title="Nothing logged for this range"
              sub="Log a check you wrote or a phone sale you paid for, and it shows up here in real time."
              action={<Btn kind="primary" sz="sm" onClick={() => setAdding({})}>+ Log payment</Btn>}/>
          )}
        </div></Card>
      ) : (
        <table className="tbl">
          <thead><tr>
            <Th k="date" label={groupByDay ? 'Time' : 'Date · time'} width={groupByDay ? 74 : 132}/>
            <Th k="method" label="Type" width={74}/>
            <Th k="ref" label="Ref" width={92}/>
            <Th k="payee" label="Payee / vendor"/>
            <Th k="picker" label="Picked up by"/>
            <Th k="prop" label="Property"/>
            <Th k="amount" label="Amount" num width={112}/>
            <th style={{width: 78}}></th>
          </tr></thead>
          <tbody>
            {groupByDay
              ? days.map(d => [
                  <tr key={'d' + d.date} className="spend__daybar">
                    <td colSpan="6">{fmtDayLabel(d.date)}</td>
                    <td className="num">{fmtMoney(spendTotal(d.items))}</td>
                    <td></td>
                  </tr>,
                  ...d.items.map(e => <SpendRow key={e.id} e={e} onEdit={() => setAdding({ entry: e })}/>),
                ])
              : sorted.map(e => <SpendRow key={e.id} e={e} showDate onEdit={() => setAdding({ entry: e })}/>)}
          </tbody>
        </table>
      )}

      <div className="small dim mt-16" style={{maxWidth: 620, lineHeight: 1.55, textWrap: 'pretty'}}>
        A running record of money going out, kept in real time. It does not post to your books — reports, P&amp;L and property costs still come only from imported bank transactions.
      </div>

      {adding && <SpendEntryModal entry={adding.entry} onClose={() => setAdding(null)}/>}
      {summary && <WeeklySummaryModal onClose={() => setSummary(false)}/>}
    </div>
  );
}

function SpendRow({ e, onEdit, showDate }) {
  const isCheck = e.method === 'check';
  return (
    <tr className={e.voided ? 'spend__void' : ''}>
      <td className="mono small dim" style={{whiteSpace: 'nowrap'}}>
        {showDate ? (fmtShortDay(e.date) + (e.time ? ' · ' + e.time : '')) : (e.time || '—')}
      </td>
      <td><span className={'spend__meth spend__meth--' + (isCheck ? 'c' : 'p')}>{isCheck ? 'Check' : 'Phone'}</span></td>
      <td className="mono small">{isCheck ? (e.checkNumber || '—') : (e.cardLast4 ? '•' + e.cardLast4 : '—')}</td>
      <td>{spendPayeeName(e)}{e.voided && <span style={{marginLeft: 6, fontSize: 11, fontWeight: 600, color: 'var(--brick)'}}>void</span>}</td>
      <td>{spendPickerName(e) || <span className="dim">—</span>}</td>
      <td>{spendPropertyLabel(e) || <span className="dim">Unassigned</span>}</td>
      <td className="num mono" style={{fontWeight: 500}}>{fmtMoney(e.amount)}</td>
      <td>
        <div className="row gap-6">
          <button className="linkbtn" onClick={onEdit}>Edit</button>
          {isCheck && <button className="linkbtn" onClick={() => toggleSpendVoid(e.id)}>{e.voided ? 'Unvoid' : 'Void'}</button>}
        </div>
      </td>
    </tr>
  );
}

function SpendEntryModal({ entry, onClose }) {
  const store = useStore();
  const editing = !!entry;
  const [method, setMethod] = useState(entry?.method || 'phone');
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [date, setDate] = useState(entry?.date || TODAY());
  const [vendor, setVendor] = useState(entry?.vendor || '');
  const [contractorId, setContractorId] = useState(entry?.contractorId || '');
  const [contractorName, setContractorName] = useState(entry?.contractorName || '');
  const [propertyId, setPropertyId] = useState(entry?.propertyId || '');
  const [cardLast4, setCardLast4] = useState(entry?.cardLast4 || '');
  const [checkNumber, setCheckNumber] = useState(entry?.checkNumber || '');
  const [note, setNote] = useState(entry?.note || '');
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState(null);
  const amountRef = React.useRef(null);
  useEffect(() => { if (amountRef.current) amountRef.current.focus(); }, []);

  const isCheck = method === 'check';
  const vendors = [...new Set([...DEFAULT_VENDORS, ...(Store.state.spendLog || []).map(e => e.vendor).filter(Boolean)])].sort();
  const properties = (store.properties || []).slice().sort((a, b) => a.address.localeCompare(b.address));
  const contractors = (store.contractors || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  // Both the hard error and the soft warning are rendered INSIDE the modal. They
  // used to be alert()/confirm(): once a browser shows "prevent this page from
  // creating additional dialogs", confirm() returns false forever, so every save
  // silently returned and the form looked permanently stuck.
  function save(force) {
    const rec = { method, amount: parseFloat(String(amount).replace(/[$,]/g, '')) || 0, date,
      vendor: isCheck ? '' : vendor, contractorId, contractorName: contractorId ? '' : contractorName,
      propertyId, cardLast4: isCheck ? '' : cardLast4, checkNumber: isCheck ? checkNumber : '', note };
    if (!rec.amount) { setWarn(null); setErr('An amount is required.'); return; }
    setErr('');
    const w = spendWarnings({ ...rec, vendor: isCheck ? (contractorName || contractorId ? 'x' : '') : vendor });
    if (w.length && !force) { setWarn(w); return; }
    if (editing) updateSpendEntry(entry.id, rec); else addSpendEntry(rec);
    onClose();
  }

  return (
    <Modal lockKey={entry?.id ? 'spendLog:' + entry.id : null} lockLabel="this payment" title={editing ? 'Edit payment' : 'Log payment'} onClose={onClose}
      right={<div className="row gap-8">
        {editing && <Btn kind="ghost" onClick={() => { if (confirm('Delete this entry? It only removes the log record.')) { deleteSpendEntry(entry.id); onClose(); } }} style={{color: 'var(--brick)'}}>Delete</Btn>}
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn className="lock-save" kind="primary" onClick={() => save(false)}>{editing ? 'Save' : 'Log it'}</Btn>
      </div>}>
      <div className="col gap-14">
        {err ? (
          <div style={{padding: '9px 12px', background: 'var(--brick-soft, #f7e6e3)', border: '1px solid var(--brick)', borderRadius: 'var(--radius-s)', fontSize: 13}}>{err}</div>
        ) : null}
        {warn ? (
          <div className="row items-center gap-10" style={{padding: '9px 12px', background: 'var(--ochre-soft)', border: '1px solid var(--ochre)', borderRadius: 'var(--radius-s)', fontSize: 13}}>
            <span style={{flex: 1}}>No {warn.join(', ')}. Fill it in, or log it as-is.</span>
            <Btn sz="sm" kind="ghost" onClick={() => setWarn(null)}>Go back</Btn>
            <Btn sz="sm" onClick={() => save(true)}>Log it anyway</Btn>
          </div>
        ) : null}
        <Segmented value={method} onChange={setMethod}
          options={[{value:'phone', label:'Phone sale'}, {value:'check', label:'Check'}]}/>

        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Amount</div>
            <input ref={amountRef} className="input mono" inputMode="decimal" placeholder="0.00"
              value={amount} onChange={e => setAmount(e.target.value)} style={{width: '100%', fontSize: 18, fontWeight: 600}}/>
          </div>
          <div>
            <div className="up dim mb-4">Date</div>
            <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} style={{width: '100%'}}/>
          </div>
        </div>

        {isCheck ? (
          <div className="grid g-2">
            <div>
              <div className="up dim mb-4">Check number</div>
              <input className="input mono" value={checkNumber} onChange={e => setCheckNumber(e.target.value)} placeholder="4127" style={{width: '100%'}}/>
            </div>
            <div>
              <div className="up dim mb-4">Paid to</div>
              <select className="input" value={contractorId} onChange={e => setContractorId(e.target.value)} style={{width: '100%'}}>
                <option value="">— one-off payee —</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {!contractorId && <input className="input mt-6" value={contractorName} onChange={e => setContractorName(e.target.value)} placeholder="Name on the check" style={{width: '100%'}}/>}
            </div>
          </div>
        ) : (
          <div className="grid g-2">
            <div>
              <div className="up dim mb-4">Store</div>
              <input className="input" list="spend-vendors" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Lowes" style={{width: '100%'}}/>
              <datalist id="spend-vendors">{vendors.map(v => <option key={v} value={v}/>)}</datalist>
            </div>
            <div>
              <div className="up dim mb-4">Card</div>
              <select className="input" value={cardLast4} onChange={e => setCardLast4(e.target.value)} style={{width: '100%'}}>
                <option value="">— pick —</option>
                {DEFAULT_CARDS.map(c => <option key={c} value={c}>•••• {c}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="grid g-2">
          {!isCheck && (
            <div>
              <div className="up dim mb-4">Picking up</div>
              <select className="input" value={contractorId} onChange={e => setContractorId(e.target.value)} style={{width: '100%'}}>
                <option value="">— one-off name —</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {!contractorId && <input className="input mt-6" value={contractorName} onChange={e => setContractorName(e.target.value)} placeholder="Who's picking it up" style={{width: '100%'}}/>}
            </div>
          )}
          <div>
            <div className="up dim mb-4">Property / job</div>
            <select className="input" value={propertyId} onChange={e => setPropertyId(e.target.value)} style={{width: '100%'}}>
              <option value="">— unassigned —</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="up dim mb-4">Note <span className="dim" style={{textTransform: 'none', letterSpacing: 0}}>(optional)</span></div>
          <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="What it was for" style={{width: '100%'}}/>
        </div>

        <div className="small dim" style={{lineHeight: 1.5, textWrap: 'pretty'}}>
          Only the amount is required. Anything else you skip, you'll be warned about once and then it saves. This entry never posts to your books.
        </div>
      </div>
    </Modal>
  );
}

function WeeklySummaryModal({ onClose }) {
  useStore();
  const [anchor, setAnchor] = useState(TODAY());
  const sum = weeklySpendSummary(anchor);
  return (
    <Modal title="Weekly spend summary" onClose={onClose} wide
      right={<div className="row gap-8">
        <Btn kind="ghost" onClick={onClose}>Close</Btn>
        <Btn kind="primary" onClick={() => window.print()}>Print</Btn>
      </div>}>
      <div className="row between items-center mb-12 noprint">
        <div className="row gap-6">
          <Btn sz="sm" kind="ghost" onClick={() => setAnchor(addDaysISO(anchor, -7))}>‹ Previous week</Btn>
          <Btn sz="sm" kind="ghost" onClick={() => setAnchor(addDaysISO(anchor, 7))}>Next week ›</Btn>
        </div>
        <div className="small dim">{sum.count} entries</div>
      </div>
      <div id="spend-summary-print">
        <div className="mb-14" style={{paddingBottom: 10, borderBottom: '2px solid var(--rule)'}}>
          <div className="serif" style={{fontSize: 19, fontWeight: 600}}>Spend log · {fmtShortDay(sum.from)} – {fmtShortDay(sum.to)}</div>
          <div className="small dim">Checks written and phone sales, grouped by property. Operational record — not a bookkeeping report.</div>
        </div>
        {!sum.groups.length && <Empty title="Nothing logged this week"/>}
        {sum.groups.map(g => (
          <div key={g.propertyId || 'none'} className="mb-16">
            <div className="row between items-baseline" style={{paddingBottom: 5, borderBottom: '1px solid var(--rule)'}}>
              <div style={{fontWeight: 600}}>{g.label}</div>
              <div className="mono" style={{fontWeight: 600}}>{fmtMoney(g.total)}</div>
            </div>
            <table className="tbl"><tbody>
              {g.items.map(e => (
                <tr key={e.id}>
                  <td className="mono small dim" style={{width: 86}}>{fmtShortDay(e.date)}</td>
                  <td style={{width: 88}} className="small">{e.method === 'check' ? 'Check ' + (e.checkNumber || '') : 'Phone'}</td>
                  <td>{spendPayeeName(e)}</td>
                  <td className="small dim">{spendPickerName(e)}</td>
                  <td className="num mono" style={{width: 100}}>{fmtMoney(e.amount)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
        {!!sum.groups.length && (
          <div className="row between items-baseline" style={{paddingTop: 10, borderTop: '2px solid var(--rule)'}}>
            <div className="serif" style={{fontSize: 17, fontWeight: 600}}>Week total</div>
            <div className="mono" style={{fontSize: 17, fontWeight: 600}}>{fmtMoney(sum.total)}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

Object.assign(window, { SpendLogScreen });
