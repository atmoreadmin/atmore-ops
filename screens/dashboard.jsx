// screens/dashboard.jsx — Alerts-first dashboard

const MONTHS_3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function DashboardScreen() {
  const store = useStore();
  const [addingProperty, setAddingProperty] = React.useState(false);
  const month = getCurrentMonth();
  const todayIso = TODAY();
  ensureLedgerForMonth(month);
  reconcileRentAcrossMonths();
  const monthLedger = getLedgerForMonth(month);
  const untagged = untaggedTransactions();

  // Compute alerts
  const vacateDue = monthLedger.filter(r => r.status === 'vacate-due');
  const lateAll = monthLedger.filter(r => r.status === 'late' || r.status === 'vacate-due' || r.status === 'partial');
  // Any charge not fully paid this month (includes still-due "upcoming" charges).
  const outstanding = monthLedger.filter(r => (r.paid || 0) < r.charge);
  const totalCharge = monthLedger.reduce((a,r) => a + r.charge, 0);
  const totalPaid = monthLedger.reduce((a,r) => a + r.paid, 0);
  const totalOwed = outstanding.reduce((a,r) => a + (r.charge - (r.paid || 0)), 0);
  const collectedPct = totalCharge ? Math.round(totalPaid / totalCharge * 100) : 0;

  // Pipeline counts (exclude archived I + J)
  const stageCounts = useMemo(() => {
    const c = {};
    const archived = new Set(getStatuses().filter(s => s.lane === 'archive').map(s => s.code));
    store.properties.forEach(p => {
      if (archived.has(p.statusCode)) return;
      c[p.statusCode] = (c[p.statusCode] || 0) + 1;
    });
    return c;
  }, [store.properties, store.statuses]);

  // Lease renewals — ending in 90 days
  const leaseRenewals = getLeaseRenewalCandidates();

  // Offers awaiting a response (received / countered)
  const offersAwaiting = offersAwaitingResponse();

  // Stale (>60 days in current stage)
  const staleProps = store.properties.filter(p => {
    if (p.statusCode !== 'C') return false;
    const d = daysInCurrentStage(p);
    return d != null && d > 60;
  });

  // Insurance renewals due in next 30 days
  const insuranceRenewals = store.properties.filter(p => {
    if (!p.insurance?.renewalDate) return false;
    const d = daysBetween(todayIso, p.insurance.renewalDate);
    return d != null && d <= 30 && d >= -7;
  }).sort((a,b) => a.insurance.renewalDate.localeCompare(b.insurance.renewalDate));

  // Property taxes due in next 30 days, not escrowed
  const taxesDue = store.properties.filter(p => {
    if (!p.taxes?.dueDate || p.taxes.escrowed) return false;
    const d = daysBetween(todayIso, p.taxes.dueDate);
    return d != null && d <= 30 && d >= -7;
  }).sort((a,b) => a.taxes.dueDate.localeCompare(b.taxes.dueDate));

  // Maintenance reminders / inspections due in next 14 days or overdue
  const remindersDue = getUpcomingReminders(14, 60);

  // Loan maturities in next 90 days
  const loanMaturities = store.properties.filter(p => {
    if (!p.loanDetail?.maturityDate) return false;
    const d = daysBetween(todayIso, p.loanDetail.maturityDate);
    return d != null && d <= 90 && d >= -7;
  }).sort((a,b) => a.loanDetail.maturityDate.localeCompare(b.loanDetail.maturityDate));

  // Capital at risk: sum of |purchasePrice| + rehab for owned, pre-sale properties (B–F)
  const capitalAtRisk = store.properties.filter(p => ['B','C','D','E','F'].includes(p.statusCode))
    .reduce((a,p) => a + Math.abs(p.purchasePrice||0) + (p.rehab || 0), 0);

  // active count excluding archive
  const activeCount = store.properties.filter(p => p.statusCode !== 'I' && p.statusCode !== 'J').length;

  // MTD cash out — from transactions, current month, negative amounts
  const mtdCashOut = store.transactions.filter(t => t.date.startsWith(month) && t.amount < 0)
    .reduce((a,t) => a + Math.abs(t.amount), 0);
  // MTD rent in — sum of paid in monthLedger
  const mtdRentIn = totalPaid;

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Dashboard</div>
          <h1>Today's operations</h1>
        </div>
        <div className="row gap-8">
          <Btn kind="ghost" sz="sm" onClick={() => nav('/bank-import')}>⤓ Bank import</Btn>
          <Btn kind="ghost" sz="sm" onClick={() => setAddingProperty(true)}>+ Add property</Btn>
        </div>
      </div>
      {addingProperty && <AddPropertyModal onClose={() => setAddingProperty(false)}/>}

      {/* STAT BAND */}
      <Card className="mb-16">
        <div className="row" style={{padding: '4px 0'}}>
          <div className="stat stat--sage grow">
            <div className="stat__label">Rent collected · {fmtMonthShort(month)}</div>
            <div className="stat__value">{fmtMoney(mtdRentIn)}</div>
            <div className="stat__sub">of {fmtMoney(totalCharge)} · {collectedPct}%</div>
          </div>
          <div className="stat stat--brick grow">
            <div className="stat__label">Owed today</div>
            <div className="stat__value">{fmtMoney(totalOwed)}</div>
            <div className="stat__sub">{outstanding.length} tenant{outstanding.length===1?'':'s'} outstanding</div>
          </div>
          <div className="stat stat--blue grow">
            <div className="stat__label">Pipeline · active</div>
            <div className="stat__value">{activeCount.toLocaleString()}</div>
            <div className="stat__sub">{stageCounts.G || 0} under contract</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Capital at risk</div>
            <div className="stat__value">{fmtMoney(capitalAtRisk, {dp:0})}</div>
            <div className="stat__sub">B–F stages</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Cash out · {fmtMonthShort(month)}</div>
            <div className="stat__value">{fmtMoney(mtdCashOut)}</div>
            <div className="stat__sub">across all categories</div>
          </div>
        </div>
      </Card>

      {/* 3-COL BODY */}
      <div className="grid g-3">
        <RentCollectionCard ledger={monthLedger} totalCharge={totalCharge} totalPaid={totalPaid}/>
        <PipelineGlanceCard counts={stageCounts}/>
        <ThisWeekCard properties={store.properties}/>
      </div>
    </div>
  );
}

// ────────── Sub-components ──────────

function AlertRow({ tone, count, title, sub, actionLabel, onAction, hidden }) {
  if (hidden) return null;
  const bg = tone === 'brick' ? 'rgba(148,57,42,0.06)' : tone === 'ochre' ? 'rgba(154,102,24,0.05)' : 'rgba(52,99,127,0.04)';
  const fg = tone === 'brick' ? 'var(--brick)' : tone === 'ochre' ? 'var(--ochre)' : 'var(--blue)';
  return (
    <div className="row items-center between"
      style={{padding:'12px 16px', borderBottom:'1px solid var(--rule-soft)', gap:16}}>
      <div className="row gap-14 items-center" style={{minWidth: 0}}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: bg, color: fg, border: '1px solid ' + fg,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:'IBM Plex Mono, monospace', fontSize:14, fontWeight:600,
          flexShrink: 0,
        }}>{count}</div>
        <div style={{minWidth: 0}}>
          <div style={{fontWeight: 500, fontSize: 13}}>{title}</div>
          <div className="small dim" style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{sub}</div>
        </div>
      </div>
      {actionLabel && (
        <Btn sz="sm" kind={tone === 'brick' ? 'danger' : 'ghost'} onClick={onAction}>{actionLabel} →</Btn>
      )}
    </div>
  );
}

const SEV_META = {
  high: { fg: 'var(--brick)', bg: 'rgba(148,57,42,0.06)', label: 'Action' },
  med:  { fg: 'var(--ochre)', bg: 'rgba(154,102,24,0.05)', label: 'Reconcile' },
  low:  { fg: 'var(--blue)',  bg: 'rgba(52,99,127,0.04)', label: 'FYI' },
};

function IntegrityRow({ issue, dismissed }) {
  const [open, setOpen] = useState(false);
  const m = SEV_META[issue.severity] || SEV_META.low;
  return (
    <div style={{borderBottom: '1px solid var(--rule-soft)', opacity: dismissed ? 0.55 : 1}}>
      <div className="row items-center between" style={{padding: '12px 16px', gap: 16}}>
        <div className="row gap-12 items-center" style={{minWidth: 0, flex: 1}}>
          <input type="checkbox" checked={!!dismissed} title={dismissed ? 'Restore this check' : 'Mark done & clear'}
            onChange={() => dismissed ? restoreCheck(issue.id) : dismissCheck(issue.id, issue.sig)}
            style={{width: 17, height: 17, flexShrink: 0, cursor: 'pointer', accentColor: 'var(--sage-deep, var(--sage))'}}/>
          <button onClick={() => setOpen(o => !o)}
            className="row gap-14 items-center"
            style={{minWidth: 0, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, flex: 1}}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, flexShrink: 0,
              background: m.bg, color: m.fg, border: '1px solid ' + m.fg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 600,
            }}>{issue.items.length}</div>
            <div style={{minWidth: 0}}>
              <div className="row gap-8 items-center">
                <span style={{fontWeight: 500, fontSize: 13, textDecoration: dismissed ? 'line-through' : 'none'}}>{issue.title}</span>
                <span className="up" style={{fontSize: 9, color: m.fg, border: '1px solid ' + m.fg, borderRadius: 4, padding: '1px 5px', letterSpacing: '0.06em'}}>{m.label}</span>
              </div>
              <div className="small dim" style={{textWrap: 'pretty'}}>
                {issue.detail} <span style={{color: m.fg}}>{open ? '— hide' : '— show ' + issue.items.length}</span>
              </div>
            </div>
          </button>
        </div>
        <Btn sz="sm" kind={issue.severity === 'high' && !dismissed ? 'danger' : 'ghost'} onClick={() => focusIssue(issue)}>{issue.action} →</Btn>
      </div>
      {open && (
        <div className="col gap-4" style={{padding: '4px 16px 14px 66px'}}>
          {issue.items.map((it, i) => (
            <div key={i} className="small mono" style={{color: 'var(--ink-2)', paddingLeft: 12, borderLeft: '2px solid ' + m.fg, textWrap: 'pretty'}}>{it}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function DataIntegrityCard() {
  useStore(); // re-render on store changes
  const [showCleared, setShowCleared] = useState(false);
  const issues = getActiveIntegrityChecks();
  const cleared = getDismissedIntegrityChecks();
  const high = issues.filter(i => i.severity === 'high').length;
  const headFg = high ? 'var(--brick)' : issues.length ? 'var(--ochre)' : 'var(--sage-deep, var(--sage))';
  return (
    <Card className="mb-16">
      <div className="card__head" style={{borderColor: headFg}}>
        <h3 style={{color: headFg}}>Books &amp; data integrity</h3>
        <div className="row gap-10 items-center">
          <span className="meta">
            {issues.length === 0 ? 'All checks passing'
              : (() => { const n = issues.reduce((a,i) => a + i.items.length, 0);
                  return `${n} item${n===1?'':'s'} across ${issues.length} check${issues.length===1?'':'s'}`; })()}
          </span>
          {issues.length > 0 && <Btn sz="sm" kind="ghost" onClick={() => clearAllChecks(issues)}>Clear all</Btn>}
        </div>
      </div>
      <div className="card__body" style={{padding: 0}}>
        {issues.length === 0 ? (
          <Empty icon="✓" title={cleared.length ? 'All checks cleared' : 'Everything reconciles'}
            sub={cleared.length ? 'You\u2019ve cleared every open check. They\u2019ll come back automatically if the underlying data changes.' : 'No rehab overruns, missing W-9s, duplicate transactions, or orphaned records detected.'}/>
        ) : issues.map(issue => <IntegrityRow key={issue.id} issue={issue}/>)}
        {cleared.length > 0 && (
          <div>
            <button onClick={() => setShowCleared(v => !v)}
              className="row gap-8 items-center"
              style={{width: '100%', background: 'var(--paper-3)', border: 'none', borderTop: '1px solid var(--rule-soft)', padding: '9px 16px', cursor: 'pointer', textAlign: 'left'}}>
              <span className="up dim" style={{fontSize: 10, letterSpacing: '0.08em'}}>Cleared</span>
              <span className="mono small dim">{cleared.length}</span>
              <span className="grow"/>
              <span className="small" style={{color: 'var(--blue)'}}>{showCleared ? 'Hide' : 'Show'}</span>
            </button>
            {showCleared && cleared.map(issue => <IntegrityRow key={issue.id} issue={issue} dismissed/>)}
          </div>
        )}
      </div>
    </Card>
  );
}

function RentCollectionCard({ ledger, totalCharge, totalPaid }) {
  const pct = totalCharge ? Math.round(totalPaid / totalCharge * 100) : 0;
  // Sort: vacate-due first, then late, partial, paid
  const order = { 'vacate-due': 0, 'late': 1, 'partial': 2, 'paid': 3 };
  const sorted = ledger.slice().sort((a,b) => (order[a.status]||9) - (order[b.status]||9));
  return (
    <Card>
      <CardHead title={`Rent · ${fmtMonthShort(getCurrentMonth())}`}
        right={<Tag tone={pct >= 80 ? 'sage' : 'ochre'}>{pct}%</Tag>}/>
      <div className="card__body">
        {ledger.length === 0 ? (
          <Empty title="No rent due yet"
            sub={`Charges for ${fmtMonthLong(getCurrentMonth())} haven't posted.`}
            action={<Btn kind="ghost" sz="sm" onClick={() => nav('/rent')}>Open rent roll →</Btn>}/>
        ) : (
        <>
        <Progress pct={pct} tone="sage" style={{marginBottom: 14}}/>
        <div className="col gap-8">
          {sorted.slice(0, 8).map(r => {
            const tenant = getTenant(r.tenantId);
            const prop = getProperty(r.propertyId);
            return (
              <div key={r.id} className="row between items-center" style={{paddingBottom: 8, borderBottom:'1px solid var(--rule-soft)'}}>
                <div style={{minWidth: 0}}>
                  <div style={{fontSize: 13, fontWeight: 500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{tenant?.name || '—'}</div>
                  <div className="addr-sub" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{prop?.address || ''}</div>
                </div>
                <div className="row gap-8 items-center shrink-0">
                  <span className="mono small">{fmtMoney(r.charge)}</span>
                  <Tag tone={rentStatusTone(r.status)}>{rentStatusLabel(r.status)}</Tag>
                </div>
              </div>
            );
          })}
        </div>
        <Btn kind="ghost" sz="sm" onClick={() => nav('/rent')} style={{marginTop: 10}}>See all {ledger.length} →</Btn>
        </>
        )}
      </div>
    </Card>
  );
}

function PipelineGlanceCard({ counts }) {
  const stages = STATUS_ORDER.concat(getStatuses().filter(s => s.lane === 'rental').map(s => s.code));
  const maxN = Math.max(1, ...Object.values(counts));
  return (
    <Card>
      <CardHead title="Pipeline" right={<Btn sz="sm" kind="ghost" onClick={() => nav('/pipeline')}>Open board →</Btn>}/>
      <div className="card__body">
        <div className="col gap-10">
          {stages.map(s => {
            const n = counts[s] || 0;
            return (
              <div key={s} className="row gap-10 items-center">
                <div style={{width: 130, fontSize: 12}}>
                  <Pip code={s}/>
                  <span className="small mid" style={{marginLeft: 6}}>{STATUS_LABEL[s]}</span>
                </div>
                <div className="grow" style={{height: 18, background:'var(--paper-3)', borderRadius:3, position:'relative'}}>
                  {n > 0 && <div style={{
                    height: '100%',
                    width: Math.max(8, (n / maxN) * 100) + '%',
                    background: s === 'K' ? 'var(--blue)' : 'var(--blue-soft)',
                    borderRadius: 3,
                    border: '1px solid ' + (s === 'K' ? 'var(--blue-deep)' : 'var(--blue)'),
                  }}/>}
                </div>
                <div className="mono small" style={{width: 30, textAlign:'right', color: n ? 'var(--ink)' : 'var(--ink-3)'}}>{n}</div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function ThisWeekCard({ properties }) {
  const today = TODAY();
  // Upcoming events: signing dates, DD dates (next 14 days)
  const events = [];
  properties.forEach(p => {
    if (p.signingDate) {
      const days = daysBetween(today, p.signingDate);
      if (days >= -2 && days <= 14) {
        events.push({ key: 'sign:' + p.id + ':' + p.signingDate, date: p.signingDate, days, label: 'Signing' + (p.closingTime ? ' · ' + p.closingTime : ''), addr: p.address, type: 'signing', id: p.id });
      }
    }
    if (p.saleSigningDate) {
      const days = daysBetween(today, p.saleSigningDate);
      if (days >= -2 && days <= 14) {
        events.push({ key: 'salesign:' + p.id + ':' + p.saleSigningDate, date: p.saleSigningDate, days, label: 'Sale signing' + (p.saleSigningTime ? ' · ' + p.saleSigningTime : ''), addr: p.address, type: 'signing', id: p.id });
      }
    }
    if (p.ddDate) {
      const days = daysBetween(today, p.ddDate);
      if (days >= -2 && days <= 14) {
        events.push({ key: 'dd:' + p.id + ':' + p.ddDate, date: p.ddDate, days, label: 'DD deadline', addr: p.address, type: 'dd', id: p.id });
      }
    }
  });

  // 1031 deadlines from actual exchanges
  const exchanges = Store.state.exchanges || [];
  exchanges.forEach(e => {
    if (e.status !== 'active' || !e.relinquishedSoldDate) return;
    const d45 = new Date(e.relinquishedSoldDate + 'T12:00:00');
    d45.setDate(d45.getDate() + 45);
    const iso45 = d45.toISOString().slice(0,10);
    const days45 = daysBetween(today, iso45);
    if (days45 >= -2 && days45 <= 14) {
      events.push({ key: 'x45:' + e.id, date: iso45, days: days45, label: '45-day 1031 deadline · ' + e.relinquishedAddress, addr: '', type: 'red' });
    }
    const d180 = new Date(e.relinquishedSoldDate + 'T12:00:00');
    d180.setDate(d180.getDate() + 180);
    const iso180 = d180.toISOString().slice(0,10);
    const days180 = daysBetween(today, iso180);
    if (days180 >= -2 && days180 <= 14) {
      events.push({ key: 'x180:' + e.id, date: iso180, days: days180, label: '180-day 1031 close · ' + e.relinquishedAddress, addr: '', type: 'red' });
    }
  });

  events.sort((a,b) => a.date.localeCompare(b.date));
  // Maintenance reminders / inspections (recurring or one-off) due soon or overdue.
  (Store.state.reminders || []).forEach(r => {
    if (r.done || !r.dueDate) return;
    const prop = getProperty(r.propertyId);
    if (!prop) return;
    const days = daysBetween(today, r.dueDate);
    if (days == null || days < -30 || days > 14) return;
    events.push({ key: 'rem:' + r.id, reminderId: r.id, date: r.dueDate, days, label: r.title + (r.recurrence && r.recurrence !== 'none' ? ' · ' + RECURRENCE_LABEL[r.recurrence].toLowerCase() : ''), addr: prop.address, type: 'reminder', id: prop.id });
  });
  events.sort((a,b) => a.date.localeCompare(b.date));
  events.forEach(e => { e.done = isEventDone(e.key); });
  events.sort((a,b) => (a.done === b.done) ? a.date.localeCompare(b.date) : (a.done ? 1 : -1));
  const outstanding = events.filter(e => !e.done).length;

  return (
    <Card>
      <CardHead title="Next 14 days" right={
        <div className="row gap-8 items-center">
          <Tag tone="blue">{outstanding} left</Tag>
          <Btn sz="sm" kind="ghost" onClick={() => nav('/calendar')}>Calendar →</Btn>
        </div>
      }/>
      <div className="card__body">
        {events.length === 0 ? <Empty title="Nothing scheduled" sub="No upcoming signings, DD dates, or deadlines."/> :
          <div className="col gap-10">
            {events.slice(0, 8).map((e,i) => (
              <div key={e.key || i} className="row gap-12 items-start" style={{paddingBottom: 8, borderBottom:'1px solid var(--rule-soft)', opacity: e.done ? 0.5 : 1}}>
                <button
                  onClick={(ev) => { ev.stopPropagation(); if (e.reminderId) { completeReminder(e.reminderId); } else { toggleEventDone(e.key); } }}
                  title={e.done ? 'Mark not done' : (e.reminderId ? 'Log as done' : 'Mark done')}
                  style={{
                    flexShrink: 0, marginTop: 2, width: 22, height: 22, borderRadius: 999, cursor: 'pointer',
                    border: '1.5px solid ' + (e.done ? 'var(--sage)' : 'var(--rule)'),
                    background: e.done ? 'var(--sage)' : 'transparent',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, lineHeight: 1, padding: 0,
                  }}>{e.done ? '✓' : ''}</button>
                <div className="col items-center clickable" style={{width: 46, flexShrink: 0}} onClick={() => e.id && nav('/property/'+e.id)}>
                  <div className="up" style={{fontSize: 10, lineHeight: 1, color: e.done ? 'var(--ink-3)' : e.days < 0 ? 'var(--brick)' : e.days <= 3 ? 'var(--ochre)' : 'var(--ink-3)'}}>
                    {MONTHS_3[new Date(e.date + 'T12:00:00').getMonth()]}
                  </div>
                  <div className="serif" style={{fontSize: 24, lineHeight: 1.05, marginTop: 2, color: e.done ? 'var(--ink-3)' : e.days < 0 ? 'var(--brick)' : 'var(--ink)', fontWeight: 500, fontVariantNumeric: 'tabular-nums'}}>
                    {new Date(e.date + 'T12:00:00').getDate()}
                  </div>
                  <div className="tiny" style={{marginTop: 2, color: e.days < 0 && !e.done ? 'var(--brick)' : e.days <= 3 && !e.done ? 'var(--ochre)' : 'var(--ink-3)'}}>
                    {e.days === 0 ? 'today' : e.days > 0 ? '+'+e.days+'d' : e.days+'d'}
                  </div>
                </div>
                <div className="grow clickable" style={{minWidth: 0}} onClick={() => e.id && nav('/property/'+e.id)}>
                  <div style={{fontWeight: 500, fontSize: 13, textDecoration: e.done ? 'line-through' : 'none'}}>{e.label}</div>
                  {e.addr && <div className="addr-sub">{e.addr}</div>}
                </div>
                {e.done
                  ? <Tag tone="sage">done</Tag>
                  : <Tag tone={e.type === 'signing' ? 'blue' : e.type === 'dd' ? 'ochre' : e.type === 'reminder' ? (e.days < 0 ? 'brick' : 'sage') : 'brick'}>{e.type === 'reminder' ? (e.days < 0 ? 'overdue' : 'upkeep') : e.type}</Tag>}
              </div>
            ))}
          </div>
        }
      </div>
    </Card>
  );
}

function fmtMonthLong(m) {
  const [y, mm] = m.split('-');
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][parseInt(mm)-1] + ' ' + y;
}
function fmtMonthShort(m) {
  const [y, mm] = m.split('-');
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mm)-1];
}

window.DashboardScreen = DashboardScreen;
window.fmtMonthLong = fmtMonthLong;
window.fmtMonthShort = fmtMonthShort;
