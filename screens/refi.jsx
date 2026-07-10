// screens/refi.jsx — Refi pipeline (sidecar on K-Rentals)

const REFI_STAGE_TONE = {
  applied: 'tan',
  appraisalScheduled: 'ochre',
  appraisalDone: 'ochre',
  closing: 'blue',
  done: 'sage',
};

function RefiScreen() {
  const store = useStore();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const today = TODAY();

  const refis = store.refis || [];
  const active = refis.filter(r => r.status !== 'done');
  const done = refis.filter(r => r.status === 'done');

  // Counts per stage
  const stageCount = (s) => active.filter(r => r.status === s).length;

  // K-Rentals without a refi
  const kProps = store.properties.filter(p => p.statusCode === 'K');
  const refiedIds = new Set(refis.map(r => r.propertyId));
  const kNoRefi = kProps.filter(p => !refiedIds.has(p.id));

  // Stats
  const totalCashOut = refis.filter(r => r.status === 'done').reduce((a,r) => a + (r.cashOut || 0), 0);
  const pendingCashOut = active.reduce((a,r) => a + (r.cashOut || 0), 0);

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Properties · Refi</div>
          <h1>Refinances · {active.length} active</h1>
        </div>
        <div className="row gap-8 items-center">
          <PropViewToggle view="refi"/>
          <Btn onClick={() => setAdding(true)}>+ Start refi</Btn>
        </div>
      </div>

      <Card className="mb-16">
        <div className="row" style={{padding: '4px 0'}}>
          <div className="stat grow">
            <div className="stat__label">Active refis</div>
            <div className="stat__value">{active.length}</div>
            <div className="stat__sub">{kProps.length} K-Rentals, {kNoRefi.length} eligible</div>
          </div>
          <div className="stat stat--blue grow">
            <div className="stat__label">Cash-out pending</div>
            <div className="stat__value">{fmtMoney(pendingCashOut)}</div>
            <div className="stat__sub">across {active.filter(r => r.cashOut).length} refis</div>
          </div>
          <div className="stat stat--sage grow">
            <div className="stat__label">Cash-out received YTD</div>
            <div className="stat__value">{fmtMoney(totalCashOut)}</div>
            <div className="stat__sub">{done.length} completed</div>
          </div>
        </div>
      </Card>

      {/* Mini stage board */}
      <Card className="mb-16">
        <div className="card__body" style={{padding: 12}}>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8}}>
            {REFI_STAGES.map(s => (
              <div key={s} style={{padding: '10px 12px', background: 'var(--paper-3)', borderRadius: 4, textAlign: 'center', border: '1px solid var(--rule)'}}>
                <div className="up dim">{REFI_STAGE_LABEL[s]}</div>
                <div className="serif mt-4" style={{fontSize: 20, fontWeight: 500}}>{stageCount(s)}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="col gap-12 mb-16">
        {active.length === 0 ? (
          <Card><div className="card__body"><Empty icon="↻" title="No active refis" sub="Start a refi from a K-Rental property or click + Start refi above."/></div></Card>
        ) : active.map(r => <RefiCard key={r.id} refi={r} onClick={() => setEditing(r.id)} today={today}/>)}
      </div>

      {done.length > 0 && (
        <Card>
          <CardHead title={`Completed refis · ${done.length}`}/>
          <table className="tbl">
            <thead>
              <tr><th>Property</th><th>Lender</th><th>Closed</th><th className="num">New loan</th><th className="num">Cash-out</th></tr>
            </thead>
            <tbody>
              {done.map(r => {
                const p = getProperty(r.propertyId);
                return (
                  <tr key={r.id} onClick={() => setEditing(r.id)}>
                    <td><span className="addr" style={{fontSize: 13}}>{p?.address || '—'}</span></td>
                    <td className="small">{r.lender}</td>
                    <td className="mono small dim">{fmtDate(r.actualClose, {full: true})}</td>
                    <td className="num mono">{r.newLoanAmount ? fmtMoney(r.newLoanAmount) : '—'}</td>
                    <td className="num mono" style={{color: 'var(--sage)'}}>{r.cashOut ? fmtMoney(r.cashOut) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {editing && <RefiEditor refi={refis.find(r => r.id === editing)} onClose={() => setEditing(null)}/>}
      {adding && <RefiEditor adding kProps={kNoRefi} onClose={() => setAdding(false)}/>}
    </div>
  );
}

function RefiCard({ refi, onClick, today }) {
  const p = getProperty(refi.propertyId);
  const stageIdx = REFI_STAGES.indexOf(refi.status);
  const stageDays = daysBetween(refi.applicationDate, today);
  const stale = stageDays > 30;
  const tone = REFI_STAGE_TONE[refi.status];

  return (
    <Card className="hoverlift" style={{cursor: 'pointer'}}>
      <div className="card__head" style={{paddingBottom: 10}}>
        <div className="row gap-10 items-center">
          <span className="serif" style={{fontSize: 17, fontWeight: 500}}>{p?.address || '—'}</span>
          <Tag tone={tone}>{REFI_STAGE_LABEL[refi.status]}</Tag>
          {stale && <Tag tone="brick">⚠ {stageDays}d</Tag>}
        </div>
        <Btn sz="sm" kind="ghost" onClick={onClick}>Edit →</Btn>
      </div>
      <div className="card__body">
        {/* Stepper */}
        <div className="row" style={{marginBottom: 14, alignItems: 'center'}}>
          {REFI_STAGES.map((s, i) => {
            const past = i < stageIdx;
            const cur = i === stageIdx;
            return (
              <React.Fragment key={s}>
                <div className="col items-center" style={{flex: '0 0 auto'}}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: past ? 'var(--sage)' : cur ? 'var(--blue)' : 'var(--paper-3)',
                    color: past || cur ? 'white' : 'var(--ink-3)',
                    border: '2px solid ' + (past ? 'var(--sage)' : cur ? 'var(--blue)' : 'var(--rule)'),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fontWeight: 600,
                  }}>{past ? '✓' : i+1}</div>
                  <div className="tiny mid mt-4" style={{textAlign: 'center', maxWidth: 90, lineHeight: 1.1}}>{REFI_STAGE_LABEL[s]}</div>
                </div>
                {i < REFI_STAGES.length - 1 && <div style={{flex: 1, height: 2, background: past ? 'var(--sage)' : 'var(--rule)', margin: '0 4px 24px 4px'}}/>}
              </React.Fragment>
            );
          })}
        </div>

        <div className="grid g-4">
          <div>
            <div className="up dim">Lender</div>
            <div className="small mt-4">{refi.lender || '—'}</div>
          </div>
          <div>
            <div className="up dim">Appraisal</div>
            <div className="small mt-4 mono">{refi.appraisalDate ? fmtDate(refi.appraisalDate) : '—'}{refi.appraisedValue ? ` · ${fmtMoney(refi.appraisedValue)}` : ''}</div>
          </div>
          <div>
            <div className="up dim">New loan @ rate</div>
            <div className="small mt-4 mono">{refi.newLoanAmount ? fmtMoney(refi.newLoanAmount) : '—'}{refi.interestRate ? ` @ ${refi.interestRate}%` : ''}</div>
          </div>
          <div>
            <div className="up dim">Target close</div>
            <div className="small mt-4 mono">{refi.targetClose ? fmtDate(refi.targetClose) : '—'}</div>
          </div>
        </div>

        {refi.cashOut > 0 && (
          <div style={{marginTop: 14, padding: '10px 14px', background: 'var(--sage-soft)', borderRadius: 4}}>
            <span className="up" style={{color: 'var(--sage)'}}>Cash-out projected</span>
            <span className="serif" style={{fontSize: 22, color: 'var(--sage)', fontWeight: 500, marginLeft: 12}}>+{fmtMoney(refi.cashOut)}</span>
          </div>
        )}

        {refi.notes && <div className="small dim mt-12" style={{fontStyle: 'italic'}}>"{refi.notes}"</div>}
      </div>
    </Card>
  );
}

function RefiEditor({ refi, adding, kProps, onClose }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [propertyId, setPropertyId] = useState(refi?.propertyId || (kProps && kProps[0]?.id) || '');
  const [status, setStatus] = useState(refi?.status || 'applied');
  const [lender, setLender] = useState(refi?.lender || '');
  const [applicationDate, setApplicationDate] = useState(refi?.applicationDate || TODAY());
  const [appraisalDate, setAppraisalDate] = useState(refi?.appraisalDate || '');
  const [appraisedValue, setAppraisedValue] = useState(refi?.appraisedValue || '');
  const [newLoanAmount, setNewLoanAmount] = useState(refi?.newLoanAmount || '');
  const [interestRate, setInterestRate] = useState(refi?.interestRate || '');
  const [cashOut, setCashOut] = useState(refi?.cashOut || '');
  const [targetClose, setTargetClose] = useState(refi?.targetClose || '');
  const [actualClose, setActualClose] = useState(refi?.actualClose || '');
  const [notes, setNotes] = useState(refi?.notes || '');

  return (
    <Modal title={adding ? 'Start refi' : 'Edit refi'} onClose={onClose}>
      <div className="col gap-12">
        <div>
          <div className="up dim mb-4">Property</div>
          {adding ? (
            <select className="select" value={propertyId} onChange={e => setPropertyId(e.target.value)} style={{width: '100%'}}>
              {(kProps || []).map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
            </select>
          ) : (
            <div className="serif" style={{fontSize: 18, fontWeight: 500}}>{getProperty(propertyId)?.address}</div>
          )}
        </div>
        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Status</div>
            <select className="select" value={status} onChange={e => setStatus(e.target.value)} style={{width: '100%'}}>
              {REFI_STAGES.map(s => <option key={s} value={s}>{REFI_STAGE_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <div className="up dim mb-4">Lender</div>
            <input className="input" value={lender} onChange={e => setLender(e.target.value)} style={{width: '100%'}}/>
          </div>
        </div>
        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Application date</div>
            <input className="input" type="date" value={applicationDate} onChange={e => setApplicationDate(e.target.value)} style={{width: '100%'}}/>
          </div>
          <div>
            <div className="up dim mb-4">Target close</div>
            <input className="input" type="date" value={targetClose} onChange={e => setTargetClose(e.target.value)} style={{width: '100%'}}/>
          </div>
        </div>
        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Appraisal date</div>
            <input className="input" type="date" value={appraisalDate} onChange={e => setAppraisalDate(e.target.value)} style={{width: '100%'}}/>
          </div>
          <div>
            <div className="up dim mb-4">Appraised value</div>
            <input className="input" type="number" value={appraisedValue} onChange={e => setAppraisedValue(e.target.value ? parseFloat(e.target.value) : '')} style={{width: '100%'}}/>
          </div>
        </div>
        <div className="grid g-3">
          <div>
            <div className="up dim mb-4">New loan amount</div>
            <input className="input" type="number" value={newLoanAmount} onChange={e => setNewLoanAmount(e.target.value ? parseFloat(e.target.value) : '')} style={{width: '100%'}}/>
          </div>
          <div>
            <div className="up dim mb-4">Interest rate %</div>
            <input className="input" type="number" step="0.01" value={interestRate} onChange={e => setInterestRate(e.target.value ? parseFloat(e.target.value) : '')} style={{width: '100%'}}/>
          </div>
          <div>
            <div className="up dim mb-4">Cash-out</div>
            <input className="input" type="number" value={cashOut} onChange={e => setCashOut(e.target.value ? parseFloat(e.target.value) : '')} style={{width: '100%'}}/>
          </div>
        </div>
        {status === 'done' && (
          <div>
            <div className="up dim mb-4">Actual close date</div>
            <input className="input" type="date" value={actualClose} onChange={e => setActualClose(e.target.value)} style={{width: '100%'}}/>
          </div>
        )}
        <div>
          <div className="up dim mb-4">Notes</div>
          <textarea className="input" rows="2" value={notes} onChange={e => setNotes(e.target.value)} style={{width: '100%'}}/>
        </div>

        <div className="row gap-8 mt-8 items-center">
          {!adding && !confirmDelete && (
            <Btn kind="ghost" onClick={() => setConfirmDelete(true)} style={{color: 'var(--brick)'}}>Delete refi</Btn>
          )}
          {!adding && confirmDelete && (
            <div className="row gap-8 items-center">
              <span className="small" style={{color: 'var(--brick)'}}>Delete this refi?</span>
              <Btn kind="ghost" onClick={() => setConfirmDelete(false)}>Keep</Btn>
              <Btn onClick={() => { deleteRefi(refi.id); onClose(); }} style={{background: 'var(--brick)', borderColor: 'var(--brick)', color: '#fff'}}>Yes, delete</Btn>
            </div>
          )}
          <div className="grow"></div>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" onClick={() => {
            const patch = { propertyId, status, lender, applicationDate, appraisalDate: appraisalDate || null,
              appraisedValue: appraisedValue || null, newLoanAmount: newLoanAmount || null,
              interestRate: interestRate || null, cashOut: cashOut || null,
              targetClose: targetClose || null, actualClose: actualClose || null, notes };
            if (adding) addRefi(patch);
            else updateRefi(refi.id, patch);
            onClose();
          }}>{adding ? 'Start refi' : 'Save'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

window.RefiScreen = RefiScreen;
window.RefiEditor = RefiEditor;
window.RefiCard = RefiCard;
window.REFI_STAGE_TONE = REFI_STAGE_TONE;
