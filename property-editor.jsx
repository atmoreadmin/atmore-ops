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
  const [lEscrowT, setLEscrowT] = useState(!!ld.escrowedTaxes);
  const [lEscrowI, setLEscrowI] = useState(!!ld.escrowedInsurance);
  const [lContact, setLContact] = useState(ld.lenderContact || '');

  // Utilities
  const [utilities, setUtilities] = useState(p.utilities || {});

  // Taxes
  const tx = p.taxes || {};
  const [tAnnual, setTAnnual] = useState(tx.annualAmount || '');
  const [tDue, setTDue] = useState(tx.dueDate || '');
  const [tEscrowed, setTEscrowed] = useState(!!tx.escrowed);
  const [tParcel, setTParcel] = useState(tx.taxId || '');
  const [financingType, setFinancingType] = useState(p.financingType || '');

  const [section, setSection] = useState('basics');

  function save() {
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
    <Modal title={`Edit · ${p.address}`} onClose={onClose}
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
                  <label className="row gap-6 items-center small" style={{cursor:'pointer'}}><input type="checkbox" checked={lEscrowT} onChange={e => setLEscrowT(e.target.checked)}/> Taxes escrowed by lender</label>
                  <label className="row gap-6 items-center small" style={{cursor:'pointer'}}><input type="checkbox" checked={lEscrowI} onChange={e => setLEscrowI(e.target.checked)}/> Insurance escrowed by lender</label>
                </div>
              </Field>
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
                  <input type="checkbox" checked={tEscrowed} onChange={e => setTEscrowed(e.target.checked)}/>
                  Taxes paid through escrow (lender handles)
                </label>
                <div className="tiny dim mt-4">If escrowed, the app won't surface tax-due alerts on the dashboard.</div>
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
