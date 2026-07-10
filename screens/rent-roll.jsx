// screens/rent-roll.jsx — with toggle: Current month (A) | Year grid (C)

function RentRollScreen() {
  const store = useStore();
  const [view, setView] = useState('current'); // 'current' or 'grid'
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [paidModal, setPaidModal] = useState(null);
  const [noticeModal, setNoticeModal] = useState(null);

  const month = getCurrentMonth();
  ensureLedgerForMonth(month);
  reconcileRentAcrossMonths();
  const monthLedger = getLedgerForMonth(month);

  // Filter
  let rows = monthLedger.slice();
  rows = rows.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (search) {
      const t = getTenant(r.tenantId);
      const p = getProperty(r.propertyId);
      const hay = `${t?.name||''} ${p?.address||''}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  // sort: vacate first, late, partial, paid
  const order = { 'vacate-due': 0, 'late': 1, 'partial': 2, 'paid': 3 };
  rows.sort((a,b) => (order[a.status]||9) - (order[b.status]||9));

  const totalCharge = monthLedger.reduce((a,r) => a + r.charge, 0);
  const totalPaid = monthLedger.reduce((a,r) => a + r.paid, 0);
  const statusCounts = {};
  monthLedger.forEach(r => { statusCounts[r.status] = (statusCounts[r.status]||0)+1; });

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Rent Roll</div>
          <h1>Who's paid, who hasn't</h1>
        </div>
        <Segmented
          value={view}
          options={[{value:'current', label:'Current month'}, {value:'grid', label:'Year grid'}]}
          onChange={setView}/>
      </div>

      {/* SUMMARY BAR */}
      <Card className="mb-16">
        <div className="row" style={{padding: '4px 0'}}>
          <div className="stat grow">
            <div className="stat__label">Collected · {fmtMonthLong(month)}</div>
            <div className="stat__value">{fmtMoney(totalPaid)}</div>
            <div className="stat__sub">of {fmtMoney(totalCharge)}</div>
          </div>
          <div className="stat stat--brick grow">
            <div className="stat__label">Outstanding</div>
            <div className="stat__value">{fmtMoney(totalCharge - totalPaid)}</div>
            <div className="stat__sub">{monthLedger.filter(r => (r.paid||0) < r.charge).length} tenants</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Active leases</div>
            <div className="stat__value">{getActiveTenants().length}</div>
            <div className="stat__sub">+ {store.tenants.filter(t => t.status==='prep').length} prepping · {store.tenants.filter(t => t.status==='vacant').length} vacant</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Vacate notices due</div>
            <div className="stat__value" style={{color: statusCounts['vacate-due'] ? 'var(--brick)' : 'var(--ink-3)'}}>{statusCounts['vacate-due']||0}</div>
            <div className="stat__sub">past day 11 of the month</div>
          </div>
        </div>
      </Card>

      {view === 'current' && (
        <CurrentMonthView rows={rows} monthLedger={monthLedger}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          search={search} setSearch={setSearch}
          onMarkPaid={setPaidModal} onNotice={setNoticeModal}
          statusCounts={statusCounts}/>
      )}

      {view === 'grid' && <YearGridView />}

      {paidModal && (
        <MarkPaidModal ledgerEntry={paidModal} onClose={() => setPaidModal(null)}/>
      )}
      {noticeModal && (
        <NoticeModal ledgerEntry={noticeModal} onClose={() => setNoticeModal(null)}/>
      )}
    </div>
  );
}

// ────── A: Current month view (dense table) ──────
function CurrentMonthView({ rows, monthLedger, statusFilter, setStatusFilter, search, setSearch, onMarkPaid, onNotice, statusCounts }) {
  const month = getCurrentMonth();
  const [sortKey, setSortKey] = useState('status');
  const [sortDir, setSortDir] = useState('asc');

  function clickHeader(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'charge' || key === 'paid' || key === 'owed' ? 'desc' : 'asc'); }
  }
  const statusOrder = { 'vacate-due': 0, 'late': 1, 'partial': 2, 'paid': 3 };
  const RR_SORT = {
    tenant:   r => (getTenant(r.tenantId)?.name || '').toLowerCase(),
    property: r => (getProperty(r.propertyId)?.address || '').toLowerCase(),
    due:      r => r.month || '',
    charge:   r => r.charge || 0,
    paid:     r => r.paid || 0,
    owed:     r => r.charge - r.paid + lateFeeFor(r),
    source:   r => (r.source || '').toLowerCase(),
    status:   r => statusOrder[r.status] ?? 9,
  };
  const sv = RR_SORT[sortKey] || RR_SORT.status;
  const sortedRows = rows.slice().sort((a,b) => {
    const av = sv(a), bv = sv(b);
    let cmp;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });
  const Th = ({ k, label, num }) => (
    <th className={num ? 'num' : ''} style={{cursor: 'pointer', userSelect: 'none'}} onClick={() => clickHeader(k)}>
      {label}{sortKey === k && <span style={{marginLeft: 4, color: 'var(--blue)'}}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
  rows = sortedRows;
  return (
    <>
      <Card className="mb-16">
        <div className="card__body row gap-12 items-center wrap">
          <input className="input" placeholder="Search tenant or property…" value={search} onChange={e => setSearch(e.target.value)} style={{flex: '1 1 240px'}}/>
          <Segmented
            value={statusFilter}
            options={[
              {value: 'all', label: `All (${monthLedger.length})`},
              {value: 'upcoming', label: `Due (${statusCounts['upcoming']||0})`},
              {value: 'vacate-due', label: `Vacate due (${statusCounts['vacate-due']||0})`},
              {value: 'late', label: `Late (${statusCounts['late']||0})`},
              {value: 'partial', label: `Partial (${statusCounts['partial']||0})`},
              {value: 'paid', label: `Paid (${statusCounts['paid']||0})`},
            ]}
            onChange={setStatusFilter}/>
          <div className="grow"/>
          <Btn sz="sm" kind="ghost" onClick={() => {
            downloadCSV(`rent-roll-${month}.csv`, monthLedger, [
              { key: 'month', label: 'Month' },
              { key: 'tenant', label: 'Tenant', fn: r => getTenant(r.tenantId)?.name || '' },
              { key: 'property', label: 'Property', fn: r => getProperty(r.propertyId)?.address || '' },
              { key: 'charge', label: 'Charge' },
              { key: 'paid', label: 'Paid' },
              { key: 'paidOn', label: 'Paid on' },
              { key: 'source', label: 'Source' },
              { key: 'status', label: 'Status' },
              { key: 'lateFee', label: 'Late fee', fn: r => lateFeeFor(r) },
            ]);
          }}>⤓ Export</Btn>
        </div>
      </Card>

      <Card>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{width: 30}}></th>
              <Th k="tenant" label="Tenant"/>
              <Th k="property" label="Property"/>
              <Th k="due" label="Due"/>
              <Th k="charge" label="Charge" num/>
              <Th k="paid" label="Paid" num/>
              <Th k="owed" label="Owed" num/>
              <Th k="source" label="Source"/>
              <Th k="status" label="Status"/>
              <th style={{width: 1}}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan="10"><Empty title="No tenants match" sub="Try clearing filters."/></td></tr>
            ) : rows.map(r => {
              const t = getTenant(r.tenantId);
              const p = getProperty(r.propertyId);
              const lateFee = lateFeeFor(r);
              const owed = r.charge - r.paid + lateFee;
              const isLate = r.status === 'late' || r.status === 'vacate-due';
              return (
                <tr key={r.id} className={isLate ? 'row--late' : ''}>
                  <td><Av name={t?.name}/></td>
                  <td>
                    <div style={{fontWeight: 500, fontSize: 13}}>{t?.name || <span className="dim">—</span>}</div>
                    <div className="addr-sub">{t?.phone || t?.voucher || ''}</div>
                  </td>
                  <td onClick={(e) => { e.stopPropagation(); if (p) nav('/property/'+p.id); }}>
                    <span className="addr" style={{fontSize: 13}}>{p?.address || '—'}</span>
                  </td>
                  <td className="mono small">{r.month}-01</td>
                  <td className="num mono">{fmtMoney(r.charge)}</td>
                  <td className="num mono" style={{color: r.paid ? 'var(--sage)' : 'var(--ink-3)'}}>{r.paid ? fmtMoney(r.paid) : '—'}</td>
                  <td className="num mono" style={{color: owed > 0 ? 'var(--brick)' : 'var(--ink-3)'}}>
                    {owed > 0 ? (
                      <div>
                        <div>{fmtMoney(owed)}</div>
                        {lateFee > 0 && (
                          <div className="tiny dim" style={{fontWeight: 400}}>
                            incl. {fmtMoney(lateFee)} fee · <span style={{color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline'}} onClick={(e) => { e.stopPropagation(); waiveLateFee(r.id, true); }}>waive</span>
                          </div>
                        )}
                        {lateFee === 0 && r.lateFeeWaived && (
                          <div className="tiny dim" style={{fontWeight: 400}}>
                            fee waived · <span style={{color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline'}} onClick={(e) => { e.stopPropagation(); waiveLateFee(r.id, false); }}>restore</span>
                          </div>
                        )}
                      </div>
                    ) : (r.lateFeeWaived || r.reducedCharge) ? (
                      <div className="tiny dim" style={{fontWeight: 400}}>{r.reducedCharge ? 'reduced rate' : 'fee waived'}</div>
                    ) : '—'}
                  </td>
                  <td><Tag tone="ghost">{r.source || '—'}</Tag></td>
                  <td><Tag tone={rentStatusTone(r.status)}>{rentStatusLabel(r.status)}</Tag></td>
                  <td>
                    <div className="row gap-6">
                      {r.status !== 'paid' && (
                        <Btn sz="sm" kind="ghost" onClick={(e) => { e.stopPropagation(); onMarkPaid(r); }}>Mark paid</Btn>
                      )}
                      {r.status === 'vacate-due' && (
                        <Btn sz="sm" kind="danger" onClick={(e) => { e.stopPropagation(); onNotice(r); }}>Notice</Btn>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

// ────── C: Year grid view ──────
function YearGridView() {
  const store = useStore();
  const [year, setYear] = useState(TODAY().slice(0, 4));
  const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tenants = getActiveTenants();
  // build map
  const map = {};
  store.rentLedger.forEach(r => {
    map[r.tenantId + '-' + r.month] = r;
  });

  // Status helpers
  const cell = (status) => {
    if (!status) return { bg: 'transparent', color: 'var(--ink-4)', sym: '·', label: '' };
    if (status === 'paid')        return { bg: 'var(--sage-soft)', color: 'var(--sage)', sym: '✓', label: 'Paid' };
    if (status === 'upcoming')    return { bg: 'var(--blue-soft)', color: 'var(--blue)',  sym: '•', label: 'Due' };
    if (status === 'partial')     return { bg: 'var(--ochre-soft)',color: 'var(--ochre)',sym: '½', label: 'Partial' };
    if (status === 'late')        return { bg: 'var(--brick-soft)',color: 'var(--brick)',sym: '✗', label: 'Late' };
    if (status === 'vacate-due')  return { bg: 'var(--brick)',     color: 'white',       sym: '!', label: 'Vacate' };
    return { bg: 'transparent', color: 'var(--ink-4)', sym: '·', label: '' };
  };
  const todayMonth = TODAY().slice(5,7);

  return (
    <Card>
      <CardHead title={`${year} · monthly grid`}
        right={
          <div className="row gap-8 items-center">
            <Btn sz="sm" kind="ghost" onClick={() => setYear(y => String(parseInt(y)-1))}>←</Btn>
            <span className="serif" style={{fontSize: 15}}>{year}</span>
            <Btn sz="sm" kind="ghost" onClick={() => setYear(y => String(parseInt(y)+1))}>→</Btn>
          </div>
        }/>
      <div className="card__body" style={{overflowX: 'auto'}}>
        <div style={{display: 'grid', gridTemplateColumns: '220px 80px repeat(12, 56px)', alignItems: 'center', gap: 0, minWidth: 'fit-content'}}>
          <div className="up dim" style={{padding: '0 0 10px 0'}}>Tenant</div>
          <div className="up dim text-r" style={{padding: '0 8px 10px 0'}}>Monthly</div>
          {months.map((m, i) => (
            <div key={m} className="up dim text-c" style={{
              padding: '0 0 10px 0',
              color: m === todayMonth && year === TODAY().slice(0,4) ? 'var(--blue)' : 'var(--ink-3)',
              fontWeight: m === todayMonth && year === TODAY().slice(0,4) ? 600 : 500,
            }}>{monthLabels[i]}</div>
          ))}

          {tenants.map((t) => (
            <React.Fragment key={t.id}>
              <div style={{padding: '12px 0', borderTop: '1px solid var(--rule-soft)'}}>
                <div style={{fontSize: 13, fontWeight: 500}}>{t.name}</div>
                <div className="addr-sub" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{getProperty(t.propertyId)?.address || ''}</div>
              </div>
              <div className="mono small text-r" style={{borderTop: '1px solid var(--rule-soft)', padding: '12px 8px 12px 0'}}>{fmtMoney(t.rent)}</div>
              {months.map((m,i) => {
                const ledger = map[t.id + '-' + year + '-' + m];
                const future = year > TODAY().slice(0,4) || (year === TODAY().slice(0,4) && m > todayMonth);
                const c = ledger ? cell(ledger.status) : (future ? cell(null) : { bg: 'var(--paper-3)', color: 'var(--ink-3)', sym: '·', label: 'No data' });
                return (
                  <div key={m} style={{padding: '8px 4px', borderTop: '1px solid var(--rule-soft)', display: 'flex', justifyContent: 'center'}}>
                    <div title={c.label || (future ? 'Not yet due' : 'No record')} style={{
                      width: 44, height: 30,
                      borderRadius: 4,
                      background: c.bg,
                      color: c.color,
                      border: c.bg === 'transparent' ? '1px dashed var(--rule)' : '1px solid currentColor',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: 'IBM Plex Mono, monospace',
                    }}>{c.sym}</div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="card__body" style={{borderTop: '1px solid var(--rule)', padding: '12px 14px'}}>
        <div className="row gap-12 wrap items-center">
          <Tag tone="sage">✓ Paid</Tag>
          <Tag tone="ochre">½ Partial</Tag>
          <Tag tone="brick">✗ Late</Tag>
          <Tag tone="solid-brick">! Vacate</Tag>
          <Tag tone="blue">• Due</Tag>
          <Tag tone="ghost">· Not yet due</Tag>
          <div className="grow"/>
          <span className="small dim">Hover a cell for tenant + month detail</span>
        </div>
      </div>
    </Card>
  );
}

// ────── Mark Paid Modal ──────
function MarkPaidModal({ ledgerEntry, onClose }) {
  const t = getTenant(ledgerEntry.tenantId);
  const p = getProperty(ledgerEntry.propertyId);
  const lateFee = lateFeeFor(ledgerEntry);
  const totalOutstanding = ledgerEntry.charge - ledgerEntry.paid + lateFee;
  const [amount, setAmount] = useState(totalOutstanding);
  const [waive, setWaive] = useState(!!ledgerEntry.lateFeeWaived);
  const [acceptLower, setAcceptLower] = useState(false);
  const [showReconcile, setShowReconcile] = useState(true);

  // Recompute when waive toggles
  React.useEffect(() => {
    const lf = waive ? 0 : Math.round(ledgerEntry.charge * 0.05);
    if (ledgerEntry.status === 'paid') return;
    setAmount((ledgerEntry.charge - ledgerEntry.paid) + (ledgerEntry.status === 'paid' ? 0 : lf));
  }, [waive]);

  function pickTx(tx) {
    if (waive !== !!ledgerEntry.lateFeeWaived) waiveLateFee(ledgerEntry.id, waive);
    markPaid(ledgerEntry.id, ledgerEntry.paid + tx.amount);
    linkLedgerToTransaction(ledgerEntry.id, tx.id);
    onClose();
  }

  return (
    <Modal title="Record payment" onClose={onClose}>
      <div className="col gap-14">
        <div>
          <div className="up dim">Tenant</div>
          <div className="serif" style={{fontSize: 18, fontWeight: 500}}>{t?.name}</div>
          <div className="addr-sub">{p?.address} · {ledgerEntry.source}</div>
        </div>

        {showReconcile && <ReconcilePicker ledger={ledgerEntry} onPick={pickTx} onSkip={() => setShowReconcile(false)}/>}

        <div className="row gap-16">
          <div>
            <div className="up dim">Charge</div>
            <div className="serif" style={{fontSize: 22, fontWeight: 500}}>{fmtMoney(ledgerEntry.charge)}</div>
          </div>
          <div className="divider-v"/>
          <div>
            <div className="up dim">Already paid</div>
            <div className="serif" style={{fontSize: 22, fontWeight: 500}}>{fmtMoney(ledgerEntry.paid)}</div>
          </div>
          {lateFee > 0 && !waive && (
            <>
              <div className="divider-v"/>
              <div>
                <div className="up dim">Late fee</div>
                <div className="serif" style={{fontSize: 22, fontWeight: 500, color: 'var(--ochre)'}}>{fmtMoney(lateFee)}</div>
              </div>
            </>
          )}
          <div className="divider-v"/>
          <div>
            <div className="up dim">Outstanding</div>
            <div className="serif" style={{fontSize: 22, fontWeight: 500, color: 'var(--brick)'}}>{fmtMoney(totalOutstanding)}</div>
          </div>
        </div>

        {(lateFee > 0 || ledgerEntry.lateFeeWaived) && (
          <label className="row gap-6 items-center small" style={{cursor: 'pointer'}}>
            <input type="checkbox" checked={waive} onChange={e => setWaive(e.target.checked)}/>
            <span>Waive late fee {waive && <span className="dim">(applies to this month only)</span>}</span>
          </label>
        )}

        <div>
          <div className="up dim" style={{marginBottom: 4}}>Amount received</div>
          <div className="row gap-8 items-center">
            <span className="serif" style={{fontSize: 22, color: 'var(--ink-3)'}}>$</span>
            <input className="input" style={{fontSize: 18, fontFamily: 'IBM Plex Mono, monospace', width: 160}}
              type="number" step="0.01"
              value={amount} onChange={e => setAmount(parseFloat(e.target.value)||0)} autoFocus/>
            <Btn sz="sm" kind="ghost" onClick={() => setAmount(ledgerEntry.charge - ledgerEntry.paid)}>fill outstanding</Btn>
            <Btn sz="sm" kind="ghost" onClick={() => setAmount(ledgerEntry.charge)}>fill full</Btn>
          </div>
        </div>

        {(ledgerEntry.paid + amount) < ledgerEntry.charge && amount > 0 && (
          <label className="row gap-6 items-center small" style={{cursor: 'pointer'}}>
            <input type="checkbox" checked={acceptLower} onChange={e => setAcceptLower(e.target.checked)}/>
            <span>Accept as paid in full at this lower rate <span className="dim">(reduces this month's charge to {fmtMoney(ledgerEntry.paid + amount)})</span></span>
          </label>
        )}

        <div className="row gap-12 items-center" style={{marginTop: 8}}>
          <span className="small dim">Recording as paid on {fmtDate(TODAY(), {full: true})}</span>
          <div className="grow"></div>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" onClick={() => {
            if (waive !== !!ledgerEntry.lateFeeWaived) waiveLateFee(ledgerEntry.id, waive);
            if (acceptLower && (ledgerEntry.paid + amount) < ledgerEntry.charge) {
              settleReducedRent(ledgerEntry.id, ledgerEntry.paid + amount);
            } else {
              markPaid(ledgerEntry.id, ledgerEntry.paid + amount);
            }
            onClose();
          }}>Record payment</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ────── Notice modal (live preview before generating) ──────
function NoticeModal({ ledgerEntry, onClose }) {
  const t = getTenant(ledgerEntry.tenantId);
  const p = getProperty(ledgerEntry.propertyId);
  const lateFee = lateFeeFor(ledgerEntry);
  const totalDue = ledgerEntry.charge - ledgerEntry.paid + lateFee;
  return (
    <Modal title="10-day notice to pay or quit"
      onClose={onClose}
      right={<Btn sz="sm" kind="primary" onClick={() => openPrintWindow([ledgerEntry])}>🖨 Print / save PDF</Btn>}>
      <div style={{background: 'white', border: '1px solid var(--rule)', padding: '36px 44px', borderRadius: 6, color: '#1c1a14', fontFamily: 'IBM Plex Sans'}}>
        <div className="row between items-start mb-16">
          <AtmoreLogo size={36}/>
          <div className="small" style={{textAlign:'right', color:'#4a463c'}}>
            Atmore Properties, LLC<br/>
            P.O. Box 12345 · Charlotte, NC 28202<br/>
            704-555-0100
          </div>
        </div>
        <div style={{borderTop: '2px solid #1c1a14', marginBottom: 18}}/>
        <div className="text-c mb-16">
          <div className="serif" style={{fontSize: 20, fontWeight: 600, letterSpacing: '0.04em'}}>10-DAY NOTICE TO PAY RENT OR QUIT</div>
          <div className="small dim" style={{marginTop: 4}}>(In compliance with N.C. Gen. Stat. § 42-3)</div>
        </div>
        <div className="small" style={{lineHeight: 1.7}}>
          <p><strong>To:</strong> {t?.name || '—'}<br/>
          <strong>Premises:</strong> {p?.address}, {p?.city} {p?.state} {p?.zip}<br/>
          <strong>Date:</strong> {fmtDate(TODAY(), {full: true})}</p>

          <p>You are hereby notified that you are in default on the payment of rent for the above-described premises. The total amount currently due and owing is:</p>

          <table style={{width: '100%', fontSize: 13, marginTop: 8, marginBottom: 8, borderCollapse: 'collapse'}}>
            <tbody>
              <tr><td style={{padding: '4px 0', borderBottom: '1px dotted #c9c2b5'}}>Rent for {fmtMonthLong(ledgerEntry.month)}</td><td className="text-r mono">{fmtMoney(ledgerEntry.charge)}</td></tr>
              {ledgerEntry.paid > 0 && <tr><td style={{padding: '4px 0', borderBottom: '1px dotted #c9c2b5'}}>Less amount already paid</td><td className="text-r mono" style={{color: 'var(--sage)'}}>−{fmtMoney(ledgerEntry.paid)}</td></tr>}
              <tr><td style={{padding: '4px 0', borderBottom: '1px dotted #c9c2b5'}}>Late fee (per lease)</td><td className="text-r mono">{fmtMoney(lateFee)}</td></tr>
              <tr><td style={{padding: '4px 0', fontWeight: 600, borderTop: '1px solid #1c1a14'}}>Total due</td><td className="text-r mono" style={{fontWeight: 600}}>{fmtMoney(totalDue)}</td></tr>
            </tbody>
          </table>

          <p>You are required to pay the above amount in full <strong>within ten (10) days</strong> of receipt of this notice, or to surrender possession of the premises. If you fail to do either, legal proceedings for possession of the premises will be instituted against you.</p>

          <p>Payment may be made via the methods previously used (Zelle, certified check) at the address above. This notice does not waive landlord's right to collect any additional rent, fees, or damages that accrue.</p>

          <div className="row between" style={{marginTop: 24, gap: 24}}>
            <div className="grow"><div style={{borderBottom: '1px solid #1c1a14'}}>&nbsp;</div><div className="tiny dim mt-4">Landlord / authorized agent</div></div>
            <div className="grow"><div style={{borderBottom: '1px solid #1c1a14'}}>&nbsp;</div><div className="tiny dim mt-4">Date</div></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

window.RentRollScreen = RentRollScreen;
