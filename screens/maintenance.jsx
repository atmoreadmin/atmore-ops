// screens/maintenance.jsx — per-property maintenance log + scheduled reminders
// (one-off or recurring, e.g. quarterly inspections). Rendered on the property
// detail page's "Maintenance" tab and surfaced on the dashboard.

// Relative due / overdue label for a reminder date.
function reminderDue(dueDate) {
  const d = (typeof daysBetween === 'function') ? daysBetween(TODAY(), dueDate) : null;
  if (d == null) return { text: '—', tone: 'ghost', fg: 'var(--ink-3)' };
  if (d < 0) return { text: `${-d}d overdue`, tone: 'brick', fg: 'var(--brick)' };
  if (d === 0) return { text: 'due today', tone: 'ochre', fg: 'var(--ochre)' };
  if (d <= 7) return { text: `in ${d}d`, tone: 'ochre', fg: 'var(--ochre)' };
  if (d <= 30) return { text: `in ${d}d`, tone: 'blue', fg: 'var(--blue)' };
  return { text: `in ${d}d`, tone: 'ghost', fg: 'var(--ink-3)' };
}

// ────── Reminders & inspections ──────
function RemindersPanel({ p }) {
  useStore();
  const reminders = getRemindersForProperty(p.id);
  const active = reminders.filter(r => !r.done);
  const done = reminders.filter(r => r.done);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  function quickQuarterly() {
    addReminder({
      propertyId: p.id,
      title: 'Quarterly inspection',
      dueDate: addMonthsISO(TODAY(), 3),
      recurrence: 'quarterly',
      notes: 'Walk the unit, photograph condition, check smoke/CO detectors and HVAC filter.',
    });
  }

  return (
    <>
      <Card>
        <CardHead title={`Reminders & inspections · ${active.length}`} right={
          <div className="row gap-8 items-center shrink-0">
            <Btn sz="sm" kind="ghost" onClick={quickQuarterly}>+ Quarterly inspection</Btn>
            <Btn sz="sm" onClick={() => setAdding(true)}>+ Reminder</Btn>
          </div>
        }/>
        {active.length === 0 ? (
          <div className="card__body"><Empty icon="🗓" title="No reminders set"
            sub="Schedule recurring upkeep — quarterly inspections, filter changes, gutter cleaning, smoke-detector checks."/></div>
        ) : (
          <div className="col">
            {active.map(r => {
              const due = reminderDue(r.dueDate);
              return (
                <div key={r.id} className="row gap-12 items-start"
                  style={{padding: '12px 16px', borderBottom: '1px solid var(--rule-soft)'}}>
                  <button onClick={() => completeReminder(r.id)}
                    title={r.recurrence === 'none' ? 'Mark done' : 'Log as done — rolls to next ' + RECURRENCE_LABEL[r.recurrence].toLowerCase()}
                    style={{
                      flexShrink: 0, marginTop: 1, width: 22, height: 22, borderRadius: 999, cursor: 'pointer',
                      border: '1.5px solid var(--rule)', background: 'transparent',
                      color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, lineHeight: 1, padding: 0,
                    }}>✓</button>
                  <div className="col items-center shrink-0" style={{width: 64}}>
                    <div className="mono small" style={{color: due.fg, fontWeight: 500, whiteSpace: 'nowrap'}}>{fmtDate(r.dueDate)}</div>
                  </div>
                  <div className="grow clickable" style={{minWidth: 0}} onClick={() => setEditing(r.id)}>
                    <div className="row gap-8 items-center">
                      <span style={{fontWeight: 500, fontSize: 13}}>{r.title}</span>
                      {r.recurrence !== 'none' && <Tag tone="ghost">↻ {RECURRENCE_LABEL[r.recurrence]}</Tag>}
                    </div>
                    {r.notes && <div className="small dim" style={{textWrap: 'pretty'}}>{r.notes}</div>}
                    {r.lastDone && <div className="tiny dim" style={{marginTop: 2}}>Last done {fmtDate(r.lastDone)}</div>}
                  </div>
                  <Tag tone={due.tone}>{due.text}</Tag>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {done.length > 0 && (
        <Card>
          <CardHead title={`Completed · ${done.length}`}/>
          <table className="tbl">
            <thead><tr><th>Reminder</th><th>Completed</th><th></th></tr></thead>
            <tbody>
              {done.map(r => (
                <tr key={r.id} onClick={() => setEditing(r.id)}>
                  <td style={{textDecoration: 'line-through', color: 'var(--ink-3)'}}>{r.title}</td>
                  <td className="mono small dim">{fmtDate(r.lastDone)}</td>
                  <td className="text-r"><span className="dim">⋯</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {adding && <ReminderForm propertyId={p.id} onClose={() => setAdding(false)}/>}
      {editing && <ReminderForm reminder={reminders.find(r => r.id === editing)} propertyId={p.id} onClose={() => setEditing(null)}/>}
    </>
  );
}

function ReminderForm({ reminder, propertyId, onClose }) {
  const editing = !!reminder;
  const [title, setTitle] = useState(reminder?.title || '');
  const [dueDate, setDueDate] = useState(reminder?.dueDate || addMonthsISO(TODAY(), 3));
  const [recurrence, setRecurrence] = useState(reminder?.recurrence || 'quarterly');
  const [notes, setNotes] = useState(reminder?.notes || '');

  const PRESETS = ['Quarterly inspection', 'Annual inspection', 'HVAC filter change', 'Gutter cleaning', 'Smoke / CO detector check', 'Pest control', 'Lawn / landscaping', 'Winterize'];

  return (
    <Modal title={editing ? 'Edit reminder' : 'New reminder'} onClose={onClose}>
      <div className="col gap-12">
        <div>
          <div className="up dim mb-4">What needs doing</div>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} style={{width: '100%'}} autoFocus
            placeholder="e.g. Quarterly inspection"/>
          <div className="row gap-6 wrap mt-8">
            {PRESETS.map(pre => (
              <button key={pre} onClick={() => setTitle(pre)}
                className="tag tag--ghost" style={{cursor: 'pointer', border: '1px solid var(--rule)'}}>{pre}</button>
            ))}
          </div>
        </div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">Next due</div><input className="input" type="date" value={dueDate || ''} onChange={e => setDueDate(e.target.value)} style={{width: '100%'}}/></div>
          <div>
            <div className="up dim mb-4">Repeat</div>
            <select className="select" value={recurrence} onChange={e => setRecurrence(e.target.value)} style={{width: '100%'}}>
              {RECURRENCE.map(rc => <option key={rc} value={rc}>{RECURRENCE_LABEL[rc]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="up dim mb-4">Notes (optional)</div>
          <textarea className="input" rows="3" value={notes} onChange={e => setNotes(e.target.value)} style={{width: '100%'}}
            placeholder="Checklist, who to call, access notes…"/>
        </div>
        {editing && reminder.recurrence !== 'none' && (
          <div className="small dim">Marking this done logs the date and rolls the next one forward by its repeat interval.</div>
        )}
        <div className="row gap-8 mt-8">
          {editing && <Btn kind="danger" sz="sm" onClick={() => { if (confirm('Delete this reminder?')) { deleteReminder(reminder.id); onClose(); } }}>Delete</Btn>}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!title || !dueDate} onClick={() => {
            const patch = { title, dueDate, recurrence, notes, propertyId };
            if (editing) updateReminder(reminder.id, patch); else addReminder(patch);
            onClose();
          }}>{editing ? 'Save' : 'Add reminder'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ────── Maintenance log ──────
function MaintenancePanel({ p }) {
  useStore();
  const records = getMaintenanceForProperty(p.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const totalCost = records.reduce((a, m) => a + (Math.abs(m.cost) || 0), 0);

  return (
    <>
      <Card>
        <CardHead title={`Maintenance log · ${records.length}`} right={
          <div className="row gap-10 items-center shrink-0">
            {totalCost > 0 && <span className="small dim">{fmtMoney(totalCost)} logged</span>}
            <Btn sz="sm" onClick={() => setAdding(true)}>+ Log work</Btn>
          </div>
        }/>
        {records.length === 0 ? (
          <div className="card__body"><Empty icon="🔧" title="No maintenance logged"
            sub="Record repairs, turnovers, inspections, and preventive work — with vendor and cost."/></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th className="num">Cost</th><th>Status</th></tr>
            </thead>
            <tbody>
              {records.map(m => (
                <tr key={m.id} onClick={() => setEditing(m.id)}>
                  <td className="mono small">{fmtDate(m.date)}</td>
                  <td><Tag tone="ghost">{m.category || '—'}</Tag></td>
                  <td className="small" style={{maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{m.description}</td>
                  <td className="small dim">{m.vendor || '—'}</td>
                  <td className="num mono small">{m.cost ? fmtMoney(Math.abs(m.cost)) : '—'}</td>
                  <td><Tag tone={MAINT_STATUS_TONE[m.status] || 'ghost'}>{MAINT_STATUS_LABEL[m.status] || m.status}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {adding && <MaintenanceForm propertyId={p.id} onClose={() => setAdding(false)}/>}
      {editing && <MaintenanceForm record={records.find(m => m.id === editing)} propertyId={p.id} onClose={() => setEditing(null)}/>}
    </>
  );
}

function MaintenanceForm({ record, propertyId, onClose }) {
  const editing = !!record;
  const [date, setDate] = useState(record?.date || TODAY());
  const [category, setCategory] = useState(record?.category || 'Repair');
  const [description, setDescription] = useState(record?.description || '');
  const [vendor, setVendor] = useState(record?.vendor || '');
  const [cost, setCost] = useState(record?.cost != null ? Math.abs(record.cost) : '');
  const [status, setStatus] = useState(record?.status || 'open');

  return (
    <Modal title={editing ? 'Edit maintenance' : 'Log maintenance'} onClose={onClose}>
      <div className="col gap-12">
        <div className="grid g-3">
          <div><div className="up dim mb-4">Date</div><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{width: '100%'}}/></div>
          <div>
            <div className="up dim mb-4">Category</div>
            <select className="select" value={category} onChange={e => setCategory(e.target.value)} style={{width: '100%'}}>
              {MAINT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="up dim mb-4">Status</div>
            <select className="select" value={status} onChange={e => setStatus(e.target.value)} style={{width: '100%'}}>
              {MAINT_STATUS.map(s => <option key={s} value={s}>{MAINT_STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="up dim mb-4">Description</div>
          <input className="input" value={description} onChange={e => setDescription(e.target.value)} style={{width: '100%'}} autoFocus
            placeholder="e.g. Replaced water heater, 40gal"/>
        </div>
        <div className="grid g-2">
          <div><div className="up dim mb-4">Vendor / contractor (optional)</div><input className="input" value={vendor} onChange={e => setVendor(e.target.value)} style={{width: '100%'}}/></div>
          <div>
            <div className="up dim mb-4">Cost (optional)</div>
            <div className="row gap-6 items-baseline">
              <span style={{color: 'var(--ink-3)', fontFamily: 'IBM Plex Mono', fontSize: 16}}>$</span>
              <input className="input mono" type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} style={{flex: 1}}/>
            </div>
          </div>
        </div>
        <div className="row gap-8 mt-8">
          {editing && <Btn kind="danger" sz="sm" onClick={() => { if (confirm('Delete this entry?')) { deleteMaintenance(record.id); onClose(); } }}>Delete</Btn>}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!description} onClick={() => {
            const patch = { date, category, description, vendor, cost: cost === '' ? null : Math.abs(parseFloat(cost)) || null, status, propertyId };
            if (editing) updateMaintenance(record.id, patch); else addMaintenance(patch);
            onClose();
          }}>{editing ? 'Save' : 'Log work'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

Object.assign(window, { RemindersPanel, ReminderForm, MaintenancePanel, MaintenanceForm });
