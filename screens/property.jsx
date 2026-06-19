// screens/property.jsx — single property detail page with left rail

// Old (pre-consolidation) subtab ids → new grouped tab, so existing deep links
// from search, dashboard alerts, and capture cards keep working.
const SUBTAB_ALIAS = {
  summary: 'capture',
  financials: 'money', transactions: 'transactions',
  offers: 'sale', leads: 'sale',
  tenants: 'tenancy', refi: 'tenancy',
  loan: 'file', taxes: 'file', utilities: 'file', hoas: 'file', documents: 'file',
  exch: 'records', activity: 'records',
};

// "12 days in Rehab" — but never a negative count for stages dated in the future.
function stageDwellLabel(p) {
  const d = (typeof daysInCurrentStage === 'function') ? daysInCurrentStage(p) : null;
  const stage = STATUS_LABEL[p.statusCode] || p.statusCode;
  if (d == null || isNaN(d)) return `in ${stage}`;
  if (d <= 0) return `just moved to ${stage}`;
  return `${d} day${d === 1 ? '' : 's'} in ${stage}`;
}

// Stage-aware headline figure for the property header.
function heroStat(p, tenants) {
  const code = p.statusCode;
  const active = (tenants || []).find(t => t.status === 'active') || (tenants || [])[0];
  const purchase = Math.abs(p.purchasePrice || 0);
  const costBasis = purchase + Math.abs(p.purchaseFees || 0) - Math.abs(p.purchaseCredits || 0) + (p.rehab || 0) + Math.abs(p.interest || 0);
  if (code === 'I') return { label: 'Net profit', value: p.grossProfit != null ? p.grossProfit : null, tone: (p.grossProfit || 0) >= 0 ? 'sage' : 'brick', sign: true };
  if (code === 'K' || code === 'D') {
    if (active && active.rent != null) return { label: 'Monthly rent', value: active.rent, suffix: '/mo' };
    return { label: 'Purchase price', value: p.purchasePrice != null ? purchase : null };
  }
  if (code === 'G' || code === 'H') {
    const base = p.salesPrice != null ? p.salesPrice : p.listPrice;
    if (base != null) return { label: 'Projected net', value: base - costBasis, tone: (base - costBasis) >= 0 ? 'sage' : 'brick', sign: true, sub: 'price − basis' };
    return { label: 'Cost basis', value: costBasis };
  }
  if (code === 'E' || code === 'F') {
    if (p.listPrice != null) return { label: 'List price', value: p.listPrice };
    return { label: 'Cost basis', value: costBasis };
  }
  return { label: 'Purchase price', value: p.purchasePrice != null ? purchase : null };
}

function PropertyScreen({ propertyId, subtab }) {
  const store = useStore();
  const p = getProperty(propertyId);
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [closeoutOpen, setCloseoutOpen] = useState(false);
  if (!p) {
    return (
      <div>
        <Empty title="Property not found" sub="The address may have been removed or renamed."
          action={<Btn onClick={() => nav('/properties')}>← All properties</Btn>}/>
      </div>
    );
  }

  const SECTIONS = [
    { id: 'capture',      label: 'Overview' },
    { id: 'money',        label: 'Money' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'sale',         label: 'Sale' },
    { id: 'tenancy',      label: 'Tenancy' },
    { id: 'tasks',        label: 'Tasks' },
    { id: 'maintenance',  label: 'Maintenance' },
    { id: 'file',         label: 'Property file' },
    { id: 'records',      label: '1031 & log' },
  ];

  const tab = SECTIONS.find(s => s.id === subtab)
    || SECTIONS.find(s => s.id === SUBTAB_ALIAS[subtab])
    || SECTIONS[0];

  // related data
  const tenants = getTenantsForProperty(p.id);
  const tx = getTxForProperty(p.id);
  const hoas = store.hoas.filter(h => h.propertyId === p.id);
  const leads = getLeadsForProperty(p.id);
  const offers = getOffersForProperty(p.id);
  const openMaint = getMaintenanceForProperty(p.id).filter(m => m.status !== 'done').length;
  const openTasks = getRemindersForProperty(p.id).filter(r => !r.done).length;
  const dueReminders = getRemindersForProperty(p.id).filter(r => !r.done && r.dueDate && daysBetween(TODAY(), r.dueDate) <= 7).length;

  return (
    <div>
      {/* breadcrumb */}
      <div className="row gap-8 items-center small mb-12">
        <a onClick={() => nav('/properties')} style={{cursor: 'pointer'}}>← All properties</a>
        <span className="dim">·</span>
        <span className="dim">{p.city}</span>
      </div>

      {/* header */}
      <Card className="mb-16">
        <div className="card__body" style={{display: 'flex', gap: 24, alignItems: 'flex-start'}}>
          <div className="grow" style={{minWidth: 0}}>
            <div style={{margin: 0}}>
              <h1 className="serif" style={{fontSize: 28, fontWeight: 500, margin: 0, lineHeight: 1.2, letterSpacing: '-0.015em', display: 'inline'}}>{p.address}</h1>
              <span style={{display: 'inline-flex', verticalAlign: 'middle', marginLeft: 10}}>
                <StagePip code={p.statusCode} onClick={() => setStagePickerOpen(true)}/>
              </span>
            </div>
            <div className="dim small" style={{marginTop: 8}}>{p.city}, {p.state} {p.zip} · {p.county} County</div>

            <div className="row gap-8 wrap items-center" style={{marginTop: 14}}>
              <Tag tone="ghost">{p.type}</Tag>
              {p.loanType && <Tag tone="ghost">{p.loanType}</Tag>}
              {p.assigned && <span className="row gap-6 items-center"><Av name={p.assigned}/><span className="small">{p.assigned}</span></span>}
              {p.lockbox && <Tag tone="ghost">🔒 {p.lockbox}</Tag>}
              {p.vestingLLC && <Tag tone="ghost">🏛 {p.vestingLLC}</Tag>}
              <span className="small dim">·</span>
              <span className="small dim">{stageDwellLabel(p)}</span>
            </div>
          </div>

          {(() => {
            const h = heroStat(p, tenants);
            if (h.value == null) return null;
            return (
              <>
                <div className="divider-v" style={{alignSelf: 'stretch'}}/>
                <div className="col items-end shrink-0" style={{minWidth: 128}}>
                  <div className="up dim">{h.label}</div>
                  <div className="serif" style={{fontSize: 30, fontWeight: 500, lineHeight: 1.05, marginTop: 4, fontVariantNumeric: 'tabular-nums', color: h.tone ? `var(--${h.tone})` : 'var(--ink)'}}>
                    {fmtMoney(h.value, h.sign ? {sign: true} : {})}{h.suffix && <span className="small dim" style={{fontWeight: 400}}>{h.suffix}</span>}
                  </div>
                  {h.sub && <div className="tiny dim" style={{marginTop: 2}}>{h.sub}</div>}
                </div>
              </>
            );
          })()}

          <div className="col gap-8 items-end shrink-0">
            <Btn kind="primary" sz="sm" onClick={() => setStagePickerOpen(true)}>Change stage…</Btn>
            <Btn sz="sm" kind="ghost" onClick={() => setEditorOpen(true)}>Edit details</Btn>
            {p.driveUrl
              ? <Btn sz="sm" kind="ghost" href={p.driveUrl}>↗ Open Drive folder</Btn>
              : <Btn sz="sm" kind="ghost" onClick={() => setEditorOpen(true)}>+ Add Drive link</Btn>}
            <Btn sz="sm" kind="ghost" style={{color: 'var(--brick)'}} onClick={() => {
              const bits = [];
              if (tenants.length) bits.push(`${tenants.length} tenant${tenants.length === 1 ? '' : 's'}`);
              if (offers.length) bits.push(`${offers.length} offer${offers.length === 1 ? '' : 's'}`);
              if (leads.length) bits.push(`${leads.length} lead${leads.length === 1 ? '' : 's'}`);
              const extra = bits.length ? ` Also removes ${bits.join(', ')}.` : '';
              const txNote = tx.length ? ` ${tx.length} tagged transaction${tx.length === 1 ? '' : 's'} will stay but lose this property tag.` : '';
              if (confirm(`Delete ${p.address}? This permanently removes the property and its deal record.${extra}${txNote} This can't be undone.`)) {
                nav('/properties');
                deleteProperty(p.id);
              }
            }}>Delete property</Btn>
          </div>
        </div>
      </Card>

      {/* body: left rail + content */}
      <div className="row gap-20 items-start">
        <Card className="rail shrink-0">
          <div className="card__body" style={{padding: 8}}>
            {SECTIONS.map(s => (
              <div key={s.id}
                onClick={() => nav('/property/' + p.id + '/' + s.id)}
                className={'rail__item' + (tab.id === s.id ? ' rail__item--active' : '')}>
                <span>{s.label}</span>
                {s.id === 'tenancy' && tenants.length > 0 && <span className="tiny dim">{tenants.length}</span>}
                {s.id === 'tasks' && openTasks > 0 && <span className="tiny" style={{color: dueReminders > 0 ? 'var(--brick)' : 'var(--ink-3)'}}>{openTasks}</span>}
                {s.id === 'maintenance' && openMaint > 0 && <span className="tiny dim">{openMaint}</span>}
                {s.id === 'sale' && (offers.length + leads.length) > 0 && <span className="tiny dim">{offers.length + leads.length}</span>}
                {s.id === 'transactions' && tx.length > 0 && <span className="tiny dim">{tx.length}</span>}
                {s.id === 'file' && hoas.length > 0 && <span className="tiny dim">{hoas.length}</span>}
              </div>
            ))}
          </div>
        </Card>

        <div className="grow col gap-16" style={{minWidth: 0}}>
          {tab.id === 'capture' && <>
            {p.notes && (
              <Card>
                <CardHead title="Notes" right={<Btn sz="sm" kind="ghost" onClick={() => setEditorOpen(true)}>Edit</Btn>}/>
                <div className="card__body">
                  <div style={{whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6}}>{p.notes}</div>
                </div>
              </Card>
            )}
            <CapturePanel p={p}/>
          </>}
          {tab.id === 'money' && <>
            <FinancialsPanel p={p} onEditCloseout={() => setCloseoutOpen(true)}/>
          </>}
          {tab.id === 'transactions' && <>
            <TransactionsPanel p={p} tx={tx}/>
          </>}
          {tab.id === 'sale' && <>
            <OffersPanel p={p} offers={offers}/>
            <LeadsPanel p={p} leads={leads}/>
          </>}
          {tab.id === 'tenancy' && <>
            <TenantsPanel p={p} tenants={tenants}/>
            <RefiPanel p={p}/>
          </>}
          {tab.id === 'tasks' && <>
            <RemindersPanel p={p}/>
          </>}
          {tab.id === 'maintenance' && <>
            <MaintenancePanel p={p}/>
          </>}
          {tab.id === 'file' && <>
            <LoanInsurancePanel p={p} onEdit={() => setEditorOpen(true)}/>
            <TaxesPanel p={p} onEdit={() => setEditorOpen(true)}/>
            <UtilitiesPanel p={p} onEdit={() => setEditorOpen(true)}/>
            <HoasPanel p={p} hoas={hoas}/>
            <DocumentsPanel p={p}/>
          </>}
          {tab.id === 'records' && <>
            <ExchPanel p={p}/>
            <ActivityPanel p={p}/>
          </>}
        </div>
      </div>

      {stagePickerOpen && <StagePicker key={p.id} property={p} onClose={() => setStagePickerOpen(false)}/>}
      {editorOpen && <PropertyEditor key={p.id} property={p} onClose={() => setEditorOpen(false)}/>}
      {closeoutOpen && <MarkSoldDialog key={p.id} property={p} editMode initialNote="" onClose={() => setCloseoutOpen(false)}/>}
    </div>
  );
}

// ────── Panels ──────

function FinancialsPanel({ p, compact, onEditCloseout }) {
  const purchase = Math.abs(p.purchasePrice || 0);
  const fees = Math.abs(p.purchaseFees || 0);
  const credits = Math.abs(p.purchaseCredits || 0);
  const acqDD = Math.abs(p.acqDDFee || 0);
  const acqEMD = Math.abs(p.acqEarnest || 0);
  const rehab = p.rehab || 0;
  const interest = Math.abs(p.interest || 0);
  const rehabBudget = p.rehabFunds ? Math.abs(p.rehabFunds) : null;
  const purchaseFeeItems = p.purchaseFeeItems || [];
  const saleFeeItems = p.saleFeeItems || [];

  const salesPrice = p.salesPrice || null;
  const closeCosts = Math.abs(p.salesFees || 0);
  const concessions = Math.abs(p.salesCredits || 0);
  const ddCollected = Math.abs(p.saleDDCollected || 0);
  const saleEMD = Math.abs(p.saleEarnest || 0);
  const payoff = Math.abs(p.salesLoanPayoff || 0);
  // Atmore loan: principal in nets against payoff out; only the interest fee is a cost.
  const atmorePrincipal = Math.abs(p.atmoreLoanPrincipal || 0);
  const atmorePayoff = Math.abs(p.atmoreLoanPayoff || 0);
  const atmoreInterest = atmorePayoff > 0 ? Math.max(0, atmorePayoff - atmorePrincipal) : 0;

  // All-in cost out. Loan payoff is NOT here — the borrowed money is already
  // inside the purchase price; only its interest is a cost.
  const costBasis = purchase + fees - credits + rehab + interest + atmoreInterest;
  // Money in. DD fee collected up front is income (it's deducted from line 603
  // precisely because it was already received). EMD nets through closing.
  const netProceeds = salesPrice != null ? salesPrice - closeCosts - concessions + ddCollected : null;
  const netProfit = salesPrice != null ? netProceeds - costBasis : null;
  const netCashAtClose = salesPrice != null ? (salesPrice - closeCosts - concessions) - payoff : null;
  const sold = p.statusCode === 'I';

  return (
    <Card>
      <CardHead title="Deal P&L" right={
        <div className="row gap-8 items-center">
          {salesPrice != null
            ? <Tag tone={netProfit >= 0 ? 'sage' : 'brick'}>{sold ? 'Net profit' : 'Projected net'} {fmtMoney(netProfit, {sign: true})}</Tag>
            : <Tag tone="ghost">In progress</Tag>}
          {onEditCloseout && (sold || p.statusCode === 'G') &&
            <Btn sz="sm" kind="ghost" onClick={onEditCloseout}>{sold ? 'Edit close-out' : 'Enter close-out'}</Btn>}
        </div>
      }/>
      <div className="card__body">
        <div style={{display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: compact ? 22 : 30}}>

          {/* ── MONEY OUT ── */}
          <div className="col gap-8">
            <div className="up dim" style={{fontSize: 11, letterSpacing: '.09em', marginBottom: 2}}>Money out · total cost</div>
            <div className="row between items-center">
              <div>Purchase price</div>
              <div className="mono">{fmtMoney(purchase)}</div>
            </div>
            {purchaseFeeItems.length > 0 ? (
              <>
                <div className="row between items-center">
                  <div className="small mid">+ Buyer closing costs</div>
                  <div className="mono small">{fmtMoney(fees)}</div>
                </div>
                {purchaseFeeItems.map((it, i) => (
                  <div key={i} className="row between items-center" style={{paddingLeft: 16}}>
                    <div className="tiny dim">{it.label}</div>
                    <div className="mono tiny dim">{fmtMoney(Math.abs(it.amount || 0))}</div>
                  </div>
                ))}
              </>
            ) : fees > 0 && <div className="row between items-center">
              <div className="small mid">+ Buyer closing costs</div>
              <div className="mono small">{fmtMoney(fees)}</div>
            </div>}
            {credits > 0 && <div className="row between items-center">
              <div className="small mid">− Purchase credits</div>
              <div className="mono small" style={{color: 'var(--sage)'}}>−{fmtMoney(credits)}</div>
            </div>}
            <div className="row between items-center">
              <div>+ Rehab</div>
              <div className="row gap-10 items-center">
                {rehabBudget && <Progress pct={rehab / rehabBudget * 100} style={{width: 80}}/>}
                <div className="mono" style={{minWidth: 96, textAlign: 'right'}}>
                  {fmtMoney(rehab)} {rehabBudget ? <span className="small dim">/ {fmtMoney(rehabBudget)}</span> : null}
                </div>
              </div>
            </div>
            <div className="row between items-center">
              <div>+ Loan interest</div>
              <div className="mono">{fmtMoney(interest)}</div>
            </div>
            {atmoreInterest > 0 && (
              <div className="row between items-center">
                <div>+ Atmore loan interest</div>
                <div className="mono">{fmtMoney(atmoreInterest)}</div>
              </div>
            )}
            <div className="divider" style={{margin: '3px 0'}}/>
            <div className="row between items-center">
              <div style={{fontWeight: 600}}>= All-in cost</div>
              <div className="mono" style={{fontWeight: 600}}>{fmtMoney(costBasis)}</div>
            </div>
            {(acqDD > 0 || acqEMD > 0) && (
              <div className="tiny dim" style={{lineHeight: 1.5}}>
                Incl. {acqDD > 0 ? `${fmtMoney(acqDD)} due-diligence fee` : ''}{acqDD > 0 && acqEMD > 0 ? ' and ' : ''}{acqEMD > 0 ? `${fmtMoney(acqEMD)} earnest` : ''} paid up front — already inside the price.
              </div>
            )}
            {atmorePayoff > 0 && (
              <div className="tiny dim" style={{lineHeight: 1.5}}>
                Atmore loan {fmtMoney(atmorePayoff)} repaid − {fmtMoney(atmorePrincipal)} principal = {fmtMoney(atmoreInterest)} interest. Principal nets to zero — only the interest is counted.
              </div>
            )}
          </div>

          {/* ── MONEY IN ── */}
          <div className="col gap-8">
            <div className="up dim" style={{fontSize: 11, letterSpacing: '.09em', marginBottom: 2}}>Money in · the sale</div>
            {salesPrice != null ? (
              <>
                <div className="row between items-center">
                  <div>Sale price</div>
                  <div className="mono" style={{color: 'var(--sage)'}}>{fmtMoney(salesPrice)}</div>
                </div>
                {saleFeeItems.length > 0 ? (
                  <>
                    <div className="row between items-center">
                      <div className="small mid">− Closing costs &amp; prorations</div>
                      <div className="mono small" style={{color: 'var(--brick)'}}>−{fmtMoney(closeCosts)}</div>
                    </div>
                    {saleFeeItems.map((it, i) => (
                      <div key={i} className="row between items-center" style={{paddingLeft: 16}}>
                        <div className="tiny dim">{it.label}</div>
                        <div className="mono tiny dim">{fmtMoney(Math.abs(it.amount || 0))}</div>
                      </div>
                    ))}
                  </>
                ) : closeCosts > 0 && <div className="row between items-center">
                  <div className="small mid">− Closing costs &amp; prorations</div>
                  <div className="mono small" style={{color: 'var(--brick)'}}>−{fmtMoney(closeCosts)}</div>
                </div>}
                {concessions > 0 && <div className="row between items-center">
                  <div className="small mid">− Seller concessions</div>
                  <div className="mono small" style={{color: 'var(--brick)'}}>−{fmtMoney(concessions)}</div>
                </div>}
                {ddCollected > 0 && <div className="row between items-center">
                  <div className="small mid">+ Due-diligence fee collected</div>
                  <div className="mono small" style={{color: 'var(--sage)'}}>+{fmtMoney(ddCollected)}</div>
                </div>}
                <div className="divider" style={{margin: '3px 0'}}/>
                <div className="row between items-center">
                  <div style={{fontWeight: 600}}>= Net proceeds</div>
                  <div className="mono" style={{fontWeight: 600}}>{fmtMoney(netProceeds)}</div>
                </div>
                {payoff > 0 && (
                  <div className="tiny dim" style={{lineHeight: 1.5}}>
                    Loan payoff of {fmtMoney(payoff)} repaid borrowed funds — already counted in the purchase, so it is not a separate cost.{saleEMD > 0 ? ` Buyer earnest of ${fmtMoney(saleEMD)} netted through closing.` : ''}
                  </div>
                )}
              </>
            ) : <div className="small dim">No sale recorded yet.</div>}
          </div>
        </div>

        {/* ── PROFIT ── */}
        {salesPrice != null && (
          <>
            <div className="row between items-center" style={{marginTop: 18, padding: '13px 16px', background: 'var(--ink)', borderRadius: 8, gap: 12}}>
              <div className="up" style={{fontSize: 11, letterSpacing: '.1em', color: 'var(--tan-soft)'}}>{sold ? 'Net profit' : 'Projected net'}</div>
              <div className="mono" style={{fontSize: 12, color: 'var(--ink-4)', flex: 1, textAlign: 'right'}}>{fmtMoney(netProceeds)} − {fmtMoney(costBasis)} =</div>
              <div className="serif" style={{fontSize: 24, fontWeight: 600, color: netProfit >= 0 ? '#bcd1a6' : '#e7b0a4'}}>{fmtMoney(netProfit, {sign: true})}</div>
            </div>
            {payoff > 0 && (
              <div className="row between items-center" style={{marginTop: 8}}>
                <div className="small dim">Net cash at closing <span className="dim">(after {fmtMoney(payoff)} payoff)</span></div>
                <div className="mono small">{fmtMoney(netCashAtClose)}</div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function PrevTenantSummary({ tenant }) {
  const [editing, setEditing] = useState(false);
  const d = tenant.depositReturn;
  return (
    <div style={{marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--rule-soft)'}}>
      <div className="row between items-baseline mb-8">
        <div className="up dim">Previous tenant</div>
        <div className="row gap-6 items-center">
          <Tag tone="ghost">Moved out {tenant.moveOut ? fmtDate(tenant.moveOut, {full: true}) : '—'}</Tag>
          <Btn sz="sm" kind="ghost" onClick={() => setEditing(true)}>Edit</Btn>
        </div>
      </div>
      <div className="row gap-16 items-baseline wrap">
        <div className="serif" style={{fontSize: 16, fontWeight: 500}}>{tenant.name || '—'}</div>
        {(tenant.moveIn || tenant.leaseEnd) && (
          <div className="small dim">{fmtDate(tenant.moveIn, {full: true})} → {fmtDate(tenant.moveOut || tenant.leaseEnd, {full: true})}</div>
        )}
      </div>
      {d ? (
        <div style={{marginTop: 10, padding: '10px 12px', background: 'var(--paper-3)', borderRadius: 6}}>
          <div className="row gap-16 items-baseline wrap">
            <div>
              <div className="up dim">Deposit held</div>
              <div className="mono mt-2">{fmtMoney(d.depositOnFile || 0)}</div>
            </div>
            <div className="divider-v"/>
            <div>
              <div className="up dim">Refunded</div>
              <div className="mono mt-2" style={{color: 'var(--sage)'}}>{fmtMoney(d.refunded || 0)}</div>
            </div>
            <div className="divider-v"/>
            <div>
              <div className="up dim">Withheld</div>
              <div className="mono mt-2" style={{color: (d.withheld || 0) > 0 ? 'var(--brick)' : 'var(--ink-3)'}}>{fmtMoney(d.withheld || 0)}</div>
            </div>
          </div>
          {(d.withheld || 0) > 0 && d.reason && <div className="small dim mt-8" style={{fontStyle: 'italic'}}>Withheld for: {d.reason}</div>}
        </div>
      ) : (
        <div className="small dim mt-8">No deposit settlement on record.</div>
      )}
      {editing && <MoveOutModal tenant={tenant} editing onClose={() => setEditing(false)}/>}
    </div>
  );
}

function TenantsPanel({ p, tenants, compact }) {
  const [adding, setAdding] = useState(false);
  const [rentChanging, setRentChanging] = useState(null);
  const [editingTenant, setEditingTenant] = useState(null);
  const [movingOut, setMovingOut] = useState(null);
  const lastPast = tenants.filter(t => t.status === 'past')
    .sort((a, b) => String(b.moveOut || b.leaseEnd || '').localeCompare(String(a.moveOut || a.leaseEnd || '')))[0];
  if (tenants.length === 0 || tenants.every(t => t.status !== 'active')) return (
    <Card>
      <CardHead title="Tenants & lease" right={p.statusCode === 'K' || p.statusCode === 'D' ? <Btn sz="sm" kind="primary" onClick={() => setAdding(true)}>+ Start lease</Btn> : null}/>
      <div className="card__body">
        <Empty icon="🏠" title="No active tenant"
          sub={p.statusCode === 'K' || p.statusCode === 'D' ? 'Property is ready to rent — add the tenant who moved in.' : `Property is in ${STATUS_LABEL[p.statusCode]} — no tenant expected yet.`}
          action={(p.statusCode === 'K' || p.statusCode === 'D') ? <Btn kind="primary" sz="sm" onClick={() => setAdding(true)}>+ Start a lease</Btn> : null}/>
        {lastPast && <PrevTenantSummary tenant={lastPast}/>}
      </div>
      {adding && <AddTenantModal propertyId={p.id} onClose={() => setAdding(false)}/>}
    </Card>
  );
  return (
    <>
      {tenants.filter(t => t.status === 'active').map(t => (
        <Card key={t.id}>
          <CardHead title={t.name || 'Vacant unit'}
            right={t.status === 'active'
              ? <div className="row gap-6"><Btn sz="sm" kind="ghost" onClick={() => setEditingTenant(t.id)}>Edit</Btn><Btn sz="sm" kind="ghost" onClick={() => setRentChanging(t.id)}>Change rent</Btn><Btn sz="sm" kind="ghost" onClick={() => setMovingOut(t.id)}>Move out</Btn><Tag tone="sage">Active</Tag></div>
              : <div className="row gap-6"><Btn sz="sm" kind="ghost" onClick={() => setEditingTenant(t.id)}>Edit</Btn><Tag tone="ghost">{t.status}</Tag></div>}/>
          {t.status === 'active' ? (
            <div className="card__body">
              <div className="grid g-3">
                <div>
                  <div className="up dim">Contact</div>
                  <div className="small mt-4">{t.phone || '—'}</div>
                  <div className="small mid">{t.email || ''}</div>
                </div>
                <div>
                  <div className="up dim">Lease</div>
                  <div className="small mt-4">{fmtDate(t.moveIn, {full: true})} → {fmtDate(t.leaseEnd, {full: true})}</div>
                </div>
                <div>
                  <div className="up dim">Rent / Source</div>
                  <div className="row gap-6 items-baseline mt-4">
                    <div className="serif" style={{fontSize: 18, fontWeight: 500}}>{fmtMoney(t.rent)}/mo</div>
                    {(t.rentHistory || []).length > 1 && <Tag tone="ghost">{t.rentHistory.length} changes</Tag>}
                  </div>
                  <div className="small dim">{t.source}{t.voucher ? ' · ' + t.voucher : ''}</div>
                  {t.source === 'Section 8' && (t.phaPortion != null || t.tenantPortion != null) && (
                    <div className="small dim mt-2">PHA {fmtMoney(t.phaPortion || 0)} · tenant {fmtMoney(t.tenantPortion || 0)}</div>
                  )}
                </div>
              </div>
              {!compact && (
                <>
                  <div className="divider"/>
                  <PaymentHistory tenantId={t.id}/>
                </>
              )}
              {t.notes && <div className="small dim mt-12" style={{fontStyle: 'italic'}}>"{t.notes}"</div>}
            </div>
          ) : (
            <div className="card__body">
              <Empty title={t.status === 'prep' ? 'Prepping for rent' : t.status === 'past' ? 'Past tenant' : 'Vacant'} sub={t.notes}
                action={t.status !== 'past' ? <Btn sz="sm" onClick={() => setAdding(true)}>+ Start lease</Btn> : null}/>
            </div>
          )}
        </Card>
      ))}
      {adding && <AddTenantModal propertyId={p.id} onClose={() => setAdding(false)}/>}
      {editingTenant && <AddTenantModal tenant={tenants.find(t => t.id === editingTenant)} onClose={() => setEditingTenant(null)}/>}
      {rentChanging && <RentChangeModal tenant={tenants.find(t => t.id === rentChanging)} onClose={() => setRentChanging(null)}/>}
      {movingOut && <MoveOutModal tenant={tenants.find(t => t.id === movingOut)} onClose={() => setMovingOut(null)}/>}
    </>
  );
}

function PaymentHistory({ tenantId }) {
  const ledger = getLedgerForTenant(tenantId);
  if (ledger.length === 0) return null;
  const totalCharged = ledger.reduce((a,r) => a + r.charge, 0);
  const totalPaid = ledger.reduce((a,r) => a + r.paid, 0);
  const totalLateFees = ledger.reduce((a,r) => a + lateFeeFor(r), 0);
  const currentOwed = ledger.reduce((a,r) => a + Math.max(0, r.charge - r.paid + lateFeeFor(r)), 0);

  return (
    <div>
      <div className="row between items-center mb-8">
        <div className="up dim">Payment ledger · {ledger.length} months</div>
        <div className="row gap-12 small">
          <span><span className="dim">Paid:</span> <span className="mono" style={{color: 'var(--sage)'}}>{fmtMoney(totalPaid)}</span></span>
          {totalLateFees > 0 && <span><span className="dim">Late fees:</span> <span className="mono" style={{color: 'var(--ochre)'}}>{fmtMoney(totalLateFees)}</span></span>}
          {currentOwed > 0 && <span><span className="dim">Owed:</span> <span className="mono" style={{color: 'var(--brick)'}}>{fmtMoney(currentOwed)}</span></span>}
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Charge</th>
            <th className="num">Paid</th>
            <th className="num">Late fee</th>
            <th className="num">Balance</th>
            <th>Paid on</th>
            <th>Status</th>
            <th>Linked</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map(r => {
            const lf = lateFeeFor(r);
            const balance = r.charge - r.paid + lf;
            const linkedTx = r.linkedTxId ? Store.state.transactions.find(t => t.id === r.linkedTxId) : null;
            return (
              <tr key={r.id}>
                <td className="mono small">{r.month}</td>
                <td className="num mono small">{fmtMoney(r.charge)}</td>
                <td className="num mono small" style={{color: r.paid ? 'var(--sage)' : 'var(--ink-3)'}}>{r.paid ? fmtMoney(r.paid) : '—'}</td>
                <td className="num mono small">
                  {lf > 0
                    ? <span style={{color: 'var(--ochre)'}}>{fmtMoney(lf)}</span>
                    : r.lateFeeWaived
                      ? <span className="dim" style={{textDecoration: 'line-through'}}>{fmtMoney(Math.round(r.charge * 0.05))}</span>
                      : <span className="dim">—</span>}
                </td>
                <td className="num mono small" style={{color: balance > 0 ? 'var(--brick)' : 'var(--ink-3)', fontWeight: balance > 0 ? 500 : null}}>{balance > 0 ? fmtMoney(balance) : '—'}</td>
                <td className="mono small dim">{r.paidOn ? fmtDate(r.paidOn) : '—'}</td>
                <td><Tag tone={rentStatusTone(r.status)}>{rentStatusLabel(r.status)}</Tag></td>
                <td className="small dim">{linkedTx ? <span className="row gap-4 items-center"><span style={{color: 'var(--blue)'}}>⛁</span><span className="mono">{fmtDate(linkedTx.date)}</span></span> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Columns available on a property's transaction table. alwaysShow can't be hidden;
// default = on out of the box. Mirrors the Properties-list column model.
const TX_COLUMNS = [
  { key: 'date',     label: 'Date',        alwaysShow: true,
    render: t => <span className="mono small">{fmtDate(t.date)}</span> },
  { key: 'acct',     label: 'Acct',        default: true,
    render: t => <span className="mono small dim">{t.acct}</span> },
  { key: 'desc',     label: 'Description', alwaysShow: true,
    render: t => <span className="small">{t.desc}{t.split && <Tag tone="ghost" style={{marginLeft: 6}}>split</Tag>}</span> },
  { key: 'payee',    label: 'Payee',
    render: t => <span className="small dim">{t.payee || '—'}</span> },
  { key: 'category', label: 'Category',    default: true,
    render: t => <Tag tone="ghost">{t.category || '—'}</Tag> },
  { key: 'amount',   label: 'Amount',      alwaysShow: true, numeric: true,
    render: t => <span className="mono" style={{color: t.amount < 0 ? 'var(--brick)' : 'var(--sage)'}}>{fmtMoney(t.amount)}</span> },
];
const TX_COLS_KEY = 'atmore-tx-columns-v1';

function TransactionsPanel({ p, tx }) {
  const store = useStore();
  const [editing, setEditing] = useState(null);
  const [splitting, setSplitting] = useState(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState(() => {
    try { const saved = localStorage.getItem(TX_COLS_KEY); if (saved) return JSON.parse(saved); } catch (e) {}
    return TX_COLUMNS.filter(c => c.default || c.alwaysShow).map(c => c.key);
  });
  function toggleCol(key) {
    const col = TX_COLUMNS.find(c => c.key === key);
    if (col?.alwaysShow) return;
    const next = visibleCols.includes(key) ? visibleCols.filter(k => k !== key) : [...visibleCols, key];
    setVisibleCols(next);
    localStorage.setItem(TX_COLS_KEY, JSON.stringify(next));
  }
  function resetCols() {
    const next = TX_COLUMNS.filter(c => c.default || c.alwaysShow).map(c => c.key);
    setVisibleCols(next);
    localStorage.setItem(TX_COLS_KEY, JSON.stringify(next));
  }
  // Open the right editor for a clicked row: split slices and split parents go to the
  // split editor; a plain transaction opens the single-transaction editor.
  function openEditor(row) {
    const baseId = row.split ? row.id.replace(/-s\d+$/, '') : row.id;
    const real = (store.transactions || []).find(x => x.id === baseId);
    if (!real) return;
    if (real.splits && real.splits.length) setSplitting(real);
    else setEditing(real);
  }
  const addrLower = (p.address || '').toLowerCase().trim();
  // Direct-tagged transactions (passed in) + this property's slice of any split transaction.
  const splitRows = (store.transactions || []).flatMap(t => {
    if (!t.splits || !t.splits.length) return [];
    return t.splits
      .filter(sp => (sp.project || '').toLowerCase().trim() === addrLower)
      .map((sp, i) => ({
        id: t.id + '-s' + i, date: t.date, acct: t.acct, desc: t.desc, payee: t.payee || '',
        category: sp.category || t.category, amount: sp.amount, split: true,
      }));
  });
  const rows = [...tx.map(t => ({ ...t, split: false })), ...splitRows]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (rows.length === 0) return (
    <Card><CardHead title="Transactions"/><div className="card__body">
      <Empty icon="$" title="No transactions tagged" sub="Tag transactions to this property via Bank Import or the Transactions screen."/>
    </div></Card>
  );

  const total = rows.reduce((a, t) => a + (t.amount || 0), 0);
  const moneyIn = rows.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const moneyOut = rows.filter(t => t.amount < 0).reduce((a, t) => a + t.amount, 0);
  // Category breakdown
  const byCat = {};
  rows.forEach(t => { const k = t.category || 'Untagged'; byCat[k] = (byCat[k] || 0) + (t.amount || 0); });
  const cats = Object.entries(byCat).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const activeCols = TX_COLUMNS.filter(c => visibleCols.includes(c.key));

  return (
    <>
    <Card>
      <CardHead title="All transactions" right={
        <div className="row gap-12 items-center small">
          <span className="dim">{rows.length} entries</span>
          <span className="mono" style={{color: total < 0 ? 'var(--brick)' : 'var(--sage)'}}>Net {fmtMoney(total, {sign: true})}</span>
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
                  {TX_COLUMNS.map(c => {
                    const isOn = visibleCols.includes(c.key);
                    return (
                      <label key={c.key} className="row gap-8 items-center"
                        style={{padding: '6px 14px', cursor: c.alwaysShow ? 'default' : 'pointer', opacity: c.alwaysShow ? 0.6 : 1, fontSize: 13}}
                        onMouseOver={e => { if (!c.alwaysShow) e.currentTarget.style.background = 'var(--paper-3)'; }}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                        <input type="checkbox" checked={isOn} disabled={c.alwaysShow} onChange={() => toggleCol(c.key)}/>
                        <span>{c.label}</span>
                        {c.alwaysShow && <span className="tiny dim" style={{marginLeft: 'auto'}}>required</span>}
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      }/>
      <div className="card__body" style={{paddingBottom: 0}}>
        <div className="row gap-20 mb-12" style={{flexWrap: 'wrap'}}>
          <div><div className="up dim">Money in</div><div className="mono" style={{color: 'var(--sage)'}}>{fmtMoney(moneyIn)}</div></div>
          <div><div className="up dim">Money out</div><div className="mono" style={{color: 'var(--brick)'}}>{fmtMoney(moneyOut)}</div></div>
          <div className="grow"/>
          <div className="col gap-4" style={{minWidth: 200}}>
            {cats.slice(0, 5).map(([cat, amt]) => (
              <div key={cat} className="row between items-center" style={{fontSize: 12}}>
                <Tag tone="ghost">{cat}</Tag>
                <span className="mono" style={{color: amt < 0 ? 'var(--brick)' : 'var(--sage)'}}>{fmtMoney(amt, {sign: true})}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>{activeCols.map(c => <th key={c.key} className={c.numeric ? 'num' : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.id} onClick={() => openEditor(t)} title="Click to edit">
              {activeCols.map(c => <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render(t)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
    {editing && <TransactionEditor tx={editing} onClose={() => setEditing(null)}/>}
    {splitting && <SplitTransactionModal tx={splitting} onClose={() => setSplitting(null)}/>}
    </>
  );
}

function HoasPanel({ p, hoas }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  return (
    <Card>
      <CardHead title="HOA memberships" right={<Btn sz="sm" onClick={() => setAdding(true)}>+ Add HOA</Btn>}/>
      <div className="card__body">
        {hoas.length === 0 ? <Empty icon="🏘" title="No HOA on file" sub="Add an HOA to track logins and payment portals."/> :
          <div className="col gap-12">
            {hoas.map(h => (
              <Card key={h.id} className="hoverlift">
                <div className="card__body row between items-center">
                  <div className="grow">
                    <div className="serif" style={{fontSize: 16, fontWeight: 500}}>{h.name}</div>
                    <div className="small dim mt-4">Last verified {fmtDate(h.lastVerified, {full: true})}</div>
                    <div className="row gap-16 mt-8 small">
                      <span>🔗 <a href={h.website}>{h.website || '—'}</a></span>
                      <span>👤 <span className="mono">{h.username || '—'}</span></span>
                      <span>🔒 <span className="mono">{'•'.repeat(8)}</span></span>
                    </div>
                  </div>
                  <div className="row gap-6">
                    <Btn sz="sm" kind="ghost" onClick={() => navigator.clipboard?.writeText(`${h.username}\n${h.password}`)}>Copy login</Btn>
                    <Btn sz="sm" kind="ghost" href={h.website || undefined} disabled={!h.website}>Open ↗</Btn>
                    <Btn sz="sm" kind="ghost" onClick={() => setEditing(h)}>Edit</Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        }
      </div>
      {adding && <AddHOAModal propertyId={p.id} onClose={() => setAdding(false)}/>}
      {editing && <AddHOAModal hoa={editing} propertyId={p.id} onClose={() => setEditing(null)}/>}
    </Card>
  );
}

function DocumentsPanel({ p }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const hasDrive = !!p.driveUrl;
  return (
    <>
      <Card>
        <CardHead title="Documents" right={
          hasDrive
            ? <Btn sz="sm" kind="primary" href={p.driveUrl}>↗ Open Drive folder</Btn>
            : <Btn sz="sm" onClick={() => setEditorOpen(true)}>+ Add Drive link</Btn>
        }/>
        <div className="card__body">
          {hasDrive ? (
            <>
              <div className="row gap-12 items-start" style={{padding: '6px 0 14px 0'}}>
                <div style={{
                  width: 56, height: 56, borderRadius: 8,
                  background: 'var(--blue-tint)', border: '1px solid var(--blue-soft)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, color: 'var(--blue-deep)', flexShrink: 0,
                }}>📁</div>
                <div className="grow">
                  <div className="serif" style={{fontSize: 16, fontWeight: 500}}>Drive folder linked</div>
                  <div className="small dim mt-4" style={{wordBreak: 'break-all'}}>{p.driveUrl}</div>
                  <div className="row gap-8 mt-12">
                    <Btn sz="sm" href={p.driveUrl}>↗ Open in Drive</Btn>
                    <Btn sz="sm" kind="ghost" onClick={() => { navigator.clipboard?.writeText(p.driveUrl); }}>Copy URL</Btn>
                    <Btn sz="sm" kind="ghost" onClick={() => setEditorOpen(true)}>Change link</Btn>
                  </div>
                </div>
              </div>
              <div className="small dim" style={{borderTop:'1px solid var(--rule-soft)', paddingTop: 12, lineHeight: 1.6}}>
                Documents live in Google Drive — purchase contract, title work, inspections, insurance policy, leases, photos, etc. The app keeps the folder link, not the files. Drop files into Drive and they're available to anyone with folder access.
              </div>
            </>
          ) : (
            <Empty icon="📁" title="No Drive folder linked"
              sub="Each property keeps its documents in a shared Google Drive folder. Link the folder here so anyone on the team can jump straight to contracts, photos, and inspections."
              action={<Btn sz="sm" kind="primary" onClick={() => setEditorOpen(true)}>+ Add Drive link</Btn>}/>
          )}
        </div>
      </Card>
      {editorOpen && <PropertyEditor property={p} onClose={() => setEditorOpen(false)}/>}
    </>
  );
}

function RefiPanel({ p }) {
  const store = useStore();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const today = TODAY();
  const refis = (store.refis || []).filter(r => r.propertyId === p.id);
  const active = refis.filter(r => r.status !== 'done');
  const completed = refis.filter(r => r.status === 'done');
  const isK = p.statusCode === 'K';

  return (
    <Card>
      <CardHead title="Refinance" right={
        <div className="row gap-8 items-center">
          <Btn sz="sm" kind="ghost" onClick={() => nav('/refi')}>Open refi pipeline →</Btn>
          {isK && refis.length === 0 && <Btn sz="sm" onClick={() => setAdding(true)}>+ Start refi</Btn>}
        </div>
      }/>
      <div className="card__body">
        {refis.length === 0 ? (
          isK ? (
            <Empty title="No active refi" sub="Refis are tracked as a sidecar lifecycle on K-Rental properties."
              action={<Btn sz="sm" kind="primary" onClick={() => setAdding(true)}>Start refi process</Btn>}/>
          ) : (
            <Empty title="Refi tracking begins at K-Rental"
              sub={`This property is currently in ${STATUS_LABEL[p.statusCode] || p.statusCode}. Once it reaches K-Rental, you can track refi here.`}/>
          )
        ) : (
          <div className="col gap-12">
            {active.map(r => <RefiCard key={r.id} refi={r} today={today} onClick={() => setEditing(r.id)}/>)}
            {completed.length > 0 && active.length > 0 && <div className="divider"/>}
            {completed.length > 0 && (
              <div>
                <div className="up dim mb-8">Completed</div>
                {completed.map(r => (
                  <div key={r.id} className="row between items-center clickable" style={{padding: '8px 4px', borderBottom: '1px solid var(--rule-soft)'}}
                    onClick={() => setEditing(r.id)}>
                    <div>
                      <div className="small" style={{fontWeight: 500}}>{r.lender}</div>
                      <div className="addr-sub">Closed {fmtDate(r.actualClose, {full: true})}</div>
                    </div>
                    <div className="row gap-12 items-center">
                      <span className="mono small">{fmtMoney(r.newLoanAmount || 0)}</span>
                      {r.cashOut > 0 && <Tag tone="sage">+{fmtMoney(r.cashOut)}</Tag>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {editing && <RefiEditor refi={refis.find(r => r.id === editing)} onClose={() => setEditing(null)}/>}
      {adding && <RefiEditor adding kProps={[p]} onClose={() => setAdding(false)}/>}
    </Card>
  );
}

function ExchPanel({ p }) {
  const store = useStore();
  const exchanges = store.exchanges || [];
  // Find exchanges this property is part of (identified or closed)
  const linkedAsReplacement = exchanges.filter(e =>
    (e.identifiedPropIds || []).includes(p.id) || (e.closedPropIds || []).includes(p.id)
  );
  const linkedAsRelinquished = exchanges.filter(e =>
    e.relinquishedPropId === p.id ||
    (!e.relinquishedPropId && e.relinquishedAddress && p.address &&
      e.relinquishedAddress.trim().toLowerCase() === p.address.trim().toLowerCase())
  );
  const is1031Type = String(p.type || '').includes('1031');
  const anyLinked = linkedAsReplacement.length > 0 || linkedAsRelinquished.length > 0;
  const canRelinquish = is1031Type || p.statusCode === 'I';

  function deadlineFrom(soldDate, n) {
    if (!soldDate) return null;
    const d = new Date(soldDate + 'T12:00:00'); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0,10);
  }
  function renderRelinquishedCard(e) {
    const day45 = deadlineFrom(e.relinquishedSoldDate, 45);
    const day180 = deadlineFrom(e.relinquishedSoldDate, 180);
    return (
      <Card key={e.id} className="hoverlift" style={{cursor:'pointer'}}>
        <div className="card__body" onClick={() => nav('/exch1031')}>
          <div className="row between items-start">
            <div className="grow">
              <div className="row gap-10 items-center">
                <span className="serif" style={{fontSize: 16, fontWeight: 500}}>{e.relinquishedAddress || p.address}</span>
                <Tag tone="blue">Relinquished property</Tag>
                <Tag tone="ghost">{e.status}</Tag>
              </div>
              <div className="addr-sub mt-4">Sold {fmtDate(e.relinquishedSoldDate, {full: true})} · {fmtMoney(e.relinquishedSalePrice)} · QI {e.qi || '—'}</div>
            </div>
          </div>
          <div className="grid g-4 mt-12">
            <KVPair label="Exchange funds" value={fmtMoney(e.exchangeFunds || 0)} mono/>
            <KVPair label="Funds available" value={fmtMoney((e.exchangeFunds || 0) - (e.fundsDeployed || 0))} mono/>
            <KVPair label="45-day deadline" value={day45 ? fmtDate(day45, {full: true}) : '—'} mono/>
            <KVPair label="180-day deadline" value={day180 ? fmtDate(day180, {full: true}) : '—'} mono/>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead title="1031 exchange" right={
        <Btn sz="sm" kind="ghost" onClick={() => nav('/exch1031')}>Open 1031 tracker →</Btn>
      }/>
      <div className="card__body">
        {!anyLinked && !canRelinquish ? (
          <Empty title="Not part of a 1031 exchange" sub="This property is not currently linked to any active or completed exchange."/>
        ) : !anyLinked && canRelinquish ? (
          <Empty title="Marked 1031, not yet linked"
            sub="If you sold this property to start an exchange, link it as the relinquished property. If you bought it with exchange funds, identify it as a replacement on the exchange."
            action={<div className="row gap-8 wrap">
              <Btn sz="sm" kind="primary" onClick={() => { window.__pendingRelinquish = p.id; nav('/exch1031'); }}>Link as relinquished →</Btn>
              <Btn sz="sm" kind="ghost" onClick={() => nav('/exch1031')}>Manage exchanges →</Btn>
            </div>}/>
        ) : (
          <div className="col gap-12">
            {linkedAsRelinquished.map(e => renderRelinquishedCard(e))}
            {linkedAsReplacement.map(e => {
              const closed = (e.closedPropIds || []).includes(p.id);
              const d45 = e.relinquishedSoldDate ? addMonthsISO(e.relinquishedSoldDate, 0) : null;
              const day45 = e.relinquishedSoldDate ? (() => {
                const d = new Date(e.relinquishedSoldDate + 'T12:00:00'); d.setDate(d.getDate() + 45);
                return d.toISOString().slice(0,10);
              })() : null;
              const day180 = e.relinquishedSoldDate ? (() => {
                const d = new Date(e.relinquishedSoldDate + 'T12:00:00'); d.setDate(d.getDate() + 180);
                return d.toISOString().slice(0,10);
              })() : null;
              return (
                <Card key={e.id} className="hoverlift" style={{cursor:'pointer'}}>
                  <div className="card__body" onClick={() => nav('/exch1031')}>
                    <div className="row between items-start">
                      <div className="grow">
                        <div className="row gap-10 items-center">
                          <span className="serif" style={{fontSize: 16, fontWeight: 500}}>{e.relinquishedAddress}</span>
                          <Tag tone={closed ? 'sage' : e.status === 'closed' ? 'sage' : 'ochre'}>
                            {closed ? 'Closed replacement' : 'Identified replacement'}
                          </Tag>
                          <Tag tone="ghost">{e.status}</Tag>
                        </div>
                        <div className="addr-sub mt-4">Relinquished · sold {fmtDate(e.relinquishedSoldDate, {full: true})} · {fmtMoney(e.relinquishedSalePrice)}</div>
                      </div>
                    </div>
                    <div className="grid g-4 mt-12">
                      <KVPair label="QI" value={e.qi}/>
                      <KVPair label="Funds available" value={fmtMoney((e.exchangeFunds || 0) - (e.fundsDeployed || 0))} mono/>
                      <KVPair label="45-day deadline" value={day45 ? fmtDate(day45, {full: true}) : '—'} mono/>
                      <KVPair label="180-day deadline" value={day180 ? fmtDate(day180, {full: true}) : '—'} mono/>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ────── Loan & Insurance ──────
function LoanInsurancePanel({ p, onEdit }) {
  const ld = p.loanDetail;
  const ins = p.insurance;
  const today = TODAY();
  const renewDays = ins?.renewalDate ? daysBetween(today, ins.renewalDate) : null;
  const renewTone = renewDays == null ? null : renewDays < 0 ? 'brick' : renewDays <= 30 ? 'ochre' : 'sage';

  return (
    <>
      <Card>
        <CardHead title="Loan" right={<Btn sz="sm" kind="ghost" onClick={onEdit}>Edit</Btn>}/>
        <div className="card__body">
          {ld ? (
            <>
              <div className="grid g-3 mb-12">
                <KVPair label="Lender" value={ld.lender}/>
                <KVPair label="Loan #" value={ld.loanNumber} mono/>
                <KVPair label="Interest rate" value={ld.interestRate ? ld.interestRate + '%' : '—'} mono/>
                <KVPair label="Monthly payment" value={ld.monthlyPayment ? fmtMoney(ld.monthlyPayment, {dp: 2}) : '—'} mono/>
                <KVPair label="Current balance" value={ld.currentBalance ? fmtMoney(ld.currentBalance) : '—'} mono/>
                <KVPair label="Maturity" value={fmtDate(ld.maturityDate, {full: true})}/>
              </div>
              <div className="row gap-8 wrap">
                {ld.escrowedTaxes && <Tag tone="blue">Taxes escrowed</Tag>}
                {ld.escrowedInsurance && <Tag tone="blue">Insurance escrowed</Tag>}
                {!ld.escrowedTaxes && !ld.escrowedInsurance && <Tag tone="ghost">Nothing escrowed</Tag>}
                {ld.lenderContact && <Tag tone="ghost">📞 {ld.lenderContact}</Tag>}
              </div>
            </>
          ) : <Empty icon="◌" title="No loan detail on file" sub="Add loan info from Edit details."/>}
        </div>
      </Card>

      <Card>
        <CardHead title="Insurance"
          right={
            <div className="row gap-8 items-center">
              {renewDays != null && <Tag tone={renewTone}>{renewDays < 0 ? `Expired ${Math.abs(renewDays)}d ago` : `Renews in ${renewDays}d`}</Tag>}
              <Btn sz="sm" kind="ghost" onClick={onEdit}>Edit</Btn>
            </div>
          }/>
        <div className="card__body">
          {ins ? (
            <>
              {renewDays != null && renewDays <= 30 && renewDays >= 0 && (
                <div style={{background: 'var(--ochre-soft)', color: 'var(--ochre)', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13, fontWeight: 500}}>
                  ⚠ Renewal due in {renewDays} days — confirm with agent before lapse.
                </div>
              )}
              {renewDays != null && renewDays < 0 && (
                <div style={{background: 'var(--brick-soft)', color: 'var(--brick)', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13, fontWeight: 500}}>
                  ⚠ Policy expired {Math.abs(renewDays)} days ago. Property may be uninsured.
                </div>
              )}
              <div className="grid g-3 mb-12">
                <KVPair label="Carrier" value={ins.carrier}/>
                <KVPair label="Policy #" value={ins.policyNumber} mono/>
                <KVPair label="Annual premium" value={ins.premium ? fmtMoney(ins.premium) : '—'} mono/>
                <KVPair label="Renewal date" value={fmtDate(ins.renewalDate, {full: true})}/>
                <KVPair label="Agent" value={ins.agentName || '—'}/>
                <KVPair label="Phone" value={ins.agentPhone || '—'} mono/>
              </div>
            </>
          ) : <Empty icon="🛡" title="No insurance on file" sub="Add coverage from Edit details — renewal alerts will surface on the dashboard."/>}
        </div>
      </Card>
    </>
  );
}

// ────── Taxes ──────
function TaxesPanel({ p, onEdit }) {
  const tx = p.taxes;
  const today = TODAY();
  const dueDays = tx?.dueDate ? daysBetween(today, tx.dueDate) : null;
  return (
    <Card>
      <CardHead title="Property tax"
        right={
          <div className="row gap-8 items-center">
            {dueDays != null && !tx.escrowed && <Tag tone={dueDays < 0 ? 'brick' : dueDays <= 30 ? 'ochre' : 'sage'}>{dueDays < 0 ? `Overdue ${Math.abs(dueDays)}d` : `Due in ${dueDays}d`}</Tag>}
            <Btn sz="sm" kind="ghost" onClick={onEdit}>Edit</Btn>
          </div>
        }/>
      <div className="card__body">
        {tx ? (
          <>
            {!tx.escrowed && dueDays != null && dueDays >= 0 && dueDays <= 30 && (
              <div style={{background: 'var(--ochre-soft)', color: 'var(--ochre)', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13, fontWeight: 500}}>
                ⚠ Tax payment due in {dueDays} days — {fmtMoney(tx.annualAmount)} owed.
              </div>
            )}
            <div className="grid g-3 mb-12">
              <KVPair label="Annual amount" value={tx.annualAmount ? fmtMoney(tx.annualAmount) : '—'} mono/>
              <KVPair label="Due date" value={fmtDate(tx.dueDate, {full: true})}/>
              <KVPair label="Parcel / tax ID" value={tx.taxId || '—'} mono/>
            </div>
            <div className="row gap-8 wrap">
              {tx.escrowed ? <Tag tone="blue">Escrowed by lender</Tag> : <Tag tone="ghost">You pay directly</Tag>}
            </div>
          </>
        ) : <Empty icon="🏛" title="No tax info on file" sub="Add tax info from Edit details to surface due-date alerts."/>}
      </div>
    </Card>
  );
}

// ────── Utilities ──────
function UtilitiesPanel({ p, onEdit }) {
  const u = p.utilities || {};
  const has = utilitiesSetUp(p);
  const offCount = UTILITY_TYPES.filter(t => (u[t.key] || {}).status === 'on').length;
  return (
    <Card>
      <CardHead title="Utilities"
        right={
          <div className="row gap-8 items-center">
            {has && offCount > 0 && <Tag tone="sage">{offCount} on in our name</Tag>}
            <Btn sz="sm" kind="ghost" onClick={onEdit}>Edit</Btn>
          </div>
        }/>
      <div className="card__body">
        {has ? (
          <>
            <div className="col gap-2">
              <div className="row gap-10" style={{padding: '0 0 6px 0', borderBottom: '1px solid var(--rule)'}}>
                <div className="up dim" style={{width: 130, flexShrink: 0}}>Utility</div>
                <div className="up dim grow">Provider</div>
                <div className="up dim grow">Account #</div>
                <div className="up dim" style={{width: 130, flexShrink: 0}}>Status</div>
              </div>
              {UTILITY_TYPES.map(t => {
                const r = u[t.key] || {};
                return (
                  <div key={t.key} className="row gap-10 items-center" style={{padding: '9px 0', borderBottom: '1px solid var(--rule-soft)'}}>
                    <div className="small" style={{width: 130, flexShrink: 0, fontWeight: 500}}>{t.icon} {t.label}</div>
                    <div className="small grow" style={{minWidth: 0, color: r.provider ? 'var(--ink)' : 'var(--ink-3)'}}>{r.provider || '—'}</div>
                    <div className="mono small grow" style={{minWidth: 0, color: r.account ? 'var(--ink)' : 'var(--ink-3)'}}>{r.account || '—'}</div>
                    <div style={{width: 130, flexShrink: 0}}><Tag tone={UTILITY_STATUS_TONE[r.status || '']}>{UTILITY_STATUS[r.status || '']}</Tag></div>
                  </div>
                );
              })}
            </div>
            {u.note && <div className="small mt-12" style={{lineHeight: 1.6, color: 'var(--ink-2)'}}>{u.note}</div>}
          </>
        ) : <Empty icon="⚡" title="No utilities on file" sub="Add electric, water, gas & trash from Edit details — you'll also be prompted when a property leaves Coming Soon."/>}
      </div>
    </Card>
  );
}

function KVPair({ label, value, mono }) {
  return (
    <div>
      <div className="up dim">{label}</div>
      <div className={"mt-4 " + (mono ? 'mono small' : 'small')}>{value || '—'}</div>
    </div>
  );
}

// ────── Leads ──────
function LeadsPanel({ p, leads }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const active = leads.filter(l => l.status !== 'lost' && l.status !== 'leased');
  const inactive = leads.filter(l => l.status === 'lost' || l.status === 'leased');

  return (
    <>
      <Card>
        <CardHead title={`Active leads · ${active.length}`} right={<Btn sz="sm" onClick={() => setAdding(true)}>+ Log lead</Btn>}/>
        {active.length === 0 ? (
          <div className="card__body"><Empty icon="📞" title="No active leads" sub="Log inquiries from Zillow, Realtor.com, drive-bys, or referrals."/></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Name</th><th>Phone</th><th>Source</th><th>Status</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {active.map(l => (
                <tr key={l.id} onClick={() => setEditing(l.id)}>
                  <td className="mono small">{fmtDate(l.date)}</td>
                  <td><span className="serif" style={{fontSize: 14, fontWeight: 500}}>{l.name}</span></td>
                  <td className="mono small dim">{l.phone}</td>
                  <td className="small">{l.source}</td>
                  <td><Tag tone={LEAD_STATUS_TONE[l.status]}>{LEAD_STATUS_LABEL[l.status]}</Tag></td>
                  <td className="small dim" style={{maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{l.notes}</td>
                  <td><span className="dim">⋯</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {inactive.length > 0 && (
        <Card>
          <CardHead title={`Inactive · ${inactive.length}`}/>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Name</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              {inactive.map(l => (
                <tr key={l.id} onClick={() => setEditing(l.id)}>
                  <td className="mono small">{fmtDate(l.date)}</td>
                  <td>{l.name}</td>
                  <td><Tag tone={LEAD_STATUS_TONE[l.status]}>{LEAD_STATUS_LABEL[l.status]}</Tag></td>
                  <td className="small dim">{l.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {adding && <LeadForm propertyId={p.id} onClose={() => setAdding(false)}/>}
      {editing && <LeadForm lead={leads.find(l => l.id === editing)} propertyId={p.id} onClose={() => setEditing(null)}/>}
    </>
  );
}

function LeadForm({ lead, propertyId, onClose }) {
  const editing = !!lead;
  const [date, setDate] = useState(lead?.date || TODAY());
  const [name, setName] = useState(lead?.name || '');
  const [phone, setPhone] = useState(lead?.phone || '');
  const [source, setSource] = useState(lead?.source || 'Zillow');
  const [status, setStatus] = useState(lead?.status || 'new');
  const [notes, setNotes] = useState(lead?.notes || '');

  return (
    <Modal title={editing ? 'Edit lead' : 'Log lead'} onClose={onClose}>
      <div className="col gap-12">
        <div className="grid g-2">
          <div><div className="up dim mb-4">Date</div><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{width:'100%'}}/></div>
          <div><div className="up dim mb-4">Source</div>
            <select className="select" value={source} onChange={e => setSource(e.target.value)} style={{width:'100%'}}>
              {['Zillow','Realtor.com','Facebook','Drive-by','Referral','Sign call','Other'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">Name</div><input className="input" value={name} onChange={e => setName(e.target.value)} style={{width:'100%'}} autoFocus/></div>
          <div><div className="up dim mb-4">Phone</div><input className="input mono" value={phone} onChange={e => setPhone(e.target.value)} style={{width:'100%'}}/></div>
        </div>
        <div>
          <div className="up dim mb-4">Status</div>
          <select className="select" value={status} onChange={e => setStatus(e.target.value)} style={{width:'100%'}}>
            {LEAD_STATUS.map(s => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <div className="up dim mb-4">Notes</div>
          <textarea className="input" rows="3" value={notes} onChange={e => setNotes(e.target.value)} style={{width:'100%'}}
            placeholder="What did they want, what's next?"/>
        </div>
        <div className="row gap-8 mt-8">
          {editing && <Btn kind="danger" sz="sm" onClick={() => { if (confirm('Delete this lead?')) { deleteLead(lead.id); onClose(); } }}>Delete</Btn>}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!name} onClick={() => {
            const patch = { date, name, phone, source, status, notes, propertyId };
            if (editing) updateLead(lead.id, patch); else addLead(patch);
            onClose();
          }}>{editing ? 'Save' : 'Log lead'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ActivityPanel({ p }) {
  const hist = (p.stageHistory || []).slice().reverse();
  const backwards = stageBackwardCount(p);
  return (
    <>
      {backwards > 0 && (
        <Card>
          <div className="card__body row gap-12 items-center" style={{background: 'var(--ochre-soft)', borderRadius: 6}}>
            <div style={{fontSize: 22, color: 'var(--ochre)'}}>↶</div>
            <div>
              <div style={{fontWeight: 500}}>Moved backward {backwards} time{backwards===1?'':'s'}</div>
              <div className="small dim">This deal has had stage reversals — worth a look before next milestone.</div>
            </div>
          </div>
        </Card>
      )}
      <Card>
        <CardHead title="Stage history" right={<Tag tone="ghost">{hist.length} change{hist.length===1?'':'s'}</Tag>}/>
        <div className="card__body">
          {hist.length === 0 ? <Empty title="No stage changes yet"/> :
            <div className="col">
              {hist.map((h, i) => {
                const isFirst = i === hist.length - 1;
                const prevIdx = h.from ? STATUS_ORDER.indexOf(h.from) : -1;
                const currIdx = STATUS_ORDER.indexOf(h.to);
                const isBackward = prevIdx >= 0 && currIdx >= 0 && currIdx < prevIdx;
                const isTerminal = ['I','J','K'].includes(h.to);
                return (
                  <div key={i} className="row gap-14 items-start" style={{padding: '12px 0', borderBottom: i < hist.length-1 ? '1px solid var(--rule-soft)' : 'none'}}>
                    <div style={{position: 'relative', width: 12, flexShrink: 0, alignSelf: 'stretch'}}>
                      <div style={{position: 'absolute', left: 5, top: 6, bottom: -12, width: 2, background: i < hist.length-1 ? 'var(--rule)' : 'transparent'}}/>
                      <div style={{position: 'absolute', left: 0, top: 3, width: 12, height: 12, borderRadius: '50%', background: isBackward ? 'var(--ochre)' : isTerminal ? 'var(--blue)' : 'var(--sage)', border: '2px solid var(--paper-2)', boxShadow: '0 0 0 1px ' + (isBackward ? 'var(--ochre)' : isTerminal ? 'var(--blue)' : 'var(--sage)')}}/>
                    </div>
                    <div className="col gap-4 grow">
                      <div className="row gap-8 items-center wrap">
                        {h.from ? (
                          <>
                            <Pip code={h.from}/>
                            <span className="dim">{isBackward ? '↶' : '→'}</span>
                            <Pip code={h.to}/>
                          </>
                        ) : (
                          <>
                            <span className="small dim">started at</span>
                            <Pip code={h.to}/>
                          </>
                        )}
                        {isBackward && <Tag tone="ochre">moved back</Tag>}
                        {isFirst && <Tag tone="ghost">initial</Tag>}
                        <span className="grow"/>
                        <span className="small dim mono">{fmtDate(h.at, {full: true})}</span>
                      </div>
                      {h.note && <div className="small" style={{color: 'var(--ink-2)', fontStyle: 'italic'}}>"{h.note}"</div>}
                      <div className="tiny dim">by {h.by}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          }
        </div>
      </Card>
    </>
  );
}

window.PropertyScreen = PropertyScreen;
