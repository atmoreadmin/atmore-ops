// screens/rental-pnl.jsx — one-page Rental P&L.
// Rule: a transaction counts against the Rental P&L only if its category starts
// with "Rental" (or it's tagged to the "Rentals (general)" bucket — shown as its
// own row). Everything else is construction/flip activity and is excluded.
// Carrying costs (mortgage, HOA, taxes, insurance) are entered manually per
// property and count monthly from closing; in any month where an actual
// Rental-tagged transaction of that type exists, the actual is used instead.

const PNL_CARRY_TYPES = [
  { key: 'mortgage',  label: 'Mortgage',  re: /mortgage|loan|interest/i },
  { key: 'hoa',       label: 'HOA',       re: /hoa/i },
  { key: 'tax',       label: 'Taxes',     re: /tax/i },
  { key: 'insurance', label: 'Insurance', re: /insurance/i },
];
const PNL_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function isRentalPnlProperty(p) {
  const ty = String(p.type || '').toLowerCase();
  return ty === 'rental' || ty === '1031' || ty === '1031 replacement' || p.statusCode === 'K';
}
function isRentalCategory(cat) { return /^rental/i.test((cat || '').trim()); }

// Manual carrying amounts (monthly) — user-entered, prefilled from the property
// record where we have it (loan payment, tax/12, insurance/12).
function pnlCarrying(p) {
  const saved = p.rentalCarrying;
  if (saved) return saved;
  const ld = p.loanDetail || {}, tx = p.taxes || {}, ins = p.insurance || {};
  return {
    mortgage: ld.monthlyPayment || 0,
    hoa: 0,
    tax: tx.annualAmount ? Math.round(tx.annualAmount / 12 * 100) / 100 : 0,
    insurance: ins.premium ? Math.round(ins.premium / 12 * 100) / 100 : 0,
  };
}
function pnlCarryTotal(c) { return PNL_CARRY_TYPES.reduce((a, t) => a + (Number(c[t.key]) || 0), 0); }

// All rental-tagged transactions for a property (direct + split slices).
function pnlRentalTx(p) {
  const addr = (p.address || '').toLowerCase().trim();
  const out = [];
  (Store.state.transactions || []).forEach(t => {
    if (t.splits && t.splits.length) {
      t.splits.forEach((sp, i) => {
        if ((sp.project || '').toLowerCase().trim() === addr && isRentalCategory(sp.category || t.category))
          out.push({ id: t.id + '-s' + i, date: t.date, desc: t.desc, payee: t.payee, category: sp.category || t.category, amount: sp.amount || 0 });
      });
    } else if ((t.project || '').toLowerCase().trim() === addr && isRentalCategory(t.category)) {
      out.push(t);
    }
  });
  return out;
}

// Per-month P&L for one property in one year. Months run Jan..Dec; carrying is
// applied only to owned months (closing → sale, capped at today).
function pnlPropertyYear(p, year) {
  const carry = pnlCarrying(p);
  const allTx = pnlRentalTx(p);
  // Carrying start: closing date, else signing date, else the first rental
  // transaction ever logged, else (for a live rental) the start of the year —
  // imported rentals often lack a purchase date and still carry costs.
  const firstTxMo = allTx.reduce((a, t) => { const m = (t.date || '').slice(0, 7); return m && (!a || m < a) ? m : a; }, null);
  let ownFrom = (p.purchaseDate || p.signingDate || '').slice(0, 7) || firstTxMo;
  if (!ownFrom && !['I', 'J'].includes(p.statusCode)) ownFrom = year + '-01';
  const ownTo = p.salesDate ? p.salesDate.slice(0, 7) : TODAY().slice(0, 7);
  const tx = allTx.filter(t => (t.date || '').slice(0, 4) === String(year));
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const ym = year + '-' + String(m).padStart(2, '0');
    const mtx = tx.filter(t => (t.date || '').slice(0, 7) === ym);
    const inn = mtx.reduce((a, t) => a + (t.amount > 0 ? t.amount : 0), 0);
    const exp = mtx.reduce((a, t) => a + (t.amount < 0 ? -t.amount : 0), 0);
    const owned = ownFrom && ym >= ownFrom && ym <= ownTo;
    let carryMo = 0; const carryDetail = [];
    if (owned) {
      PNL_CARRY_TYPES.forEach(ct => {
        const amt = Number(carry[ct.key]) || 0;
        if (!amt) return;
        // If an actual Rental-tagged charge of this type is logged this month, use it (it's already in `exp`).
        const hasActual = mtx.some(t => t.amount < 0 && ct.re.test(t.category || ''));
        if (!hasActual) { carryMo += amt; carryDetail.push(ct.label); }
      });
    }
    months.push({ ym, m, owned, in: inn, exp, carry: carryMo, carryDetail, net: inn - exp - carryMo, txCount: mtx.length, future: ym > TODAY().slice(0, 7) });
  }
  const tot = f => months.filter(x => !x.future).reduce((a, x) => a + x[f], 0);
  return { months, in: tot('in'), exp: tot('exp'), carry: tot('carry'), net: tot('net'), hasActivity: months.some(x => x.txCount > 0 || (x.owned && !x.future)) };
}

function pnlMoney(v, { zero = '—', signed = false } = {}) {
  if (!v) return <span className="mono small" style={{color: 'var(--ink-3)'}}>{zero}</span>;
  const color = signed ? (v >= 0 ? 'var(--sage)' : 'var(--brick)') : 'inherit';
  return <span className="mono small" style={{color}}>{fmtMoney(v)}</span>;
}

function CarryingEditor({ p, onClose }) {
  const init = pnlCarrying(p);
  const [vals, setVals] = useState(() => Object.fromEntries(PNL_CARRY_TYPES.map(t => [t.key, init[t.key] ? String(init[t.key]) : ''])));
  function save() {
    updateProperty(p.id, { rentalCarrying: Object.fromEntries(PNL_CARRY_TYPES.map(t => [t.key, parseFloat(vals[t.key]) || 0])) });
    onClose();
  }
  return (
    <Modal title={'Monthly carrying costs — ' + p.address} onClose={onClose}
      right={<div className="row gap-8"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}>Save</Btn></div>}>
      <div className="col gap-12">
        <div className="small dim" style={{textWrap: 'pretty'}}>Counted against the Rental P&L every month from closing{p.purchaseDate ? ' (' + fmtDate(p.purchaseDate, {full: true}) + ')' : ''}. In months where you tag an actual <b>Rental</b> mortgage / HOA / tax / insurance transaction, the actual amount is used instead — no double counting.</div>
        <div className="grid g-2">
          {PNL_CARRY_TYPES.map(t => (
            <div key={t.key}>
              <div className="up dim mb-4">{t.label} / month</div>
              <div className="row gap-6 items-baseline">
                <span style={{color: 'var(--ink-3)', fontFamily: 'IBM Plex Mono', fontSize: 16}}>$</span>
                <input className="input mono" type="number" step="0.01" value={vals[t.key]}
                  onChange={e => setVals(v => ({ ...v, [t.key]: e.target.value }))} style={{flex: 1}}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// Drill-down: every transaction (and carrying line) behind one month's numbers.
function PnlMonthTxModal({ p, m, onClose }) {
  const tx = pnlRentalTx(p).filter(t => (t.date || '').slice(0, 7) === m.ym)
    .sort((a, b) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0));
  const carry = pnlCarrying(p);
  return (
    <Modal title={p.address + ' — ' + PNL_MON[m.m - 1] + ' ' + m.ym.slice(0, 4)} onClose={onClose} wide>
      <div className="col">
        {tx.length === 0 && m.carryDetail.length === 0 && <div className="small dim" style={{padding: '8px 0'}}>No rental transactions this month.</div>}
        {tx.map(t => (
          <div key={t.id} className="row gap-10 items-center" style={{padding: '6px 0', borderBottom: '1px solid var(--rule-soft)'}}>
            <span className="mono small dim" style={{width: 70, flexShrink: 0}}>{fmtDate(t.date)}</span>
            <span className="small grow" style={{minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{t.desc}{t.payee && <span className="dim">{' · ' + t.payee}</span>}</span>
            {t.category && <Tag tone="ghost">{t.category}</Tag>}
            <span className="mono small" style={{width: 92, textAlign: 'right', flexShrink: 0, color: t.amount < 0 ? 'var(--brick)' : 'var(--sage)'}}>{fmtMoney(t.amount)}</span>
          </div>
        ))}
        {m.carryDetail.map(label => {
          const ct = PNL_CARRY_TYPES.find(c => c.label === label);
          const amt = Number(carry[ct.key]) || 0;
          return (
            <div key={label} className="row gap-10 items-center" style={{padding: '6px 0', borderBottom: '1px solid var(--rule-soft)'}}>
              <span className="mono small dim" style={{width: 70, flexShrink: 0}}>—</span>
              <span className="small grow" style={{fontStyle: 'italic', color: 'var(--ink-2)'}}>{label} — monthly carrying</span>
              <Tag tone="ochre">recurring</Tag>
              <span className="mono small" style={{width: 92, textAlign: 'right', flexShrink: 0, color: 'var(--brick)'}}>{fmtMoney(-amt)}</span>
            </div>
          );
        })}
        <div className="row between small items-center" style={{paddingTop: 10}}>
          <span className="dim">In {fmtMoney(m.in)} · charges {fmtMoney(-m.exp)} · carrying {fmtMoney(-m.carry)}</span>
          <span className="mono" style={{fontWeight: 600, color: m.net >= 0 ? 'var(--sage)' : 'var(--brick)'}}>Net {fmtMoney(m.net)}</span>
        </div>
      </div>
    </Modal>
  );
}

// Month-by-month breakdown shown when a property row is expanded.
function PnlMonthDetail({ r }) {
  const [detail, setDetail] = useState(null);
  const shown = r.data.months.filter(m => !m.future && (m.owned || m.txCount > 0));
  return (
    <>
    <table className="tbl" style={{background: 'var(--paper-3)'}}>
      <thead><tr><th style={{paddingLeft: 34}}>Month</th><th className="num">Rent in</th><th className="num">Rental charges</th><th className="num">Carrying</th><th className="num">Net</th></tr></thead>
      <tbody>
        {shown.map(m => (
          <tr key={m.ym} onClick={() => setDetail(m)} style={{cursor: 'pointer'}} title="Click to see the transactions behind these numbers">
            <td className="mono small" style={{paddingLeft: 34}}>{PNL_MON[m.m - 1]} <span className="dim" style={{fontSize: 10}}>▸</span></td>
            <td className="num">{pnlMoney(m.in)}</td>
            <td className="num">{m.exp ? <span className="mono small" style={{color: 'var(--brick)'}}>{fmtMoney(-m.exp)}</span> : pnlMoney(0)}</td>
            <td className="num" title={m.carryDetail.join(' + ')}>{m.carry ? <span className="mono small" style={{color: 'var(--brick)'}}>{fmtMoney(-m.carry)}</span> : pnlMoney(0)}</td>
            <td className="num">{pnlMoney(m.net, { signed: true, zero: '$0' })}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {detail && <PnlMonthTxModal p={r.p} m={detail} onClose={() => setDetail(null)}/>}
    </>
  );
}

function RentalPnlScreen() {
  useStore();
  const [view, setView] = useState('summary');
  const [year, setYear] = useState(parseInt(TODAY().slice(0, 4)));
  const [open, setOpen] = useState(null);
  const [editCarry, setEditCarry] = useState(null);

  const props = (Store.state.properties || []).filter(isRentalPnlProperty)
    .sort((a, b) => (a.address || '').localeCompare(b.address || ''));

  // Years with any rental activity or ownership
  const years = useMemo(() => {
    const ys = new Set([parseInt(TODAY().slice(0, 4))]);
    (Store.state.transactions || []).forEach(t => { if (isRentalCategory(t.category) && t.date) ys.add(parseInt(t.date.slice(0, 4))); });
    props.forEach(p => { if (p.purchaseDate) ys.add(parseInt(p.purchaseDate.slice(0, 4))); });
    return [...ys].sort((a, b) => b - a).slice(0, 6);
  }, [Store.state.transactions, Store.state.properties]);

  const rows = props.map(p => ({ p, data: pnlPropertyYear(p, year) })).filter(r => r.data.hasActivity);
  const activeRows = rows.filter(r => !r.p.salesDate);
  const soldRows = rows.filter(r => r.p.salesDate);

  // "Rentals (general)" bucket — overhead rental charges not tied to one address
  const genTx = (Store.state.transactions || []).filter(t =>
    (t.project || '').toLowerCase().trim() === 'rentals (general)' && (t.date || '').slice(0, 4) === String(year));
  const genByMonth = m => genTx.filter(t => parseInt((t.date || '').slice(5, 7)) === m).reduce((a, t) => a + (t.amount || 0), 0);
  const genIn = genTx.reduce((a, t) => a + (t.amount > 0 ? t.amount : 0), 0);
  const genExp = genTx.reduce((a, t) => a + (t.amount < 0 ? -t.amount : 0), 0);

  const T = { in: rows.reduce((a, r) => a + r.data.in, 0) + genIn, exp: rows.reduce((a, r) => a + r.data.exp, 0) + genExp, carry: rows.reduce((a, r) => a + r.data.carry, 0) };
  T.net = T.in - T.exp - T.carry;
  const curMonth = String(year) === TODAY().slice(0, 4) ? parseInt(TODAY().slice(5, 7)) : 12;

  const kpi = (label, v, color) => (
    <div className="col" style={{gap: 2}}>
      <div className="up dim">{label}</div>
      <div className="mono" style={{fontSize: 22, fontWeight: 600, color}}>{fmtMoney(v)}</div>
    </div>
  );

  return (
    <div className="col gap-16">
      <div className="row between items-end wrap gap-12">
        <div className="col" style={{gap: 2}}>
          <h1 style={{margin: 0}}>Rental P&L</h1>
          <div className="small dim" style={{textWrap: 'pretty'}}>Only <b>Rental</b>-category transactions and monthly carrying costs count here — construction and reno charges are excluded.</div>
        </div>
        <div className="row gap-10 items-center">
          <Segmented value={String(year)} options={years.map(y => ({ value: String(y), label: String(y) }))} onChange={v => setYear(parseInt(v))}/>
          <Segmented value={view} options={[{ value: 'summary', label: 'Year summary' }, { value: 'grid', label: 'Monthly grid' }]} onChange={setView}/>
        </div>
      </div>

      <Card>
        <div className="card__body row wrap items-center" style={{gap: 32}}>
          {kpi('Rent collected', T.in, 'var(--sage)')}
          {kpi('Rental charges', -T.exp, 'var(--brick)')}
          {kpi('Carrying costs', -T.carry, 'var(--brick)')}
          {kpi('Net ' + year, T.net, T.net >= 0 ? 'var(--sage)' : 'var(--brick)')}
          <div className="small dim grow" style={{textAlign: 'right', minWidth: 160}}>{rows.length} rental propert{rows.length === 1 ? 'y' : 'ies'} · through {PNL_MON[curMonth - 1]} {year}</div>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card><div className="card__body"><Empty icon="⌂" title="No rental activity this year"
          sub="Properties typed Rental / 1031 / 1031 Replacement appear here once they have Rental-category transactions or an owned month."/></div></Card>
      ) : view === 'summary' ? (
        <Card>
          <CardHead title={'By property · ' + year} meta="click a row for the month-by-month breakdown"/>
          <table className="tbl">
            <thead><tr><th>Property</th><th className="num">Rent in</th><th className="num">Rental charges</th><th className="num">Carrying</th><th className="num">Net</th><th style={{width: 90}}></th></tr></thead>
            <tbody>
              {activeRows.map(r => {
                const isOpen = open === r.p.id;
                return (
                  <React.Fragment key={r.p.id}>
                    <tr onClick={() => setOpen(isOpen ? null : r.p.id)} style={{cursor: 'pointer'}}>
                      <td><span style={{display: 'inline-block', width: 14, color: 'var(--ink-3)'}}>{isOpen ? '▾' : '▸'}</span><a onClick={e => { e.stopPropagation(); nav('/property/' + r.p.id); }} style={{fontWeight: 500}}>{r.p.address}</a>{r.p.type && String(r.p.type).includes('1031') && <Tag tone="ghost" style={{marginLeft: 8}}>1031</Tag>}</td>
                      <td className="num">{pnlMoney(r.data.in)}</td>
                      <td className="num">{r.data.exp ? <span className="mono small" style={{color: 'var(--brick)'}}>{fmtMoney(-r.data.exp)}</span> : pnlMoney(0)}</td>
                      <td className="num" title="Mortgage + HOA + taxes + insurance (manual monthly amounts)">{r.data.carry ? <span className="mono small" style={{color: 'var(--brick)'}}>{fmtMoney(-r.data.carry)}</span> : pnlMoney(0)}</td>
                      <td className="num"><span className="mono small" style={{fontWeight: 600, color: r.data.net >= 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(r.data.net)}</span></td>
                      <td className="text-r"><button className="btn btn--ghost btn--sm" style={{padding: '1px 7px', fontSize: 11, whiteSpace: 'nowrap'}} title="Edit monthly mortgage / HOA / tax / insurance"
                        onClick={e => { e.stopPropagation(); setEditCarry(r.p.id); }}>✎ carrying</button></td>
                    </tr>
                    {isOpen && <tr><td colSpan={6} style={{padding: 0}}><PnlMonthDetail r={r}/></td></tr>}
                  </React.Fragment>
                );
              })}
              {soldRows.length > 0 && (
                <tr style={{background: 'var(--paper-3)', borderTop: '2px solid var(--rule)'}}>
                  <td colSpan={6} className="up" style={{fontSize: 10.5, fontWeight: 700, paddingTop: 9, paddingBottom: 9, color: 'var(--ink-2)'}}>Sold this year · carrying stops at sale month</td>
                </tr>
              )}
              {soldRows.map(r => {
                const isOpen = open === r.p.id;
                return (
                  <React.Fragment key={r.p.id}>
                    <tr onClick={() => setOpen(isOpen ? null : r.p.id)} style={{cursor: 'pointer', opacity: 0.85}}>
                      <td><span style={{display: 'inline-block', width: 14, color: 'var(--ink-3)'}}>{isOpen ? '▾' : '▸'}</span><a onClick={e => { e.stopPropagation(); nav('/property/' + r.p.id); }} style={{fontWeight: 500}}>{r.p.address}</a><Tag tone="ghost" style={{marginLeft: 8}}>Sold {fmtDate(r.p.salesDate)}</Tag>{r.p.type && String(r.p.type).includes('1031') && <Tag tone="ghost" style={{marginLeft: 6}}>1031</Tag>}</td>
                      <td className="num">{pnlMoney(r.data.in)}</td>
                      <td className="num">{r.data.exp ? <span className="mono small" style={{color: 'var(--brick)'}}>{fmtMoney(-r.data.exp)}</span> : pnlMoney(0)}</td>
                      <td className="num" title="Carrying counted only through the sale month">{r.data.carry ? <span className="mono small" style={{color: 'var(--brick)'}}>{fmtMoney(-r.data.carry)}</span> : pnlMoney(0)}</td>
                      <td className="num"><span className="mono small" style={{fontWeight: 600, color: r.data.net >= 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(r.data.net)}</span></td>
                      <td className="text-r"><button className="btn btn--ghost btn--sm" style={{padding: '1px 7px', fontSize: 11, whiteSpace: 'nowrap'}} title="Edit monthly mortgage / HOA / tax / insurance"
                        onClick={e => { e.stopPropagation(); setEditCarry(r.p.id); }}>✎ carrying</button></td>
                    </tr>
                    {isOpen && <tr><td colSpan={6} style={{padding: 0}}><PnlMonthDetail r={r}/></td></tr>}
                  </React.Fragment>
                );
              })}
              {genTx.length > 0 && (
                <tr style={{background: 'var(--paper-3)'}}>
                  <td style={{paddingLeft: 20, fontStyle: 'italic'}}>Rentals (general) <span className="dim small">· not tied to one address</span></td>
                  <td className="num">{pnlMoney(genIn)}</td>
                  <td className="num">{genExp ? <span className="mono small" style={{color: 'var(--brick)'}}>{fmtMoney(-genExp)}</span> : pnlMoney(0)}</td>
                  <td className="num">{pnlMoney(0)}</td>
                  <td className="num"><span className="mono small" style={{fontWeight: 600, color: (genIn - genExp) >= 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(genIn - genExp)}</span></td>
                  <td></td>
                </tr>
              )}
              <tr style={{borderTop: '2px solid var(--rule)', background: 'var(--paper-2)'}}>
                <td style={{fontWeight: 700, paddingLeft: 20}}>Total · {year}</td>
                <td className="num"><span className="mono small" style={{fontWeight: 600, color: 'var(--sage)'}}>{fmtMoney(T.in)}</span></td>
                <td className="num"><span className="mono small" style={{fontWeight: 600, color: 'var(--brick)'}}>{fmtMoney(-T.exp)}</span></td>
                <td className="num"><span className="mono small" style={{fontWeight: 600, color: 'var(--brick)'}}>{fmtMoney(-T.carry)}</span></td>
                <td className="num"><span className="mono" style={{fontWeight: 700, color: T.net >= 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(T.net)}</span></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : (
        <Card>
          <CardHead title={'Net by month · ' + year} meta="rent in − rental charges − carrying"/>
          <div style={{overflowX: 'auto'}}>
            <table className="tbl" style={{minWidth: 900}}>
              <thead><tr><th>Property</th>{PNL_MON.map((m, i) => <th key={m} className="num" style={{opacity: i + 1 > curMonth ? 0.4 : 1}}>{m}</th>)}<th className="num" style={{borderLeft: '2px solid var(--rule)'}}>Total</th></tr></thead>
              <tbody>
                {activeRows.map(r => (
                  <tr key={r.p.id}>
                    <td style={{whiteSpace: 'nowrap'}}><a onClick={() => nav('/property/' + r.p.id)} style={{fontWeight: 500}}>{r.p.address}</a></td>
                    {r.data.months.map(m => (
                      <td key={m.ym} className="num" title={m.owned || m.txCount ? `${PNL_MON[m.m-1]}: in ${fmtMoney(m.in)} · charges ${fmtMoney(-m.exp)} · carrying ${fmtMoney(-m.carry)}` : undefined}>
                        {m.future || (!m.owned && !m.txCount) ? <span className="mono small" style={{color: 'var(--ink-3)'}}>·</span>
                          : <span className="mono" style={{fontSize: 11.5, color: m.net > 0 ? 'var(--sage)' : m.net < 0 ? 'var(--brick)' : 'var(--ink-3)'}}>{fmtMoney(m.net)}</span>}
                      </td>
                    ))}
                    <td className="num" style={{borderLeft: '2px solid var(--rule)'}}><span className="mono small" style={{fontWeight: 600, color: r.data.net >= 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(r.data.net)}</span></td>
                  </tr>
                ))}
                {soldRows.length > 0 && (
                  <tr style={{background: 'var(--paper-3)', borderTop: '2px solid var(--rule)'}}>
                    <td colSpan={14} className="up" style={{fontSize: 10.5, fontWeight: 700, paddingTop: 9, paddingBottom: 9, color: 'var(--ink-2)'}}>Sold this year</td>
                  </tr>
                )}
                {soldRows.map(r => (
                  <tr key={r.p.id} style={{opacity: 0.85}}>
                    <td style={{whiteSpace: 'nowrap'}}><a onClick={() => nav('/property/' + r.p.id)} style={{fontWeight: 500}}>{r.p.address}</a><Tag tone="ghost" style={{marginLeft: 8}}>Sold {fmtDate(r.p.salesDate)}</Tag></td>
                    {r.data.months.map(m => (
                      <td key={m.ym} className="num" title={m.owned || m.txCount ? `${PNL_MON[m.m-1]}: in ${fmtMoney(m.in)} · charges ${fmtMoney(-m.exp)} · carrying ${fmtMoney(-m.carry)}` : undefined}>
                        {m.future || (!m.owned && !m.txCount) ? <span className="mono small" style={{color: 'var(--ink-3)'}}>·</span>
                          : <span className="mono" style={{fontSize: 11.5, color: m.net > 0 ? 'var(--sage)' : m.net < 0 ? 'var(--brick)' : 'var(--ink-3)'}}>{fmtMoney(m.net)}</span>}
                      </td>
                    ))}
                    <td className="num" style={{borderLeft: '2px solid var(--rule)'}}><span className="mono small" style={{fontWeight: 600, color: r.data.net >= 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(r.data.net)}</span></td>
                  </tr>
                ))}
                {genTx.length > 0 && (
                  <tr style={{background: 'var(--paper-3)'}}>
                    <td style={{fontStyle: 'italic', whiteSpace: 'nowrap'}}>Rentals (general)</td>
                    {PNL_MON.map((_, i) => { const v = genByMonth(i + 1); return <td key={i} className="num">{v ? <span className="mono" style={{fontSize: 11.5, color: v > 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(v)}</span> : <span className="mono small" style={{color: 'var(--ink-3)'}}>·</span>}</td>; })}
                    <td className="num" style={{borderLeft: '2px solid var(--rule)'}}><span className="mono small" style={{fontWeight: 600, color: (genIn - genExp) >= 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(genIn - genExp)}</span></td>
                  </tr>
                )}
                <tr style={{borderTop: '2px solid var(--rule)', background: 'var(--paper-2)'}}>
                  <td style={{fontWeight: 700}}>Total</td>
                  {PNL_MON.map((_, i) => {
                    const v = rows.reduce((a, r) => { const m = r.data.months[i]; return a + (m.future ? 0 : m.net); }, 0) + genByMonth(i + 1);
                    return <td key={i} className="num">{i + 1 > curMonth ? <span className="mono small" style={{color: 'var(--ink-3)'}}>·</span> : <span className="mono" style={{fontSize: 11.5, fontWeight: 600, color: v > 0 ? 'var(--sage)' : v < 0 ? 'var(--brick)' : 'var(--ink-3)'}}>{fmtMoney(v)}</span>}</td>;
                  })}
                  <td className="num" style={{borderLeft: '2px solid var(--rule)'}}><span className="mono" style={{fontWeight: 700, color: T.net >= 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(T.net)}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editCarry && <CarryingEditor p={props.find(x => x.id === editCarry)} onClose={() => setEditCarry(null)}/>}
    </div>
  );
}

Object.assign(window, { RentalPnlScreen, isRentalPnlProperty, isRentalCategory, pnlCarrying });
