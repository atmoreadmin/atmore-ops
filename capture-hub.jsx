// capture-hub.jsx — life-event "Capture" hub for a property.
// One place, organized by what actually happens to a deal:
//   Acquisition → Listing → Offers → Sale → Rental → 1031
// Each card shows what's captured and re-opens a focused form to edit it.
// Reuses existing dialogs (MarkSoldDialog, ConvertRentalDialog) and adds
// buy-side Acquisition + Listing forms that were previously buried in "Edit details".

const { useState: useCapState } = React;

// ── small labeled field (local; property-editor's Field isn't global) ──
function CapField({ label, hint, children }) {
  return (
    <div>
      {label && <div className="up dim mb-4">{label}</div>}
      {children}
      {hint && <div className="tiny dim mt-4">{hint}</div>}
    </div>
  );
}
function CapMoney({ value, onChange, placeholder, autoFocus }) {
  return <input className="input mono" type="number" step="100" placeholder={placeholder || '0'}
    value={value} onChange={e => onChange(e.target.value)} autoFocus={autoFocus} style={{width: '100%'}}/>;
}
// date helpers for the "days from contract" quick entry
function capAddDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function capDaysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
const capNum = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const capToStore = v => (v === '' || v == null) ? null : parseFloat(v);

// ───────────────────────── Milestone timeline ─────────────────────────
function stageReachedAt(p, code) {
  const h = p.stageHistory || [];
  const hit = h.find(e => e.to === code);
  return hit ? hit.at : null;
}

// Render a "13:30" 24h clock string as "1:30 PM". Returns null on empty/bad input.
function fmtClock(t) {
  if (!t) return null;
  const parts = String(t).split(':');
  const h = parseInt(parts[0], 10);
  if (isNaN(h)) return t;
  const m = parseInt(parts[1], 10) || 0;
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = ((h + 11) % 12) + 1;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

// Contract details surfaced when an "Under contract" milestone is clicked.
function ucMilestoneDetails(p, key) {
  if (key === 'ucbuy') {
    return {
      title: 'Under contract — to buy',
      rows: [
        { k: 'EMD (earnest money)', v: p.acqEarnest != null ? fmtMoney(Math.abs(p.acqEarnest)) : null },
        { k: 'DD amount (due-diligence fee)', v: p.acqDDFee != null ? fmtMoney(Math.abs(p.acqDDFee)) : null },
        { k: 'DD deadline', v: p.ddDate ? fmtDate(p.ddDate) : null, tone: 'ochre' },
        { k: 'Signing date', v: p.signingDate ? fmtDate(p.signingDate) : null },
        { k: 'Signing time', v: fmtClock(p.closingTime) },
      ],
    };
  }
  return {
    title: 'Under contract — to sell',
    rows: [
      { k: 'Buyer EMD (earnest money)', v: p.saleEarnest != null ? fmtMoney(Math.abs(p.saleEarnest)) : null },
      { k: 'DD amount collected', v: p.saleDDCollected != null ? fmtMoney(Math.abs(p.saleDDCollected)) : null },
      { k: 'Buyer DD deadline', v: p.buyerDDDate ? fmtDate(p.buyerDDDate) : null, tone: 'ochre' },
      { k: 'Sale / signing date', v: p.salesDate ? fmtDate(p.salesDate) : null },
      { k: 'Signing time', v: fmtClock(p.salesClosingTime || p.closingTime) },
    ],
  };
}

function MilestoneTimeline({ p }) {
  const [open, setOpen] = React.useState(null); // step.key whose popover is shown
  React.useEffect(() => { setOpen(null); }, [p.id]);

  const ucBuy   = p.signingDate || null;
  const acquired = p.purchaseDate || null;
  const listed  = p.listDate || (p.listPrice != null ? stageReachedAt(p, 'F') : null);
  const ucSell  = stageReachedAt(p, 'G');
  // Only light up "Sold" once the property is actually archived as Sold — a sale date
  // recorded while still under contract (e.g. a scheduled signing) must not read as sold.
  const sold    = p.statusCode === 'I' ? (p.salesDate || stageReachedAt(p, 'I')) : null;

  const steps = [
    { key: 'ucbuy', label: 'Under contract', sub: 'to buy', at: ucBuy, dd: p.ddDate || null },
    { key: 'acq',   label: 'Acquired',       sub: 'closed',  at: acquired },
    { key: 'list',  label: 'Listed',         sub: 'on market', at: listed },
    { key: 'ucsell',label: 'Under contract', sub: 'to sell', at: ucSell, dd: p.buyerDDDate || null },
    { key: 'sold',  label: 'Sold',           sub: 'closed',  at: sold },
  ];
  // Hide the whole strip if literally nothing has happened yet.
  if (!steps.some(s => s.at)) return null;

  return (
    <Card>
      <div className="card__body" style={{paddingTop: 18, paddingBottom: 18}}>
        <div className="row items-start" style={{gap: 0}}>
          {steps.map((s, i) => {
            const done = !!s.at;
            const isUC = s.key === 'ucbuy' || s.key === 'ucsell';
            const details = isUC ? ucMilestoneDetails(p, s.key) : null;
            const hasDetails = details && details.rows.some(r => r.v != null);
            const clickable = isUC && hasDetails;
            const isOpen = open === s.key;
            return (
              <React.Fragment key={s.key}>
                <div className="col items-center text-c" style={{flex: '0 0 auto', width: 108, position: 'relative'}}>
                  <div
                    className="col items-center text-c"
                    onClick={clickable ? (e) => { e.stopPropagation(); setOpen(isOpen ? null : s.key); } : undefined}
                    style={{
                      cursor: clickable ? 'pointer' : 'default',
                      borderRadius: 8, padding: '4px 6px 6px', margin: '-4px -6px -6px',
                      background: isOpen ? 'var(--blue-tint)' : 'transparent',
                    }}>
                    <div style={{
                      width: 12, height: 12, borderRadius: '50%',
                      background: done ? 'var(--blue)' : 'var(--paper)',
                      border: '2px solid ' + (done ? 'var(--blue)' : 'var(--rule)'),
                      boxShadow: done ? '0 0 0 4px var(--blue-tint)' : 'none',
                      marginBottom: 14,
                    }}/>
                    <div className="up" style={{color: done ? 'var(--ink)' : 'var(--ink-4)', lineHeight: 1.25, height: 28, display: 'flex', alignItems: 'flex-end', justifyContent: 'center'}}>{s.label}</div>
                    <div className="tiny dim" style={{marginTop: 3}}>{s.sub}</div>
                    <div className="mono tiny" style={{marginTop: 7, color: done ? 'var(--ink-2)' : 'var(--ink-4)'}}>
                      {done ? fmtDate(s.at) : '—'}
                    </div>
                    {s.dd !== undefined && (
                      <div className="mono tiny" style={{marginTop: 3, color: s.dd ? 'var(--ochre)' : 'var(--ink-4)'}}>
                        {s.dd ? 'DD ' + fmtDate(s.dd) : 'DD —'}
                      </div>
                    )}
                    {clickable && (
                      <div className="tiny" style={{marginTop: 5, color: 'var(--blue)', fontWeight: 600}}>
                        {isOpen ? 'Hide details' : 'View details'}
                      </div>
                    )}
                  </div>
                  {isOpen && details && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute', top: 'calc(100% + 8px)', zIndex: 30,
                        [i >= steps.length / 2 ? 'right' : 'left']: -6,
                        width: 240, textAlign: 'left',
                        background: 'var(--paper)', border: '1px solid var(--rule)',
                        borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,0.16)', padding: '12px 14px',
                      }}>
                      <div className="up dim mb-8" style={{fontWeight: 600}}>{details.title}</div>
                      <div className="col" style={{gap: 7}}>
                        {details.rows.map((r, ri) => (
                          <div key={ri} className="row between items-baseline" style={{gap: 12}}>
                            <span className="tiny dim" style={{whiteSpace: 'nowrap'}}>{r.k}</span>
                            <span className="mono tiny" style={{
                              fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                              color: r.v == null ? 'var(--ink-4)' : (r.tone === 'ochre' ? 'var(--ochre)' : 'var(--ink)'),
                            }}>{r.v == null ? '—' : r.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div style={{flex: 1, height: 2, background: steps[i+1].at ? 'var(--blue-soft)' : 'var(--rule)', marginTop: 19, minWidth: 16, borderRadius: 1}}/>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      {open && (
        <div onClick={() => setOpen(null)} style={{position: 'fixed', inset: 0, zIndex: 20}}/>
      )}
    </Card>
  );
}

// ───────────────────────── Event card shell ─────────────────────────
// status: 'captured' | 'partial' | 'empty' | 'na'
function EventCard({ index, title, blurb, status, current, facts, actionLabel, onAction, secondary }) {
  const toneFor = { captured: 'sage', partial: 'ochre', empty: 'ghost', na: 'ghost' };
  const labelFor = { captured: 'Captured', partial: 'In progress', empty: 'Not captured', na: 'Optional here' };
  const dim = status === 'na';
  return (
    <Card accent={current} style={dim ? {opacity: 0.72} : null}>
      <div className="card__head">
        <div className="row gap-10 items-center" style={{minWidth: 0}}>
          <div className="mono" style={{
            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: current ? 'var(--blue)' : 'var(--paper-3)',
            color: current ? '#fff' : 'var(--ink-3)',
            border: '1px solid ' + (current ? 'var(--blue)' : 'var(--rule)'),
            fontSize: 12, fontWeight: 600,
          }}>{index}</div>
          <div style={{minWidth: 0}}>
            <h3 className="serif" style={{margin: 0, fontSize: 16}}>{title}</h3>
            <div className="tiny dim" style={{marginTop: 1}}>{blurb}</div>
          </div>
        </div>
        <div className="row gap-8 items-center shrink-0">
          {current && <Tag tone="blue">Current stage</Tag>}
          <Tag tone={toneFor[status]}>{labelFor[status]}</Tag>
        </div>
      </div>
      <div className="card__body col gap-12">
        {facts && facts.length > 0 ? (
          <div className="grid" style={{gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px 20px'}}>
            {facts.map((f, i) => (
              <div key={i}>
                <div className="up dim mb-2">{f.k}</div>
                <div style={{fontSize: 13, fontFamily: f.mono ? 'IBM Plex Mono, monospace' : null, fontVariantNumeric: 'tabular-nums', color: f.v == null ? 'var(--ink-4)' : (f.color || 'var(--ink)')}}>
                  {f.v == null ? '—' : f.v}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="small dim">{status === 'na' ? 'Not relevant for this property yet — capture it here if that changes.' : 'Nothing captured yet.'}</div>
        )}
        <div className="row gap-8 items-center">
          <Btn kind={status === 'empty' || status === 'na' ? 'primary' : 'ghost'} sz="sm" onClick={onAction}>{actionLabel}</Btn>
          {secondary}
        </div>
      </div>
    </Card>
  );
}

// ───────────────────────── The hub ─────────────────────────
function CapturePanel({ p }) {
  const [dialog, setDialog] = useCapState(null); // 'acq' | 'list' | 'sold' | 'rental' | null
  // Close any open capture dialog when switching properties, so one property's
  // half-filled form can never carry its values onto another property.
  React.useEffect(() => { setDialog(null); }, [p.id]);
  const offers = (typeof getOffersForProperty === 'function' ? getOffersForProperty(p.id) : []) || [];
  const tenants = (typeof getTenantsForProperty === 'function' ? getTenantsForProperty(p.id) : []) || [];

  const code = p.statusCode;
  const typeStr = String(p.type || '');
  const is1031 = typeStr.includes('1031');
  const isRentalKind = typeStr === 'Rental' || code === 'K' || code === 'D';
  const owned = ['C','D','E','F','G','H','K','I'].includes(code);

  // ── Acquisition ──
  const acqFacts = [
    { k: 'Under contract', v: p.signingDate ? fmtDate(p.signingDate) : null, mono: true },
    { k: 'DD deadline', v: p.ddDate ? fmtDate(p.ddDate) : null, mono: true },
    { k: 'Closing date', v: p.purchaseDate ? fmtDate(p.purchaseDate) : null, mono: true },
    { k: 'Purchase price', v: p.purchasePrice != null ? fmtMoney(Math.abs(p.purchasePrice)) : null, mono: true },
    { k: 'Earnest money', v: p.acqEarnest != null ? fmtMoney(Math.abs(p.acqEarnest)) : null, mono: true },
    { k: 'Due-diligence fee', v: p.acqDDFee != null ? fmtMoney(Math.abs(p.acqDDFee)) : null, mono: true },
    { k: 'Closing costs', v: p.purchaseFees != null ? fmtMoney(Math.abs(p.purchaseFees)) : null, mono: true },
    { k: 'Loan funds', v: p.purchaseLoan != null ? fmtMoney(Math.abs(p.purchaseLoan)) : null, mono: true },
    { k: '1031 funds brought in', v: p.acqExchangeFunds != null ? fmtMoney(Math.abs(p.acqExchangeFunds)) : null, mono: true },
    { k: 'Rehab budget', v: p.rehabFunds != null ? fmtMoney(Math.abs(p.rehabFunds)) : null, mono: true },
    { k: 'Closing attorney', v: p.attorney || null },
  ];
  const acqHas = [p.purchasePrice, p.purchaseDate, p.signingDate].some(v => v != null && v !== '');
  const acqFull = p.purchasePrice != null && p.purchaseDate;
  const acqStatus = acqFull ? 'captured' : acqHas ? 'partial' : 'empty';

  // ── Listing ──
  const listFacts = [
    { k: 'List price', v: p.listPrice != null ? fmtMoney(p.listPrice) : null, mono: true },
    { k: 'List date', v: p.listDate ? fmtDate(p.listDate) : null, mono: true },
    { k: 'Atmore listing agent', v: p.listingAgent || null },
  ];
  const listHas = [p.listPrice, p.listDate, p.listingAgent].some(v => v != null && v !== '');
  const listStatus = isRentalKind && !listHas ? 'na' : (p.listPrice != null && (p.listDate || p.listingAgent) ? 'captured' : listHas ? 'partial' : 'empty');

  // ── Offers ──
  const activeOffers = offers.filter(o => typeof isOfferActive === 'function' ? isOfferActive(o) : true);
  const bestNet = typeof bestNetForProperty === 'function' ? bestNetForProperty(p.id) : null;
  const offerFacts = offers.length ? [
    { k: 'Offers logged', v: String(offers.length), mono: true },
    { k: 'Still active', v: String(activeOffers.length), mono: true },
    { k: 'Best net to seller', v: bestNet != null ? fmtMoney(bestNet) : null, mono: true, color: 'var(--sage)' },
  ] : [];
  const offerStatus = offers.length ? 'captured' : (isRentalKind ? 'na' : 'empty');

  // ── Sale ──
  const saleFacts = [
    { k: 'Sale price', v: p.salesPrice != null ? fmtMoney(p.salesPrice) : null, mono: true },
    { k: 'Buyer DD deadline', v: p.buyerDDDate ? fmtDate(p.buyerDDDate) : null, mono: true },
    { k: 'Sale date', v: p.salesDate ? fmtDate(p.salesDate) : null, mono: true },
    { k: 'Closing costs', v: p.salesFees != null ? fmtMoney(Math.abs(p.salesFees)) : null, mono: true },
    { k: 'Concessions', v: p.salesCredits != null ? fmtMoney(Math.abs(p.salesCredits)) : null, mono: true },
    { k: 'DD fee collected', v: p.saleDDCollected != null ? fmtMoney(Math.abs(p.saleDDCollected)) : null, mono: true },
    { k: 'Buyer earnest', v: p.saleEarnest != null ? fmtMoney(Math.abs(p.saleEarnest)) : null, mono: true },
    { k: 'Net profit', v: p.grossProfit != null ? fmtMoney(p.grossProfit, {sign: true}) : null, mono: true, color: (p.grossProfit||0) >= 0 ? 'var(--sage)' : 'var(--brick)' },
  ];
  const saleStatus = p.salesPrice != null ? 'captured' : (isRentalKind ? 'na' : 'empty');

  // ── Rental ──
  const activeTenant = tenants.find(t => t.status === 'active') || tenants[0];
  const rentFacts = activeTenant ? [
    { k: 'Tenant', v: activeTenant.name || null },
    { k: 'Monthly rent', v: activeTenant.rent != null ? fmtMoney(activeTenant.rent) : null, mono: true },
    { k: 'Deposit', v: activeTenant.deposit != null ? fmtMoney(activeTenant.deposit) : null, mono: true },
    { k: 'Lease ends', v: activeTenant.leaseEnd ? fmtDate(activeTenant.leaseEnd) : null, mono: true },
  ] : [];
  const rentStatus = tenants.length ? 'captured' : (isRentalKind ? 'empty' : 'na');

  // ── 1031 ──
  const exchanges = (typeof window !== 'undefined' && window.Store && Store.state.exchanges) || [];
  const linked = exchanges.filter(e =>
    (e.replacementAddress && e.replacementAddress.trim().toLowerCase() === (p.address||'').trim().toLowerCase()) ||
    (e.relinquishedAddress && e.relinquishedAddress.trim().toLowerCase() === (p.address||'').trim().toLowerCase()));
  const exFacts = linked.length ? [
    { k: 'Exchanges linked', v: String(linked.length), mono: true },
    { k: 'Role', v: linked.map(e => (e.replacementAddress||'').trim().toLowerCase() === (p.address||'').trim().toLowerCase() ? 'Replacement' : 'Relinquished').join(', ') },
  ] : [];
  const exStatus = linked.length ? 'captured' : (is1031 ? 'empty' : 'na');

  // map current stage → which card to spotlight
  const currentCard =
    ['A','B','C'].includes(code) ? 'acq' :
    ['E','F'].includes(code) ? 'list' :
    ['G','H'].includes(code) ? (offers.length ? 'offers' : 'list') :
    code === 'I' ? 'sold' :
    code === 'K' || code === 'D' ? 'rental' : 'acq';

  return (
    <>
      <MilestoneTimeline p={p}/>

      <EventCard index="1" title="Acquisition" blurb="Going under contract to buy, through closing"
        status={acqStatus} current={currentCard === 'acq'} facts={acqFacts}
        actionLabel={acqHas ? 'Edit acquisition' : 'Capture acquisition'} onAction={() => setDialog('acq')}/>

      <EventCard index="2" title="Listing" blurb="Putting it on the market"
        status={listStatus} current={currentCard === 'list'} facts={listFacts}
        actionLabel={listHas ? 'Edit listing' : 'Capture listing'} onAction={() => setDialog('list')}/>

      <EventCard index="3" title="Offers" blurb="Offers received while on market"
        status={offerStatus} current={currentCard === 'offers'} facts={offerFacts}
        actionLabel={offers.length ? 'Manage offers →' : 'Log an offer →'} onAction={() => nav('/property/' + p.id + '/offers')}/>

      <EventCard index="4" title="Sale" blurb="Selling the home — close-out & profit"
        status={saleStatus} current={currentCard === 'sold'} facts={saleFacts}
        actionLabel={p.salesPrice != null ? 'Edit close-out' : 'Capture sale'} onAction={() => setDialog('sold')}/>

      <EventCard index="5" title="Rental & lease" blurb="Tenant, rent, and lease terms"
        status={rentStatus} current={currentCard === 'rental'} facts={rentFacts}
        actionLabel={tenants.length ? 'Manage tenants →' : 'Convert to rental'}
        onAction={() => tenants.length ? nav('/property/' + p.id + '/tenants') : setDialog('rental')}/>

      <EventCard index="6" title="1031 exchange" blurb="Linking relinquished & replacement property"
        status={exStatus} current={false} facts={exFacts}
        actionLabel={linked.length ? 'View 1031 link →' : 'Set up 1031 link →'} onAction={() => nav('/property/' + p.id + '/exch')}/>

      {dialog === 'acq'    && <AcquisitionDialog key={p.id} property={p} onClose={() => setDialog(null)}/>}
      {dialog === 'list'   && <ListingDialog key={p.id} property={p} onClose={() => setDialog(null)}/>}
      {dialog === 'sold'   && <MarkSoldDialog key={p.id} property={p} editMode initialNote="" onClose={() => setDialog(null)}/>}
      {dialog === 'rental' && <ConvertRentalDialog key={p.id} property={p} onBack={() => setDialog(null)} onClose={() => setDialog(null)} initialNote=""/>}
    </>
  );
}

// ───────────────────────── Acquisition (buy-side) dialog ─────────────────────────
function AcquisitionDialog({ property, onClose }) {
  const p = property;
  const [signingDate, setSigningDate] = useCapState(p.signingDate || '');
  const [ddDate, setDdDate]           = useCapState(p.ddDate || '');
  const [ddDays, setDdDays]           = useCapState(p.signingDate && p.ddDate ? String(capDaysBetween(p.signingDate, p.ddDate)) : '');
  const [purchaseDate, setPurchaseDate] = useCapState(p.purchaseDate || '');
  const [closingTime, setClosingTime] = useCapState(p.closingTime || '');
  const [purchasePrice, setPurchasePrice] = useCapState(p.purchasePrice != null ? String(Math.abs(p.purchasePrice)) : '');
  const [earnest, setEarnest]         = useCapState(p.acqEarnest != null ? String(Math.abs(p.acqEarnest)) : '');
  const [purchaseFees, setPurchaseFees] = useCapState(p.purchaseFees != null ? String(Math.abs(p.purchaseFees)) : '');
  const [purchaseCredits, setPurchaseCredits] = useCapState(p.purchaseCredits != null ? String(Math.abs(p.purchaseCredits)) : '');
  const [purchaseLoan, setPurchaseLoan] = useCapState(p.purchaseLoan != null ? String(Math.abs(p.purchaseLoan)) : '');
  const [acqDD, setAcqDD]             = useCapState(p.acqDDFee != null ? String(Math.abs(p.acqDDFee)) : '');
  const [rehabFunds, setRehabFunds]   = useCapState(p.rehabFunds != null ? String(Math.abs(p.rehabFunds)) : '');
  const [rehab, setRehab]             = useCapState(p.rehab != null ? String(Math.abs(p.rehab)) : '');
  const [acqExchangeFunds, setAcqExchangeFunds] = useCapState(p.acqExchangeFunds != null ? String(Math.abs(p.acqExchangeFunds)) : '');
  const [attorney, setAttorney]       = useCapState(p.attorney || '');
  const [attorneyContact, setAttorneyContact] = useCapState(p.attorneyContact || '');
  const [note, setNote]               = useCapState('');

  const price = capNum(purchasePrice);
  const fees  = Math.abs(capNum(purchaseFees));
  const credits = Math.abs(capNum(purchaseCredits));
  const exchange = Math.abs(capNum(acqExchangeFunds));
  const loanFunds = Math.abs(capNum(purchaseLoan));
  const cashToClose = price + fees - credits - Math.abs(capNum(earnest)) - Math.abs(capNum(acqDD)) - exchange - loanFunds;

  function save() {
    updateProperty(p.id, {
      signingDate: signingDate || null,
      ddDate: ddDate || null,
      purchaseDate: purchaseDate || null,
      closingTime: closingTime || null,
      purchasePrice: capToStore(purchasePrice),
      acqEarnest: capToStore(earnest),
      purchaseFees: purchaseFees !== '' ? Math.abs(parseFloat(purchaseFees)) : null,
      purchaseFeeItems: [],
      purchaseCredits: purchaseCredits !== '' ? Math.abs(parseFloat(purchaseCredits)) : null,
      purchaseLoan: purchaseLoan !== '' ? -Math.abs(parseFloat(purchaseLoan)) : null,
      acqDDFee: acqDD !== '' ? Math.abs(parseFloat(acqDD)) : null,
      rehabFunds: capToStore(rehabFunds),
      rehab: capToStore(rehab),
      acqExchangeFunds: acqExchangeFunds !== '' ? Math.abs(parseFloat(acqExchangeFunds)) : null,
      attorney, attorneyContact,
    });
    if (note.trim()) addPropertyNote(p.id, note.trim());
    onClose();
  }

  return (
    <Modal title="Acquisition — under contract to buy" onClose={onClose}
      right={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>Save acquisition</Btn></>}>
      <div className="mb-16">
        <div className="up dim">Property</div>
        <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{p.address}</div>
        <div className="small dim mt-4">Everything about buying this home — the contract, key dates, and cost basis at purchase. Nothing is required.</div>
      </div>

      <div className="up dim mb-8">Contract</div>
      <div className="grid g-2 mb-8">
        <CapField label="Purchase price"><CapMoney value={purchasePrice} onChange={setPurchasePrice} autoFocus/></CapField>
        <CapField label="Earnest money"><CapMoney value={earnest} onChange={setEarnest}/></CapField>
      </div>
      <div className="grid g-2 mb-16">
        <CapField label="Under contract date"><input className="input" type="date" value={signingDate} onChange={e => { setSigningDate(e.target.value); const d = parseInt(ddDays, 10); if (e.target.value && !isNaN(d)) setDdDate(capAddDaysISO(e.target.value, d)); }} style={{width: '100%'}}/></CapField>
        <CapField label="Due-diligence deadline" hint="Pick a date — or type the number of days from the under-contract date and the date fills itself in.">
          <div className="row gap-6">
            <input className="input" type="date" value={ddDate} onChange={e => { setDdDate(e.target.value); if (signingDate && e.target.value) setDdDays(String(capDaysBetween(signingDate, e.target.value))); }} style={{flex: 1, minWidth: 0}}/>
            <input className="input mono" type="number" min="0" placeholder="days" value={ddDays} title="Days from under-contract date"
              onChange={e => { setDdDays(e.target.value); const d = parseInt(e.target.value, 10); const base = signingDate || (typeof Store !== 'undefined' && Store.state.today) || new Date().toISOString().slice(0, 10); if (!isNaN(d)) setDdDate(capAddDaysISO(base, d)); }}
              style={{width: 70}}/>
          </div>
        </CapField>
      </div>

      <div className="up dim mb-8">Closing</div>
      <div className="grid g-3 mb-8">
        <CapField label="Closing date"><input className="input" type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} style={{width: '100%'}}/></CapField>
        <CapField label="Closing time"><input className="input" type="time" value={closingTime} onChange={e => setClosingTime(e.target.value)} style={{width: '100%'}}/></CapField>
        <CapField label="Rehab budget"><CapMoney value={rehabFunds} onChange={setRehabFunds}/></CapField>
      </div>
      <div className="grid g-3 mb-8">
        <CapField label="Purchase closing costs" hint="Lump sum — title, escrow, lender, recording, transfer tax, etc."><CapMoney value={purchaseFees} onChange={setPurchaseFees}/></CapField>
        <CapField label="Purchase credits" hint="Credits received at purchase — reduces cost basis."><CapMoney value={purchaseCredits} onChange={setPurchaseCredits}/></CapField>
        <CapField label="Due-diligence fee paid" hint="Non-refundable fee paid to seller up front. Already part of the price — recorded for the deal history."><CapMoney value={acqDD} onChange={setAcqDD}/></CapField>
      </div>
      <div className="grid g-3 mb-8">
        <CapField label="Loan funds" hint="New loan at purchase — reduces cash to close."><CapMoney value={purchaseLoan} onChange={setPurchaseLoan}/></CapField>
        <CapField label="Rehab spent to date" hint="Actuals so far — feeds cost basis and the P&L."><CapMoney value={rehab} onChange={setRehab}/></CapField>
        <CapField label="1031 funds brought in" hint="Replacement-side exchange proceeds applied to this purchase — reduces cash to close."><CapMoney value={acqExchangeFunds} onChange={setAcqExchangeFunds}/></CapField>
      </div>
      <div className="grid g-2 mb-16">
        <CapField label="Closing attorney"><input className="input" value={attorney} onChange={e => setAttorney(e.target.value)} placeholder="e.g. Hankin & Pack PLLC" style={{width: '100%'}}/></CapField>
        <CapField label="Attorney contact"><input className="input" value={attorneyContact} onChange={e => setAttorneyContact(e.target.value)} placeholder="phone or email" style={{width: '100%'}}/></CapField>
      </div>

      <div className="row between items-center mb-16" style={{padding: '12px 14px', background: 'var(--paper-3)', borderRadius: 6, border: '1px solid var(--rule)'}}>
        <div>
          <div className="small dim">Est. cash to close</div>
          <div className="tiny dim">price + closing costs − credits − earnest − DD fee − loan funds − 1031 funds</div>
        </div>
        <div className="serif" style={{fontSize: 22, fontWeight: 500}}>{fmtMoney(cashToClose)}</div>
      </div>

      <CapField label="Note (optional)"><textarea className="input" rows="2" value={note} onChange={e => setNote(e.target.value)} style={{width: '100%', resize: 'vertical', fontFamily: 'inherit'}} placeholder="Anything notable about this acquisition…"/></CapField>
    </Modal>
  );
}

// ───────────────────────── Listing dialog ─────────────────────────
function ListingDialog({ property, onClose }) {
  const p = property;
  const [listPrice, setListPrice]   = useCapState(p.listPrice != null ? String(p.listPrice) : '');
  const [listDate, setListDate]     = useCapState(p.listDate || '');
  const [listingAgent, setListingAgent] = useCapState(p.listingAgent || '');
  const [listingNotes, setListingNotes] = useCapState(p.listingNotes || '');

  function save() {
    updateProperty(p.id, {
      listPrice: listPrice === '' ? null : Math.round(Number(listPrice)),
      listDate: listDate || null,
      listingAgent, listingNotes,
    });
    onClose();
  }

  return (
    <Modal title="Listing — on the market" onClose={onClose}
      right={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>Save listing</Btn></>}>
      <div className="mb-16">
        <div className="up dim">Property</div>
        <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{p.address}</div>
        <div className="small dim mt-4">What it's listed at and who's handling it. The asking price feeds offer comparisons.</div>
      </div>

      <div className="grid g-2 mb-8">
        <CapField label="List price"><CapMoney value={listPrice} onChange={setListPrice} autoFocus/></CapField>
        <CapField label="List date"><input className="input" type="date" value={listDate} onChange={e => setListDate(e.target.value)} style={{width: '100%'}}/></CapField>
      </div>
      <div className="mb-8">
        <CapField label="Atmore listing agent"><input className="input" value={listingAgent} onChange={e => setListingAgent(e.target.value)} placeholder="Agent or FSBO" style={{width: '100%'}}/></CapField>
      </div>
      <CapField label="Listing notes" hint="Target buyer, staging, showing instructions, anything to remember.">
        <textarea className="input" rows="3" value={listingNotes} onChange={e => setListingNotes(e.target.value)} style={{width: '100%', resize: 'vertical', fontFamily: 'inherit'}}/>
      </CapField>
    </Modal>
  );
}

// Append a note to the property's activity log (best-effort; falls back to notes field).
function addPropertyNote(propId, text) {
  if (typeof Store === 'undefined') return;
  Store.update(s => {
    const p = s.properties.find(x => x.id === propId);
    if (!p) return;
    p.stageHistory = p.stageHistory || [];
    p.stageHistory.push({ from: p.statusCode, to: p.statusCode, at: s.today, note: text, by: 'capture' });
  });
}

Object.assign(window, { CapturePanel, MilestoneTimeline, EventCard, AcquisitionDialog, ListingDialog, addPropertyNote });
