// screens/spend-log.jsx — real-time register of money going out: checks written
// and phone sales (vendor purchases authorized by phone). Deliberately separate
// from the books: nothing here posts to reports, P&L or property costs.

const SPEND_RANGE_KEY = 'atmore-spend-range-v1';

function SpendLogScreen() {
  useStore();
  const today = TODAY();
  const [range, setRange] = useState(() => localStorage.getItem(SPEND_RANGE_KEY) || 'today');
  const [custom, setCustom] = useState({ from: addDaysISO(today, -30), to: today });
  const [adding, setAdding] = useState(null);
  const [summary, setSummary] = useState(false);

  function setRangeP(v) { setRange(v); localStorage.setItem(SPEND_RANGE_KEY, v); }

  const bounds = range === 'today' ? { from: today, to: today }
    : range === 'week' ? { from: weekStartISO(today), to: weekEndISO(today) }
    : { from: custom.from, to: custom.to };

  const entries = spendEntries(bounds.from, bounds.to);
  const todayEntries = spendEntries(today, today);
  const weekEntries = spendEntries(weekStartISO(today), weekEndISO(today));
  const gaps = checkSequenceGaps();
  const lastCheck = lastCheckNumber();

  const checksToday = todayEntries.filter(e => e.method === 'check' && !e.voided).length;
  const phoneToday = todayEntries.filter(e => e.method === 'phone' && !e.voided).length;

  // Group the visible range by day so each day carries its own subtotal.
  const days = [];
  entries.forEach(e => {
    let g = days.find(d => d.date === e.date);
    if (!g) { g = { date: e.date, items: [] }; days.push(g); }
    g.items.push(e);
  });

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

      {!entries.length ? (
        <Card><div className="card__body">
          <Empty title="Nothing logged for this range"
            sub="Log a check you wrote or a phone sale you paid for, and it shows up here in real time."
            action={<Btn kind="primary" sz="sm" onClick={() => setAdding({})}>+ Log payment</Btn>}/>
        </div></Card>
      ) : (
        <table className="tbl">
          <thead><tr>
            <th style={{width: 74}}>Time</th>
            <th style={{width: 74}}>Type</th>
            <th style={{width: 92}}>Ref</th>
            <th>Payee / vendor</th>
            <th>Picked up by</th>
            <th>Property</th>
            <th className="num" style={{width: 112}}>Amount</th>
            <th style={{width: 78}}></th>
          </tr></thead>
          <tbody>
            {days.map(d => [
              <tr key={'d' + d.date} className="spend__daybar">
                <td colSpan="6">{fmtDayLabel(d.date)}</td>
                <td className="num">{fmtMoney(spendTotal(d.items))}</td>
                <td></td>
              </tr>,
              ...d.items.map(e => <SpendRow key={e.id} e={e} onEdit={() => setAdding({ entry: e })}/>),
            ])}
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

function SpendRow({ e, onEdit }) {
  const isCheck = e.method === 'check';
  return (
    <tr className={e.voided ? 'spend__void' : ''}>
      <td className="mono small dim">{e.time || '—'}</td>
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
  const amountRef = React.useRef(null);
  useEffect(() => { if (amountRef.current) amountRef.current.focus(); }, []);

  const isCheck = method === 'check';
  const vendors = [...new Set([...DEFAULT_VENDORS, ...(Store.state.spendLog || []).map(e => e.vendor).filter(Boolean)])].sort();
  const properties = (store.properties || []).slice().sort((a, b) => a.address.localeCompare(b.address));
  const contractors = (store.contractors || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  function save() {
    const rec = { method, amount: parseFloat(String(amount).replace(/[$,]/g, '')) || 0, date,
      vendor: isCheck ? '' : vendor, contractorId, contractorName: contractorId ? '' : contractorName,
      propertyId, cardLast4: isCheck ? '' : cardLast4, checkNumber: isCheck ? checkNumber : '', note };
    if (!rec.amount) { alert('An amount is required.'); return; }
    const warn = spendWarnings({ ...rec, vendor: isCheck ? (contractorName || contractorId ? 'x' : '') : vendor });
    if (warn.length && !confirm('Saving without ' + warn.join(', ') + '. Save anyway?')) return;
    if (editing) updateSpendEntry(entry.id, rec); else addSpendEntry(rec);
    onClose();
  }

  return (
    <Modal lockKey={entry?.id ? 'spendLog:' + entry.id : null} lockLabel="this payment" title={editing ? 'Edit payment' : 'Log payment'} onClose={onClose}
      right={<div className="row gap-8">
        {editing && <Btn kind="ghost" onClick={() => { if (confirm('Delete this entry? It only removes the log record.')) { deleteSpendEntry(entry.id); onClose(); } }} style={{color: 'var(--brick)'}}>Delete</Btn>}
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn className="lock-save" kind="primary" onClick={save}>{editing ? 'Save' : 'Log it'}</Btn>
      </div>}>
      <div className="col gap-14">
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
