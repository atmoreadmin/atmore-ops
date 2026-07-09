// screens/tax-binder.jsx — Annual tax binder
// Aggregates everything you'd need for tax filing: rent collected, expenses by category,
// sold properties, 1099s issued, insurance/tax payments — for a chosen year.

function TaxBinderScreen() {
  const store = useStore();
  const [year, setYear] = useState(parseInt(TODAY().slice(0,4)));
  const [soldSort, setSoldSort] = useState({ key: 'salesDate', dir: 'desc' });
  const yearStr = String(year);

  // Rent collected — sum paid amount where paidOn falls in the year
  const rentCollected = store.rentLedger
    .filter(r => r.paidOn && r.paidOn.startsWith(yearStr))
    .reduce((a,r) => a + r.paid, 0);

  // Expenses by category — transactions in year with negative amount
  const txInYear = store.transactions.filter(t => t.date.startsWith(yearStr));
  const expensesByCat = {};
  let totalExpenses = 0;
  txInYear.forEach(t => {
    if (t.amount >= 0) return;
    const cat = t.category || 'Uncategorized';
    expensesByCat[cat] = (expensesByCat[cat] || 0) + Math.abs(t.amount);
    totalExpenses += Math.abs(t.amount);
  });
  const catRows = Object.entries(expensesByCat).sort((a,b) => b[1] - a[1]);

  // Income by category (positive amounts)
  const incomeByCat = {};
  let totalIncome = 0;
  txInYear.forEach(t => {
    if (t.amount <= 0) return;
    const cat = t.category || 'Uncategorized';
    incomeByCat[cat] = (incomeByCat[cat] || 0) + t.amount;
    totalIncome += t.amount;
  });

  // Sold properties — those with a sales date in the year
  const soldThisYear = store.properties.filter(p =>
    p.salesDate && p.salesDate.startsWith(yearStr) ||
    p.stageHistory?.some(h => h.to === 'I' && h.at && h.at.startsWith(yearStr))
  );

  // 1099s issued for year
  const ten99s = store.contractors
    .filter(c => (c.ten99History || []).some(h => h.taxYear === year && h.status === 'issued'))
    .map(c => ({ ...c, history: c.ten99History.find(h => h.taxYear === year) }));
  const ten99Pending = store.contractors.filter(c => ten99Status(c, year) === 'ready' || ten99Status(c, year) === 'w9_missing');

  // Property tax & insurance from properties (annual)
  const annualTaxes = store.properties.reduce((a,p) => a + (p.taxes?.annualAmount || 0), 0);
  const annualInsurance = store.properties.reduce((a,p) => a + (p.insurance?.premium || 0), 0);

  const netIncome = totalIncome + rentCollected - totalExpenses;

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Year-end tax binder</div>
          <h1>{year} · operating summary</h1>
        </div>
        <div className="row gap-8 items-center">
          <Btn sz="sm" kind="ghost" onClick={() => setYear(y => y-1)}>← {year-1}</Btn>
          <Btn sz="sm" kind="ghost" onClick={() => setYear(y => y+1)}>{year+1} →</Btn>
          <Btn kind="primary" onClick={() => window.print()}>🖨 Print binder</Btn>
        </div>
      </div>

      <Card className="mb-16">
        <div className="row" style={{padding: '4px 0'}}>
          <div className="stat stat--sage grow">
            <div className="stat__label">Rent collected</div>
            <div className="stat__value">{fmtMoney(rentCollected)}</div>
            <div className="stat__sub">across {store.tenants.filter(t => t.status === 'active').length} tenants</div>
          </div>
          <div className="stat stat--sage grow">
            <div className="stat__label">Other income</div>
            <div className="stat__value">{fmtMoney(totalIncome)}</div>
            <div className="stat__sub">tagged Rental Income, etc.</div>
          </div>
          <div className="stat stat--brick grow">
            <div className="stat__label">Total expenses</div>
            <div className="stat__value">{fmtMoney(totalExpenses)}</div>
            <div className="stat__sub">across {catRows.length} categories</div>
          </div>
          <div className={'stat grow ' + (netIncome > 0 ? 'stat--sage' : 'stat--brick')}>
            <div className="stat__label">Net (cash basis)</div>
            <div className="stat__value">{fmtMoney(netIncome, {sign: true})}</div>
            <div className="stat__sub">income − expenses</div>
          </div>
        </div>
      </Card>

      <div className="grid g-2 mb-16">
        <Card>
          <CardHead title="Expenses by category" right={<Tag tone="ghost">{txInYear.filter(t => t.amount < 0).length} tx</Tag>}/>
          <table className="tbl">
            <thead><tr><th>Category</th><th className="num">Amount</th><th>Share</th></tr></thead>
            <tbody>
              {catRows.length === 0 ? <tr><td colSpan="3"><div className="small dim text-c" style={{padding: 24}}>No expenses tagged this year.</div></td></tr> :
                catRows.map(([cat, amt]) => (
                  <tr key={cat}>
                    <td><Tag tone={cat === 'Uncategorized' ? 'ochre' : 'ghost'}>{cat}</Tag></td>
                    <td className="num mono">{fmtMoney(amt)}</td>
                    <td><Progress pct={amt / Math.max(totalExpenses, 1) * 100} tone="brick"/></td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHead title="Income breakdown" right={<Tag tone="ghost">{Object.keys(incomeByCat).length} sources</Tag>}/>
          <div className="card__body col gap-10">
            <div className="row between items-center" style={{padding: '8px 0', borderBottom: '1px solid var(--rule-soft)'}}>
              <div>
                <div style={{fontWeight: 500}}>Rent payments received</div>
                <div className="small dim">from rent ledger</div>
              </div>
              <div className="mono">{fmtMoney(rentCollected)}</div>
            </div>
            {Object.entries(incomeByCat).map(([cat, amt]) => (
              <div key={cat} className="row between items-center" style={{padding: '8px 0', borderBottom: '1px solid var(--rule-soft)'}}>
                <div>
                  <div style={{fontWeight: 500}}>{cat}</div>
                  <div className="small dim">from transactions tagged "{cat}"</div>
                </div>
                <div className="mono">{fmtMoney(amt)}</div>
              </div>
            ))}
            <div className="divider" style={{margin: '4px 0'}}/>
            <div className="row between items-center">
              <div style={{fontWeight: 600}}>Total income</div>
              <div className="serif" style={{fontSize: 18, fontWeight: 600, color: 'var(--sage)'}}>{fmtMoney(rentCollected + totalIncome)}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mb-16">
        <CardHead title="Property tax & insurance (annual)" right={<Tag tone="ghost">{store.properties.filter(p => p.taxes || p.insurance).length} properties</Tag>}/>
        <div className="grid g-2 card__body">
          <div>
            <div className="up dim">Total annual property tax</div>
            <div className="serif" style={{fontSize: 24, fontWeight: 500}}>{fmtMoney(annualTaxes)}</div>
            <div className="small dim">across all properties (computed from tax data on file)</div>
          </div>
          <div>
            <div className="up dim">Total annual insurance premiums</div>
            <div className="serif" style={{fontSize: 24, fontWeight: 500}}>{fmtMoney(annualInsurance)}</div>
            <div className="small dim">deductible as operating expense</div>
          </div>
        </div>
      </Card>

      <Card className="mb-16">
        <CardHead title={`Vacancy report · ${year}`} right={<Tag tone="ghost">{getVacancyReport(year).length} units</Tag>}/>
        {(() => {
          const vac = getVacancyReport(year);
          if (vac.length === 0) return <div className="card__body"><Empty title="No vacant units this year" sub="All rental properties had tenants the whole period."/></div>;
          const totalDays = vac.reduce((a,v) => a + v.days, 0);
          const totalLost = vac.reduce((a,v) => a + v.lostRent, 0);
          const totalCarry = vac.reduce((a,v) => a + v.carryingCost, 0);
          return (
            <>
              <div className="row" style={{padding: '4px 0', borderBottom: '1px solid var(--rule)'}}>
                <div className="stat grow">
                  <div className="stat__label">Vacant days (sum)</div>
                  <div className="stat__value">{totalDays.toLocaleString()}</div>
                </div>
                <div className="stat stat--brick grow">
                  <div className="stat__label">Estimated lost rent</div>
                  <div className="stat__value">{fmtMoney(totalLost)}</div>
                </div>
                <div className="stat stat--brick grow">
                  <div className="stat__label">Carrying cost (taxes + insurance + loan)</div>
                  <div className="stat__value">{fmtMoney(totalCarry)}</div>
                </div>
              </div>
              <table className="tbl">
                <thead><tr><th>Property</th><th>Vacant since</th><th>Status</th><th className="num">Days</th><th className="num">Lost rent</th><th className="num">Carrying cost</th></tr></thead>
                <tbody>
                  {vac.map((v, i) => (
                    <tr key={i} onClick={() => nav('/property/'+v.property.id)}>
                      <td><span className="addr">{v.property.address}</span></td>
                      <td className="mono small dim">{fmtDate(v.vacantSince, {full: true})}</td>
                      <td><Tag tone="ochre">{v.status}</Tag></td>
                      <td className="num mono">{v.days}</td>
                      <td className="num mono" style={{color: 'var(--brick)'}}>{fmtMoney(v.lostRent)}</td>
                      <td className="num mono" style={{color: 'var(--brick)'}}>{fmtMoney(v.carryingCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          );
        })()}
      </Card>

      <Card className="mb-16">
        <CardHead title={`Properties sold in ${year}`} right={<Tag tone="ghost">{soldThisYear.length}</Tag>}/>
        {soldThisYear.length === 0 ? (
          <div className="card__body"><Empty title="No properties sold this year"/></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>{[
                ['address', 'Property', false],
                ['salesDate', 'Sold date', false],
                ['salesPrice', 'Sale price', true],
                ['cost', 'Cost basis', true],
                ['profit', 'Net profit', true],
                ['llc', 'Vesting LLC', false],
              ].map(([k, label, numeric]) => (
                <th key={k} className={numeric ? 'num' : undefined}
                  onClick={() => setSoldSort(s => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))}
                  style={{cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap'}} title="Click to sort">
                  {label}{soldSort.key === k ? (soldSort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {[...soldThisYear].sort((a, b) => {
                const val = p => {
                  const cost = Math.abs(p.purchasePrice || 0) + (p.rehab || 0) + Math.abs(p.interest || 0) + Math.abs(p.purchaseFees || 0);
                  const profit = p.grossProfit != null ? p.grossProfit : (p.salesPrice || 0) - cost;
                  switch (soldSort.key) {
                    case 'address': return (p.address || '').toLowerCase();
                    case 'salesDate': return p.salesDate || '';
                    case 'salesPrice': return p.salesPrice || 0;
                    case 'cost': return cost;
                    case 'profit': return profit;
                    case 'llc': return (p.vestingLLC || '').toLowerCase();
                    default: return p.salesDate || '';
                  }
                };
                const av = val(a), bv = val(b);
                const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
                return soldSort.dir === 'asc' ? cmp : -cmp;
              }).map(p => {
                const cost = Math.abs(p.purchasePrice || 0) + (p.rehab || 0) + Math.abs(p.interest || 0) + Math.abs(p.purchaseFees || 0);
                // Use the close-out's saved profit (cash-basis when actuals were entered); fall back to the rough estimate.
                const gross = p.grossProfit != null ? p.grossProfit : (p.salesPrice || 0) - cost;
                return (
                  <tr key={p.id} onClick={() => nav('/property/'+p.id)}>
                    <td><span className="addr">{p.address}</span><div className="addr-sub">{p.type}</div></td>
                    <td className="mono small dim">{fmtDate(p.salesDate, {full: true})}</td>
                    <td className="num mono">{fmtMoney(p.salesPrice || 0)}</td>
                    <td className="num mono dim">{fmtMoney(cost)}</td>
                    <td className="num mono" style={{color: gross > 0 ? 'var(--sage)' : 'var(--brick)', fontWeight: 500}}>{fmtMoney(gross, {sign: true})}</td>
                    <td className="small dim">{p.vestingLLC || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mb-16">
        <CardHead title={`1099s for ${year}`} right={
          <div className="row gap-6">
            <Tag tone="sage">{ten99s.length} issued</Tag>
            {ten99Pending.length > 0 && <Tag tone="ochre">{ten99Pending.length} pending</Tag>}
          </div>
        }/>
        {ten99s.length === 0 && ten99Pending.length === 0 ? (
          <div className="card__body"><Empty title="No 1099 activity yet for this year"/></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Contractor</th><th>Status</th><th>Date issued</th><th className="num">Reported</th></tr></thead>
            <tbody>
              {ten99s.map(c => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td><Tag tone="sage">Issued</Tag></td>
                  <td className="mono small dim">{fmtDate(c.history.issuedDate, {full: true})}</td>
                  <td className="num mono">{fmtMoney(c.history.amountReported)}</td>
                </tr>
              ))}
              {ten99Pending.map(c => {
                const s = ten99Status(c, year);
                return (
                  <tr key={c.id} onClick={() => nav('/contractors')}>
                    <td>{c.name}</td>
                    <td><Tag tone={ten99StatusTone(s)}>{ten99StatusLabel(s)}</Tag></td>
                    <td className="dim small">—</td>
                    <td className="num mono dim">{fmtMoney(c.ytd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="small dim" style={{maxWidth: 700, lineHeight: 1.6}}>
        This is a cash-basis summary derived from your transaction tags and rent ledger. Bring this binder to your accountant — they'll ask for backup on each category, your 1099-NEC filings, and the gross profit on each sold property.
      </div>
    </div>
  );
}

window.TaxBinderScreen = TaxBinderScreen;
