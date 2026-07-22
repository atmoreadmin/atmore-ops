// screens/offers.jsx — sale-side offer tracking for a single property.
// Offers RECEIVED on a property we're selling. The hero metric is
// net-to-seller = offer price − itemized concessions − (manual) closing costs.

function ListPriceEditor({ p }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(p.listPrice || '');
  if (!editing) {
    return (
      <div className="row gap-8 items-baseline">
        <span className="up dim">List price</span>
        <span className="serif" style={{fontSize: 20, fontWeight: 500}}>
          {p.listPrice ? fmtMoney(p.listPrice) : <span className="dim" style={{fontSize: 14}}>not set</span>}
        </span>
        <a style={{cursor: 'pointer', fontSize: 12, marginLeft: 4}} onClick={() => { setVal(p.listPrice || ''); setEditing(true); }}>
          {p.listPrice ? 'edit' : '+ set'}
        </a>
      </div>
    );
  }
  const save = () => {
    const num = val === '' ? null : Math.round(Number(val));
    updateProperty(p.id, { listPrice: isNaN(num) ? null : num });
    setEditing(false);
  };
  return (
    <div className="row gap-6 items-center">
      <span className="up dim">List price</span>
      <input className="input mono" type="number" value={val} autoFocus
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        style={{width: 130}}/>
      <Btn sz="sm" kind="primary" onClick={save}>Save</Btn>
      <Btn sz="sm" kind="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
    </div>
  );
}

// Compact breakdown of nonzero concession line items
function ConcessionBreakdown({ o }) {
  const c = o.concessions || {};
  const lines = CONCESSION_FIELDS.filter(f => Number(c[f.key]) > 0);
  if (lines.length === 0) return <span className="dim">—</span>;
  return (
    <div className="col gap-2">
      <span className="mono" style={{color: 'var(--brick)'}}>−{fmtMoney(offerTotalConcessions(o))}</span>
      <span className="tiny dim" style={{lineHeight: 1.35}}>
        {lines.map(f => f.label.replace(' credit', '').replace('-cost', ' cost') + ' ' + fmtMoney(Number(c[f.key]))).join(' · ')}
      </span>
    </div>
  );
}

function OffersPanel({ p, offers }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const active = offers.filter(isOfferActive);
  const inactive = offers.filter(o => !isOfferActive(o));
  const bestNet = bestNetForProperty(p.id);
  const list = p.listPrice || null;

  return (
    <>
      {/* Summary strip */}
      <Card>
        <CardHead title="Offer summary" right={<Btn kind="primary" sz="sm" onClick={() => setAdding(true)} style={{whiteSpace: 'nowrap'}}>+ Log offer</Btn>}/>
        <div className="card__body row gap-24 items-center wrap">
          <ListPriceEditor p={p}/>
          <div className="divider-v" style={{height: 36}}/>
          <div>
            <div className="up dim">Active offers</div>
            <div className="serif" style={{fontSize: 20, fontWeight: 500}}>{active.length}</div>
          </div>
          <div>
            <div className="up dim">Best net to seller</div>
            <div className="serif" style={{fontSize: 20, fontWeight: 500, color: bestNet != null ? 'var(--sage)' : 'var(--ink-3)'}}>
              {bestNet != null ? fmtMoney(bestNet) : '—'}
            </div>
          </div>
          {bestNet != null && list && (
            <div>
              <div className="up dim">vs list</div>
              <div className="mono" style={{fontSize: 16, fontWeight: 500, color: bestNet - list >= 0 ? 'var(--sage)' : 'var(--brick)'}}>
                {fmtMoney(bestNet - list, {sign: true})}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Active offers — ranked by net-to-seller */}
      <Card>
        <CardHead title={`Offers on the table · ${active.length}`}
          meta={active.length > 1 ? 'ranked by net to seller' : null}/>
        {active.length === 0 ? (
          <div className="card__body">
            <Empty icon="📩" title="No active offers"
              sub="Log an offer as it comes in — price, financing, and itemized seller concessions. The table ranks them by what actually lands in your pocket."
              action={<Btn kind="primary" sz="sm" onClick={() => setAdding(true)}>+ Log first offer</Btn>}/>
          </div>
        ) : (
          <div style={{overflowX: 'auto'}}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Financing</th>
                  <th className="num">Offer price</th>
                  <th>Concessions</th>
                  <th className="num">Closing costs</th>
                  <th className="num">Net to seller</th>
                  <th>Close</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((o, i) => {
                  const net = offerNetToSeller(o);
                  const delta = list ? o.offerPrice - list : null;
                  const isBest = i === 0 && active.length > 1;
                  return (
                    <tr key={o.id} onClick={() => setEditing(o.id)}
                      style={isBest ? {background: 'var(--sage-soft)'} : null}>
                      <td>
                        <div className="serif" style={{fontSize: 14, fontWeight: 500}}>{o.buyer || 'Unnamed buyer'}</div>
                        <div className="tiny dim row gap-6 items-center">
                          <span>{o.buyerAgent || '—'}</span>
                          {o.driveUrl && <a href={o.driveUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title="Open offer document">↗ doc</a>}
                        </div>
                      </td>
                      <td>
                        <Tag tone={o.financing === 'Cash' ? 'sage' : 'ghost'}>{o.financing || '—'}</Tag>
                      </td>
                      <td className="num mono">
                        {fmtMoney(o.offerPrice)}
                        {delta != null && (
                          <div className="tiny" style={{color: delta >= 0 ? 'var(--sage)' : 'var(--brick)'}}>
                            {fmtMoney(delta, {sign: true})} vs list
                          </div>
                        )}
                      </td>
                      <td className="small"><ConcessionBreakdown o={o}/></td>
                      <td className="num mono small dim">{o.closingCosts ? '−' + fmtMoney(o.closingCosts) : '—'}</td>
                      <td className="num mono" style={{fontWeight: 600, color: 'var(--ink)'}}>
                        <div className="row gap-6 items-center" style={{justifyContent: 'flex-end'}}>
                          {isBest && <Tag tone="sage">Best</Tag>}
                          <span>{fmtMoney(net)}</span>
                        </div>
                      </td>
                      <td className="mono small dim">{fmtDate(o.closeDate)}</td>
                      <td><Tag tone={OFFER_STATUS_TONE[o.status]}>{OFFER_STATUS_LABEL[o.status]}</Tag></td>
                      <td><span className="dim">⋯</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Closed-out offers */}
      {inactive.length > 0 && (
        <Card>
          <CardHead title={`Closed out · ${inactive.length}`}/>
          <table className="tbl">
            <thead>
              <tr><th>Buyer</th><th>Financing</th><th className="num">Offer price</th><th className="num">Net to seller</th><th>Status</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {inactive.map(o => (
                <tr key={o.id} onClick={() => setEditing(o.id)}>
                  <td>{o.buyer || 'Unnamed buyer'}</td>
                  <td className="small dim">{o.financing || '—'}</td>
                  <td className="num mono small">{fmtMoney(o.offerPrice)}</td>
                  <td className="num mono small dim">{fmtMoney(offerNetToSeller(o))}</td>
                  <td><Tag tone={OFFER_STATUS_TONE[o.status]}>{OFFER_STATUS_LABEL[o.status]}</Tag></td>
                  <td className="small dim" style={{maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{o.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {adding && <OfferForm propertyId={p.id} property={p} onClose={() => setAdding(false)}/>}
      {editing && <OfferForm offer={offers.find(o => o.id === editing)} propertyId={p.id} property={p} onClose={() => setEditing(null)}/>}
    </>
  );
}

function OfferForm({ offer, propertyId, property, onClose }) {
  const editing = !!offer;
  const [date, setDate] = useState(offer?.date || TODAY());
  const [buyer, setBuyer] = useState(offer?.buyer || '');
  const [buyerAgent, setBuyerAgent] = useState(offer?.buyerAgent || '');
  const [agentContact, setAgentContact] = useState(offer?.agentContact || '');
  const [offerPrice, setOfferPrice] = useState(offer?.offerPrice ?? '');
  const [earnestMoney, setEarnestMoney] = useState(offer?.earnestMoney ?? '');
  const [financing, setFinancing] = useState(offer?.financing || 'Conventional');
  const [closeDate, setCloseDate] = useState(offer?.closeDate || '');
  const [ddFee, setDdFee] = useState(offer?.dueDiligenceFee ?? '');
  const [ddDays, setDdDays] = useState(offer?.dueDiligenceDays ?? '');
  const [ddDate, setDdDate] = useState(offer?.dueDiligenceDate || '');
  const [status, setStatus] = useState(offer?.status || 'received');
  const [closingCosts, setClosingCosts] = useState(offer?.closingCosts ?? '');
  const [conc, setConc] = useState({ ...emptyConcessions(), ...(offer?.concessions || {}) });
  const [contingencies, setContingencies] = useState(offer?.contingencies || []);
  const [notes, setNotes] = useState(offer?.notes || '');
  const [driveUrl, setDriveUrl] = useState(offer?.driveUrl || '');

  const setConcField = (k, v) => setConc(c => ({ ...c, [k]: v === '' ? 0 : Number(v) }));
  const toggleCont = (c) => setContingencies(arr => arr.includes(c) ? arr.filter(x => x !== c) : [...arr, c]);

  const totalConc = CONCESSION_FIELDS.reduce((a, f) => a + (Number(conc[f.key]) || 0), 0);
  const net = (Number(offerPrice) || 0) - totalConc;
  const list = property?.listPrice || null;
  const deltaList = list ? net - list : null;
  // acquisition-side cost basis — same formula as the property Money tab
  const costBasis = property ? Math.abs(property.purchasePrice || 0) + Math.abs(property.purchaseFees || 0) - Math.abs(property.purchaseCredits || 0) + (property.rehab || 0) + Math.abs(property.interest || 0) : null;
  const projProfit = (costBasis != null && costBasis > 0 && (Number(offerPrice) || 0) > 0) ? net - costBasis : null;

  const save = () => {
    if (editing) updateOffer(offer.id, buildPatch()); else addOffer(buildPatch());
    onClose();
  };
  const buildPatch = () => ({
    date, buyer, buyerAgent, agentContact,
    offerPrice: offerPrice === '' ? null : Number(offerPrice),
    earnestMoney: earnestMoney === '' ? null : Number(earnestMoney),
    financing, closeDate, status,
    dueDiligenceFee: ddFee === '' ? null : Number(ddFee),
    dueDiligenceDays: ddDays === '' ? null : Number(ddDays),
    dueDiligenceDate: ddDate || null,
    closingCosts: closingCosts === '' ? null : Number(closingCosts),
    concessions: conc, contingencies, notes, driveUrl, propertyId,
  });

  return (
    <Modal title={editing ? 'Edit offer' : 'Log offer'} onClose={onClose}>
      <div className="col gap-12">
        {/* Buyer + date */}
        <div className="grid g-2">
          <div><div className="up dim mb-4">Buyer</div>
            <input className="input" value={buyer} onChange={e => setBuyer(e.target.value)} style={{width: '100%'}} autoFocus placeholder="Buyer name / entity"/></div>
          <div><div className="up dim mb-4">Date received</div>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{width: '100%'}}/></div>
        </div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">Buyer's agent / brokerage</div>
            <input className="input" value={buyerAgent} onChange={e => setBuyerAgent(e.target.value)} style={{width: '100%'}} placeholder="Brokerage — agent"/></div>
          <div><div className="up dim mb-4">Agent contact</div>
            <input className="input mono" value={agentContact} onChange={e => setAgentContact(e.target.value)} style={{width: '100%'}} placeholder="phone or email"/></div>
        </div>

        {/* Price / financing terms */}
        <div className="grid g-3">
          <div><div className="up dim mb-4">Offer price</div>
            <input className="input mono" type="number" value={offerPrice} onChange={e => setOfferPrice(e.target.value)} style={{width: '100%'}} placeholder="0"/></div>
          <div><div className="up dim mb-4">Earnest money</div>
            <input className="input mono" type="number" value={earnestMoney} onChange={e => setEarnestMoney(e.target.value)} style={{width: '100%'}} placeholder="0"/></div>
          <div><div className="up dim mb-4">Financing</div>
            <select className="select" value={financing} onChange={e => setFinancing(e.target.value)} style={{width: '100%'}}>
              {FINANCING_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
            </select></div>
        </div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">Proposed close date</div>
            <input className="input" type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} style={{width: '100%'}}/></div>
          <div><div className="up dim mb-4">Status</div>
            <select className="select" value={status} onChange={e => setStatus(e.target.value)} style={{width: '100%'}}>
              {OFFER_STATUS.map(s => <option key={s} value={s}>{OFFER_STATUS_LABEL[s]}</option>)}
            </select></div>
        </div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">Due-diligence fee</div>
            <input className="input mono" type="number" value={ddFee} onChange={e => setDdFee(e.target.value)} style={{width: '100%'}} placeholder="0"/></div>
          <div><div className="up dim mb-4">Due-diligence deadline</div>
            <div className="row gap-6">
              <input className="input" type="date" value={ddDate} title="DD deadline date"
                onChange={e => { setDdDate(e.target.value); const base = date || ''; if (base && e.target.value) setDdDays(String(Math.round((new Date(e.target.value + 'T12:00:00') - new Date(base + 'T12:00:00')) / 86400000))); }}
                style={{flex: 1, minWidth: 0}}/>
              <input className="input mono" type="number" min="0" placeholder="days" value={ddDays} title="Days from date received"
                onChange={e => { setDdDays(e.target.value); const n = parseInt(e.target.value, 10); const base = date || ''; if (base && !isNaN(n)) { const d = new Date(base + 'T12:00:00'); d.setDate(d.getDate() + n); setDdDate(d.toISOString().slice(0, 10)); } }}
                style={{width: 64}}/>
            </div>
            <div className="tiny dim mt-4">Pick a date or type days from date received — they fill each other in.</div></div>
        </div>

        {/* Contingencies */}
        <div>
          <div className="up dim mb-6">Contingencies</div>
          <div className="row gap-8 wrap">
            {CONTINGENCY_TYPES.map(c => {
              const on = contingencies.includes(c);
              return (
                <span key={c} onClick={() => toggleCont(c)} style={{cursor: 'pointer'}}>
                  <Tag tone={on ? 'ochre' : 'ghost'}>{on ? '✓ ' : ''}{c}</Tag>
                </span>
              );
            })}
            {contingencies.length === 0 && <span className="small dim">None selected (clean offer)</span>}
          </div>
        </div>

        {/* Itemized seller concessions */}
        <div style={{background: 'var(--paper-3)', borderRadius: 'var(--radius)', padding: '12px 14px'}}>
          <div className="row between items-baseline mb-8">
            <div className="up dim">Seller concessions</div>
            <div className="small">Total <span className="mono" style={{color: 'var(--brick)', fontWeight: 600}}>{fmtMoney(totalConc)}</span></div>
          </div>
          <div className="grid g-3 gap-8">
            {CONCESSION_FIELDS.map(f => (
              <div key={f.key}>
                <div className="tiny dim mb-4">{f.label}</div>
                <input className="input mono" type="number" value={conc[f.key] || ''} onChange={e => setConcField(f.key, e.target.value)}
                  style={{width: '100%'}} placeholder="0"/>
              </div>
            ))}
          </div>
        </div>

        {/* Live net to seller */}
        <div>
          <div style={{background: 'var(--blue-tint)', border: '1px solid var(--blue-soft)', borderRadius: 'var(--radius)', padding: '10px 14px'}}>
            <div className="up" style={{color: 'var(--blue-deep)'}}>Net to seller</div>
            <div className="row gap-8 items-baseline">
              <span className="serif" style={{fontSize: 24, fontWeight: 600, color: 'var(--blue-deep)'}}>{fmtMoney(net)}</span>
              {deltaList != null && (
                <span className="mono small" style={{color: deltaList >= 0 ? 'var(--sage)' : 'var(--brick)'}}>{fmtMoney(deltaList, {sign: true})} vs list</span>
              )}
            </div>
            {projProfit != null && (
              <div className="tiny" style={{marginTop: 4, color: projProfit >= 0 ? 'var(--sage)' : 'var(--brick)'}}>
                Projected profit {fmtMoney(projProfit, {sign: true})}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="up dim mb-4">Notes</div>
          <textarea className="input" rows="2" value={notes} onChange={e => setNotes(e.target.value)} style={{width: '100%'}}
            placeholder="Counter terms, timeline, what's next…"/>
        </div>

        <div>
          <div className="up dim mb-4">Offer document link <span className="dim" style={{textTransform: 'none', letterSpacing: 0}}>(Drive / DocuSign URL — optional)</span></div>
          <input className="input" value={driveUrl} onChange={e => setDriveUrl(e.target.value)} style={{width: '100%'}} placeholder="https://…"/>
        </div>

        {/* Actions */}
        <div className="row gap-8 mt-8 items-center">
          {editing && <Btn kind="danger" sz="sm" onClick={() => { if (confirm('Delete this offer?')) { deleteOffer(offer.id); onClose(); } }}>Delete</Btn>}
          <div className="grow"/>
          {editing && status !== 'accepted' && (
            <Btn kind="ghost" sz="sm" onClick={() => {
              if (!confirm(`Accept ${buyer || 'this'} offer?\n\nIt'll be marked accepted. Any other offers stay as backups — decline them manually if you want.`)) return;
              const adv = (property?.statusCode !== 'G') &&
                confirm('Offer accepted. Also move this property to "Under Contract"?');
              // Single mutation: persists edits + marks accepted + rejects siblings
              acceptOffer(offer.id, { patch: buildPatch(), advanceToUnderContract: adv });
              onClose();
            }}>✓ Accept offer</Btn>
          )}
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!buyer || offerPrice === ''} onClick={save}>{editing ? 'Save' : 'Log offer'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

Object.assign(window, { OffersPanel, OfferForm, ListPriceEditor });
