// screens/reports.jsx — Reports tab: Rentals breakdown + P&L
// Rentals: every property categorized as a rental (status K / type Rental),
//   including ones still in renovation. Carrying costs = mortgage + insurance
//   + taxes per month (renovation spend excluded). Net cash flow → owner payout.
// P&L: actual logged transactions, grouped income/expense by category, for a
//   chosen date range, toggleable between the whole business and rentals only.

const OWNER_PAYOUT_KEY = 'atmore-rental-payout-v1';
function loadPayout() {
  try { const v = JSON.parse(localStorage.getItem(OWNER_PAYOUT_KEY)); if (v && v.names && v.pct) return v; } catch (e) {}
  return { names: ['Joe', 'Moe'], pct: [50, 50] };
}

function ReportsScreen() {
  const store = useStore();
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('atmore-reports-tab') || 'rentals'; } catch (e) { return 'rentals'; }
  });
  function pick(v) { setTab(v); try { localStorage.setItem('atmore-reports-tab', v); } catch (e) {} }

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Reports</div>
          <h1>{tab === 'rentals' ? 'Rental cash flow' : 'Profit & loss'}</h1>
        </div>
        <Segmented value={tab}
          options={[{ value: 'rentals', label: 'Rentals' }, { value: 'pnl', label: 'P&L' }]}
          onChange={pick} />
      </div>
      {tab === 'rentals' ? <RentalsReport /> : <PnlReport />}
    </div>
  );
}

// ─── Rentals ─────────────────────────────────────────────────────────────────
function monthsInRange(from, to) {
  if (!from) return [to].filter(Boolean);
  if (!to) return [from];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out = [];
  while ((y < ty || (y === ty && m <= tm)) && out.length < 240) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m++; if (m > 12) { m = 1; y++; }
  }
  return out.length ? out : [from];
}

function rentalCarry(p) {
  const mort = p.loanDetail?.monthlyPayment || 0;
  const insMo = (p.insurance?.premium || 0) / 12;       // premium is annual
  const taxMo = (p.taxes?.annualAmount || 0) / 12;       // annual
  const escI = !!p.loanDetail?.escrowedInsurance;        // already inside the mortgage payment
  const escT = !!(p.loanDetail?.escrowedTaxes || p.taxes?.escrowed);
  const cost = mort + (escI ? 0 : insMo) + (escT ? 0 : taxMo);
  return { mort, insMo, taxMo, escI, escT, cost };
}

function RentalsReport() {
  const store = useStore();
  const [payout, setPayout] = useState(loadPayout);
  const [editSplit, setEditSplit] = useState(false);
  const [openProp, setOpenProp] = useState(null);
  const cur = getCurrentMonth();
  const [from, setFrom] = useState(cur);
  const [to, setTo] = useState(cur);
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const months = monthsInRange(lo, hi);
  const N = months.length || 1;
  const rangeShort = N === 1 ? fmtMonthLong(lo) : N + ' months';
  const rangeLong = N === 1 ? fmtMonthLong(lo) : (fmtMonthLong(lo) + ' – ' + fmtMonthLong(hi));

  const rentalLane = getStatuses().filter(s => s.lane === 'rental').map(s => s.code);
  const archiveLane = getStatuses().filter(s => s.lane === 'archive').map(s => s.code);
  const isRental = p => (p.type === 'Rental' || rentalLane.includes(p.statusCode)) && !archiveLane.includes(p.statusCode);

  // Actual logged expenses tagged to each property within the month range.
  const catKind = {};
  (store.lists?.categories || []).forEach(c => { catKind[c.label] = c.kind; });
  const expByProp = {};
  const linesByProp = {};
  (store.transactions || []).forEach(t => {
    if (!t.date) return;
    const mo = t.date.slice(0, 7);
    if (mo < lo || mo > hi) return;
    const parts = (t.splits && t.splits.length)
      ? t.splits.map(s => ({ amount: s.amount || 0, category: s.category || t.category || '', project: s.project || t.project || '', split: true }))
      : [{ amount: t.amount || 0, category: t.category || '', project: t.project || '' }];
    parts.forEach(pt => {
      const prop = getPropertyByAddr(pt.project);
      if (!prop) return;
      const kind = catKind[pt.category];
      const isExp = kind === 'expense' ? true : kind === 'income' ? false : pt.amount < 0;
      (linesByProp[prop.id] = linesByProp[prop.id] || []).push({ ...pt, date: t.date, desc: t.desc, payee: t.payee, isExp });
      if (!isExp) return;
      expByProp[prop.id] = (expByProp[prop.id] || 0) + Math.abs(pt.amount);
    });
  });

  const rows = store.properties.filter(isRental).map(p => {
    const active = getTenantsForProperty(p.id).filter(t => t.status === 'active' && (t.rent || 0) > 0);
    const scheduled = months.reduce((a, m) => a + active.reduce((s, t) => s + getRentForMonth(t, m), 0), 0);
    // True rent received: actual payments recorded in the rent ledger for these months.
    const rent = (store.rentLedger || []).reduce((a, r) => a + ((r.propertyId === p.id && r.month >= lo && r.month <= hi) ? (r.paid || 0) : 0), 0);
    const c = rentalCarry(p);
    const cost = expByProp[p.id] || 0; // actual logged expenses tagged to this property
    const carry = c.mort * N + (c.escI ? 0 : c.insMo * N) + (c.escT ? 0 : c.taxMo * N); // modeled mortgage + insurance + taxes
    const reno = !rentalLane.includes(p.statusCode); // in a pipeline stage = still being renovated
    return {
      p, rent, scheduled, escI: c.escI, escT: c.escT, reno, nTenants: active.length,
      mort: c.mort * N, insMo: c.insMo * N, taxMo: c.taxMo * N, cost,
      net: rent - carry - cost,
    };
  }).sort((a, b) => {
    if (a.reno !== b.reno) return a.reno ? 1 : -1;           // rented first, renovating last
    return (a.p.address || '').localeCompare(b.p.address || '');
  });

  const T = rows.reduce((a, r) => ({
    rent: a.rent + r.rent,
    mort: a.mort + r.mort,
    ins: a.ins + (r.escI ? 0 : r.insMo),
    tax: a.tax + (r.escT ? 0 : r.taxMo),
    cost: a.cost + r.cost,
    net: a.net + r.net,
  }), { rent: 0, mort: 0, ins: 0, tax: 0, cost: 0, net: 0 });
  T.deduct = T.mort + T.ins + T.tax + T.cost;

  const nRented = rows.filter(r => !r.reno).length;
  const nReno = rows.filter(r => r.reno).length;

  function savePayout(next) { setPayout(next); try { localStorage.setItem(OWNER_PAYOUT_KEY, JSON.stringify(next)); } catch (e) {} }
  function setPct(i, val) {
    const v = Math.max(0, Math.min(100, Math.round(val) || 0));
    savePayout({ ...payout, pct: i === 0 ? [v, 100 - v] : [100 - v, v] });
  }
  function setName(i, val) { const names = payout.names.slice(); names[i] = val; savePayout({ ...payout, names }); }

  function exportCsv() {
    const flat = rows.map(r => ({
      property: r.p.address, status: r.reno ? 'In renovation' : statusLabelFor(r.p),
      rent: round2(r.rent), mortgage: round2(r.mort),
      insurance: round2(r.escI ? 0 : r.insMo), taxes: round2(r.escT ? 0 : r.taxMo),
      monthlyCost: round2(r.cost), netCashFlow: round2(r.net),
    }));
    flat.push({ property: 'TOTAL', status: '', rent: round2(T.rent), mortgage: round2(T.mort), insurance: round2(T.ins), taxes: round2(T.tax), monthlyCost: round2(T.cost), netCashFlow: round2(T.net) });
    downloadCSV('rental-cash-flow_' + lo + '_' + hi + '.csv', flat, [
      { key: 'property', label: 'Property' }, { key: 'status', label: 'Status' },
      { key: 'rent', label: 'Rent received' }, { key: 'mortgage', label: 'Mortgage' },
      { key: 'insurance', label: 'Insurance' }, { key: 'taxes', label: 'Taxes' },
      { key: 'monthlyCost', label: 'Cost' }, { key: 'netCashFlow', label: 'Net cash flow' },
    ]);
  }

  if (rows.length === 0) {
    return <Card><Empty icon="🏠" title="No rentals yet"
      sub="Properties land here once they're set to the Rental (K) status or typed as a Rental. Renovating future rentals are included too." /></Card>;
  }

  return (
    <div>
      {/* CONTROLS */}
      <Card className="mb-16">
        <div className="card__body row gap-12 items-center wrap">
          <label className="row gap-6 items-center small dim">From
            <input className="input mono" type="month" value={from} onChange={e => setFrom(e.target.value || cur)} />
          </label>
          <label className="row gap-6 items-center small dim">To
            <input className="input mono" type="month" value={to} onChange={e => setTo(e.target.value || cur)} />
          </label>
          <Tag tone="ghost">{N} month{N === 1 ? '' : 's'}</Tag>
          {(from !== cur || to !== cur) &&
            <Btn sz="sm" kind="ghost" onClick={() => { setFrom(cur); setTo(cur); }}>This month</Btn>}
          <div className="grow" />
          <span className="tiny dim">Totals over the range. Net = actual rent received minus modeled mortgage, insurance &amp; taxes, minus the actual logged expenses (Cost) tagged to each property.</span>
        </div>
      </Card>

      {/* SUMMARY */}
      <Card className="mb-16">
        <div className="row" style={{ padding: '4px 0' }}>
          <div className="stat grow">
            <div className="stat__label">Rentals</div>
            <div className="stat__value">{rows.length}</div>
            <div className="stat__sub">{nRented} rented · {nReno} in renovation</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Rent received · {rangeShort}</div>
            <div className="stat__value">{fmtMoney(T.rent)}</div>
            <div className="stat__sub">{fmtMoney(T.rent / N)} / mo</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Total costs · {rangeShort}</div>
            <div className="stat__value">{fmtMoney(T.deduct)}</div>
            <div className="stat__sub">mortgage, ins, taxes + logged</div>
          </div>
          <div className="stat grow" style={{ borderLeft: '2px solid var(--rule)' }}>
            <div className="stat__label">Net cash flow · {rangeShort}</div>
            <div className="stat__value" style={{ color: T.net >= 0 ? 'var(--sage)' : 'var(--brick)' }}>{fmtMoney(T.net, { sign: true })}</div>
            <div className="stat__sub">{fmtMoney(T.net / N, { sign: true })} / mo</div>
          </div>
        </div>
      </Card>

      {/* PER-PROPERTY TABLE */}
      <Card className="mb-16">
        <CardHead title={'By property · ' + rangeLong} right={<Btn sz="sm" kind="ghost" onClick={exportCsv}>⤓ Export CSV</Btn>} />
        <table className="tbl">
          <thead>
            <tr>
              <th>Property</th>
              <th style={{ width: 150 }}>Status</th>
              <th className="num" style={{ width: 110 }} title="Actual rent received (from the rent ledger) in this range">Rent received</th>
              <th className="num" style={{ width: 110 }}>Mortgage</th>
              <th className="num" style={{ width: 120 }}>Insurance</th>
              <th className="num" style={{ width: 110 }}>Taxes</th>
              <th className="num" style={{ width: 120 }} title="Actual logged expenses tagged to this property">Cost</th>
              <th className="num" style={{ width: 130 }}>Net cash flow</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isOpen = openProp === r.p.id;
              const pLines = (linesByProp[r.p.id] || []).sort((a, b) => (a.isExp ? 1 : 0) - (b.isExp ? 1 : 0) || (b.date || '').localeCompare(a.date || ''));
              const inSum = pLines.filter(l => !l.isExp).reduce((a, l) => a + Math.abs(l.amount), 0);
              return (
              <React.Fragment key={r.p.id}>
              <tr onClick={() => setOpenProp(isOpen ? null : r.p.id)} style={{ cursor: 'pointer' }} title={isOpen ? 'Hide transactions' : pLines.length ? 'Show ' + pLines.length + ' transaction' + (pLines.length === 1 ? '' : 's') + ' in this range' : 'No logged transactions in this range'}>
                <td><span style={{ display: 'inline-block', width: 14, color: 'var(--ink-3)' }}>{isOpen ? '▾' : '▸'}</span><span className="addr">{r.p.address}</span></td>
                <td>
                  {r.reno
                    ? <Tag tone="ochre">In renovation</Tag>
                    : <span className="row gap-6 items-center"><StatusBadge code={r.p.statusCode} full /></span>}
                </td>
                <td className="num mono" title={r.scheduled !== r.rent ? 'Scheduled: ' + fmtMoney(r.scheduled) : undefined}>{r.rent ? fmtMoney(r.rent) : <span className="dim">$0</span>}{r.scheduled > r.rent + 0.5 && <div className="tiny dim">of {fmtMoney(r.scheduled)}</div>}</td>
                <td className="num mono">{r.mort ? fmtMoney(r.mort) : <span className="dim">—</span>}</td>
                <td className="num mono"><EscCell amt={r.insMo} esc={r.escI} /></td>
                <td className="num mono"><EscCell amt={r.taxMo} esc={r.escT} /></td>
                <td className="num mono">{fmtMoney(r.cost)}</td>
                <td className="num mono" style={{ color: r.net >= 0 ? 'var(--sage)' : 'var(--brick)', fontWeight: 600 }}>{fmtMoney(r.net, { sign: true })}</td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={8} style={{ padding: 0, background: 'var(--paper-3)' }}>
                    <div style={{ padding: '6px 12px 10px 26px' }}>
                      <div className="row between items-center" style={{ padding: '4px 0' }}>
                        <span className="tiny up dim">Logged transactions · {rangeLong}</span>
                        <a className="small" style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); nav('/property/' + r.p.id); }}>Open property →</a>
                      </div>
                      {pLines.length === 0
                        ? <div className="small dim" style={{ padding: '6px 0' }}>No transactions tagged to this property in this range.</div>
                        : pLines.map((l, i) => (
                          <div key={i} className="row gap-10 items-center" style={{ padding: '5px 0', borderTop: '1px solid var(--rule-soft)' }}>
                            <span className="mono small dim" style={{ width: 64, flexShrink: 0 }}>{fmtDate(l.date)}</span>
                            <span className="small grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.desc}{l.payee && <span className="dim">{' · ' + l.payee}</span>}</span>
                            {l.split && <Tag tone="blue">split</Tag>}
                            <Tag tone="ghost">{l.category || 'Uncategorized'}</Tag>
                            <Tag tone={l.isExp ? 'brick' : 'sage'}>{l.isExp ? 'charge' : 'deposit'}</Tag>
                            <span className="mono small" style={{ width: 92, textAlign: 'right', flexShrink: 0, color: l.isExp ? 'var(--brick)' : 'var(--sage)' }}>{fmtMoney(l.isExp ? -Math.abs(l.amount) : Math.abs(l.amount))}</span>
                          </div>
                        ))}
                      {pLines.length > 0 && (
                        <div className="row gap-12 small" style={{ padding: '6px 0 0', borderTop: '1px solid var(--rule-soft)', justifyContent: 'flex-end' }}>
                          <span><span className="dim">Deposits:</span> <span className="mono" style={{ color: 'var(--sage)' }}>{fmtMoney(inSum)}</span></span>
                          <span><span className="dim">Charges:</span> <span className="mono" style={{ color: 'var(--brick)' }}>{fmtMoney(-r.cost)}</span></span>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--rule)', fontWeight: 600 }}>
              <td>Portfolio · {rows.length}</td>
              <td className="small dim">{nRented} rented</td>
              <td className="num mono">{fmtMoney(T.rent)}</td>
              <td className="num mono">{fmtMoney(T.mort)}</td>
              <td className="num mono">{fmtMoney(T.ins)}</td>
              <td className="num mono">{fmtMoney(T.tax)}</td>
              <td className="num mono">{fmtMoney(T.cost)}</td>
              <td className="num mono" style={{ color: T.net >= 0 ? 'var(--sage)' : 'var(--brick)' }}>{fmtMoney(T.net, { sign: true })}</td>
            </tr>
          </tfoot>
        </table>
        <div className="card__body small dim" style={{ lineHeight: 1.6 }}>
          Figures are totals over the selected range. <strong>Net cash flow = Rent received − Mortgage − Insurance − Taxes − Cost</strong>, where <strong>Rent received</strong> is actual payments recorded in the rent ledger (a dim “of $X” shows the scheduled rent when less was collected), Mortgage, Insurance and Taxes are the modeled monthly figures (insurance and taxes are annual amounts prorated monthly) and <strong>Cost</strong> is the actual logged expenses tagged to each property. Amounts marked <span className="mono tiny">esc</span> are escrowed
          inside the mortgage payment, so they aren't added again.
        </div>
      </Card>

      {/* OWNER PAYOUT */}
      <Card>
        <CardHead title={'Owner payout · ' + rangeLong} right={
          <Btn sz="sm" kind="ghost" onClick={() => setEditSplit(v => !v)}>{editSplit ? 'Done' : 'Edit split'}</Btn>
        } />
        <div className="card__body">
          <div className="small dim mb-12" style={{ lineHeight: 1.6 }}>
            The full net cash flow is paid out to the two owners on the split below.
            {T.net < 0 && <span style={{ color: 'var(--brick)' }}> Net is negative this period — the figures show each owner's share of the shortfall.</span>}
          </div>
          <div className="grid g-2 gap-12">
            {[0, 1].map(i => {
              const share = T.net * (payout.pct[i] / 100);
              return (
                <div key={i} style={{ border: '1px solid var(--rule)', borderRadius: 8, padding: '14px 16px', background: 'var(--paper-2)' }}>
                  <div className="row between items-center">
                    {editSplit
                      ? <input className="input" value={payout.names[i]} onChange={e => setName(i, e.target.value)} style={{ width: 140, fontWeight: 600 }} />
                      : <span className="row gap-8 items-center"><Av name={payout.names[i]} /><span className="serif" style={{ fontSize: 16, fontWeight: 600 }}>{payout.names[i]}</span></span>}
                    {editSplit
                      ? <span className="row gap-4 items-center"><input className="input mono" type="number" min="0" max="100" value={payout.pct[i]} onChange={e => setPct(i, parseFloat(e.target.value))} style={{ width: 64 }} />%</span>
                      : <Tag tone="ghost">{payout.pct[i]}%</Tag>}
                  </div>
                  <div className="mono" style={{ fontSize: 28, fontWeight: 600, marginTop: 10, color: share >= 0 ? 'var(--ink)' : 'var(--brick)' }}>{fmtMoney(share, { sign: true })}</div>
                  <div className="small dim">{fmtMoney(share / N, { sign: true })} / mo</div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}

function EscCell({ amt, esc }) {
  if (!amt) return <span className="dim">—</span>;
  if (esc) return <span className="dim">{fmtMoney(amt)} <span className="mono tiny">esc</span></span>;
  return <span>{fmtMoney(amt)}</span>;
}

function statusLabelFor(p) {
  const s = getStatuses().find(x => x.code === p.statusCode);
  return s ? s.label : (p.statusCode || '');
}
function round2(n) { return Math.round((n || 0) * 100) / 100; }

// ─── P&L ─────────────────────────────────────────────────────────────────────
function PnlReport() {
  const store = useStore();
  const yr = TODAY().slice(0, 4);
  const [scope, setScope] = useState('all'); // all | rentals
  const [from, setFrom] = useState(yr + '-01-01');
  const [to, setTo] = useState(TODAY());

  const rentalLane = getStatuses().filter(s => s.lane === 'rental').map(s => s.code);
  const isRentalProp = p => p && (p.type === 'Rental' || rentalLane.includes(p.statusCode));
  const catKind = {};
  (store.lists?.categories || []).forEach(c => { catKind[c.label] = c.kind; });

  // Flatten transactions (and their splits) into individual ledger lines in range.
  const lines = [];
  (store.transactions || []).forEach(t => {
    if (!t.date || t.date < from || t.date > to) return;
    const parts = (t.splits && t.splits.length)
      ? t.splits.map(s => ({ amount: s.amount || 0, category: s.category || '', project: s.project || '', date: t.date, desc: t.desc, payee: t.payee, split: true }))
      : [{ amount: t.amount || 0, category: t.category || '', project: t.project || '', date: t.date, desc: t.desc, payee: t.payee }];
    parts.forEach(p => {
      if (scope === 'rentals' && !isRentalProp(getPropertyByAddr(p.project))) return;
      lines.push(p);
    });
  });

  const income = {}, expense = {};
  const incLines = {}, expLines = {};
  let unattributedRental = 0;
  lines.forEach(l => {
    const label = l.category || 'Uncategorized';
    const kind = catKind[l.category];
    const isInc = kind === 'income' ? true : kind === 'expense' ? false : (l.amount >= 0);
    if (isInc) { income[label] = (income[label] || 0) + l.amount; (incLines[label] = incLines[label] || []).push(l); }
    else { expense[label] = (expense[label] || 0) + Math.abs(l.amount); (expLines[label] = expLines[label] || []).push(l); }
  });
  // Heads-up: rental income that isn't tagged to a specific property is invisible in rentals scope.
  if (scope === 'rentals') {
    (store.transactions || []).forEach(t => {
      if (!t.date || t.date < from || t.date > to) return;
      const handle = (amount, category, project) => {
        const kind = catKind[category];
        const isInc = kind === 'income' ? true : kind === 'expense' ? false : (amount >= 0);
        if (isInc && !isRentalProp(getPropertyByAddr(project))) unattributedRental += amount;
      };
      if (t.splits && t.splits.length) t.splits.forEach(s => handle(s.amount || 0, s.category || '', s.project || ''));
      else handle(t.amount || 0, t.category || '', t.project || '');
    });
  }

  const incRows = Object.entries(income).sort((a, b) => b[1] - a[1]);
  const expRows = Object.entries(expense).sort((a, b) => b[1] - a[1]);
  const totalInc = incRows.reduce((a, r) => a + r[1], 0);
  const totalExp = expRows.reduce((a, r) => a + r[1], 0);
  const net = totalInc - totalExp;
  const pct = totalInc + totalExp > 0 ? (totalInc / (totalInc + totalExp)) * 100 : 50;

  function exportCsv() {
    const flat = [
      ...incRows.map(([c, v]) => ({ section: 'Income', category: c, amount: round2(v) })),
      { section: 'Income', category: 'Total income', amount: round2(totalInc) },
      ...expRows.map(([c, v]) => ({ section: 'Expense', category: c, amount: round2(-v) })),
      { section: 'Expense', category: 'Total expenses', amount: round2(-totalExp) },
      { section: 'Net', category: 'Net profit / loss', amount: round2(net) },
    ];
    downloadCSV(`p-and-l_${from}_${to}.csv`, flat, [
      { key: 'section', label: 'Section' }, { key: 'category', label: 'Category' }, { key: 'amount', label: 'Amount' },
    ]);
  }

  return (
    <div>
      {/* CONTROLS */}
      <Card className="mb-16">
        <div className="card__body row gap-12 items-center wrap">
          <Segmented value={scope}
            options={[{ value: 'all', label: 'Whole business' }, { value: 'rentals', label: 'Rentals only' }]}
            onChange={setScope} />
          <div className="grow" />
          <label className="row gap-6 items-center small dim">From
            <input className="input mono" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
          </label>
          <label className="row gap-6 items-center small dim">To
            <input className="input mono" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
          </label>
          <Btn sz="sm" kind="ghost" onClick={exportCsv}>⤓ Export CSV</Btn>
        </div>
      </Card>

      {/* SUMMARY */}
      <Card className="mb-16">
        <div className="row" style={{ padding: '4px 0' }}>
          <div className="stat grow">
            <div className="stat__label">Income</div>
            <div className="stat__value" style={{ color: 'var(--sage)' }}>{fmtMoney(totalInc)}</div>
            <div className="stat__sub">{incRows.length} categor{incRows.length === 1 ? 'y' : 'ies'}</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Expenses</div>
            <div className="stat__value" style={{ color: 'var(--brick)' }}>{fmtMoney(totalExp)}</div>
            <div className="stat__sub">{expRows.length} categor{expRows.length === 1 ? 'y' : 'ies'}</div>
          </div>
          <div className="stat grow" style={{ borderLeft: '2px solid var(--rule)' }}>
            <div className="stat__label">Net {net >= 0 ? 'profit' : 'loss'}</div>
            <div className="stat__value" style={{ color: net >= 0 ? 'var(--sage)' : 'var(--brick)' }}>{fmtMoney(net, { sign: true })}</div>
            <div className="stat__sub">{fmtDate(from)} – {fmtDate(to)}</div>
          </div>
        </div>
        {(totalInc + totalExp > 0) && (
          <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', margin: '0 16px 16px' }}>
            <div style={{ width: pct + '%', background: 'var(--sage)' }} />
            <div style={{ width: (100 - pct) + '%', background: 'var(--brick)' }} />
          </div>
        )}
      </Card>

      <div className="grid g-2 gap-16">
        <PnlSection title="Income" rows={incRows} total={totalInc} tone="var(--sage)" sign={1} linesByCat={incLines} />
        <PnlSection title="Expenses" rows={expRows} total={totalExp} tone="var(--brick)" sign={-1} linesByCat={expLines} />
      </div>

      <Card className="mt-16">
        <div className="card__body row between items-center">
          <span className="serif" style={{ fontSize: 18, fontWeight: 600 }}>Net {net >= 0 ? 'profit' : 'loss'}</span>
          <span className="mono" style={{ fontSize: 24, fontWeight: 700, color: net >= 0 ? 'var(--sage)' : 'var(--brick)' }}>{fmtMoney(net, { sign: true })}</span>
        </div>
      </Card>

      <div className="small dim mt-16" style={{ maxWidth: 760, lineHeight: 1.6 }}>
        Figures come from your logged transactions (splits counted individually) over the selected range.
        Categories are sorted into income and expense by their list setting; uncategorized lines are grouped by amount.
        {scope === 'rentals' && (
          <> <strong>Rentals only</strong> counts transactions tagged to a property in the Rental status.
            {unattributedRental > 0 && <> {fmtMoney(unattributedRental)} of income in this range isn't tagged to a specific rental, so it isn't shown here — switch to <em>Whole business</em> to include it.</>}
          </>
        )}
      </div>
    </div>
  );
}

function PnlSection({ title, rows, total, tone, sign, linesByCat }) {
  const [open, setOpen] = useState(null);
  return (
    <Card>
      <CardHead title={title} />
      {rows.length === 0
        ? <div className="card__body small dim">No {title.toLowerCase()} in this range.</div>
        : (
          <table className="tbl">
            <tbody>
              {rows.map(([cat, v]) => {
                const isOpen = open === cat;
                const catLines = (linesByCat && linesByCat[cat]) || [];
                return (
                <React.Fragment key={cat}>
                <tr onClick={() => setOpen(isOpen ? null : cat)} style={{ cursor: 'pointer' }} title={isOpen ? 'Hide transactions' : 'Show ' + catLines.length + ' transaction' + (catLines.length === 1 ? '' : 's')}>
                  <td><span style={{ display: 'inline-block', width: 14, color: 'var(--ink-3)' }}>{isOpen ? '▾' : '▸'}</span>{cat === 'Uncategorized' ? <span className="dim">Uncategorized</span> : <Tag tone="ghost">{cat}</Tag>}<span className="tiny dim" style={{ marginLeft: 6 }}>{catLines.length}</span></td>
                  <td className="num mono" style={{ width: 140 }}>{fmtMoney(sign * v, { sign: true })}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={2} style={{ padding: 0, background: 'var(--paper-3)' }}>
                      <div style={{ padding: '4px 12px 8px 26px', maxHeight: 320, overflowY: 'auto' }}>
                        {[...catLines].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((l, i) => (
                          <div key={i} className="row gap-10 items-center" style={{ padding: '5px 0', borderTop: '1px solid var(--rule-soft)' }}>
                            <span className="mono small dim" style={{ width: 64, flexShrink: 0 }}>{fmtDate(l.date)}</span>
                            <span className="small grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.desc}{l.payee && <span className="dim">{' · ' + l.payee}</span>}</span>
                            {l.split && <Tag tone="blue">split</Tag>}
                            {l.project && l.project !== 'multiple' && <span className="tiny dim" style={{ flexShrink: 0, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.project}</span>}
                            <span className="mono small" style={{ width: 92, textAlign: 'right', flexShrink: 0, color: l.amount < 0 ? 'var(--brick)' : 'var(--sage)' }}>{fmtMoney(l.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--rule)', fontWeight: 600 }}>
                <td>Total {title.toLowerCase()}</td>
                <td className="num mono" style={{ color: tone }}>{fmtMoney(sign * total, { sign: true })}</td>
              </tr>
            </tfoot>
          </table>
        )}
    </Card>
  );
}

window.ReportsScreen = ReportsScreen;
