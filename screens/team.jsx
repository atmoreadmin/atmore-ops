// screens/team.jsx — roster and time off. Small crew, no formal accrual policy:
// days taken are logged as they happen, no approval step, and approved days
// show on the main Calendar as chips.

function TeamScreen() {
  const store = useStore();
  const today = TODAY();
  const year = Number(today.slice(0, 4));
  const [adding, setAdding] = useState(null);
  const [roster, setRoster] = useState(false);

  const employees = store.employees || [];
  const monthStart = today.slice(0, 8) + '01';
  const monthDays = [];
  for (let d = monthStart, guard = 0; d.slice(0, 7) === today.slice(0, 7) && guard < 40; d = addDaysISO(d, 1), guard++) monthDays.push(d);
  const monthLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const upcoming = (store.timeOff || [])
    .filter(t => (t.endDate || t.startDate) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const recent = (store.timeOff || [])
    .filter(t => (t.endDate || t.startDate) < today)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .slice(0, 12);

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Team</div>
          <h1>Time off</h1>
        </div>
        <div className="row gap-8">
          <Btn sz="sm" onClick={() => setRoster(true)}>Manage people</Btn>
          <Btn kind="primary" sz="sm" onClick={() => setAdding({})}>+ Log time off</Btn>
        </div>
      </div>

      {!employees.length ? (
        <Card><div className="card__body">
          <Empty title="No one on the roster yet" sub="Add the people who can take time off."
            action={<Btn kind="primary" sz="sm" onClick={() => setRoster(true)}>Manage people</Btn>}/>
        </div></Card>
      ) : (
        <>
          <Card className="mb-16">
            <CardHead title={"Who's out · " + monthLabel}/>
            <div className="card__body">
              <div className="team__strip">
                <div className="team__stripHead"></div>
                {monthDays.map(d => (
                  <div key={d} className={'team__stripDay' + (d === today ? ' team__stripDay--today' : '')}>
                    {Number(d.slice(8))}
                  </div>
                ))}
                {employees.map(emp => [
                  <div key={emp.id + '-n'} className="team__stripName">{emp.name}</div>,
                  ...monthDays.map(d => {
                    const off = (store.timeOff || []).find(t => t.employeeId === emp.id && d >= t.startDate && d <= (t.endDate || t.startDate));
                    return <div key={emp.id + d} className={'team__cell' + (off ? ' team__cell--off team__cell--' + off.type : '')}
                      title={off ? emp.name + ' — ' + TIME_OFF_LABEL[off.type] : ''}></div>;
                  }),
                ])}
              </div>
              <div className="row gap-14 mt-12" style={{flexWrap: 'wrap'}}>
                {TIME_OFF_TYPES.map(t => (
                  <div key={t} className="row gap-6 items-center">
                    <span className={'team__key team__cell--' + t}></span>
                    <span className="small dim">{TIME_OFF_LABEL[t]}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid g-2 mb-16">
            {employees.map(emp => {
              const ytd = timeOffYtd(emp.id, year);
              const next = upcoming.find(t => t.employeeId === emp.id);
              return (
                <Card key={emp.id}>
                  <div className="card__body">
                    <div className="row between items-center">
                      <div className="row gap-10 items-center">
                        <Av name={emp.name}/>
                        <div>
                          <div style={{fontWeight: 600}}>{emp.name}</div>
                          <div className="small dim">{ytd === 0 ? 'No days taken in ' + year : ytd + (ytd === 1 ? ' day' : ' days') + ' taken in ' + year}</div>
                        </div>
                      </div>
                      <Btn sz="sm" kind="ghost" onClick={() => setAdding({ employeeId: emp.id })}>+ Log</Btn>
                    </div>
                    {next && (
                      <div className="small mt-10" style={{paddingTop: 8, borderTop: '1px solid var(--rule-soft)'}}>
                        <span className="dim">Next out · </span>
                        {fmtShortDay(next.startDate)}{next.endDate && next.endDate !== next.startDate ? '–' + fmtShortDay(next.endDate) : ''}
                        <Tag tone={TIME_OFF_TONE[next.type]} style={{marginLeft: 6}}>{TIME_OFF_LABEL[next.type]}</Tag>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <TimeOffTable title="Upcoming" rows={upcoming} onEdit={t => setAdding({ record: t })} empty="Nobody has time off booked."/>
          <TimeOffTable title="Already taken" rows={recent} onEdit={t => setAdding({ record: t })} empty="Nothing logged yet."/>
        </>
      )}

      {adding && <TimeOffModal record={adding.record} employeeId={adding.employeeId} onClose={() => setAdding(null)}/>}
      {roster && <RosterModal onClose={() => setRoster(false)}/>}
    </div>
  );
}

function TimeOffTable({ title, rows, onEdit, empty }) {
  return (
    <Card className="mb-16">
      <CardHead title={title} meta={rows.length ? rows.length + ' record' + (rows.length === 1 ? '' : 's') : null}/>
      <div className="card__body pad-0">
        {!rows.length ? <div className="small dim" style={{padding: '18px 14px'}}>{empty}</div> : (
          <table className="tbl">
            <thead><tr>
              <th style={{width: 150}}>Person</th>
              <th style={{width: 120}}>Type</th>
              <th style={{width: 190}}>Dates</th>
              <th className="num" style={{width: 70}}>Days</th>
              <th>Note</th>
              <th style={{width: 56}}></th>
            </tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id}>
                  <td style={{fontWeight: 500}}>{employeeName(t.employeeId)}</td>
                  <td><Tag tone={TIME_OFF_TONE[t.type]}>{TIME_OFF_LABEL[t.type]}</Tag></td>
                  <td>{fmtShortDay(t.startDate)}{t.endDate && t.endDate !== t.startDate ? ' – ' + fmtShortDay(t.endDate) : ''}</td>
                  <td className="num mono">{timeOffDays(t)}</td>
                  <td className="dim">{t.note || '—'}</td>
                  <td><button className="linkbtn" onClick={() => onEdit(t)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function TimeOffModal({ record, employeeId, onClose }) {
  const store = useStore();
  const editing = !!record;
  const employees = store.employees || [];
  const [empId, setEmpId] = useState(record?.employeeId || employeeId || (employees[0] || {}).id || '');
  const [type, setType] = useState(record?.type || 'pto');
  const [startDate, setStart] = useState(record?.startDate || TODAY());
  const [endDate, setEnd] = useState(record?.endDate || record?.startDate || TODAY());
  const [halfDay, setHalfDay] = useState(!!record?.halfDay);
  const [note, setNote] = useState(record?.note || '');

  function save() {
    if (!empId) { alert('Pick a person.'); return; }
    if (endDate < startDate) { alert('The end date is before the start date.'); return; }
    const rec = { employeeId: empId, type, startDate, endDate: halfDay ? startDate : endDate, halfDay, note };
    if (editing) updateTimeOff(record.id, rec); else addTimeOff(rec);
    onClose();
  }

  return (
    <Modal title={editing ? 'Edit time off' : 'Log time off'} onClose={onClose}
      right={<div className="row gap-8">
        {editing && <Btn kind="ghost" style={{color: 'var(--brick)'}}
          onClick={() => { if (confirm('Delete this time-off record?')) { deleteTimeOff(record.id); onClose(); } }}>Delete</Btn>}
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" onClick={save}>{editing ? 'Save' : 'Log it'}</Btn>
      </div>}>
      <div className="col gap-14">
        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">Person</div>
            <select className="input" value={empId} onChange={e => setEmpId(e.target.value)} style={{width: '100%'}}>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <div className="up dim mb-4">Type</div>
            <select className="input" value={type} onChange={e => setType(e.target.value)} style={{width: '100%'}}>
              {TIME_OFF_TYPES.map(t => <option key={t} value={t}>{TIME_OFF_LABEL[t]}</option>)}
            </select>
          </div>
        </div>

        <label className="row gap-6 items-center" style={{cursor: 'pointer'}}>
          <input type="checkbox" checked={halfDay} onChange={e => setHalfDay(e.target.checked)}/>
          <span style={{fontSize: 13}}>Half day</span>
        </label>

        <div className="grid g-2">
          <div>
            <div className="up dim mb-4">{halfDay ? 'Date' : 'First day off'}</div>
            <input type="date" className="input" value={startDate}
              onChange={e => { setStart(e.target.value); if (e.target.value > endDate) setEnd(e.target.value); }} style={{width: '100%'}}/>
          </div>
          {!halfDay && (
            <div>
              <div className="up dim mb-4">Last day off</div>
              <input type="date" className="input" value={endDate} onChange={e => setEnd(e.target.value)} style={{width: '100%'}}/>
            </div>
          )}
        </div>

        <div>
          <div className="up dim mb-4">Note <span className="dim" style={{textTransform: 'none', letterSpacing: 0}}>(optional)</span></div>
          <input className="input" value={note} onChange={e => setNote(e.target.value)} style={{width: '100%'}}/>
        </div>
      </div>
    </Modal>
  );
}

function RosterModal({ onClose }) {
  const store = useStore();
  const [name, setName] = useState('');
  const employees = store.employees || [];
  return (
    <Modal title="People" onClose={onClose} right={<Btn kind="primary" onClick={onClose}>Done</Btn>}>
      <div className="col gap-10">
        {!employees.length && <div className="small dim">Nobody on the roster yet.</div>}
        {employees.map(e => (
          <div key={e.id} className="row between items-center" style={{padding: '7px 0', borderBottom: '1px solid var(--rule-soft)'}}>
            <div className="row gap-10 items-center">
              <Av name={e.name}/>
              <input className="input" value={e.name} onChange={ev => renameEmployee(e.id, ev.target.value)} style={{width: 200}}/>
            </div>
            <button className="linkbtn" style={{color: 'var(--brick)'}}
              onClick={() => {
                const n = timeOffForEmployee(e.id).length;
                const msg = n ? `Remove ${e.name}? This also deletes their ${n} time-off record${n === 1 ? '' : 's'}.` : `Remove ${e.name}?`;
                if (confirm(msg)) removeEmployee(e.id);
              }}>Remove</button>
          </div>
        ))}
        <div className="row gap-8 mt-8">
          <input className="input" value={name} placeholder="New person's name" style={{flex: 1}}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { addEmployee(name); setName(''); } }}/>
          <Btn disabled={!name.trim()} onClick={() => { addEmployee(name); setName(''); }}>Add</Btn>
        </div>
      </div>
    </Modal>
  );
}

Object.assign(window, { TeamScreen });
