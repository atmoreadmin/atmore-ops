// property-editor.jsx — Edit property details modal.
// Static + reference data only. The buy-side deal data (price, dates, fees,
// attorney, rehab) lives in the Acquisition form on the Overview tab — there is
// exactly one place to edit it.

function PropertyEditor({ property, onClose }) {
  const p = property;
  // Basics
  const [type, setType] = useState(p.type || '');
  const [assigned, setAssigned] = useState(p.assigned || '');
  const [loanType, setLoanType] = useState(p.loanType || '');
  const [lockbox, setLockbox] = useState(p.lockbox || '');
  const [vestingLLC, setVestingLLC] = useState(p.vestingLLC || '');
  const [driveUrl, setDriveUrl] = useState(p.driveUrl || '');
  const [notes, setNotes] = useState(p.notes || '');
  // Signing schedule — drives the dashboard "Next 14 days" scheduler.
  const [signingDate, setSigningDate] = useState(p.signingDate || '');
  const [signingTime, setSigningTime] = useState(p.closingTime || '');

  // Insurance
  const ins = p.insurance || {};
  const [iCarrier, setICarrier] = useState(ins.carrier || '');
  const [iPolicy, setIPolicy] = useState(ins.policyNumber || '');
  const [iPremium, setIPremium] = useState(ins.premium || '');
  const [iRenewal, setIRenewal] = useState(ins.renewalDate || '');
  const [iAgentName, setIAgentName] = useState(ins.agentName || '');
  const [iAgentPhone, setIAgentPhone] = useState(ins.agentPhone || '');

  // Loan detail
  const ld = p.loanDetail || {};
  const [lLender, setLLender] = useState(ld.lender || '');
  const [lNumber, setLNumber] = useState(ld.loanNumber || '');
  const [lMonthly, setLMonthly] = useState(ld.monthlyPayment || '');
  const [lBalance, setLBalance] = useState(ld.currentBalance || '');
  const [lMaturity, setLMaturity] = useState(ld.maturityDate || '');
  const [lRate, setLRate] = useState(ld.interestRate || '');
  // "Taxes escrowed" is asked twice in this editor — once under the loan, once
  // under property tax — but it is ONE fact. They were separate state, and the
  // Rental P&L only ever read the loan copy: checking the tax-section box left
  // the P&L subtracting tax on top of a mortgage that already contained it.
  // Both boxes now drive both fields.
  const [lEscrowT, setLEscrowT] = useState(!!ld.escrowedTaxes || !!(p.taxes || {}).escrowed);
  const [lEscrowI, setLEscrowI] = useState(!!ld.escrowedInsurance);
  const [lContact, setLContact] = useState(ld.lenderContact || '');
  const [lEscrowStart, setLEscrowStart] = useState(ld.escrowStart || '');
  const [refiOpen, setRefiOpen] = useState(false);
  function onRefi(n) {
    setLLender(n.lender || ''); setLNumber(n.loanNumber || ''); setLMonthly(n.monthlyPayment || ''); setLBalance(n.currentBalance || '');
    setLRate(n.interestRate || ''); setLMaturity(n.maturityDate || ''); setLContact(n.lenderContact || '');
    setLEscrowI(!!n.escrowedInsurance); setTaxEscrowed(!!n.escrowedTaxes); setLEscrowStart(n.escrowStart || '');
  }

  // Utilities
  const [utilities, setUtilities] = useState(p.utilities || {});

  // Taxes
  const tx = p.taxes || {};
  const [tAnnual, setTAnnual] = useState(tx.annualAmount || '');
  const [tDue, setTDue] = useState(tx.dueDate || '');
  const [tEscrowed, setTEscrowed] = useState(!!tx.escrowed || !!ld.escrowedTaxes);
  const setTaxEscrowed = v => { setLEscrowT(v); setTEscrowed(v); };
  const [tParcel, setTParcel] = useState(tx.taxId || '');
  const [financingType, setFinancingType] = useState(p.financingType || '');

  const [section, setSection] = useState('basics');

  function save(opts) {
    const patch = {
      type, assigned, loanType, lockbox, vestingLLC, driveUrl, notes,
      financingType: financingType || null,
      signingDate: signingDate || null,
      closingTime: signingTime || null,
      insurance: (iCarrier || iPolicy || iPremium || iRenewal || iAgentName || iAgentPhone) ? {
        carrier: iCarrier, policyNumber: iPolicy,
        premium: iPremium ? parseFloat(iPremium) : null,
        renewalDate: iRenewal || null,
        agentName: iAgentName, agentPhone: iAgentPhone,
      } : null,
      loanDetail: (lLender || lNumber || lBalance || lMonthly || lRate || lMaturity || lContact || lEscrowT || lEscrowI) ? {
        lender: lLender, loanNumber: lNumber,
        monthlyPayment: lMonthly ? parseFloat(lMonthly) : null,
        currentBalance: lBalance ? parseFloat(lBalance) : null,
        maturityDate: lMaturity || null,
        interestRate: lRate ? parseFloat(lRate) : null,
        escrowedTaxes: lEscrowT,
        escrowedInsurance: lEscrowI,
        escrowStart: lEscrowStart || null,
        lenderContact: lContact,
      } : null,
      taxes: (tAnnual || tDue || tParcel || tEscrowed) ? {
        annualAmount: tAnnual ? parseFloat(tAnnual) : null,
        dueDate: tDue || null,
        escrowed: tEscrowed,
        taxId: tParcel,
      } : null,
      utilities: utilitiesSetUp({ utilities }) ? utilities : null,
    };
    updateProperty(p.id, patch);
    if (opts && opts.keepOpen) return;   // eviction save — the read-only notice stays visible
    onClose();
  }

  const SECTIONS = [
    {id:'basics',    label:'Basics'},
    {id:'mortgage',  label:'Mortgage'},
    {id:'financing', label:'Financing'},
    {id:'insurance', label:'Insurance'},
    {id:'taxutil',   label:'Taxes & utilities'},
  ];

  return (
    <Modal lockKey={'properties:' + p.id} lockLabel={p.address} onEvictedSave={() => { try { save({ keepOpen: true }); } catch (e) {} }} title={`Edit · ${p.address}`} onClose={onClose}
      right={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>Save</Btn></>}>
      <div className="row gap-16 items-start" style={{minHeight: 380}}>
        <div className="col" style={{width: 160, flexShrink: 0}}>
          {SECTIONS.map(s => (
            <div key={s.id} className={'rail__item' + (section === s.id ? ' rail__item--active' : '')}
              onClick={() => setSection(s.id)}>{s.label}</div>
          ))}
          <div className="tiny dim mt-12" style={{padding: '0 12px', lineHeight: 1.5}}>
            Purchase price &amp; fees are edited under <strong>Overview → Acquisition</strong>.
          </div>
        </div>

        <div className="grow" style={{minWidth: 0}}>
          {section === 'basics' && (
            <div className="col gap-12">
              <div className="grid g-2">
                <Field label="Property type">
                  <ManagedSelect listKey="propertyTypes" value={type} onChange={setType} style={{width: '100%'}}/>
                </Field>
                <Field label="Assigned to">
                  <input className="input" value={assigned} onChange={e => setAssigned(e.target.value)} style={{width: '100%'}}/>
                </Field>
              </div>
              <div className="grid g-2">
                <Field label="Vesting LLC">
                  <ManagedSelect listKey="vestingLLCs" value={vestingLLC} onChange={setVestingLLC} style={{width: '100%'}}/>
                </Field>
                <Field label="Loan type">
                  <ManagedSelect listKey="loanTypes" value={loanType} onChange={setLoanType} style={{width: '100%'}}/>
                </Field>
              </div>
              <Field label="Lockbox code">
                <input className="input" value={lockbox} onChange={e => setLockbox(e.target.value)} style={{width: 200, fontFamily: 'IBM Plex Mono, monospace'}}/>
              </Field>
              <div className="divider" style={{margin: '4px 0'}}/>
              <div className="up dim">Signing</div>
              <div className="grid g-2">
                <Field label="Signing date">
                  <input className="input" type="date" value={signingDate} onChange={e => setSigningDate(e.target.value)} style={{width: '100%'}}/>
                </Field>
                <Field label="Signing time">
                  <input className="input" type="time" value={signingTime} onChange={e => setSigningTime(e.target.value)} style={{width: '100%'}}/>
                </Field>
              </div>
              <div className="tiny dim" style={{marginTop: -4}}>Shows on the dashboard “Next 14 days” scheduler.</div>
              <Field label="Google Drive folder">
                <input className="input" type="url" value={driveUrl} onChange={e => setDriveUrl(e.target.value)} style={{width: '100%'}}
                  placeholder="https://drive.google.com/drive/folders/…"/>
                <div className="tiny dim mt-4">Pasting the URL makes the "Open Drive folder" button work.</div>
              </Field>
              <Field label="Notes">
                <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} style={{width: '100%', minHeight: 100, resize: 'vertical', fontFamily: 'inherit'}}
                  placeholder="Anything to remember about this property—contractor preferences, neighbor issues, quirks, history…"/>
              </Field>
            </div>
          )}

          {section === 'mortgage' && (
            <div className="col gap-12">
              <div className="up dim">Mortgage</div>
              <div className="grid g-2">
                <Field label="Lender"><input className="input" value={lLender} onChange={e => setLLender(e.target.value)} style={{width: '100%'}}/></Field>
                <Field label="Loan #"><input className="input mono" value={lNumber} onChange={e => setLNumber(e.target.value)} style={{width: '100%'}}/></Field>
              </div>
              <div className="grid g-3">
                <Field label="Monthly payment"><input className="input mono" type="number" value={lMonthly} onChange={e => setLMonthly(e.target.value)} style={{width: '100%'}}/></Field>
                <Field label="Current balance"><input className="input mono" type="number" value={lBalance} onChange={e => setLBalance(e.target.value)} style={{width: '100%'}}/></Field>
                <Field label="Interest rate %"><input className="input mono" type="number" step="0.01" value={lRate} onChange={e => setLRate(e.target.value)} style={{width: '100%'}}/></Field>
              </div>
              <div className="grid g-2">
                <Field label="Maturity date"><input className="input" type="date" value={lMaturity} onChange={e => setLMaturity(e.target.value)} style={{width: '100%'}}/></Field>
                <Field label="Lender contact"><input className="input" value={lContact} onChange={e => setLContact(e.target.value)} style={{width: '100%'}}/></Field>
              </div>
              <Field label="Escrow">
                <div className="col gap-6">
                  <label className="row gap-6 items-center small" style={{cursor:'pointer'}}><input type="checkbox" checked={lEscrowT} onChange={e => setTaxEscrowed(e.target.checked)}/> Taxes escrowed by lender</label>
                  <label className="row gap-6 items-center small" style={{cursor:'pointer'}}><input type="checkbox" checked={lEscrowI} onChange={e => setLEscrowI(e.target.checked)}/> Insurance escrowed by lender</label>
                  {(lEscrowT || lEscrowI) && <div className="row gap-8 items-center" style={{marginTop: 4}}>
                    <span className="small dim">Escrow starts</span>
                    <input className="input mono" type="month" value={lEscrowStart} onChange={e => setLEscrowStart(e.target.value)} style={{width: 160}}/>
                    <span className="tiny dim">Blank = since closing. Earlier months still count taxes/insurance separately.</span>
                  </div>}
                </div>
              </Field>
              <div className="row gap-10 items-center" style={{paddingTop: 8, borderTop: '1px solid var(--rule-soft)'}}>
                <Btn sz="sm" kind="ghost" onClick={() => setRefiOpen(true)}>Record refinance…</Btn>
                <span className="tiny dim">Keeps the old loan on file and starts new carrying amounts from the refi month.</span>
              </div>
              {(p.loanHistory || []).length > 0 && <Field label="Prior loans">
                <div className="col gap-4">{p.loanHistory.slice().reverse().map((h, i) => (
                  <div key={i} className="small dim">{(h.lender || 'Lender')}{h.loanNumber ? ' #' + h.loanNumber : ''}{h.monthlyPayment ? ' · ' + fmtMoney(h.monthlyPayment) + '/mo' : ''}{h.endedOn ? ' · until ' + fmtDate(h.endedOn + '-01') : ''}</div>
                ))}</div>
              </Field>}
              {refiOpen && <RefinanceModal p={p} onClose={() => setRefiOpen(false)} onDone={onRefi}/>}
            </div>
          )}

          {section === 'financing' && (
            <div className="col gap-12">
              <div className="up dim">Financing</div>
              <Field label="Loan structure">
                <select className="input" value={financingType} onChange={e => setFinancingType(e.target.value)} style={{width: 220}}>
                  <option value="">—</option>
                  <option value="DSCR">DSCR</option>
                  <option value="Cash">Cash</option>
                  <option value="Bridge">Bridge</option>
                </select>
              </Field>
              <div className="tiny dim" style={{lineHeight: 1.5}}>How this property is financed — DSCR loan, bought with cash, or on a bridge loan.</div>
            </div>
          )}

          {section === 'insurance' && (
            <div className="col gap-12">
              <div className="up dim">Insurance</div>
              <div className="grid g-2">
                <Field label="Carrier"><input className="input" value={iCarrier} onChange={e => setICarrier(e.target.value)} style={{width: '100%'}}/></Field>
                <Field label="Policy #"><input className="input mono" value={iPolicy} onChange={e => setIPolicy(e.target.value)} style={{width: '100%'}}/></Field>
              </div>
              <div className="grid g-2">
                <Field label="Annual premium"><input className="input mono" type="number" value={iPremium} onChange={e => setIPremium(e.target.value)} style={{width: '100%'}}/></Field>
                <Field label="Renewal date"><input className="input" type="date" value={iRenewal} onChange={e => setIRenewal(e.target.value)} style={{width: '100%'}}/></Field>
              </div>
              <div className="grid g-2">
                <Field label="Agent name"><input className="input" value={iAgentName} onChange={e => setIAgentName(e.target.value)} style={{width: '100%'}}/></Field>
                <Field label="Agent phone"><input className="input mono" value={iAgentPhone} onChange={e => setIAgentPhone(e.target.value)} style={{width: '100%'}}/></Field>
              </div>
            </div>
          )}

          {section === 'taxutil' && (
            <div className="col gap-12">
              <div className="up dim">Property tax</div>
              <div className="grid g-2">
                <Field label="Annual property tax"><input className="input mono" type="number" value={tAnnual} onChange={e => setTAnnual(e.target.value)} style={{width: '100%'}}/></Field>
                <Field label="Due date"><input className="input" type="date" value={tDue} onChange={e => setTDue(e.target.value)} style={{width: '100%'}}/></Field>
              </div>
              <Field label="Parcel / tax ID"><input className="input mono" value={tParcel} onChange={e => setTParcel(e.target.value)} style={{width: 300}}/></Field>
              <Field label="">
                <label className="row gap-6 items-center small" style={{cursor:'pointer'}}>
                  <input type="checkbox" checked={tEscrowed} onChange={e => setTaxEscrowed(e.target.checked)}/>
                  Taxes paid through escrow (lender handles)
                </label>
                <div className="tiny dim mt-4">Same setting as “Taxes escrowed by lender” under the loan. If escrowed, tax-due alerts are hidden and the Rental P&amp;L counts tax inside the mortgage payment instead of as its own line.</div>
              </Field>

              <div className="divider" style={{margin: '4px 0'}}/>
              <div className="up dim">Utilities</div>
              <div className="small dim" style={{lineHeight: 1.6}}>Who each utility is with, the account number, and whether it's on in our name, transferred, or off.</div>
              <UtilityFields value={utilities} onChange={setUtilities}/>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Refinance: archive the current loan, set the new one, and start a new carrying
// period from the refi month so earlier P&L months keep the old payment/escrow.
function RefinanceModal({ p, onClose, onDone }) {
  const [month, setMonth] = useState(TODAY().slice(0, 7));
  const [f, setF] = useState({ lender: '', loanNumber: '', monthlyPayment: '', currentBalance: '', interestRate: '', maturityDate: '', lenderContact: '', escrowedTaxes: true, escrowedInsurance: true });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const ok = /^\d{4}-\d{2}$/.test(month) && parseFloat(f.monthlyPayment) > 0;
  function save() {
    const [y, m] = month.split('-').map(Number);
    const prev = m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
    const prevCarry = pnlCarryingFor(p, prev);
    const base = p.rentalCarrying || pnlCarrying(p);
    const num = v => v === '' || v == null ? null : parseFloat(v);
    const newLoan = { ...(p.loanDetail || {}), lender: f.lender, loanNumber: f.loanNumber, monthlyPayment: num(f.monthlyPayment), currentBalance: num(f.currentBalance),
      interestRate: num(f.interestRate), maturityDate: f.maturityDate || null, lenderContact: f.lenderContact, escrowedTaxes: f.escrowedTaxes, escrowedInsurance: f.escrowedInsurance, escrowStart: month };
    updateProperty(p.id, {
      loanHistory: [...(p.loanHistory || []), { ...(p.loanDetail || {}), endedOn: month }],
      loanDetail: newLoan,
      rentalCarrying: { mortgage: base.mortgage || 0, hoa: base.hoa || 0, tax: base.tax || 0, insurance: base.insurance || 0,
        escrowTaxes: base.escrowTaxes != null ? base.escrowTaxes : pnlEscrowedFor(p, 'tax', prev),
        escrowInsurance: base.escrowInsurance != null ? base.escrowInsurance : pnlEscrowedFor(p, 'insurance', prev) },
      carryingPeriods: [...(p.carryingPeriods || []).filter(x => x.from !== month), {
        from: month, mortgage: num(f.monthlyPayment) || 0, hoa: prevCarry.hoa || 0, tax: prevCarry.tax || 0, insurance: prevCarry.insurance || 0,
        escrowTaxes: f.escrowedTaxes, escrowInsurance: f.escrowedInsurance, note: 'Refinance' + (f.lender ? ' · ' + f.lender : '') }].sort((a, b) => a.from.localeCompare(b.from)),
      taxes: { ...(p.taxes || {}), escrowed: f.escrowedTaxes },
    });
    onDone && onDone(newLoan);
    onClose();
  }
  return (
    <Modal title={'Record refinance · ' + p.address} onClose={onClose}
      right={<div className="row gap-8"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn disabled={!ok} onClick={save}>Save refinance</Btn></div>}>
      <div className="col gap-12">
        <div className="small dim" style={{textWrap: 'pretty'}}>The current loan{(p.loanDetail || {}).lender ? ' (' + p.loanDetail.lender + ')' : ''} moves to Prior loans. Rental P&L uses the new payment and escrow from the first-payment month; earlier months are unchanged.</div>
        <div className="grid g-2">
          <Field label="First new payment (month)"><input className="input mono" type="month" value={month} onChange={e => setMonth(e.target.value)} style={{width: '100%'}}/></Field>
          <Field label="New monthly payment"><input className="input mono" type="number" step="0.01" value={f.monthlyPayment} onChange={e => set('monthlyPayment', e.target.value)} style={{width: '100%'}}/></Field>
          <Field label="Lender"><input className="input" value={f.lender} onChange={e => set('lender', e.target.value)} style={{width: '100%'}}/></Field>
          <Field label="Loan #"><input className="input mono" value={f.loanNumber} onChange={e => set('loanNumber', e.target.value)} style={{width: '100%'}}/></Field>
          <Field label="Balance"><input className="input mono" type="number" value={f.currentBalance} onChange={e => set('currentBalance', e.target.value)} style={{width: '100%'}}/></Field>
          <Field label="Interest rate %"><input className="input mono" type="number" step="0.01" value={f.interestRate} onChange={e => set('interestRate', e.target.value)} style={{width: '100%'}}/></Field>
          <Field label="Maturity date"><input className="input" type="date" value={f.maturityDate} onChange={e => set('maturityDate', e.target.value)} style={{width: '100%'}}/></Field>
          <Field label="Lender contact"><input className="input" value={f.lenderContact} onChange={e => set('lenderContact', e.target.value)} style={{width: '100%'}}/></Field>
        </div>
        <div className="col gap-6">
          <label className="row gap-6 items-center small" style={{cursor: 'pointer'}}><input type="checkbox" checked={f.escrowedTaxes} onChange={e => set('escrowedTaxes', e.target.checked)}/> Taxes escrowed in new payment</label>
          <label className="row gap-6 items-center small" style={{cursor: 'pointer'}}><input type="checkbox" checked={f.escrowedInsurance} onChange={e => set('escrowedInsurance', e.target.checked)}/> Insurance escrowed in new payment</label>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div>
      {label && <div className="up dim mb-4">{label}</div>}
      {children}
    </div>
  );
}

// Shared utilities form — used by the editor's Utilities section and the
// "leaving Coming Soon" stage prompt.
function UtilityFields({ value, onChange }) {
  const v = value || {};
  const set = (key, field, val) => onChange({ ...v, [key]: { ...(v[key] || {}), [field]: val } });
  return (
    <div className="col gap-10">
      <div className="row gap-10" style={{paddingBottom: 4}}>
        <div style={{width: 130, flexShrink: 0}}/>
        <div className="up dim grow">Provider</div>
        <div className="up dim grow">Account #</div>
        <div className="up dim" style={{width: 150, flexShrink: 0}}>Status</div>
      </div>
      {UTILITY_TYPES.map(u => {
        const r = v[u.key] || {};
        return (
          <div key={u.key} className="row gap-10 items-center">
            <div className="small" style={{width: 130, flexShrink: 0, fontWeight: 500}}>{u.icon} {u.label}</div>
            <input className="input grow" value={r.provider || ''} onChange={e => set(u.key, 'provider', e.target.value)}
              placeholder="e.g. Alabama Power" style={{minWidth: 0}}/>
            <input className="input mono grow" value={r.account || ''} onChange={e => set(u.key, 'account', e.target.value)}
              placeholder="—" style={{minWidth: 0}}/>
            <select className="select" value={r.status || ''} onChange={e => set(u.key, 'status', e.target.value)}
              style={{width: 150, flexShrink: 0}}>
              {Object.entries(UTILITY_STATUS).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
            </select>
          </div>
        );
      })}
      <Field label="Utility notes">
        <textarea className="input" value={v.note || ''} onChange={e => onChange({ ...v, note: e.target.value })}
          style={{width: '100%', minHeight: 64, resize: 'vertical', fontFamily: 'inherit'}}
          placeholder="Meter locations, deposit info, who to call, anything quirky…"/>
      </Field>
    </div>
  );
}

Object.assign(window, { PropertyEditor, UtilityFields });
