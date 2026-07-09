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

// Contract details surfaced (and editable) when an "Under contract" milestone is
// clicked. Each field maps 1:1 to a synced Property column so edits round-trip to
// the Google Sheet on the next push.
function milestoneSpec(key) {
  if (key === 'ucbuy') {
    return {
      title: 'Under contract — to buy',
      fields: [
        { key: 'acqEarnest',  label: 'EMD (earnest money)',          type: 'money' },
        { key: 'acqDDFee',    label: 'DD amount (due-diligence fee)', type: 'money' },
        { key: 'ddDate',      label: 'DD deadline',                  type: 'date', tone: 'ochre' },
        { key: 'signingDate', label: 'Signing date',                 type: 'date' },
        { key: 'closingTime', label: 'Signing time',                 type: 'time' },
      ],
    };
  }
  if (key === 'acq') {
    return {
      title: 'Acquired — closing',
      fields: [
        { key: 'purchasePrice', label: 'Purchase price', type: 'money' },
        { key: 'purchaseDate',  label: 'Closing date',   type: 'date' },
      ],
    };
  }
  if (key === 'list') {
    return {
      title: 'Listed — on market',
      fields: [
        { key: 'listPrice', label: 'List price', type: 'money' },
        { key: 'listDate',  label: 'List date',  type: 'date' },
      ],
    };
  }
  if (key === 'sold') {
    return {
      title: 'Sold — close-out',
      fields: [
        { key: 'salesPrice', label: 'Sale price', type: 'money' },
        { key: 'salesDate',  label: 'Sale date',  type: 'date' },
      ],
    };
  }
  return {
    title: 'Under contract — to sell',
    fields: [
      { key: 'saleEarnest',    label: 'Buyer EMD (earnest money)', type: 'money' },
      { key: 'saleDDCollected',label: 'DD amount collected',       type: 'money' },
      { key: 'buyerDDDate',    label: 'Buyer DD deadline',         type: 'date', tone: 'ochre' },
      { key: 'saleSigningDate',label: 'Sale / signing date',       type: 'date' },
      { key: 'saleSigningTime',label: 'Signing time',              type: 'time' },
    ],
  };
}

// Editable popover for an Under-contract milestone. Saves straight through
// updateProperty() → localStorage → sync push (same path the capture dialogs use).
function MilestonePopover({ p, spec, anchorRight, onClose }) {
  const init = {};
  spec.fields.forEach(f => {
    const v = p[f.key];
    init[f.key] = f.type === 'money' ? (v == null ? '' : String(Math.abs(v))) : (v || '');
  });
  const [draft, setDraft] = React.useState(init);
  const [saved, setSaved] = React.useState(false);
  const set = (k, val) => { setDraft(d => ({ ...d, [k]: val })); setSaved(false); };

  function save() {
    const patch = {};
    spec.fields.forEach(f => {
      const raw = draft[f.key];
      if (f.type === 'money') patch[f.key] = (raw === '' || raw == null) ? null : Math.abs(parseFloat(raw));
      else patch[f.key] = raw || null;
    });
    updateProperty(p.id, patch);
    setSaved(true);
    setTimeout(onClose, 650);
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', zIndex: 30,
        [anchorRight ? 'right' : 'left']: -6,
        width: 256, textAlign: 'left',
        background: 'var(--paper)', border: '1px solid var(--rule)',
        borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,0.16)', padding: '12px 14px',
      }}>
      <div className="up dim mb-8" style={{fontWeight: 600}}>{spec.title}</div>
      <div className="col" style={{gap: 9}}>
        {spec.fields.map(f => (
          <label key={f.key} className="col" style={{gap: 3}}>
            <span className="tiny dim">{f.label}</span>
            {f.type === 'money' ? (
              <div className="row items-center" style={{gap: 4}}>
                <span className="tiny dim">$</span>
                <input className="input mono" type="number" step="100" min="0"
                  value={draft[f.key]} onChange={e => set(f.key, e.target.value)}
                  placeholder="0" style={{width: '100%'}}/>
              </div>
            ) : (
              <input className="input mono" type={f.type === 'time' ? 'time' : 'date'}
                value={draft[f.key]} onChange={e => set(f.key, e.target.value)}
                style={{width: '100%', color: f.tone === 'ochre' && draft[f.key] ? 'var(--ochre)' : undefined}}/>
            )}
          </label>
        ))}
      </div>
      <div className="row between items-center" style={{marginTop: 12, gap: 8}}>
        <Btn sz="sm" kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn sz="sm" kind="primary" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</Btn>
      </div>
    </div>
  );
}

function MilestoneTimeline({ p }) {
  const [open, setOpen] = React.useState(null); // step.key whose popover is shown
  React.useEffect(() => { setOpen(null); }, [p.id]);

  // ── Dates that anchor each milestone (may be missing on synced/imported records) ──
  const ucBuy   = p.signingDate || null;
  const acquired = p.purchaseDate || null;
  const listed  = p.listDate || (p.listPrice != null ? stageReachedAt(p, 'F') : null);
  const ucSell  = stageReachedAt(p, 'G');
  // Only light up "Sold" once the property is actually archived as Sold — a sale date
  // recorded while still under contract (e.g. a scheduled signing) must not read as sold.
  const sold    = p.statusCode === 'I' ? (p.salesDate || stageReachedAt(p, 'I')) : null;

  // ── Milestones reached purely from the current stage code ──
  // Imported / synced properties often carry a statusCode but no dates and no
  // stageHistory rows. Without this, a property that's genuinely owned, listed,
  // under contract to sell, or sold would show NO timeline at all. Deriving
  // "reached" from the stage code makes the strip appear consistently; the date
  // under each dot still reads "—" until the actual date is captured.
  const code = p.statusCode;
  const owned = ['C','D','E','F','G','H','K','I'].includes(code); // matches the acquisition card's own "owned" rule
  const reach = {
    ucbuy:  owned,                              // owning it means it was under contract to buy
    acq:    owned,                              // closed / acquired
    list:   ['F','G','H','I'].includes(code),   // On Market or beyond
    ucsell: ['G','H','I'].includes(code),       // Under Contract (sell), Pending 1031, Sold
    sold:   code === 'I',
  };

  const steps = [
    { key: 'ucbuy', label: 'Under contract', sub: 'to buy', at: ucBuy, dd: p.ddDate || null, reached: reach.ucbuy },
    { key: 'acq',   label: 'Acquired',       sub: 'closed',  at: acquired, reached: reach.acq },
    { key: 'list',  label: 'Listed',         sub: 'on market', at: listed, reached: reach.list },
    { key: 'ucsell',label: 'Under contract', sub: 'to sell', at: ucSell, dd: p.buyerDDDate || null, reached: reach.ucsell },
    { key: 'sold',  label: 'Sold',           sub: 'closed',  at: sold, reached: reach.sold },
  ];
  // Note: we no longer hide the strip when no dates exist — it renders as an
  // empty placeholder so the lifecycle is always visible on the property screen.

  return (
    <Card>
      <div className="card__body" style={{paddingTop: 18, paddingBottom: 18}}>
        <div className="row items-start" style={{gap: 0}}>
          {steps.map((s, i) => {
            const done = !!s.at || s.reached;
            const clickable = true; // every milestone is editable, regardless of status
            const isOpen = open === s.key;
            const anchorRight = i >= steps.length / 2;
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
                    <div className="mono tiny" style={{marginTop: 7, color: s.at ? 'var(--ink-2)' : 'var(--ink-4)'}}>
                      {s.at ? fmtDate(s.at) : '—'}
                    </div>
                    {s.dd !== undefined && (
                      <div className="mono tiny" style={{marginTop: 3, color: s.dd ? 'var(--ochre)' : 'var(--ink-4)'}}>
                        {s.dd ? 'DD ' + fmtDate(s.dd) : 'DD —'}
                      </div>
                    )}
                    {clickable && (
                      <div className="tiny" style={{marginTop: 5, color: 'var(--blue)', fontWeight: 600}}>
                        {isOpen ? 'Close' : 'View / edit'}
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <MilestonePopover p={p} spec={milestoneSpec(s.key)} anchorRight={anchorRight} onClose={() => setOpen(null)} />
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div style={{flex: 1, height: 2, background: (steps[i+1].at || steps[i+1].reached) ? 'var(--blue-soft)' : 'var(--rule)', marginTop: 19, minWidth: 16, borderRadius: 1}}/>
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
  const [cashToClose, setCashToClose] = useCapState(p.cashToClose != null ? String(Math.abs(p.cashToClose)) : '');
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
  const cashToCloseEst = price + fees - credits - Math.abs(capNum(earnest)) - Math.abs(capNum(acqDD)) - exchange - loanFunds;

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
      cashToClose: capToStore(cashToClose),
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
      <div className="grid g-3 mb-8">
        <CapField label="Purchase price"><CapMoney value={purchasePrice} onChange={setPurchasePrice} autoFocus/></CapField>
        <CapField label="Due diligence" hint="Non-refundable fee paid to seller up front."><CapMoney value={acqDD} onChange={setAcqDD}/></CapField>
        <CapField label="Earnest money"><CapMoney value={earnest} onChange={setEarnest}/></CapField>
      </div>
      <div className="grid g-3 mb-8">
        <CapField label="DD deadline"><input className="input" type="date" value={ddDate} onChange={e => setDdDate(e.target.value)} style={{width: '100%'}}/></CapField>
        <CapField label="Closing date"><input className="input" type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} style={{width: '100%'}}/></CapField>
        <CapField label="Closing time"><input className="input" type="time" value={closingTime} onChange={e => setClosingTime(e.target.value)} style={{width: '100%'}}/></CapField>
      </div>
      <div className="grid g-2 mb-16">
        <CapField label="Closing attorney"><input className="input" value={attorney} onChange={e => setAttorney(e.target.value)} placeholder="e.g. Hankin & Pack PLLC" style={{width: '100%'}}/></CapField>
        <div></div>
      </div>

      <div className="up dim mb-8">Financing &amp; cost basis</div>
      <div className="grid g-3 mb-8">
        <CapField label="Purchase closing costs" hint="Lump sum — title, escrow, lender, recording, transfer tax, etc."><CapMoney value={purchaseFees} onChange={setPurchaseFees}/></CapField>
        <CapField label="Purchase credits" hint="Credits received at purchase — reduces cost basis."><CapMoney value={purchaseCredits} onChange={setPurchaseCredits}/></CapField>
        <CapField label="Rehab budget"><CapMoney value={rehabFunds} onChange={setRehabFunds}/></CapField>
      </div>
      <div className="grid g-3 mb-16">
        <CapField label="Loan funds" hint="New loan at purchase — reduces cash to close."><CapMoney value={purchaseLoan} onChange={setPurchaseLoan}/></CapField>
        <CapField label="1031 funds brought in" hint="Replacement-side exchange proceeds applied to this purchase — reduces cash to close."><CapMoney value={acqExchangeFunds} onChange={setAcqExchangeFunds}/></CapField>
        <CapField label="Cash to close (actual)" hint="From the HUD — what you actually brought to closing."><CapMoney value={cashToClose} onChange={setCashToClose}/></CapField>
      </div>

      <div className="row between items-center mb-16" style={{padding: '12px 14px', background: 'var(--paper-3)', borderRadius: 6, border: '1px solid var(--rule)'}}>
        <div>
          <div className="small dim">Est. cash to close</div>
          <div className="tiny dim">price + closing costs − credits − earnest − DD fee − loan funds − 1031 funds</div>
        </div>
        <div className="serif" style={{fontSize: 22, fontWeight: 500}}>{fmtMoney(cashToCloseEst)}</div>
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
