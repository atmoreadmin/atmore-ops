// modals.jsx — assorted "add" + "split" + "reconcile" modals

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SplitTransactionModal — divide one tx across multiple properties
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function SplitTransactionModal({ tx, onClose }) {
  const store = useStore();
  const initial = tx.splits && tx.splits.length
    ? tx.splits.map(s => ({...s}))
    : [{ project: tx.project && tx.project !== 'multiple' ? tx.project : '', amount: tx.amount, category: tx.category || '' }];
  const [splits, setSplits] = useState(initial);
  const [autoMark, setAutoMark] = useState(true);

  const total = tx.amount;
  const allocated = splits.reduce((a, s) => a + (parseFloat(s.amount) || 0), 0);
  const remaining = total - allocated;
  const isBalanced = Math.abs(remaining) < 0.01;
  const isIncome = tx.amount > 0;

  function patch(i, p) {
    const next = splits.slice();
    next[i] = { ...next[i], ...p };
    setSplits(next);
  }
  function addRow() {
    setSplits([...splits, { project: '', amount: remaining > 0 ? remaining : '', category: tx.category || '' }]);
  }
  function removeRow(i) {
    setSplits(splits.filter((_, idx) => idx !== i));
  }
  function fillBySection8() {
    const hcvTenants = store.tenants.filter(t => t.status === 'active' && t.source === 'Section 8');
    if (hcvTenants.length === 0) { alert('No active Section 8 tenants to split by.'); return; }
    const rows = hcvTenants.map(t => ({
      project: getProperty(t.propertyId)?.address || '',
      amount: t.rent,
      category: 'Rental Income',
      tenantId: t.id,
    }));
    setSplits(rows);
  }
  function splitEvenly() {
    if (splits.length === 0) return;
    const per = Math.round((total / splits.length) * 100) / 100;
    setSplits(splits.map(s => ({ ...s, amount: per })));
  }

  function save() {
    const cleaned = splits.filter(s => s.project && (parseFloat(s.amount) || 0) !== 0)
      .map(s => ({ project: s.project, amount: parseFloat(s.amount), category: s.category || '', tenantId: s.tenantId }));
    splitTransaction(tx.id, cleaned);

    // Auto-mark rent ledger if requested
    if (autoMark && isIncome) {
      const month = tx.date.slice(0,7);
      cleaned.forEach(sp => {
        if (sp.category !== 'Rental Income') return;
        const property = getPropertyByAddr(sp.project);
        if (!property) return;
        const tenants = getTenantsForProperty(property.id);
        const tenant = sp.tenantId
          ? tenants.find(t => t.id === sp.tenantId)
          : tenants.find(t => t.status === 'active');
        if (!tenant) return;
        const ledger = store.rentLedger.find(r => r.tenantId === tenant.id && r.month === month);
        if (ledger && ledger.status !== 'paid') {
          markPaid(ledger.id, sp.amount);
          linkLedgerToTransaction(ledger.id, tx.id);
        }
      });
    }
    onClose();
  }

  return (
    <Modal title={`Split transaction · ${fmtMoney(tx.amount, {sign: true})}`} onClose={onClose}>
      <div className="col gap-14">
        <div style={{padding: '12px 14px', background: 'var(--paper-3)', borderRadius: 4}}>
          <div className="row gap-12 items-baseline">
            <span className="mono small">{fmtDate(tx.date, {full: true})}</span>
            <span style={{fontSize: 14, fontWeight: 500}}>{tx.desc}</span>
          </div>
          <div className="row gap-12 mt-4 small dim">
            <span>Account {tx.acct}</span>
            <span>·</span>
            <span>{isIncome ? 'Deposit' : 'Charge'}: {fmtMoney(tx.amount)}</span>
          </div>
        </div>

        <div className="row gap-8 items-center">
          <span className="up dim">Quick fill</span>
          <Btn sz="sm" kind="ghost" onClick={fillBySection8}>By Section 8 tenants</Btn>
          {splits.length > 1 && <Btn sz="sm" kind="ghost" onClick={splitEvenly}>Split evenly</Btn>}
        </div>

        <table className="tbl">
          <thead>
            <tr>
              <th>Property</th>
              <th className="num">Amount</th>
              <th>Category</th>
              <th style={{width: 1}}></th>
            </tr>
          </thead>
          <tbody>
            {splits.map((s, i) => (
              <tr key={i}>
                <td>
                  <select className="select" value={s.project} onChange={e => patch(i, {project: e.target.value})} style={{width: '100%', minWidth: 200}}>
                    <option value="">— pick property —</option>
                    {s.project && !OVERHEAD_PROJECTS.includes(s.project) && !store.properties.some(p => p.address === s.project) && (
                      <option value={s.project}>{s.project}</option>
                    )}
                    <optgroup label="Overhead">
                      {OVERHEAD_PROJECTS.map(o => <option key={o} value={o}>{o}</option>)}
                    </optgroup>
                    <optgroup label="Properties">
                      {store.properties.map(p => <option key={p.id} value={p.address}>{p.address}</option>)}
                    </optgroup>
                  </select>
                </td>
                <td className="num">
                  <input className="input mono" type="number" step="0.01" value={s.amount}
                    onChange={e => patch(i, {amount: e.target.value})} style={{width: 110, textAlign: 'right'}}/>
                </td>
                <td>
                  <ManagedSelect listKey="categories" value={s.category} onChange={(v) => patch(i, {category: v})} style={{width: '100%', minWidth: 180}}/>
                </td>
                <td>
                  {splits.length > 1 && <Btn sz="sm" kind="ghost" onClick={() => removeRow(i)}>×</Btn>}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan="4">
                <Btn sz="sm" kind="ghost" onClick={addRow}>+ Add split</Btn>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="row gap-16 items-baseline" style={{padding: '10px 14px', background: isBalanced ? 'var(--sage-soft)' : 'var(--ochre-soft)', borderRadius: 4}}>
          <div>
            <div className="up dim">Total</div>
            <div className="mono">{fmtMoney(total)}</div>
          </div>
          <div className="divider-v"/>
          <div>
            <div className="up dim">Allocated</div>
            <div className="mono">{fmtMoney(allocated)}</div>
          </div>
          <div className="divider-v"/>
          <div>
            <div className="up dim" style={{color: isBalanced ? 'var(--sage)' : 'var(--ochre)'}}>
              {isBalanced ? '✓ Balanced' : 'Remaining'}
            </div>
            <div className="mono" style={{color: isBalanced ? 'var(--sage)' : 'var(--ochre)', fontWeight: 600}}>{fmtMoney(remaining)}</div>
          </div>
          <div className="grow"/>
        </div>

        {isIncome && (
          <label className="row gap-6 items-center small" style={{cursor: 'pointer'}}>
            <input type="checkbox" checked={autoMark} onChange={e => setAutoMark(e.target.checked)}/>
            <span>Also mark matching rent ledger entries as paid for this month</span>
          </label>
        )}

        <div className="row gap-8 mt-8">
          {tx.splits && tx.splits.length > 0 && (
            <Btn kind="ghost" onClick={() => { if (confirm('Remove split? The transaction will revert to a single property.')) { clearSplit(tx.id); onClose(); } }}>Remove split</Btn>
          )}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!isBalanced || splits.filter(s => s.project).length < 2} onClick={save}>
            Save split
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AddTenantModal — start a lease on a property
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AddTenantModal({ propertyId, tenant, onClose }) {
  const editing = !!tenant;
  const p = getProperty(propertyId || (tenant && tenant.propertyId));
  const pid = propertyId || (tenant && tenant.propertyId);
  const [name, setName] = useState(tenant?.name || '');
  const [phone, setPhone] = useState(tenant?.phone || '');
  const [email, setEmail] = useState(tenant?.email || '');
  const [moveIn, setMoveIn] = useState(tenant?.moveIn || TODAY());
  const [leaseEnd, setLeaseEnd] = useState(tenant?.leaseEnd || addMonthsISO(TODAY(), 12));
  const [rent, setRent] = useState(tenant?.rent != null ? String(tenant.rent) : '');
  const [deposit, setDeposit] = useState(tenant?.deposit != null ? String(tenant.deposit) : '');
  const [source, setSource] = useState(tenant?.source || 'Zelle');
  const [voucher, setVoucher] = useState(tenant?.voucher || '');
  const [phaPortion, setPhaPortion] = useState(tenant?.phaPortion != null ? String(tenant.phaPortion) : '');
  const [tenantPortion, setTenantPortion] = useState(tenant?.tenantPortion != null ? String(tenant.tenantPortion) : '');
  const [occupants, setOccupants] = useState(tenant?.occupants != null ? String(tenant.occupants) : '');
  const [notes, setNotes] = useState(tenant?.notes || '');
  const [convertToK, setConvertToK] = useState(!editing && p?.statusCode !== 'K');

  return (
    <Modal title={editing ? `Edit lease · ${p?.address}` : `Start lease · ${p?.address}`} onClose={onClose}>
      <div className="col gap-12">
        <div className="grid g-2">
          <div><div className="up dim mb-4">Tenant name</div><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Phone</div><input className="input mono" value={phone} onChange={e => setPhone(e.target.value)} style={{width: '100%'}}/></div>
        </div>
        <div><div className="up dim mb-4">Email</div><input className="input" value={email} onChange={e => setEmail(e.target.value)} style={{width: '100%'}}/></div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">Move-in date</div><input className="input" type="date" value={moveIn} onChange={e => setMoveIn(e.target.value)} style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Lease end</div><input className="input" type="date" value={leaseEnd} onChange={e => setLeaseEnd(e.target.value)} style={{width: '100%'}}/></div>
        </div>
        <div className="grid g-3">
          <div><div className="up dim mb-4">Monthly rent</div><input className="input mono" type="number" value={rent} onChange={e => setRent(e.target.value)} style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Security deposit</div><input className="input mono" type="number" value={deposit} onChange={e => setDeposit(e.target.value)} style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Occupants</div><input className="input" type="number" value={occupants} onChange={e => setOccupants(e.target.value)} style={{width: '100%'}}/></div>
        </div>
        <div>
          <div className="up dim mb-4">Payment source</div>
          <ManagedSelect listKey="paymentSources" value={source} onChange={setSource} style={{width: '100%'}}/>
        </div>
        {source === 'Section 8' && (
          <div style={{padding: '12px 14px', background: 'var(--blue-tint)', borderRadius: 6, border: '1px solid var(--blue-soft)'}}>
            <div className="up dim mb-8">Section 8 rent split</div>
            <div className="grid g-2 mb-8">
              <div><div className="up dim mb-4">Voucher (PHA) portion</div><input className="input mono" type="number" value={phaPortion} onChange={e => setPhaPortion(e.target.value)} placeholder="0" style={{width: '100%'}}/></div>
              <div><div className="up dim mb-4">Tenant responsibility</div><input className="input mono" type="number" value={tenantPortion} onChange={e => setTenantPortion(e.target.value)} placeholder="0" style={{width: '100%'}}/></div>
            </div>
            {(() => {
              const pha = parseFloat(phaPortion) || 0, ten = parseFloat(tenantPortion) || 0, rentN = parseFloat(rent) || 0;
              if (pha + ten === 0) return <div className="tiny dim">Split the monthly rent between the housing authority and the tenant. Leave blank if fully subsidized.</div>;
              const diff = rentN - (pha + ten);
              return <div className="row between items-center tiny">
                <span className="dim">PHA {fmtMoney(pha)} + tenant {fmtMoney(ten)} = <b style={{color: 'var(--ink-2)'}}>{fmtMoney(pha + ten)}</b></span>
                {rentN > 0 && Math.abs(diff) > 1
                  ? <button onClick={() => { if (ten) setPhaPortion(String(rentN - ten)); else setTenantPortion(String(rentN - pha)); }} style={{background: 'none', border: 'none', padding: 0, color: 'var(--ochre)', cursor: 'pointer', textDecoration: 'underline', font: 'inherit'}}>{diff > 0 ? fmtMoney(diff) + ' under rent' : fmtMoney(-diff) + ' over rent'} · balance</button>
                  : rentN > 0 ? <span style={{color: 'var(--sage)'}}>matches rent ✓</span> : null}
              </div>;
            })()}
            <div className="mt-8"><div className="up dim mb-4">Voucher detail</div><input className="input" value={voucher} onChange={e => setVoucher(e.target.value)} placeholder="CharlottHA — HCV #, recert date…" style={{width: '100%'}}/></div>
          </div>
        )}
        <div><div className="up dim mb-4">Notes</div><textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} rows="2" style={{width: '100%'}}/></div>

        {!editing && p && p.statusCode !== 'K' && (
          <label className="row gap-6 items-center small" style={{cursor: 'pointer', padding: '8px 12px', background: 'var(--blue-tint)', borderRadius: 4}}>
            <input type="checkbox" checked={convertToK} onChange={e => setConvertToK(e.target.checked)}/>
            <span>Convert property to <Pip code="K"/> Rental status</span>
          </label>
        )}

        <div className="row gap-8 mt-8">
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!name || !rent}
            onClick={() => {
              const payload = {
                name, phone, email,
                moveIn, leaseEnd,
                rent: parseFloat(rent), deposit: parseFloat(deposit) || 0,
                source, voucher: voucher || null,
                phaPortion: source === 'Section 8' && phaPortion !== '' ? parseFloat(phaPortion) : null,
                tenantPortion: source === 'Section 8' && tenantPortion !== '' ? parseFloat(tenantPortion) : null,
                occupants: parseInt(occupants) || null,
                notes,
              };
              if (editing) {
                updateTenant(tenant.id, payload);
              } else {
                addTenant({ propertyId: pid, ...payload });
                if (convertToK && p.statusCode !== 'K') changeStage(pid, 'K', { note: 'Tenant placed — converted to rental' });
              }
              onClose();
            }}>{editing ? 'Save changes' : 'Start lease'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AddHOAModal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AddHOAModal({ propertyId, hoa, onClose }) {
  const editing = !!hoa;
  const [name, setName] = useState(hoa?.name || '');
  const [website, setWebsite] = useState(hoa?.website || '');
  const [username, setUsername] = useState(hoa?.username || '');
  const [password, setPassword] = useState(hoa?.password || '');

  return (
    <Modal title={editing ? `Edit HOA · ${hoa.name}` : 'Add HOA'} onClose={onClose}>
      <div className="col gap-12">
        <div><div className="up dim mb-4">HOA / management company name</div><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus style={{width: '100%'}}/></div>
        <div><div className="up dim mb-4">Portal website</div><input className="input" type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." style={{width: '100%'}}/></div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">Username</div><input className="input mono" value={username} onChange={e => setUsername(e.target.value)} style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Password</div><input className="input mono" type="password" value={password} onChange={e => setPassword(e.target.value)} style={{width: '100%'}}/></div>
        </div>
        <div className="small dim">Stored in your browser's localStorage. In production this lives in the Google Sheet alongside the rest of your data.</div>
        <div className="row gap-8 mt-8">
          {editing && <Btn kind="danger" sz="sm" onClick={() => { if (confirm(`Remove ${hoa.name}?`)) { deleteHOA(hoa.id); onClose(); } }}>Delete</Btn>}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!name}
            onClick={() => {
              if (editing) updateHOA(hoa.id, { name, website, username, password });
              else addHOA({ propertyId, name, website, username, password });
              onClose();
            }}>{editing ? 'Save' : 'Add HOA'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AddPropertyModal — initial acquisition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// AddressLookup — free-text address search (OpenStreetMap Nominatim, no key).
// Picking a suggestion auto-fills the manual fields below it.
function AddressLookup({ onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = React.useRef(null);

  function search(text) {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (!text || text.trim().length < 5) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=5&q=' + encodeURIComponent(text));
        const data = await r.json();
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch (e) { setResults([]); setOpen(false); }
      setBusy(false);
    }, 400);
  }

  function pick(item) {
    const a = item.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const iso = a['ISO3166-2-lvl4'] || '';
    onPick({
      address: street || (item.display_name || '').split(',')[0],
      city: a.city || a.town || a.village || a.hamlet || '',
      state: iso.startsWith('US-') ? iso.slice(3) : '',
      zip: a.postcode || '',
      county: (a.county || '').replace(/ County$/i, ''),
    });
    setQ(item.display_name);
    setOpen(false);
  }

  return (
    <div style={{position: 'relative'}}>
      <div className="up dim mb-4">Address lookup</div>
      <input className="input" value={q} onChange={e => search(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => { if (results.length) setOpen(true); }}
        placeholder="Start typing an address to auto-fill…" style={{width: '100%'}}/>
      {busy && <div className="tiny dim" style={{position: 'absolute', right: 10, top: 30}}>Searching…</div>}
      {open && results.length > 0 && (
        <div style={{position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, zIndex: 50,
          background: 'var(--paper, #fff)', border: '1px solid var(--rule, #d8d3c4)', borderRadius: 6,
          boxShadow: '0 8px 28px -6px rgba(28,26,20,0.25)', maxHeight: 240, overflowY: 'auto'}}>
          {results.map((r, i) => (
            <div key={i} className="small" style={{padding: '8px 12px', cursor: 'pointer', borderTop: i ? '1px solid var(--rule-soft, #eee9dc)' : 'none'}}
              onMouseDown={e => { e.preventDefault(); pick(r); }}>
              {r.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddPropertyModal({ onClose, onCreated }) {
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('NC');
  const [zip, setZip] = useState('');
  const [county, setCounty] = useState('Mecklenburg');
  const [type, setType] = useState('Wholesale');
  const [assigned, setAssigned] = useState('');
  const [loanType, setLoanType] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [rehabFunds, setRehabFunds] = useState('');
  const [ddFee, setDdFee] = useState('');
  const [earnest, setEarnest] = useState('');
  const [ddDate, setDdDate] = useState('');
  const [signingDate, setSigningDate] = useState('');
  const [vestingLLC, setVestingLLC] = useState('Atmore Properties LLC');
  const [driveUrl, setDriveUrl] = useState('');
  const [statusCode, setStatusCode] = useState('A');

  const store = useStore();

  return (
    <Modal title="Add property" onClose={onClose}>
      <div className="col gap-12">
        <div className="up dim">Address</div>
        <AddressLookup onPick={f => {
          if (f.address) setAddress(f.address);
          if (f.city) setCity(f.city);
          if (f.state) setState(f.state);
          if (f.zip) setZip(f.zip);
          if (f.county) setCounty(f.county);
        }}/>
        <div><div className="up dim mb-4">Street address</div><input className="input" value={address} onChange={e => setAddress(e.target.value)} autoFocus placeholder="123 Main St #B" style={{width: '100%'}}/></div>
        <div className="grid g-3">
          <div><div className="up dim mb-4">City</div><input className="input" value={city} onChange={e => setCity(e.target.value)} style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">State</div><input className="input" value={state} onChange={e => setState(e.target.value)} maxLength="2" style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Zip</div><input className="input mono" value={zip} onChange={e => setZip(e.target.value)} style={{width: '100%'}}/></div>
        </div>
        <div><div className="up dim mb-4">County</div><input className="input" value={county} onChange={e => setCounty(e.target.value)} style={{width: 240}}/></div>

        <div className="divider" style={{margin: '4px 0'}}/>
        <div className="up dim">Deal</div>

        <div className="grid g-3">
          <div>
            <div className="up dim mb-4">Type</div>
            <ManagedSelect listKey="propertyTypes" value={type} onChange={setType} style={{width: '100%'}}/>
          </div>
          <div>
            <div className="up dim mb-4">Assigned to</div>
            <select className="select" value={assigned} onChange={e => {
              if (e.target.value === '__add__') {
                const n = window.prompt('Add team member:');
                if (n && n.trim()) { addTeamMember(n.trim()); setAssigned(n.trim()); }
                return;
              }
              setAssigned(e.target.value);
            }} style={{width: '100%'}}>
              <option value="">— pick —</option>
              {store.team.map(o => <option key={o} value={o}>{o}</option>)}
              <option disabled>──────────</option>
              <option value="__add__">+ Add new…</option>
            </select>
          </div>
          <div><div className="up dim mb-4">Loan type</div>
            <ManagedSelect listKey="loanTypes" value={loanType} onChange={setLoanType} style={{width: '100%'}}/>
          </div>
        </div>

        <div className="grid g-2">
          <div><div className="up dim mb-4">Purchase price</div><input className="input mono" type="number" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Rehab budget</div><input className="input mono" type="number" value={rehabFunds} onChange={e => setRehabFunds(e.target.value)} style={{width: '100%'}}/></div>
        </div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">Due-diligence fee</div><input className="input mono" type="number" value={ddFee} onChange={e => setDdFee(e.target.value)} style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Earnest money deposit</div><input className="input mono" type="number" value={earnest} onChange={e => setEarnest(e.target.value)} style={{width: '100%'}}/></div>
        </div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">DD date</div><input className="input" type="date" value={ddDate} onChange={e => setDdDate(e.target.value)} style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Signing date</div><input className="input" type="date" value={signingDate} onChange={e => setSigningDate(e.target.value)} style={{width: '100%'}}/></div>
        </div>

        <div className="divider" style={{margin: '4px 0'}}/>

        <div>
          <div className="up dim mb-4">Vesting LLC</div>
          <ManagedSelect listKey="vestingLLCs" value={vestingLLC} onChange={setVestingLLC} style={{width: '100%'}}/>
        </div>
        <div><div className="up dim mb-4">Google Drive folder (optional)</div><input className="input" type="url" value={driveUrl} onChange={e => setDriveUrl(e.target.value)} placeholder="https://drive.google.com/..." style={{width: '100%'}}/></div>

        <div className="small dim" style={{padding: '8px 12px', background: 'var(--paper-3)', borderRadius: 4}}>
          New properties default to <Pip code="A"/> Coming Soon. Pick a different starting stage below if you're adding a property that's already further along.
        </div>

        <div>
          <div className="up dim mb-4">Starting stage</div>
          <select className="select" value={statusCode} onChange={e => setStatusCode(e.target.value)} style={{width: '100%'}}>
            {[...STATUS_ORDER, ...getStatuses().filter(s => s.lane === 'rental').map(s => s.code)].map(code => (
              <option key={code} value={code}>{code} — {STATUS_LABEL[code]}</option>
            ))}
          </select>
        </div>

        <div className="row gap-8 mt-8">
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!address || !city}
            onClick={() => {
              const newId = addProperty({
                address, city, state, zip, county, type, assigned, loanType,
                purchasePrice: purchasePrice ? -Math.abs(parseFloat(purchasePrice)) : null,
                rehabFunds: rehabFunds ? parseFloat(rehabFunds) : null,
                acqDDFee: ddFee ? Math.abs(parseFloat(ddFee)) : null,
                acqEarnest: earnest ? Math.abs(parseFloat(earnest)) : null,
                ddDate: ddDate || null, signingDate: signingDate || null,
                vestingLLC, driveUrl, statusCode,
              });
              onClose();
              // When opened inline (e.g. from the transaction editor) just hand the
              // new address back to the caller instead of navigating away.
              if (onCreated) onCreated(address);
              else setTimeout(() => nav('/property/' + newId), 50);
            }}>Add property</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ReconcilePicker — choose a bank tx to link to a ledger entry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ReconcilePicker({ ledger, onPick, onSkip }) {
  const matches = findMatchingTxForLedger(ledger);
  if (matches.length === 0) return null;

  return (
    <div style={{padding: '12px 14px', background: 'var(--blue-tint)', border: '1px solid var(--blue-soft)', borderRadius: 6, marginBottom: 14}}>
      <div className="row between items-baseline mb-8">
        <div className="serif" style={{fontSize: 15, fontWeight: 500, color: 'var(--blue-deep)'}}>Possible bank match{matches.length === 1 ? '' : 'es'}</div>
        <Btn sz="sm" kind="ghost" onClick={onSkip}>Skip — no match</Btn>
      </div>
      <div className="col gap-6">
        {matches.slice(0, 4).map(m => (
          <div key={m.tx.id} className="row gap-10 items-center clickable"
            style={{padding: '8px 12px', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 4}}
            onClick={() => onPick(m.tx)}>
            <div className="mono small dim" style={{width: 70}}>{fmtDate(m.tx.date)}</div>
            <div className="grow" style={{minWidth: 0}}>
              <div className="small" style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500}}>{m.tx.desc}</div>
              <div className="tiny dim">acct {m.tx.acct} · confidence {m.score}%</div>
            </div>
            <div className="mono" style={{color: 'var(--sage)', fontWeight: 500}}>{fmtMoney(m.tx.amount)}</div>
            <Btn sz="sm" kind="primary">Link →</Btn>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, {
  SplitTransactionModal, AddTenantModal, AddHOAModal, AddPropertyModal, ReconcilePicker,
  RentChangeModal, TransactionEditor,
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TransactionEditor — add or edit a single transaction
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TransactionEditor({ tx, onClose }) {
  const editing = !!tx;
  const store = useStore();
  const [date, setDate] = useState(tx?.date || TODAY());
  const [acct, setAcct] = useState(tx?.acct || store.accounts[0]?.id || '');
  const [desc, setDesc] = useState(tx?.desc || '');
  const [amount, setAmount] = useState(tx?.amount || '');
  const [direction, setDirection] = useState(tx ? (tx.amount >= 0 ? 'in' : 'out') : 'out');
  const [payee, setPayee] = useState(tx?.payee || '');
  const [category, setCategory] = useState(tx?.category || '');
  const [project, setProject] = useState(tx?.project || '');
  const [addingProp, setAddingProp] = useState(false);

  const absAmount = Math.abs(parseFloat(amount) || 0);
  const amountValid = String(amount).trim() !== '' && !isNaN(parseFloat(amount));
  const signedAmount = direction === 'out' ? -absAmount : absAmount;

  function save() {
    const payload = { date, acct, desc, amount: signedAmount, payee, category, project };
    if (editing) {
      tagTransaction(tx.id, payload);
    } else {
      Store.update(s => {
        const id = 't' + (s.transactions.reduce((a,t) => Math.max(a, parseInt(t.id.slice(1))||0), 0) + 1);
        s.transactions.push({ id, ...payload, monthSheet: '', importBatch: 'manual-' + TODAY() });
      });
    }
    onClose();
  }

  function doDelete() {
    if (!confirm('Delete this transaction?')) return;
    bulkDeleteTransactions([tx.id]);
    onClose();
  }

  return (
    <React.Fragment>
    <Modal title={editing ? 'Edit transaction' : 'Add manual transaction'} onClose={onClose}>
      <div className="col gap-12">
        <div className="grid g-3">
          <div><div className="up dim mb-4">Date</div><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{width: '100%'}} autoFocus/></div>
          <div>
            <div className="up dim mb-4">Account</div>
            <select className="select" value={acct} onChange={e => setAcct(e.target.value)} style={{width: '100%'}}>
              {store.accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <div className="up dim mb-4">Direction</div>
            <Segmented value={direction}
              options={[{value:'out', label:'– Charge'}, {value:'in', label:'+ Deposit'}]}
              onChange={setDirection}/>
          </div>
        </div>
        <div>
          <div className="up dim mb-4">Description</div>
          <input className="input" value={desc} onChange={e => setDesc(e.target.value)} style={{width: '100%'}}
            placeholder="e.g. Check 4641 — drywall labor"/>
        </div>
        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Amount</div>
            <div className="row gap-6 items-baseline">
              <span style={{color: direction === 'out' ? 'var(--brick)' : 'var(--sage)', fontFamily: 'IBM Plex Mono', fontSize: 18, fontWeight: 600}}>{direction === 'out' ? '−' : '+'}</span>
              <input className="input mono" type="number" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)} style={{flex: 1, fontSize: 16}}/>
            </div>
          </div>
          <div><div className="up dim mb-4">Payee (optional)</div><input className="input" value={payee} onChange={e => setPayee(e.target.value)} style={{width: '100%'}}/></div>
        </div>
        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Category</div>
            <ManagedSelect listKey="categories" value={category} onChange={setCategory} style={{width: '100%'}}
              filter={c => !c.kind || c.kind === (direction === 'in' ? 'income' : 'expense')}/>
          </div>
          <div>
            <div className="up dim mb-4">Property</div>
            <select className="select" value={project} style={{width: '100%'}}
              onChange={e => {
                if (e.target.value === '__add__') { setAddingProp(true); return; }
                setProject(e.target.value);
              }}>
              <option value="">— unassigned —</option>
              {project && project !== 'multiple' && !OVERHEAD_PROJECTS.includes(project) && !store.properties.some(p => p.address === project) && (
                <option value={project}>{project}</option>
              )}
              <option value="multiple">multiple · split</option>
              <optgroup label="Overhead">
                {OVERHEAD_PROJECTS.map(o => <option key={o} value={o}>{o}</option>)}
              </optgroup>
              <optgroup label="Properties">
                {store.properties.map(p => <option key={p.id} value={p.address}>{p.address}</option>)}
              </optgroup>
              <option value="__add__">+ Add new property…</option>
            </select>
          </div>
        </div>

        {editing && tx.importBatch && (
          <div className="small dim">Originally imported in batch <span className="mono">{tx.importBatch}</span></div>
        )}

        <div className="row gap-8 mt-8 items-center">
          {editing && <Btn kind="danger" onClick={doDelete}>Delete</Btn>}
          {(!desc || !amountValid) && <span className="tiny dim">{!desc && !amountValid ? 'Add a description and amount to save' : !desc ? 'Add a description to save' : 'Enter an amount to save'}</span>}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!desc || !amountValid}
            onClick={save}>{editing ? 'Save' : 'Add transaction'}</Btn>
        </div>
      </div>
    </Modal>
    {addingProp && <AddPropertyModal
      onClose={() => setAddingProp(false)}
      onCreated={(addr) => setProject(addr)}/>}
    </React.Fragment>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RentChangeModal — log a mid-lease rent change
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function RentChangeModal({ tenant, onClose }) {
  const [effectiveDate, setEffectiveDate] = useState(addMonthsISO(TODAY(), 1)?.slice(0,8) + '01');
  const [amount, setAmount] = useState(tenant.rent);
  const [note, setNote] = useState('');

  const history = (tenant.rentHistory || []).slice().sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const delta = (parseFloat(amount) || 0) - tenant.rent;
  const deltaPct = tenant.rent ? Math.round((delta / tenant.rent) * 1000) / 10 : 0;

  return (
    <Modal title={`Change rent · ${tenant.name}`} onClose={onClose}>
      <div className="col gap-14">
        <div className="row gap-16">
          <div>
            <div className="up dim">Current rent</div>
            <div className="serif" style={{fontSize: 24, fontWeight: 500}}>{fmtMoney(tenant.rent)}/mo</div>
          </div>
          <div className="divider-v"/>
          <div>
            <div className="up dim">New rent</div>
            <div className="row gap-6 items-baseline">
              <span className="serif" style={{fontSize: 22, color: 'var(--ink-3)'}}>$</span>
              <input className="input mono" type="number" step="50" value={amount}
                onChange={e => setAmount(parseFloat(e.target.value) || 0)} style={{width: 130, fontSize: 18}} autoFocus/>
            </div>
          </div>
          {delta !== 0 && (
            <>
              <div className="divider-v"/>
              <div>
                <div className="up dim">Change</div>
                <div className="serif" style={{fontSize: 22, fontWeight: 500, color: delta > 0 ? 'var(--sage)' : 'var(--brick)'}}>
                  {fmtMoney(delta, {sign: true})}
                </div>
                <div className="small" style={{color: delta > 0 ? 'var(--sage)' : 'var(--brick)'}}>{deltaPct > 0 ? '+' : ''}{deltaPct}%</div>
              </div>
            </>
          )}
        </div>

        <div>
          <div className="up dim mb-4">Effective from</div>
          <input className="input" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} style={{width: 240}}/>
          <div className="tiny dim mt-4">Unpaid ledger entries from this month forward will reflect the new rent. Past payments are untouched.</div>
        </div>

        <div>
          <div className="up dim mb-4">Note (optional)</div>
          <textarea className="input" rows="2" value={note} onChange={e => setNote(e.target.value)} style={{width: '100%'}}
            placeholder="e.g. lease renewal · annual increase · added pet rent"/>
        </div>

        {history.length > 0 && (
          <div>
            <div className="up dim mb-4">Rent history</div>
            <div className="col gap-4">
              {history.map((h, i) => (
                <div key={i} className="row gap-10 items-baseline" style={{paddingBottom: 4, borderBottom: '1px solid var(--rule-soft)'}}>
                  <span className="mono small dim" style={{width: 90}}>{fmtDate(h.effectiveDate, {full: true})}</span>
                  <span className="mono">{fmtMoney(h.amount)}/mo</span>
                  <span className="small dim grow">{h.note || ''}</span>
                  {history.length > 1 && (
                    <Btn sz="sm" kind="ghost" onClick={() => { if (confirm('Remove this rent history entry?')) deleteRentChange(tenant.id, (tenant.rentHistory || []).indexOf(h)); }}>×</Btn>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="row gap-8 mt-8">
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!amount || amount === tenant.rent}
            onClick={() => {
              addRentChange(tenant.id, { effectiveDate, amount: parseFloat(amount), note });
              onClose();
            }}>Apply change</Btn>
        </div>
      </div>
    </Modal>
  );
}
