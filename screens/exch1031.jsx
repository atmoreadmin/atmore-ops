// screens/exch1031.jsx — 1031 tracker with dual countdown clocks

function Exch1031Screen() {
  const store = useStore();
  const [editing, setEditing] = useState(() => window.__pendingRelinquish ? 'new' : null);
  const [prefillProp, setPrefillProp] = useState(() => { const v = window.__pendingRelinquish || null; window.__pendingRelinquish = null; return v; });
  const today = TODAY();

  const exchanges = store.exchanges || [];
  const active = exchanges.filter(e => e.status === 'active');
  const closed = exchanges.filter(e => e.status === 'closed');

  // Urgency stats
  const in45 = active.filter(e => {
    const d = daysBetween(today, addDays(e.relinquishedSoldDate, 45));
    return d >= 0 && d <= 45;
  });
  const in180 = active.filter(e => {
    const d = daysBetween(today, addDays(e.relinquishedSoldDate, 180));
    return d >= 0;
  });
  const totalFunds = active.reduce((a,e) => a + (e.exchangeFunds || 0), 0);
  const totalDeployed = active.reduce((a,e) => a + (e.fundsDeployed || 0), 0);

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Properties · 1031</div>
          <h1>Exchanges · {active.length} active</h1>
        </div>
        <div className="row gap-8 items-center">
          <PropViewToggle view="1031"/>
          <Btn onClick={() => setEditing('new')}>+ Start exchange</Btn>
        </div>
      </div>

      <Card className="mb-16">
        <div className="row" style={{padding: '4px 0'}}>
          <div className={'stat grow ' + (in45.length ? 'stat--brick' : '')}>
            <div className="stat__label">In 45-day window</div>
            <div className="stat__value">{in45.length}</div>
            <div className="stat__sub">identification deadline</div>
          </div>
          <div className="stat stat--blue grow">
            <div className="stat__label">In 180-day window</div>
            <div className="stat__value">{in180.length}</div>
            <div className="stat__sub">close deadline</div>
          </div>
          <div className="stat grow">
            <div className="stat__label">Exchange funds</div>
            <div className="stat__value">{fmtMoney(totalFunds)}</div>
            <div className="stat__sub">{fmtMoney(totalDeployed)} deployed</div>
          </div>
          <div className="stat stat--sage grow">
            <div className="stat__label">Closed exchanges</div>
            <div className="stat__value">{closed.length}</div>
            <div className="stat__sub">all-time</div>
          </div>
        </div>
      </Card>

      <div className="col gap-16 mb-20">
        {active.length === 0
          ? <Card><div className="card__body"><Empty title="No active exchanges"/></div></Card>
          : active.map(e => <ExchangeCard key={e.id} exchange={e} today={today} onEdit={() => setEditing(e.id)}/>)}
      </div>

      {closed.length > 0 && (
        <Card>
          <CardHead title={`Closed exchanges · ${closed.length}`}/>
          <table className="tbl">
            <thead>
              <tr><th>Relinquished</th><th>Sold</th><th className="num">Sale price</th><th className="num">Funds</th><th>QI</th></tr>
            </thead>
            <tbody>
              {closed.map(e => (
                <tr key={e.id} onClick={() => setEditing(e.id)}>
                  <td><span className="addr" style={{fontSize: 13}}>{e.relinquishedAddress}</span></td>
                  <td className="mono small dim">{fmtDate(e.relinquishedSoldDate, {full: true})}</td>
                  <td className="num mono">{fmtMoney(e.relinquishedSalePrice)}</td>
                  <td className="num mono">{fmtMoney(e.exchangeFunds)}</td>
                  <td className="small dim">{e.qi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && <ExchangeEditor exchangeId={editing === 'new' ? null : editing} initialRelinquishedPropId={editing === 'new' ? prefillProp : null} onClose={() => { setEditing(null); setPrefillProp(null); }}/>}
    </div>
  );
}

function ExchangeCard({ exchange, today, onEdit }) {
  const e = exchange;
  const d45 = addDays(e.relinquishedSoldDate, 45);
  const d180 = addDays(e.relinquishedSoldDate, 180);
  const days45 = daysBetween(today, d45);
  const days180 = daysBetween(today, d180);
  const elapsed = daysBetween(e.relinquishedSoldDate, today);
  const pct45 = Math.min(100, Math.max(0, (elapsed / 45) * 100));
  const pct180 = Math.min(100, Math.max(0, (elapsed / 180) * 100));

  const past45 = days45 < 0;
  const past180 = days180 < 0;
  const tone45 = past45 ? 'sage' : days45 <= 7 ? 'brick' : days45 <= 21 ? 'ochre' : 'blue';
  const tone180 = past180 ? 'sage' : days180 <= 14 ? 'brick' : days180 <= 60 ? 'ochre' : 'blue';

  const identifiedProps = (e.identifiedPropIds || []).map(id => getProperty(id)).filter(Boolean);
  const closedProps = (e.closedPropIds || []).map(id => getProperty(id)).filter(Boolean);
  const draws = e.draws || [];
  const deployed = draws.length ? draws.reduce((a,d) => a + (parseFloat(d.amount) || 0), 0) : (e.fundsDeployed || 0);
  const remainingFunds = (e.exchangeFunds || 0) - deployed;
  const pctDeployed = e.exchangeFunds ? Math.min(100, (deployed / e.exchangeFunds) * 100) : 0;
  const drawnForProp = (pid) => draws.filter(d => d.propId === pid).reduce((a,d) => a + (parseFloat(d.amount) || 0), 0);

  const accent = days45 <= 7 && !past45 ? 'alert' : null;

  return (
    <Card alert={accent === 'alert'}>
      <div className="card__head">
        <div className="row gap-10 items-center">
          <span className="serif" style={{fontSize: 18, fontWeight: 500}}>{e.relinquishedAddress}</span>
          <Tag tone="ghost">{e.relinquishedCity}</Tag>
          {e.ddReceived > 0 && <Tag tone="ochre" title={`${fmtMoney(e.ddReceived)} received outside the exchange — potential boot`}>⚑ {fmtMoney(e.ddReceived)} boot?</Tag>}
          {!past45 && days45 <= 7 && <Tag tone="brick">⚠ {days45} day{days45===1?'':'s'} to 45-day</Tag>}
        </div>
        <Btn sz="sm" kind="ghost" onClick={onEdit}>Edit →</Btn>
      </div>
      <div className="card__body col gap-16">

        {/* Sale facts */}
        <div className="row gap-16 wrap">
          <div>
            <div className="up dim">Relinquished sold</div>
            <div className="small mt-4 mono">{fmtDate(e.relinquishedSoldDate, {full: true})}</div>
          </div>
          <div className="divider-v"/>
          <div>
            <div className="up dim">Sale price</div>
            <div className="small mt-4 mono">{fmtMoney(e.relinquishedSalePrice)}</div>
          </div>
          {(e.relinquishedClosingCosts > 0 || e.sellerCredits > 0 || e.qiFee > 0 || e.ddReceived > 0) && (
            <>
              <div className="divider-v"/>
              <div>
                <div className="up dim">Costs + credits + QI fee</div>
                <div className="small mt-4 mono" style={{color: 'var(--brick)'}}>
                  −{fmtMoney((e.relinquishedClosingCosts || 0) + (e.sellerCredits || 0) + (e.qiFee || 0) + (e.ddReceived || 0))}
                  <span className="dim" style={{marginLeft: 6, fontFamily:'inherit', fontSize: 11}}>
                    ({[
                      e.relinquishedClosingCosts > 0 && `${fmtMoney(e.relinquishedClosingCosts)} costs`,
                      e.sellerCredits > 0 && `${fmtMoney(e.sellerCredits)} credits`,
                      e.qiFee > 0 && `${fmtMoney(e.qiFee)} QI`,
                      e.ddReceived > 0 && `${fmtMoney(e.ddReceived)} direct`,
                    ].filter(Boolean).join(' · ')})
                  </span>
                </div>
              </div>
            </>
          )}
          <div className="divider-v"/>
          <div>
            <div className="up dim">Exchange funds (QI holds)</div>
            <div className="small mt-4 mono">{fmtMoney(e.exchangeFunds)}</div>
          </div>
          <div className="divider-v"/>
          <div>
            <div className="up dim">QI</div>
            <div className="small mt-4">{e.qi}</div>
          </div>
        </div>

        {/* Dual clocks */}
        <div className="col gap-14" style={{padding: '14px 16px', background: 'var(--paper-3)', borderRadius: 6}}>
          <ClockRow
            label="45-day identification"
            deadline={d45}
            days={days45}
            pct={pct45}
            tone={tone45}
            past={past45}
            sub={past45 ? `${identifiedProps.length} replacement${identifiedProps.length===1?'':'s'} identified` : `Day ${elapsed} of 45 · ${identifiedProps.length} identified`}
          />
          <ClockRow
            label="180-day close"
            deadline={d180}
            days={days180}
            pct={pct180}
            tone={tone180}
            past={past180}
            sub={past180 ? `${closedProps.length} of ${identifiedProps.length} closed` : `Day ${elapsed} of 180 · ${closedProps.length} of ${identifiedProps.length} closed`}
          />
        </div>

        {/* Replacements */}
        <div>
          <div className="row between items-center mb-8">
            <div className="up dim">Identified replacements · {identifiedProps.length} of 3 max</div>
            <Btn sz="sm" kind="ghost" onClick={onEdit}>+ Identify another</Btn>
          </div>
          <div className="col gap-6">
            {identifiedProps.length === 0
              ? <div className="small dim" style={{padding: '12px 14px', background: 'var(--paper-3)', borderRadius: 4, fontStyle: 'italic'}}>No replacements identified yet.</div>
              : identifiedProps.map(p => {
                const isClosed = (e.closedPropIds || []).includes(p.id);
                return (
                  <div key={p.id} className="row gap-12 items-center clickable"
                    onClick={() => nav('/property/'+p.id)}
                    style={{padding: '8px 12px', border: '1px solid var(--rule)', borderRadius: 4}}>
                    <Pip code={p.statusCode}/>
                    <div className="grow">
                      <div className="addr" style={{fontSize: 14}}>{p.address}</div>
                      <div className="addr-sub">{p.city} · {p.type}</div>
                    </div>
                    {drawnForProp(p.id) > 0 && <Tag tone="blue" title="Exchange funds applied to this purchase">{fmtMoney(drawnForProp(p.id))} drawn</Tag>}
                    {p.purchasePrice && <span className="mono small dim">{fmtMoney(Math.abs(p.purchasePrice))}</span>}
                    {isClosed ? <Tag tone="sage">closed</Tag> : <Tag tone="ochre">identified</Tag>}
                  </div>
                );
              })
            }
            {identifiedProps.length < 3 && (
              <div onClick={onEdit} style={{padding: '12px 14px', border: '1px dashed var(--rule)', borderRadius: 4, color: 'var(--ink-3)', textAlign: 'center', fontSize: 12, cursor: 'pointer'}}>
                + identify a {identifiedProps.length === 0 ? 'first' : identifiedProps.length === 1 ? 'second' : 'third'} (up to 3 by 45-day rule)
              </div>
            )}
          </div>
        </div>

        {/* Funds ledger */}
        <div className="col gap-10" style={{padding: '14px 16px', background: 'var(--paper-3)', borderRadius: 6}}>
          <div className="row between items-end">
            <div>
              <div className="up dim">Remaining for next purchase</div>
              <div className="serif" style={{fontSize: 26, fontWeight: 600, color: remainingFunds > 0.5 ? 'var(--blue-deep)' : 'var(--sage)'}}>{fmtMoney(remainingFunds)}</div>
            </div>
            <div className="small dim mono" style={{textAlign: 'right', lineHeight: 1.5}}>
              {fmtMoney(deployed)} drawn<br/>of {fmtMoney(e.exchangeFunds)} held
            </div>
          </div>
          <Progress pct={pctDeployed} tone={remainingFunds > 0.5 ? 'ochre' : 'sage'}/>
          {draws.length > 0 ? (
            <div className="col gap-2 mt-4">
              {draws.map((d, i) => {
                const p = d.propId && getProperty(d.propId);
                return (
                  <div key={i} className="row between items-center" style={{fontSize: 12.5, padding: '5px 0', borderBottom: i < draws.length - 1 ? '1px solid var(--rule-soft)' : 'none'}}>
                    <div className="row gap-8 items-baseline" style={{minWidth: 0}}>
                      <span className="mono tiny dim" style={{flexShrink: 0}}>{d.date ? fmtDate(d.date) : '—'}</span>
                      <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{p ? p.address : (d.propId || 'Unassigned draw')}</span>
                      {d.note && <span className="dim" style={{flexShrink: 0}}>· {d.note}</span>}
                    </div>
                    <span className="mono" style={{color: 'var(--brick)', flexShrink: 0}}>−{fmtMoney(d.amount)}</span>
                  </div>
                );
              })}
            </div>
          ) : deployed > 0 ? (
            <div className="small dim">{fmtMoney(deployed)} drawn (untracked) · open Edit to itemize by property.</div>
          ) : (
            <div className="small dim">No draws yet — full balance available.</div>
          )}
          <div className="small dim mt-2">{e.qiContact}</div>
        </div>

        {e.notes && <div className="small dim" style={{fontStyle: 'italic'}}>"{e.notes}"</div>}
      </div>
    </Card>
  );
}

function ClockRow({ label, deadline, days, pct, tone, past, sub }) {
  const fg = tone === 'brick' ? 'var(--brick)' : tone === 'ochre' ? 'var(--ochre)' : tone === 'sage' ? 'var(--sage)' : 'var(--blue)';
  return (
    <div>
      <div className="row between items-baseline mb-6">
        <div style={{fontWeight: 500, fontSize: 13}}>{label}</div>
        <div className="row gap-10 items-baseline">
          {past
            ? <span className="serif" style={{fontSize: 18, color: fg, fontWeight: 500}}>passed</span>
            : <>
                <span className="serif" style={{fontSize: 22, color: fg, fontWeight: 500}}>{days}</span>
                <span className="small dim">days</span>
              </>
          }
          <span className="small dim mono">deadline {fmtDate(deadline, {full: true})}</span>
        </div>
      </div>
      <Progress pct={pct} tone={tone === 'brick' ? 'brick' : tone === 'ochre' ? 'ochre' : 'sage'}/>
      <div className="small dim mt-4">{sub}</div>
    </div>
  );
}

function ExchangeEditor({ exchangeId, initialRelinquishedPropId, onClose }) {
  const e = exchangeId ? getExchange(exchangeId) : null;
  const isNew = !e;
  const preProp = (isNew && initialRelinquishedPropId) ? getProperty(initialRelinquishedPropId) : null;
  const pfCity = preProp && preProp.city ? (preProp.city + (preProp.state && !String(preProp.city).includes(preProp.state) ? ', ' + preProp.state : '')) : '';
  const [relinquishedPropId, setRelinquishedPropId] = useState(e?.relinquishedPropId || initialRelinquishedPropId || '');
  const [addr, setAddr] = useState(e?.relinquishedAddress || (preProp ? preProp.address || '' : ''));
  const [city, setCity] = useState(e?.relinquishedCity || pfCity);
  const [soldDate, setSoldDate] = useState(e?.relinquishedSoldDate || (preProp ? preProp.salesDate || '' : ''));
  const [salePrice, setSalePrice] = useState(e?.relinquishedSalePrice || (preProp ? preProp.salesPrice || '' : ''));
  const [closingCosts, setClosingCosts] = useState(e?.relinquishedClosingCosts || (preProp && preProp.salesFees ? Math.abs(preProp.salesFees) : ''));
  const [sellerCredits, setSellerCredits] = useState(e?.sellerCredits || (preProp && preProp.salesCredits ? Math.abs(preProp.salesCredits) : ''));
  const [qiFee, setQiFee] = useState(e?.qiFee || '');
  const preAcceptedOffer = preProp && typeof getOffersForProperty === 'function' ? (getOffersForProperty(preProp.id) || []).find(o => o.status === 'accepted') : null;
  const preDD = preProp ? (preProp.saleDDCollected != null ? Math.abs(preProp.saleDDCollected) : (preAcceptedOffer && preAcceptedOffer.dueDiligenceFee != null ? Math.abs(preAcceptedOffer.dueDiligenceFee) : '')) : '';
  const [ddReceived, setDdReceived] = useState(e?.ddReceived || preDD);
  const [sellerCreditsReceived, setSellerCreditsReceived] = useState(e?.sellerCreditsReceived || '');
  const [funds, setFunds] = useState(e?.exchangeFunds || '');
  const [draws, setDraws] = useState(
    e?.draws && e.draws.length
      ? e.draws.map(d => ({ propId: d.propId || '', amount: d.amount ?? '', date: d.date || '', note: d.note || '' }))
      : (e?.fundsDeployed ? [{ propId: '', amount: e.fundsDeployed, date: e?.relinquishedSoldDate || '', note: 'prior draw' }] : [])
  );
  const [qi, setQi] = useState(e?.qi || '');
  const [qiContact, setQiContact] = useState(e?.qiContact || '');
  const [identified, setIdentified] = useState(e?.identifiedPropIds || []);
  const [closed, setClosed] = useState(e?.closedPropIds || []);
  const [notes, setNotes] = useState(e?.notes || '');
  const [status, setStatus] = useState(e?.status || 'active');

  // Computed reconciliation
  const sp = parseFloat(salePrice) || 0;
  const cc = parseFloat(closingCosts) || 0;
  const sc = parseFloat(sellerCredits) || 0;
  const qf = parseFloat(qiFee) || 0;
  const dd = parseFloat(ddReceived) || 0;
  const scr = parseFloat(sellerCreditsReceived) || 0;
  const computed = sp - cc - sc - qf - dd + scr;
  const stored = parseFloat(funds) || 0;
  const delta = stored - computed;
  const hasBreakdown = sp > 0 && (cc > 0 || sc > 0 || qf > 0 || dd > 0 || scr > 0);

  const store = useStore();
  const pipelineCodes = getStatuses().filter(s => s.lane === 'pipeline').map(s => s.code);
  const candidateProps = store.properties.filter(p => pipelineCodes.includes(p.statusCode));

  // Relinquished property link — sold / 1031-type records are the likely relinquished homes
  const relinquishOptions = store.properties
    .filter(pr => pr.statusCode === 'I' || String(pr.type || '').includes('1031') || pr.id === relinquishedPropId)
    .sort((a, b) => (b.salesDate || '').localeCompare(a.salesDate || ''));
  function ddForProp(pr) {
    if (!pr) return '';
    if (pr.saleDDCollected != null) return Math.abs(pr.saleDDCollected);
    const ao = typeof getOffersForProperty === 'function' ? (getOffersForProperty(pr.id) || []).find(o => o.status === 'accepted') : null;
    return ao && ao.dueDiligenceFee != null ? Math.abs(ao.dueDiligenceFee) : '';
  }
  function fillFromProp(pid, force) {
    const pr = pid && getProperty(pid);
    if (!pr) return;
    const cityVal = pr.city ? (pr.city + (pr.state && !String(pr.city).includes(pr.state) ? ', ' + pr.state : '')) : '';
    const apply = (setter, val) => { if (val === '' || val == null) return; setter(prev => (force || !prev) ? val : prev); };
    apply(setAddr, pr.address || '');
    apply(setCity, cityVal);
    apply(setSoldDate, pr.salesDate || '');
    apply(setSalePrice, pr.salesPrice || '');
    apply(setClosingCosts, pr.salesFees ? Math.abs(pr.salesFees) : '');
    apply(setSellerCredits, pr.salesCredits ? Math.abs(pr.salesCredits) : '');
    apply(setDdReceived, ddForProp(pr));
  }
  function pickRelinquished(pid) { setRelinquishedPropId(pid); fillFromProp(pid, false); }

  // Draws / disbursements
  const idProps = identified.map(id => getProperty(id)).filter(Boolean);
  const fundsNum = parseFloat(funds) || 0;
  const drawTotal = draws.reduce((a, d) => a + (parseFloat(d.amount) || 0), 0);
  const drawRemaining = fundsNum - drawTotal;
  function updateDraw(i, patch) { setDraws(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d)); }
  function addDraw() { setDraws(prev => [...prev, { propId: idProps.find(p => !prev.some(d => d.propId === p.id))?.id || '', amount: '', date: '', note: '' }]); }
  function removeDraw(i) { setDraws(prev => prev.filter((_, idx) => idx !== i)); }

  function toggleIdentified(id) {
    setIdentified(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 3 ? prev : [...prev, id]);
  }
  function toggleClosed(id) {
    setClosed(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <Modal title={isNew ? 'Start exchange' : 'Edit exchange'} onClose={onClose}>
      <div className="col gap-12">
        <div className="up dim">Relinquished property</div>
        <div>
          <div className="up dim mb-4">Link to a property record <span className="dim" style={{textTransform:'none', letterSpacing: 0}}>(the home you sold to start this exchange)</span></div>
          <div className="row gap-6 items-center">
            <select className="select" value={relinquishedPropId} onChange={ev => pickRelinquished(ev.target.value)} style={{flex: 1}}>
              <option value="">Not linked — enter manually</option>
              {relinquishOptions.map(pr => <option key={pr.id} value={pr.id}>{pr.address}{pr.salesDate ? ' · sold ' + fmtDate(pr.salesDate) : ''}</option>)}
            </select>
            {relinquishedPropId && <Btn sz="sm" kind="ghost" title="Overwrite the fields below with this property's sale data" onClick={() => fillFromProp(relinquishedPropId, true)}>Pull sale data</Btn>}
          </div>
          {relinquishedPropId
            ? <div className="small mt-4" style={{color: 'var(--sage)'}}>✓ Linked — this exchange will appear on that property's 1031 panel.</div>
            : <div className="small dim mt-4">Optional, but linking lets the property page show this exchange.</div>}
        </div>
        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Address</div>
            <input className="input" value={addr} onChange={ev => setAddr(ev.target.value)} style={{width: '100%'}}/>
          </div>
          <div>
            <div className="up dim mb-4">City / state</div>
            <input className="input" value={city} onChange={ev => setCity(ev.target.value)} style={{width: '100%'}}/>
          </div>
        </div>
        <div className="grid g-3">
          <div>
            <div className="up dim mb-4">Sold date</div>
            <input className="input" type="date" value={soldDate} onChange={ev => setSoldDate(ev.target.value)} style={{width: '100%'}}/>
            {(() => {
              const lp = relinquishedPropId && getProperty(relinquishedPropId);
              if (!lp) return null;
              if (lp.salesDate && lp.salesDate !== soldDate) return (
                <div className="tiny mt-4" style={{color: 'var(--ochre)'}}>
                  Sale recorded {fmtDate(lp.salesDate)} ·{' '}
                  <button onClick={() => setSoldDate(lp.salesDate)} style={{background: 'none', border: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline', font: 'inherit'}}>use sale date</button>
                </div>
              );
              if (lp.salesDate && lp.salesDate === soldDate) return <div className="tiny dim mt-4">From {lp.address} sale.</div>;
              return <div className="tiny dim mt-4">Linked property has no sale date yet — mark it Sold to populate this.</div>;
            })()}
          </div>
          <div>
            <div className="up dim mb-4">Sale price <span className="dim" style={{textTransform:'none', letterSpacing: 0}}>(gross from HUD)</span></div>
            <input className="input" type="number" value={salePrice} onChange={ev => setSalePrice(ev.target.value ? parseFloat(ev.target.value) : '')} style={{width: '100%'}}/>
          </div>
          <div>
            <div className="up dim mb-4">Status</div>
            <select className="select" value={status} onChange={ev => setStatus(ev.target.value)} style={{width: '100%'}}>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="grid g-3">
          <div>
            <div className="up dim mb-4">Seller closing costs <span className="dim" style={{textTransform:'none', letterSpacing: 0}}>(commission, attorney, recording, transfer tax)</span></div>
            <input className="input" type="number" value={closingCosts} onChange={ev => setClosingCosts(ev.target.value ? parseFloat(ev.target.value) : '')} style={{width: '100%'}} placeholder="0"/>
          </div>
          <div>
            <div className="up dim mb-4">Seller credits to buyer <span className="dim" style={{textTransform:'none', letterSpacing: 0}}>(repairs, closing-cost credit, warranty)</span></div>
            <input className="input" type="number" value={sellerCredits} onChange={ev => setSellerCredits(ev.target.value ? parseFloat(ev.target.value) : '')} style={{width: '100%'}} placeholder="0"/>
          </div>
          <div>
            <div className="up dim mb-4">QI fee <span className="dim" style={{textTransform:'none', letterSpacing: 0}}>(intermediary's charge)</span></div>
            <input className="input" type="number" value={qiFee} onChange={ev => setQiFee(ev.target.value ? parseFloat(ev.target.value) : '')} style={{width: '100%'}} placeholder="0"/>
          </div>
        </div>

        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Paid to you directly <span className="dim" style={{textTransform:'none', letterSpacing: 0}}>(due diligence / earnest paid outside closing — never reaches QI)</span></div>
            <input className="input" type="number" value={ddReceived} onChange={ev => setDdReceived(ev.target.value ? parseFloat(ev.target.value) : '')} style={{width: '100%'}} placeholder="0"/>
            {(() => {
              const lp = relinquishedPropId && getProperty(relinquishedPropId);
              if (!lp) return null;
              const lpDD = ddForProp(lp);
              if (lpDD === '' || lpDD == null) return null;
              if (Math.abs((parseFloat(ddReceived) || 0) - lpDD) > 1) return (
                <div className="tiny mt-4" style={{color: 'var(--ochre)'}}>
                  DD fee on sale {fmtMoney(lpDD)} ·{' '}
                  <button onClick={() => setDdReceived(lpDD)} style={{background: 'none', border: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline', font: 'inherit'}}>use it</button>
                </div>
              );
              return <div className="tiny dim mt-4">From {lp.address} sale.</div>;
            })()}
          </div>
          <div>
            <div className="up dim mb-4">Credits received by seller <span className="dim" style={{textTransform:'none', letterSpacing: 0}}>(proration reimbursements in your favor — prepaid HOA / assessments; adds to proceeds)</span></div>
            <input className="input" type="number" value={sellerCreditsReceived} onChange={ev => setSellerCreditsReceived(ev.target.value ? parseFloat(ev.target.value) : '')} style={{width: '100%'}} placeholder="0"/>
          </div>
        </div>

        <div className="grid g-3">
          <div style={{gridColumn: 'span 3'}}>
            <div className="up dim mb-4">Exchange funds <span className="dim" style={{textTransform:'none', letterSpacing: 0}}>(what QI holds — usually sale − costs − credits − QI fee)</span></div>
            <div className="row gap-6 items-center">
              <input className="input" type="number" value={funds} onChange={ev => setFunds(ev.target.value ? parseFloat(ev.target.value) : '')} style={{flex: 1}}/>
              {hasBreakdown && (
                <Btn sz="sm" kind="ghost" title="Set to computed value" onClick={() => setFunds(computed)}>= {fmtMoney(computed)}</Btn>
              )}
            </div>
          </div>
        </div>

        {hasBreakdown && (
          <div style={{padding: '12px 14px', background: 'var(--paper-3)', borderRadius: 6, border: '1px solid var(--rule)'}}>
            <div className="up dim mb-8">HUD reconciliation</div>
            <div className="col gap-4" style={{fontSize: 13}}>
              <div className="row between items-center"><span>Sale price</span><span className="mono">{fmtMoney(sp)}</span></div>
              {cc > 0 && <div className="row between items-center"><span className="dim">− Seller closing costs</span><span className="mono" style={{color:'var(--brick)'}}>−{fmtMoney(cc)}</span></div>}
              {sc > 0 && <div className="row between items-center"><span className="dim">− Seller credits to buyer</span><span className="mono" style={{color:'var(--brick)'}}>−{fmtMoney(sc)}</span></div>}
              {qf > 0 && <div className="row between items-center"><span className="dim">− QI fee</span><span className="mono" style={{color:'var(--brick)'}}>−{fmtMoney(qf)}</span></div>}
              {dd > 0 && <div className="row between items-center"><span className="dim">− Paid to you directly (DD fee)</span><span className="mono" style={{color:'var(--brick)'}}>−{fmtMoney(dd)}</span></div>}
              {scr > 0 && <div className="row between items-center"><span className="dim">+ Credits received by seller</span><span className="mono" style={{color:'var(--sage)'}}>+{fmtMoney(scr)}</span></div>}
              <div className="row between items-center" style={{paddingTop: 6, borderTop: '1px solid var(--rule)', fontWeight: 500}}>
                <span>Net to QI (computed)</span>
                <span className="mono">{fmtMoney(computed)}</span>
              </div>
              {dd > 0 && (
                <div className="row gap-6 items-baseline mt-4" style={{padding: '6px 8px', background: 'var(--ochre-soft)', color: 'var(--ochre)', borderRadius: 3, fontSize: 12}}>
                  <span style={{fontWeight: 600}}>⚑ Potential boot</span>
                  <span>{fmtMoney(dd)} received outside the exchange — may be taxable. Confirm treatment with your CPA.</span>
                </div>
              )}
              {stored > 0 && Math.abs(delta) > 1 && (
                <div className="row between items-center mt-4" style={{padding: '6px 8px', background: 'var(--ochre-soft)', color: 'var(--ochre)', borderRadius: 3, fontSize: 12}}>
                  <span>⚠ Entered exchange funds differs by {fmtMoney(Math.abs(delta), {sign: false})}</span>
                  <Btn sz="sm" kind="ghost" onClick={() => setFunds(computed)}>Use computed</Btn>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">QI</div>
            <input className="input" value={qi} onChange={ev => setQi(ev.target.value)} style={{width: '100%'}}/>
          </div>
          <div>
            <div className="up dim mb-4">QI contact</div>
            <input className="input" value={qiContact} onChange={ev => setQiContact(ev.target.value)} style={{width: '100%'}}/>
          </div>
        </div>

        {/* Draws / disbursements */}
        <div>
          <div className="row between items-center mb-4">
            <div className="up dim">Funds drawn <span className="dim" style={{textTransform:'none', letterSpacing: 0}}>(one row each time the QI wires funds to close a replacement)</span></div>
            <Btn sz="sm" kind="ghost" onClick={addDraw}>+ Add draw</Btn>
          </div>
          <div className="col gap-6">
            {draws.length === 0 && (
              <div className="small dim" style={{padding: '10px 12px', background: 'var(--paper-3)', borderRadius: 4, fontStyle: 'italic'}}>No draws yet. Add one each time you use part of the exchange to close a home.</div>
            )}
            {draws.map((d, i) => (
              <div key={i} className="row gap-6 items-center wrap" style={{padding: 6, background: 'var(--paper-3)', borderRadius: 4}}>
                <select className="select" value={d.propId || ''} onChange={ev => updateDraw(i, {propId: ev.target.value})} style={{flex: '1 1 150px', minWidth: 0}}>
                  <option value="">Unassigned</option>
                  {idProps.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
                </select>
                <input className="input" type="number" placeholder="amount" value={d.amount} onChange={ev => updateDraw(i, {amount: ev.target.value})} style={{width: 110}}/>
                <input className="input" type="date" value={d.date || ''} onChange={ev => updateDraw(i, {date: ev.target.value})} style={{width: 150}}/>
                <input className="input" placeholder="note (optional)" value={d.note || ''} onChange={ev => updateDraw(i, {note: ev.target.value})} style={{flex: '1 1 90px', minWidth: 0}}/>
                <button onClick={() => removeDraw(i)} title="Remove draw" style={{background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px'}}>×</button>
              </div>
            ))}
          </div>
          {(fundsNum > 0 || draws.length > 0) && (
            <div className="row between items-center mt-8" style={{padding: '8px 12px', background: drawRemaining < -0.5 ? 'rgba(176,84,60,0.10)' : 'var(--paper-3)', borderRadius: 4, fontSize: 13}}>
              <span className="dim">Drawn {fmtMoney(drawTotal)} of {fmtMoney(fundsNum)} held</span>
              <span style={{fontWeight: 600, color: drawRemaining < -0.5 ? 'var(--brick)' : drawRemaining > 0.5 ? 'var(--blue-deep)' : 'var(--sage)'}}>
                {drawRemaining < -0.5 ? `⚠ Over by ${fmtMoney(Math.abs(drawRemaining))}` : `${fmtMoney(drawRemaining)} remaining for next purchase`}
              </span>
            </div>
          )}
        </div>

        <div>
          <div className="up dim mb-4">Identified replacements · {identified.length} of 3 max</div>
          <div className="col gap-4" style={{maxHeight: 200, overflow: 'auto', border: '1px solid var(--rule)', borderRadius: 4, padding: 6}}>
            {candidateProps.map(p => {
              const isIded = identified.includes(p.id);
              const isClosed = closed.includes(p.id);
              return (
                <div key={p.id} className="row gap-8 items-center" style={{padding: '6px 8px', borderRadius: 3, background: isIded ? 'var(--blue-tint)' : 'transparent'}}>
                  <input type="checkbox" checked={isIded} onChange={() => toggleIdentified(p.id)} disabled={!isIded && identified.length >= 3}/>
                  <Pip code={p.statusCode}/>
                  <span className="small grow">{p.address}</span>
                  {isIded && <label className="tiny dim" style={{cursor:'pointer'}}><input type="checkbox" checked={isClosed} onChange={() => toggleClosed(p.id)}/> closed</label>}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="up dim mb-4">Notes</div>
          <textarea className="input" rows="2" value={notes} onChange={ev => setNotes(ev.target.value)} style={{width: '100%'}}/>
        </div>

        <div className="row gap-8 mt-8">
          {!isNew && (
            <Btn kind="danger" sz="sm" onClick={() => {
              if (!confirm(`Delete this exchange?\n\n${addr}\n\nThis cannot be undone. The properties identified as replacements stay; only the exchange record is removed.`)) return;
              Store.update(s => { s.exchanges = s.exchanges.filter(x => x.id !== exchangeId); });
              onClose();
            }}>Delete</Btn>
          )}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" onClick={() => {
            const cleanDraws = draws
              .map(d => ({ propId: d.propId || '', amount: parseFloat(d.amount) || 0, date: d.date || '', note: d.note || '' }))
              .filter(d => d.amount);
            const data = {
              relinquishedAddress: addr,
              relinquishedCity: city,
              relinquishedPropId: relinquishedPropId || '',
              relinquishedSoldDate: soldDate,
              relinquishedSalePrice: salePrice || 0,
              relinquishedClosingCosts: parseFloat(closingCosts) || 0,
              sellerCredits: parseFloat(sellerCredits) || 0,
              qiFee: parseFloat(qiFee) || 0,
              ddReceived: parseFloat(ddReceived) || 0,
              sellerCreditsReceived: parseFloat(sellerCreditsReceived) || 0,
              exchangeFunds: funds || 0,
              draws: cleanDraws,
              fundsDeployed: cleanDraws.reduce((a, d) => a + d.amount, 0),
              qi, qiContact, status, notes,
              identifiedPropIds: identified,
              closedPropIds: closed,
            };
            Store.update(s => {
              if (isNew) s.exchanges.push({ id: 'ex' + (s.exchanges.length+100), ...data });
              else Object.assign(s.exchanges.find(x => x.id === exchangeId), data);
            });
            onClose();
          }}>{isNew ? 'Start exchange' : 'Save'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function addDays(iso, n) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

window.Exch1031Screen = Exch1031Screen;
