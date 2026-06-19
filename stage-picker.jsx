// stage-picker.jsx — modal popover for changing a property's pipeline stage

const { useState: usePS } = React;

function StagePicker({ property, onClose }) {
  const [note, setNote] = usePS('');
  const [confirming, setConfirming] = usePS(null); // 'sold' | 'failed' | 'rental' | null
  const [filling, setFilling] = usePS(null); // { code, missing } for ordinary moves with gaps
  const [utilTarget, setUtilTarget] = usePS(null); // target code when prompting utilities on leaving Coming Soon
  const [stagedTarget, setStagedTarget] = usePS(null); // hover hint

  const currentIdx = STATUS_ORDER.indexOf(property.statusCode);

  function pick(code, skipUtil) {
    // Leaving Coming Soon (A) → capture utility setup before anything else
    if (!skipUtil && property.statusCode === 'A' && code !== 'A' && !utilitiesSetUp(property)) {
      setUtilTarget(code); return;
    }
    // Terminal stages need confirmation flow
    if (code === 'I') { setConfirming('sold'); return; }
    if (code === 'J') { setConfirming('failed'); return; }
    if (code === 'K') { setConfirming('rental'); return; }
    if (code === 'G') { setConfirming('contract'); return; }
    // Ordinary move — if the target stage expects fields this property is missing, prompt
    const missing = missingExpectedFields(property, code);
    if (missing.length) { setFilling({ code, missing }); return; }
    changeStage(property.id, code, { note });
    onClose();
  }

  if (confirming === 'sold')     return <MarkSoldDialog property={property} onBack={() => setConfirming(null)} onClose={onClose} initialNote={note}/>;
  if (confirming === 'failed')   return <MarkFailedDialog property={property} onBack={() => setConfirming(null)} onClose={onClose} initialNote={note}/>;
  if (confirming === 'rental')   return <ConvertRentalDialog property={property} onBack={() => setConfirming(null)} onClose={onClose} initialNote={note}/>;
  if (confirming === 'contract') return <UnderContractDialog property={property} onBack={() => setConfirming(null)} onClose={onClose} initialNote={note}/>;
  if (filling) return <FillStageFieldsDialog property={property} code={filling.code} missing={filling.missing} note={note} onBack={() => setFilling(null)} onClose={onClose}/>;
  if (utilTarget) return <UtilitiesPrompt property={property} targetCode={utilTarget}
    onBack={() => setUtilTarget(null)} onClose={onClose}
    onContinue={() => { const c = utilTarget; setUtilTarget(null); pick(c, true); }}/>;

  const targetIdx = stagedTarget ? STATUS_ORDER.indexOf(stagedTarget) : null;
  const isBackward = targetIdx != null && targetIdx >= 0 && targetIdx < currentIdx;
  const backwards = stageBackwardCount(property);

  return (
    <Modal title={`Move ${property.address}`} onClose={onClose}>
      <div className="row gap-12 items-center mb-16">
        <div className="up dim">Currently</div>
        <Pip code={property.statusCode}/>
        <span className="small">{STATUS_LABEL[property.statusCode]}</span>
        <span className="small dim">·</span>
        <span className="small dim">{daysInCurrentStage(property)} days in stage</span>
      </div>

      <div className="up dim mb-8">Move to pipeline stage</div>
      <div className="col gap-4 mb-16">
        {STATUS_ORDER.map((code, i) => {
          const isCurrent = code === property.statusCode;
          const isPast = i < currentIdx;
          return (
            <div key={code}
              onMouseEnter={() => setStagedTarget(code)}
              onMouseLeave={() => setStagedTarget(null)}
              onClick={() => !isCurrent && pick(code)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px',
                background: isCurrent ? 'var(--blue-tint)' : 'transparent',
                border: '1px solid ' + (isCurrent ? 'var(--blue-soft)' : 'transparent'),
                borderRadius: 4,
                cursor: isCurrent ? 'default' : 'pointer',
                opacity: isCurrent ? 1 : isPast ? 0.85 : 1,
              }}
              onMouseOver={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--paper-3)'; }}
              onMouseOut={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}>
              <Pip code={code}/>
              <span style={{fontWeight: isCurrent ? 600 : 500, fontSize: 13}}>{STATUS_LABEL[code]}</span>
              {isCurrent && <Tag tone="blue">Current</Tag>}
              {!isCurrent && isPast && <span className="tiny dim">↶ move back</span>}
              {!isCurrent && !isPast && <span className="tiny dim">↷ advance</span>}
              <span className="grow"/>
              {!isCurrent && <span className="dim">→</span>}
            </div>
          );
        })}
      </div>

      <div className="up dim mb-8">Outcomes</div>
      <div className="col gap-4 mb-16">
        {getStatus('I') && <OutcomeRow code="I" tone="sage" label={'Mark as ' + (STATUS_LABEL['I'] || 'Sold')}
          desc="Records sale date + price. Property moves to archive."
          current={property.statusCode === 'I'}
          onClick={() => pick('I')}/>}
        {getStatus('K') && <OutcomeRow code="K" tone="blue" label={'Convert to ' + (STATUS_LABEL['K'] || 'Rental')}
          desc="Moves to K-Rental sidecar. Add tenants from the Tenants tab next."
          current={property.statusCode === 'K'}
          onClick={() => pick('K')}/>}
        {getStatus('J') && <OutcomeRow code="J" tone="brick" label={'Mark as ' + (STATUS_LABEL['J'] || 'Failed')}
          desc="Deal dead. Records reason. Property moves to archive."
          current={property.statusCode === 'J'}
          onClick={() => pick('J')}/>}
      </div>

      {isBackward && (
        <div style={{
          background: 'var(--ochre-soft)',
          border: '1px solid var(--ochre)',
          color: 'var(--ochre)',
          padding: '10px 12px',
          borderRadius: 4,
          fontSize: 12,
          marginBottom: 12,
        }}>
          ↶ Moving backward to <strong>{STATUS_LABEL[stagedTarget]}</strong>.
          {backwards > 0 && ` This property has already moved backward ${backwards} time${backwards===1?'':'s'}.`}
        </div>
      )}

      <div>
        <div className="up dim mb-4">Note about this change <span style={{textTransform: 'none', letterSpacing: 0}}>(optional)</span></div>
        <textarea className="input" rows="2" placeholder="e.g. appraisal came in low, going back to On Market"
          value={note} onChange={e => setNote(e.target.value)}
          style={{width: '100%', resize: 'vertical', fontFamily: 'inherit'}}/>
      </div>

      <div className="row gap-8 mt-16">
        <span className="small dim row items-center">Click any stage above to move.</span>
        <div className="grow"/>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

function OutcomeRow({ code, tone, label, desc, current, onClick }) {
  if (current) return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px',
      background: 'var(--' + (tone === 'sage' ? 'sage-soft' : tone === 'blue' ? 'blue-tint' : 'brick-soft') + ')',
      borderRadius: 4,
    }}>
      <Pip code={code}/>
      <div className="grow">
        <div style={{fontSize: 13, fontWeight: 600}}>{label}</div>
        <div className="tiny dim">{desc}</div>
      </div>
      <Tag tone={tone}>Current</Tag>
    </div>
  );
  return (
    <div onClick={onClick} className="hoverlift"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px',
        border: '1px solid var(--rule)',
        borderRadius: 4,
        cursor: 'pointer',
      }}>
      <Pip code={code}/>
      <div className="grow">
        <div style={{fontSize: 13, fontWeight: 500}}>{label}</div>
        <div className="tiny dim">{desc}</div>
      </div>
      <span className="dim">→</span>
    </div>
  );
}

// ────── Confirm dialogs ──────

// ────── Close-out helpers (module scope so inputs keep focus across renders) ──────
function CloseoutMoney({ value, onChange, placeholder, autoFocus }) {
  return (
    <input className="input mono" type="number" step="100" placeholder={placeholder || '0'}
      value={value} onChange={e => onChange(e.target.value)} autoFocus={autoFocus}
      style={{width: '100%'}}/>
  );
}
function CloseoutSummaryRow({ label, value, sub, color, strong, big }) {
  return (
    <div className="row between items-center">
      <div className={strong ? 'serif' : 'small'} style={{fontWeight: strong ? 500 : 400, fontSize: big ? 16 : undefined, color: 'var(--ink' + (strong ? '' : '-2') + ')'}}>{label}</div>
      <div className={big ? 'serif' : 'mono'} style={{fontSize: big ? 22 : undefined, fontWeight: big || strong ? 500 : 400, color: color || 'var(--ink)'}}>{value}{sub && <span className="small dim" style={{marginLeft: 6}}>{sub}</span>}</div>
    </div>
  );
}

// ─── Itemized fee breakdown (shared by close-out dialog + property editor) ───
const FEE_PRESETS_PURCHASE = ['Title / settlement', 'Escrow / closing', 'Lender fees', 'Recording', 'Transfer tax', 'Attorney', 'Inspection / survey', 'Tax proration', 'HOA proration'];
const FEE_PRESETS_SALE = ['Title / settlement', 'Escrow / closing', 'Commission', 'Recording', 'Transfer tax', 'Attorney', 'Home warranty', 'Tax proration', 'HOA proration'];

function feeItemsTotal(items) {
  return (items || []).reduce((a, it) => a + (Math.abs(parseFloat(it.amount)) || 0), 0);
}
function cleanFeeItems(items) {
  return (items || [])
    .filter(it => (it.label && it.label.trim()) || parseFloat(it.amount))
    .map(it => ({ label: (it.label || '').trim() || 'Fee', amount: Math.abs(parseFloat(it.amount)) || 0 }));
}
// Seed editor rows from an itemized array if present, else from a legacy lump total.
function initFeeItems(p, itemsKey, lumpKey, defLabel) {
  if (Array.isArray(p[itemsKey]) && p[itemsKey].length) {
    return p[itemsKey].map(x => ({ label: x.label || '', amount: x.amount != null ? String(x.amount) : '' }));
  }
  const lump = p[lumpKey];
  if (lump != null && Math.abs(parseFloat(lump)) > 0) return [{ label: defLabel, amount: String(Math.abs(parseFloat(lump))) }];
  return [];
}

function FeeItemsEditor({ items, onChange, presets }) {
  const list = items || [];
  const update = (i, patch) => onChange(list.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const add = (label) => onChange([...list, { label: label || '', amount: '' }]);
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));
  const total = feeItemsTotal(list);
  const used = new Set(list.map(it => it.label));
  return (
    <div className="col gap-6">
      {list.map((it, i) => (
        <div key={i} className="row gap-6 items-center">
          <input className="input" value={it.label} placeholder="Fee label" onChange={e => update(i, { label: e.target.value })} style={{flex: 1}}/>
          <input className="input mono" type="number" step="50" value={it.amount} placeholder="0" onChange={e => update(i, { amount: e.target.value })} style={{width: 120}}/>
          <button onClick={() => remove(i)} title="Remove" style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 18, lineHeight: 1, padding: '0 4px'}}>×</button>
        </div>
      ))}
      <div className="row gap-4 wrap items-center">
        {(presets || []).filter(l => !used.has(l)).map(l => (
          <button key={l} className="tiny" onClick={() => add(l)} style={{background: 'var(--paper-3)', border: '1px solid var(--rule)', borderRadius: 999, padding: '3px 10px', cursor: 'pointer', color: 'var(--ink-2)', fontFamily: 'inherit'}}>+ {l}</button>
        ))}
        <button className="tiny" onClick={() => add('')} style={{background: 'none', border: '1px dashed var(--rule)', borderRadius: 999, padding: '3px 10px', cursor: 'pointer', color: 'var(--ink-2)', fontFamily: 'inherit'}}>+ Custom</button>
      </div>
      {list.length > 0 && (
        <div className="row between items-center" style={{paddingTop: 6, borderTop: '1px solid var(--rule)'}}>
          <span className="small dim">Subtotal</span>
          <span className="mono" style={{fontWeight: 500}}>{fmtMoney(total)}</span>
        </div>
      )}
    </div>
  );
}

function MarkSoldDialog({ property, onBack, onClose, initialNote, editMode }) {
  const p = property;
  const taggedRehab = taggedRehabForProperty(p);
  // Pull from the accepted offer (or best active offer) so the close-out starts pre-filled.
  const propOffers = (typeof getOffersForProperty === 'function' ? getOffersForProperty(p.id) : []) || [];
  const chosenOffer = propOffers.find(o => o.status === 'accepted') || propOffers.filter(isOfferActive)[0] || null;
  const offerPriceStr = chosenOffer && chosenOffer.offerPrice != null ? String(chosenOffer.offerPrice) : '';
  const offerConcStr = chosenOffer && typeof offerTotalConcessions === 'function' && offerTotalConcessions(chosenOffer) ? String(offerTotalConcessions(chosenOffer)) : '';
  // Don't auto-stamp a sale date when merely editing the close-out (e.g. to record an
  // upcoming signing appointment). Only the actual sale confirmation defaults to today.
  const [salesDate, setSalesDate]   = usePS(p.salesDate || (editMode ? '' : TODAY()));
  const [saleSigningDate, setSaleSigningDate] = usePS(p.saleSigningDate || '');
  const [saleSigningTime, setSaleSigningTime] = usePS(p.saleSigningTime || '');
  const [salesPrice, setSalesPrice] = usePS(p.salesPrice != null ? String(p.salesPrice) : offerPriceStr);
  const [listPrice, setListPrice]   = usePS(p.listPrice != null ? String(p.listPrice) : '');
  const [salesFees, setSalesFees] = usePS(p.salesFees != null ? String(Math.abs(p.salesFees)) : (feeItemsTotal(p.saleFeeItems) ? String(feeItemsTotal(p.saleFeeItems)) : ''));
  const [salesCredits, setSalesCredits] = usePS(p.salesCredits != null ? String(p.salesCredits) : offerConcStr);
  const [purchaseFees, setPurchaseFees] = usePS(p.purchaseFees != null ? String(Math.abs(p.purchaseFees)) : (feeItemsTotal(p.purchaseFeeItems) ? String(feeItemsTotal(p.purchaseFeeItems)) : ''));
  const [purchaseCredits, setPurchaseCredits] = usePS(p.purchaseCredits != null ? String(Math.abs(p.purchaseCredits)) : '');
  const [loanPayoff, setLoanPayoff] = usePS(p.salesLoanPayoff != null ? String(p.salesLoanPayoff) : '');
  const [atmorePrincipal, setAtmorePrincipal] = usePS(p.atmoreLoanPrincipal != null ? String(Math.abs(p.atmoreLoanPrincipal)) : '');
  const [atmorePayoff, setAtmorePayoff]       = usePS(p.atmoreLoanPayoff != null ? String(Math.abs(p.atmoreLoanPayoff)) : '');
  const [exchangeFunds, setExchangeFunds] = usePS(p.exchangeFunds != null ? String(p.exchangeFunds) : '');
  const [ddCollected, setDdCollected] = usePS(p.saleDDCollected != null ? String(Math.abs(p.saleDDCollected)) : '');
  const [saleEMD, setSaleEMD] = usePS(p.saleEarnest != null ? String(Math.abs(p.saleEarnest)) : '');
  const [rehab, setRehab]           = usePS(p.rehab != null ? String(p.rehab) : (taggedRehab ? String(taggedRehab) : ''));
  const [interest, setInterest]     = usePS(p.interest != null ? String(p.interest) : '');
  const [note, setNote] = usePS(initialNote);

  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const toStore = v => (v === '' || v == null) ? null : parseFloat(v);

  const purchase  = Math.abs(num(p.purchasePrice));
  const pFees     = Math.abs(num(purchaseFees));
  const pCredits  = Math.abs(num(purchaseCredits));
  // Atmore loan: principal in nets against payoff out — only the interest fee is a real cost.
  const atmorePrin = Math.abs(num(atmorePrincipal));
  const atmorePay  = Math.abs(num(atmorePayoff));
  const atmoreInterest = atmorePay > 0 ? Math.max(0, atmorePay - atmorePrin) : 0;
  const costBasis = purchase + pFees - pCredits + num(rehab) + Math.abs(num(interest)) + atmoreInterest;
  const price       = num(salesPrice);
  const closeCosts  = Math.abs(num(salesFees));
  const concessions = Math.abs(num(salesCredits));
  const payoff      = Math.abs(num(loanPayoff));
  const ddColl      = Math.abs(num(ddCollected));
  const grossProfit = price - costBasis;
  const netProceeds = price - closeCosts - concessions + ddColl;
  const netProfit   = netProceeds - costBasis;
  const netCash     = (price - closeCosts - concessions) - payoff;
  const rehabDiffers = taggedRehab > 0 && Math.abs(num(rehab) - taggedRehab) > 1;

  return (
    <Modal title={editMode ? 'Edit close-out' : 'Mark as Sold — close-out'} onClose={onClose}>
      <div className="row gap-8 items-center mb-16 small dim">
        {onBack && <Btn sz="sm" kind="ghost" onClick={onBack}>← back to stage picker</Btn>}
        <span className="grow"/>
        <span>Nothing is required — fill what you have, gaps are flagged on the dashboard.</span>
      </div>

      <div className="mb-16">
        <div className="up dim">Property</div>
        <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{property.address}</div>
      </div>

      {/* SALE */}
      <div className="up dim mb-8">Sale</div>
      <div className="grid g-3 mb-16">
        <div><div className="up dim mb-4">Sale date</div><input className="input" type="date" value={salesDate} onChange={e => setSalesDate(e.target.value)} style={{width: '100%'}}/></div>
        <div><div className="up dim mb-4">Sale price</div><CloseoutMoney value={salesPrice} onChange={setSalesPrice} autoFocus/>{chosenOffer && p.salesPrice == null && <div className="tiny dim mt-4">From {chosenOffer.status === 'accepted' ? 'accepted' : 'top'} offer{chosenOffer.buyer ? ' · ' + chosenOffer.buyer : ''}</div>}</div>
        <div><div className="up dim mb-4">List price</div><CloseoutMoney value={listPrice} onChange={setListPrice}/></div>
      </div>
      <div className="grid g-3 mb-16">
        <div><div className="up dim mb-4">Signing date</div><input className="input" type="date" value={saleSigningDate} onChange={e => setSaleSigningDate(e.target.value)} style={{width: '100%'}}/></div>
        <div><div className="up dim mb-4">Signing time</div><input className="input" type="time" value={saleSigningTime} onChange={e => setSaleSigningTime(e.target.value)} style={{width: '100%'}}/></div>
        <div className="col justify-end"><div className="tiny dim">Shows on the dashboard “Next 14 days” scheduler.</div></div>
      </div>

      {/* CLOSING ADJUSTMENTS */}
      <div className="up dim mb-8">Closing adjustments</div>
      <div className="mb-8">
        <div className="up dim mb-4">Sale closing costs</div>
        <CloseoutMoney value={salesFees} onChange={setSalesFees}/>
        <div className="tiny dim mt-4">Lump sum — commission + title, escrow, recording, transfer tax, etc.</div>
      </div>
      <div className="grid g-3 mb-8">
        <div><div className="up dim mb-4">Seller concessions</div><CloseoutMoney value={salesCredits} onChange={setSalesCredits}/></div>
        <div><div className="up dim mb-4">Loan payoff at closing</div><CloseoutMoney value={loanPayoff} onChange={setLoanPayoff}/></div>
        <div><div className="up dim mb-4">1031 funds rolled out</div><CloseoutMoney value={exchangeFunds} onChange={setExchangeFunds}/></div>
      </div>
      <div className="grid g-3 mb-8">
        <div><div className="up dim mb-4">Due-diligence fee collected</div><CloseoutMoney value={ddCollected} onChange={setDdCollected}/></div>
        <div><div className="up dim mb-4">Buyer earnest money</div><CloseoutMoney value={saleEMD} onChange={setSaleEMD}/></div>
        <div></div>
      </div>
      <div className="tiny dim mb-16">Closing costs &amp; seller concessions reduce net profit. The DD fee you collected adds to it. Loan payoff, 1031 funds &amp; buyer earnest affect cash at closing, not profit.</div>

      {/* COST BASIS CONFIRM */}
      <div className="up dim mb-8">Confirm cost basis</div>
      <div className="grid g-2 mb-4">
        <div>
          <div className="up dim mb-4">Rehab spent</div>
          <CloseoutMoney value={rehab} onChange={setRehab}/>
          {rehabDiffers && (
            <div className="tiny mt-4" style={{color: 'var(--ochre)'}}>
              {fmtMoney(taggedRehab)} tagged in transactions ·{' '}
              <button onClick={() => setRehab(String(taggedRehab))} style={{background: 'none', border: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline', font: 'inherit'}}>use tagged total</button>
            </div>
          )}
          {!rehabDiffers && taggedRehab > 0 && <div className="tiny dim mt-4">Matches {fmtMoney(taggedRehab)} tagged in transactions.</div>}
        </div>
        <div><div className="up dim mb-4">Interest accrued</div><CloseoutMoney value={interest} onChange={setInterest}/></div>
      </div>
      <div className="up dim mb-8" style={{marginTop: 4}}>Atmore loan <span className="dim" style={{textTransform:'none',letterSpacing:0}}>(if Atmore fronted funds)</span></div>
      <div className="grid g-2 mb-4">
        <div><div className="up dim mb-4">Atmore loan principal</div><CloseoutMoney value={atmorePrincipal} onChange={setAtmorePrincipal}/></div>
        <div><div className="up dim mb-4">Atmore loan payoff</div><CloseoutMoney value={atmorePayoff} onChange={setAtmorePayoff}/></div>
      </div>
      <div className="tiny dim mb-8">{atmorePay > 0
        ? <>Payoff {fmtMoney(atmorePay)} − principal {fmtMoney(atmorePrin)} = <b style={{color:'var(--ink-2)'}}>{fmtMoney(atmoreInterest)}</b> interest counted as a cost. Principal nets to zero.</>
        : <>Enter what Atmore lent and what you repaid — only the difference (the interest fee) hits profit. Principal in/out nets to zero.</>}</div>
      <div className="mb-4">
        <div className="up dim mb-4">Purchase closing costs</div>
        <CloseoutMoney value={purchaseFees} onChange={setPurchaseFees}/>
      </div>
      <div className="grid g-2 mb-4">
        <div><div className="up dim mb-4">Purchase credits</div><CloseoutMoney value={purchaseCredits} onChange={setPurchaseCredits}/></div>
        <div></div>
      </div>
      <div className="tiny dim mb-16">Purchase price {fmtMoney(purchase)} is pulled from the property record. Closing costs add to your cost basis; credits reduce it.</div>

      {/* LIVE SUMMARY */}
      <div className="mb-16 col gap-8" style={{padding: '14px 16px', background: 'var(--paper-3)', borderRadius: 6, border: '1px solid var(--rule)'}}>
        <CloseoutSummaryRow label="Cost basis" value={fmtMoney(costBasis)} strong/>
        <CloseoutSummaryRow label="Sale price" value={fmtMoney(price)}/>
        {closeCosts > 0 && <CloseoutSummaryRow label="− Closing costs" value={'−' + fmtMoney(closeCosts)} color="var(--brick)"/>}
        {concessions > 0 && <CloseoutSummaryRow label="− Seller concessions" value={'−' + fmtMoney(concessions)} color="var(--brick)"/>}
        {ddColl > 0 && <CloseoutSummaryRow label="+ DD fee collected" value={'+' + fmtMoney(ddColl)} color="var(--sage)"/>}
        {(closeCosts > 0 || concessions > 0 || ddColl > 0) && <CloseoutSummaryRow label="= Net proceeds" value={fmtMoney(netProceeds)} strong/>}
        {atmoreInterest > 0 && <CloseoutSummaryRow label="− Atmore loan interest" value={'−' + fmtMoney(atmoreInterest)} color="var(--brick)"/>}
        <div className="divider" style={{margin: '2px 0'}}/>
        <CloseoutSummaryRow label="Gross profit" value={fmtMoney(grossProfit, {sign: true})} sub="price − basis" color={grossProfit >= 0 ? 'var(--sage)' : 'var(--brick)'}/>
        <CloseoutSummaryRow label="Net profit" value={fmtMoney(netProfit, {sign: true})} big color={netProfit >= 0 ? 'var(--sage)' : 'var(--brick)'}/>
        {payoff > 0 && <CloseoutSummaryRow label="Net cash at closing" value={fmtMoney(netCash)} sub="after loan payoff"/>}
      </div>

      <div className="mb-16">
        <div className="up dim mb-4">Note (optional)</div>
        <textarea className="input" rows="2" value={note} onChange={e => setNote(e.target.value)} style={{width: '100%'}}/>
      </div>

      {!editMode && <div className="small dim mb-16" style={{padding: '8px 12px', background: 'var(--sage-soft)', borderRadius: 4, color: 'var(--sage)'}}>
        ✓ Moves to <strong>I — Sold</strong> and archives. Re-open anytime via “Show archive.”
      </div>}

      <div className="row gap-8">
        <div className="grow"/>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary"
          onClick={() => {
            const payload = {
              salesDate,
              saleSigningDate: saleSigningDate || null,
              saleSigningTime: saleSigningTime || null,
              salesPrice: toStore(salesPrice),
              listPrice: toStore(listPrice),
              salesFees: toStore(salesFees),
              saleFeeItems: [],
              salesCredits: toStore(salesCredits),
              purchaseFees: toStore(purchaseFees),
              purchaseFeeItems: [],
              purchaseCredits: toStore(purchaseCredits),
              salesLoanPayoff: toStore(loanPayoff),
              atmoreLoanPrincipal: toStore(atmorePrincipal),
              atmoreLoanPayoff: toStore(atmorePayoff),
              exchangeFunds: toStore(exchangeFunds),
              saleDDCollected: toStore(ddCollected),
              saleEarnest: toStore(saleEMD),
              rehab: toStore(rehab),
              interest: toStore(interest),
              grossProfit: salesPrice === '' ? null : Math.round(netProfit),
              note,
            };
            if (editMode) updateCloseout(property.id, payload);
            else changeStage(property.id, 'I', payload);
            onClose();
          }}>{editMode ? 'Save close-out' : 'Confirm sale'}</Btn>
      </div>
    </Modal>
  );
}

function MarkFailedDialog({ property, onBack, onClose, initialNote }) {
  const [reason, setReason] = usePS('');
  const [note, setNote] = usePS(initialNote);
  const REASONS = ['Title issue', 'Seller backed out', 'Appraisal came in low', 'Inspection too rough', 'Financing fell through', 'Better deal elsewhere', 'Other'];

  return (
    <Modal title="Mark as Failed" onClose={onClose}>
      <div className="row gap-8 items-center mb-16 small dim">
        <Btn sz="sm" kind="ghost" onClick={onBack}>← back to stage picker</Btn>
      </div>

      <div className="mb-16">
        <div className="up dim">Property</div>
        <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{property.address}</div>
      </div>

      <div className="mb-16">
        <div className="up dim mb-4">Reason</div>
        <div className="col gap-4">
          {REASONS.map(r => (
            <label key={r} style={{display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 4, cursor: 'pointer', background: reason === r ? 'var(--paper-3)' : 'transparent'}}>
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)}/>
              <span style={{fontSize: 13}}>{r}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mb-16">
        <div className="up dim mb-4">Note (recommended)</div>
        <textarea className="input" rows="3" placeholder="What happened?" value={note} onChange={e => setNote(e.target.value)} style={{width: '100%'}}/>
      </div>

      <div className="small dim mb-16" style={{padding: '8px 12px', background: 'var(--brick-soft)', borderRadius: 4, color: 'var(--brick)'}}>
        ⚠ This property will move to <strong>J — Failed</strong> and disappear from the active list. View it again via "Show archive."
      </div>

      <div className="row gap-8">
        <div className="grow"/>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="danger" disabled={!reason}
          onClick={() => {
            changeStage(property.id, 'J', { failedReason: reason, note });
            onClose();
          }}>Mark failed</Btn>
      </div>
    </Modal>
  );
}

function ConvertRentalDialog({ property, onBack, onClose, initialNote }) {
  const [note, setNote] = usePS(initialNote);
  const [addingTenant, setAddingTenant] = usePS(false);

  if (addingTenant) return <AddTenantModal propertyId={property.id} onClose={onClose}/>;

  return (
    <Modal title="Convert to Rental" onClose={onClose}>
      <div className="row gap-8 items-center mb-16 small dim">
        <Btn sz="sm" kind="ghost" onClick={onBack}>← back to stage picker</Btn>
      </div>

      <div className="mb-16">
        <div className="up dim">Property</div>
        <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{property.address}</div>
      </div>

      <div className="mb-16 small" style={{lineHeight: 1.6, color: 'var(--ink-2)'}}>
        Converting to <Pip code="K"/> moves this property into the rental sidecar. The fastest path is to record the tenant now — that converts the stage and starts the rent ledger in one step.
      </div>

      <div className="mb-16">
        <div className="up dim mb-4">Note (optional)</div>
        <textarea className="input" rows="2" value={note} onChange={e => setNote(e.target.value)} style={{width: '100%'}}/>
      </div>

      <div className="row gap-8">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <div className="grow"/>
        <Btn kind="ghost"
          onClick={() => { changeStage(property.id, 'K', { note }); onClose(); }}>Convert only</Btn>
        <Btn kind="primary" onClick={() => setAddingTenant(true)}>Convert &amp; start lease →</Btn>
      </div>
    </Modal>
  );
}

// ────── Under Contract: pick a logged offer or enter terms, + closing logistics ──────
function UnderContractDialog({ property, onBack, onClose, initialNote }) {
  const p = property;
  const offers = (getOffersForProperty(p.id) || []).filter(isOfferActive)
    .sort((a, b) => offerNetToSeller(b) - offerNetToSeller(a));
  const init = offers[0] || null;

  const [sel, setSel]   = usePS(init ? init.id : 'manual'); // offer id | 'manual'
  const [buyer, setBuyer]             = usePS(init ? (init.buyer || '') : '');
  const [offerPrice, setOfferPrice]   = usePS(init && init.offerPrice != null ? String(init.offerPrice) : (p.listPrice != null ? String(p.listPrice) : ''));
  const [earnest, setEarnest]         = usePS(init && init.earnestMoney != null ? String(init.earnestMoney) : '');
  const [financing, setFinancing]     = usePS(init ? (init.financing || 'Conventional') : 'Conventional');
  const [concessions, setConcessions] = usePS(init ? String(offerTotalConcessions(init) || '') : '');
  const [closeDate, setCloseDate]     = usePS(init ? (init.closeDate || '') : '');
  const [contingencies, setContingencies] = usePS(init ? (init.contingencies || []) : []);
  const [attorney, setAttorney]       = usePS(p.attorney || '');
  const [attorneyContact, setAttorneyContact] = usePS(p.attorneyContact || '');
  const [buyerDD, setBuyerDD]         = usePS(p.buyerDDDate || (init && init.ddDeadline) || '');
  const [saleSigningDate, setSaleSigningDate] = usePS(p.saleSigningDate || '');
  const [saleSigningTime, setSaleSigningTime] = usePS(p.saleSigningTime || '');
  const [note, setNote] = usePS(initialNote);

  function applyOffer(o) {
    setSel(o.id);
    setBuyer(o.buyer || '');
    setOfferPrice(o.offerPrice != null ? String(o.offerPrice) : '');
    setEarnest(o.earnestMoney != null ? String(o.earnestMoney) : '');
    setFinancing(o.financing || 'Conventional');
    setConcessions(String(offerTotalConcessions(o) || ''));
    setCloseDate(o.closeDate || '');
    setContingencies(o.contingencies || []);
    if (o.ddDeadline) setBuyerDD(o.ddDeadline);
  }
  function pickManual() {
    setSel('manual');
    setBuyer(''); setOfferPrice(p.listPrice != null ? String(p.listPrice) : '');
    setEarnest(''); setFinancing('Conventional'); setConcessions('');
    setCloseDate(''); setContingencies([]);
  }
  const toggleCont = c => setContingencies(arr => arr.includes(c) ? arr.filter(x => x !== c) : [...arr, c]);

  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const netToSeller = num(offerPrice) - num(concessions);

  return (
    <Modal title="Move to Under Contract" onClose={onClose}>
      <div className="row gap-8 items-center mb-16 small dim">
        <Btn sz="sm" kind="ghost" onClick={onBack}>← back to stage picker</Btn>
        <span className="grow"/>
        <span>Nothing required — gaps are flagged on the dashboard.</span>
      </div>

      <div className="mb-16">
        <div className="up dim">Property</div>
        <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{p.address}</div>
      </div>

      {offers.length > 0 && (
        <>
          <div className="up dim mb-8">Which offer are you accepting?</div>
          <div className="col gap-4 mb-16">
            {offers.map(o => {
              const on = sel === o.id;
              return (
                <div key={o.id} onClick={() => applyOffer(o)}
                  style={{display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer',
                    border: '1px solid ' + (on ? 'var(--blue)' : 'var(--rule)'), borderRadius: 4,
                    background: on ? 'var(--blue-tint)' : 'transparent'}}>
                  <input type="radio" checked={on} onChange={() => applyOffer(o)}/>
                  <div className="grow" style={{minWidth: 0}}>
                    <div className="row gap-8 items-baseline">
                      <span style={{fontWeight: 500, fontSize: 13}}>{o.buyer || 'Unnamed buyer'}</span>
                      <Tag tone={OFFER_STATUS_TONE[o.status]}>{OFFER_STATUS_LABEL[o.status]}</Tag>
                      <span className="tiny dim">{o.financing}</span>
                    </div>
                    <div className="tiny dim">Net to seller {fmtMoney(offerNetToSeller(o))} · close {o.closeDate ? fmtDate(o.closeDate) : '—'}</div>
                  </div>
                  <div className="mono small">{fmtMoney(o.offerPrice)}</div>
                </div>
              );
            })}
            <div onClick={pickManual}
              style={{display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer',
                border: '1px solid ' + (sel === 'manual' ? 'var(--blue)' : 'var(--rule)'), borderRadius: 4,
                background: sel === 'manual' ? 'var(--blue-tint)' : 'transparent'}}>
              <input type="radio" checked={sel === 'manual'} onChange={pickManual}/>
              <span style={{fontSize: 13}}>Enter terms manually <span className="dim">(no logged offer)</span></span>
            </div>
          </div>
        </>
      )}

      <div className="up dim mb-8">Contract terms</div>
      <div className="grid g-2 mb-8">
        <div><div className="up dim mb-4">Buyer</div><input className="input" value={buyer} onChange={e => setBuyer(e.target.value)} style={{width: '100%'}}/></div>
        <div><div className="up dim mb-4">Contract price</div><CloseoutMoney value={offerPrice} onChange={setOfferPrice}/></div>
      </div>
      <div className="grid g-3 mb-8">
        <div><div className="up dim mb-4">Earnest money</div><CloseoutMoney value={earnest} onChange={setEarnest}/></div>
        <div>
          <div className="up dim mb-4">Financing</div>
          <select className="select" value={financing} onChange={e => setFinancing(e.target.value)} style={{width: '100%'}}>
            {FINANCING_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div><div className="up dim mb-4">Seller concessions</div><CloseoutMoney value={concessions} onChange={setConcessions}/></div>
      </div>
      <div className="mb-16">
        <div className="up dim mb-6">Contingencies</div>
        <div className="row gap-6" style={{flexWrap: 'wrap'}}>
          {CONTINGENCY_TYPES.map(c => {
            const on = contingencies.includes(c);
            return (
              <button key={c} onClick={() => toggleCont(c)}
                style={{padding: '5px 12px', borderRadius: 999, cursor: 'pointer', font: 'inherit', fontSize: 12,
                  border: '1px solid ' + (on ? 'var(--blue)' : 'var(--rule)'),
                  background: on ? 'var(--blue-tint)' : 'transparent', color: on ? 'var(--blue-deep)' : 'var(--ink-2)'}}>
                {c}
              </button>
            );
          })}
        </div>
      </div>

      <div className="up dim mb-8">Closing logistics</div>
      <div className="grid g-2 mb-8">
        <div><div className="up dim mb-4">Closing attorney</div><input className="input" value={attorney} onChange={e => setAttorney(e.target.value)} style={{width: '100%'}}/></div>
        <div><div className="up dim mb-4">Attorney contact</div><input className="input" value={attorneyContact} onChange={e => setAttorneyContact(e.target.value)} placeholder="phone or email" style={{width: '100%'}}/></div>
      </div>
      <div className="grid g-2 mb-16">
        <div><div className="up dim mb-4">Expected close date</div><input className="input" type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} style={{width: '100%'}}/></div>
        <div><div className="up dim mb-4">Buyer's DD deadline</div><input className="input" type="date" value={buyerDD} onChange={e => setBuyerDD(e.target.value)} style={{width: '100%'}}/></div>
      </div>
      <div className="grid g-3 mb-16">
        <div><div className="up dim mb-4">Signing date</div><input className="input" type="date" value={saleSigningDate} onChange={e => setSaleSigningDate(e.target.value)} style={{width: '100%'}}/></div>
        <div><div className="up dim mb-4">Signing time</div><input className="input" type="time" value={saleSigningTime} onChange={e => setSaleSigningTime(e.target.value)} style={{width: '100%'}}/></div>
        <div className="col justify-end"><div className="tiny dim">Scheduling the closing — does not mark the property sold.</div></div>
      </div>

      <div className="row between items-center mb-16" style={{padding: '12px 14px', background: 'var(--paper-3)', borderRadius: 6, border: '1px solid var(--rule)'}}>
        <div>
          <div className="small dim">Net to seller</div>
          <div className="tiny dim">price − concessions · prefills the close-out</div>
        </div>
        <div className="serif" style={{fontSize: 22, fontWeight: 500}}>{fmtMoney(netToSeller)}</div>
      </div>

      <div className="mb-16">
        <div className="up dim mb-4">Note (optional)</div>
        <textarea className="input" rows="2" value={note} onChange={e => setNote(e.target.value)} style={{width: '100%'}}/>
      </div>

      <div className="small dim mb-16" style={{padding: '8px 12px', background: 'var(--blue-tint)', borderRadius: 4, color: 'var(--blue-deep)'}}>
        → Moves to <strong>G — Under Contract</strong>{sel === 'manual' ? ' and logs an accepted offer' : ' and accepts this offer'}. Other open offers stay as backups.
      </div>

      <div className="row gap-8">
        <div className="grow"/>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" onClick={() => {
          goUnderContract(p.id, {
            offerId: sel === 'manual' ? null : sel,
            terms: { buyer, offerPrice, earnestMoney: earnest, financing, concessionsTotal: concessions, closeDate, contingencies },
            closing: { attorney, attorneyContact, buyerDDDate: buyerDD, saleSigningDate, saleSigningTime },
            note,
          });
          onClose();
        }}>Go under contract →</Btn>
      </div>
    </Modal>
  );
}

// ────── Fill-in-missing-fields prompt for ordinary forward moves ──────
function FillStageFieldsDialog({ property, code, missing, note, onBack, onClose }) {
  const [vals, setVals] = usePS(() => Object.fromEntries(missing.map(k => [k, ''])));
  const set = (k, v) => setVals(o => ({ ...o, [k]: v }));

  function move(withVals) {
    const opts = { note };
    if (withVals) {
      missing.forEach(k => {
        const v = vals[k];
        if (v === '' || v == null) return;
        opts[k] = FIELD_META[k]?.kind === 'money' ? parseFloat(v) : v;
      });
    }
    changeStage(property.id, code, opts);
    onClose();
  }
  const anyFilled = missing.some(k => vals[k] !== '' && vals[k] != null);

  return (
    <Modal title={`Moving to ${STATUS_LABEL[code]}`} onClose={onClose}>
      <div className="row gap-8 items-center mb-16 small dim">
        <Btn sz="sm" kind="ghost" onClick={onBack}>← back to stage picker</Btn>
      </div>

      <div className="mb-16">
        <div className="up dim">Property</div>
        <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{property.address}</div>
      </div>

      <div className="small mid mb-16" style={{lineHeight: 1.6}}>
        A few fields are usually filled by the time a property reaches <strong>{STATUS_LABEL[code]}</strong>. Add them now, or skip — anything left blank gets flagged on the dashboard.
      </div>

      <div className="col gap-12 mb-16">
        {missing.map(k => {
          const meta = FIELD_META[k] || { label: k, kind: 'money' };
          return (
            <div key={k}>
              <div className="up dim mb-4">{meta.label}</div>
              <input
                className={'input' + (meta.kind === 'money' ? ' mono' : '')}
                type={meta.kind === 'date' ? 'date' : 'number'}
                step={meta.kind === 'money' ? '100' : undefined}
                placeholder={meta.kind === 'money' ? '0' : undefined}
                value={vals[k]} onChange={e => set(k, e.target.value)}
                style={{width: '100%'}}/>
            </div>
          );
        })}
      </div>

      <div className="row gap-8">
        <div className="grow"/>
        <Btn kind="ghost" onClick={() => move(false)}>Skip &amp; move</Btn>
        <Btn kind="primary" disabled={!anyFilled} onClick={() => move(true)}>Save &amp; move →</Btn>
      </div>
    </Modal>
  );
}

// ────── Pip-as-button: little chevron wrapping a Pip ──────
function StagePip({ code, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        background: 'transparent', border: 'none', padding: 0,
        display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        fontFamily: 'inherit',
      }}
      title="Click to change stage">
      <Pip code={code}/>
      <span style={{color: 'var(--ink-3)', fontSize: 11}}>▾</span>
    </button>
  );
}

// ────── Leaving Coming Soon: capture utility setup ──────
function UtilitiesPrompt({ property, targetCode, onContinue, onBack, onClose }) {
  const [utilities, setUtilities] = usePS(property.utilities || {});

  function move(withData) {
    if (withData) updateProperty(property.id, { utilities });
    onContinue();
  }

  return (
    <Modal title="Set up utilities" onClose={onClose}>
      <div className="row gap-8 items-center mb-16 small dim">
        <Btn sz="sm" kind="ghost" onClick={onBack}>← back to stage picker</Btn>
      </div>

      <div className="mb-16">
        <div className="up dim">Property</div>
        <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{property.address}</div>
      </div>

      <div className="small mid mb-16" style={{lineHeight: 1.6}}>
        This property is leaving <strong>Coming Soon</strong> → <strong>{STATUS_LABEL[targetCode]}</strong>.
        Capture who the utilities are with so rehab and showings aren't held up. Fill what you know — you can skip and add it later.
      </div>

      <div className="mb-16">
        <UtilityFields value={utilities} onChange={setUtilities}/>
      </div>

      <div className="row gap-8">
        <div className="grow"/>
        <Btn kind="ghost" onClick={() => move(false)}>Skip &amp; move</Btn>
        <Btn kind="primary" onClick={() => move(true)}>Save &amp; move →</Btn>
      </div>
    </Modal>
  );
}

Object.assign(window, { StagePicker, StagePip, MarkSoldDialog, MarkFailedDialog, ConvertRentalDialog, UnderContractDialog, FillStageFieldsDialog, UtilitiesPrompt, FeeItemsEditor, feeItemsTotal, cleanFeeItems, initFeeItems, FEE_PRESETS_PURCHASE, FEE_PRESETS_SALE });
