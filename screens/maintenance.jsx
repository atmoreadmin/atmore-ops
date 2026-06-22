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

// ────── Tasks (deadlines, recurring upkeep & inspections) ──────
// Priority pill — only shown for high/low; "normal" is the unmarked default.
function PriorityPip({ priority }) {
  if (!priority || priority === 'normal') return null;
  const high = priority === 'high';
  return (
    <span className="up" style={{
      fontSize: 9, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 4,
      color: high ? 'var(--brick)' : 'var(--ink-3)',
      border: '1px solid ' + (high ? 'var(--brick)' : 'var(--rule)'),
      background: high ? 'var(--brick-soft)' : 'transparent',
    }}>{high ? '↑ High' : '↓ Low'}</span>
  );
}

function TaskRow({ r, onEdit }) {
  const due = reminderDue(r.dueDate);
  const list = Array.isArray(r.checklist) ? r.checklist : [];
  const doneCount = list.filter(c => c.done).length;
  return (
    <div className="row gap-12 items-start" style={{padding: '12px 16px', borderBottom: '1px solid var(--rule-soft)'}}>
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
      <div className="grow clickable" style={{minWidth: 0}} onClick={() => onEdit(r.id)}>
        <div className="row gap-8 items-center wrap">
          <span style={{fontWeight: 500, fontSize: 13}}>{r.title}</span>
          <PriorityPip priority={r.priority}/>
          {r.recurrence && r.recurrence !== 'none' && <Tag tone="ghost">↻ {RECURRENCE_LABEL[r.recurrence]}</Tag>}
          {list.length > 0 && <Tag tone={doneCount === list.length ? 'sage' : 'ghost'}>☑ {doneCount}/{list.length}</Tag>}
        </div>
        {r.notes && <div className="small dim" style={{textWrap: 'pretty'}}>{r.notes}</div>}
        {list.length > 0 && (
          <div className="col gap-2" style={{marginTop: 6}}>
            {list.map(c => (
              <label key={c.id} className="row gap-6 items-center" style={{cursor: 'pointer'}}
                onClick={e => { e.stopPropagation(); toggleTaskChecklistItem(r.id, c.id); }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0, fontSize: 10, lineHeight: '13px', textAlign: 'center',
                  border: '1.5px solid ' + (c.done ? 'var(--sage)' : 'var(--rule)'),
                  background: c.done ? 'var(--sage)' : 'transparent', color: '#fff',
                }}>{c.done ? '✓' : ''}</span>
                <span className="small" style={{color: c.done ? 'var(--ink-3)' : 'var(--ink-2)', textDecoration: c.done ? 'line-through' : 'none'}}>{c.text}</span>
              </label>
            ))}
          </div>
        )}
        {r.lastDone && <div className="tiny dim" style={{marginTop: 2}}>Last done {fmtDate(r.lastDone)}</div>}
      </div>
      <Tag tone={due.tone}>{due.text}</Tag>
    </div>
  );
}

function RemindersPanel({ p }) {
  useStore();
  const reminders = getRemindersForProperty(p.id);
  const PRIO = { high: 0, normal: 1, low: 2 };
  const active = reminders.filter(r => !r.done)
    .sort((a, b) => (PRIO[a.priority || 'normal'] - PRIO[b.priority || 'normal']) || (a.dueDate || '').localeCompare(b.dueDate || ''));
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
        <CardHead title={`Tasks · ${active.length}`} right={
          <div className="row gap-8 items-center shrink-0">
            <Btn sz="sm" kind="ghost" onClick={quickQuarterly}>+ Quarterly inspection</Btn>
            <Btn sz="sm" onClick={() => setAdding(true)}>+ Task</Btn>
          </div>
        }/>
        {active.length === 0 ? (
          <div className="card__body"><Empty icon="🗓" title="No tasks yet"
            sub="Add anything with a deadline — closing to-dos, inspections, filter changes, follow-ups. Tasks show up on the Calendar."/></div>
        ) : (
          <div className="col">
            {active.map(r => <TaskRow key={r.id} r={r} onEdit={setEditing}/>)}
          </div>
        )}
      </Card>

      {done.length > 0 && (
        <Card>
          <CardHead title={`Completed · ${done.length}`}/>
          <table className="tbl">
            <thead><tr><th>Task</th><th>Completed</th><th></th></tr></thead>
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

let _taskChkSeq = 0;
function newChkId() { return 'ck' + Date.now().toString(36) + (_taskChkSeq++); }

function ReminderForm({ reminder, propertyId, defaultDate, onClose }) {
  const editing = !!reminder;
  // When opened without a property (e.g. from the Calendar), let the user pick one.
  const needsProperty = !propertyId;
  const [propId, setPropId] = useState(reminder?.propertyId || propertyId || '');
  const [title, setTitle] = useState(reminder?.title || '');
  const [dueDate, setDueDate] = useState(reminder?.dueDate || defaultDate || TODAY());
  const [recurrence, setRecurrence] = useState(reminder?.recurrence || 'none');
  const [priority, setPriority] = useState(reminder?.priority || 'normal');
  const [notes, setNotes] = useState(reminder?.notes || '');
  const [checklist, setChecklist] = useState(() =>
    (reminder?.checklist || []).map(c => ({ ...c })));
  const [newItem, setNewItem] = useState('');

  const props = (typeof sortedProperties === 'function') ? sortedProperties() : (Store.state.properties || []);
  const PRESETS = ['Quarterly inspection', 'Annual inspection', 'HVAC filter change', 'Gutter cleaning', 'Smoke / CO detector check', 'Pest control', 'Lawn / landscaping', 'Winterize'];

  function addItem() {
    const t = newItem.trim();
    if (!t) return;
    setChecklist(cl => [...cl, { id: newChkId(), text: t, done: false }]);
    setNewItem('');
  }

  return (
    <Modal title={editing ? 'Edit task' : 'New task'} onClose={onClose}>
      <div className="col gap-12">
        {needsProperty && (
          <div>
            <div className="up dim mb-4">Property</div>
            <select className="select" value={propId} onChange={e => setPropId(e.target.value)} style={{width: '100%'}}>
              <option value="">Select a property…</option>
              {props.map(pp => <option key={pp.id} value={pp.id}>{pp.address}</option>)}
            </select>
          </div>
        )}
        <div>
          <div className="up dim mb-4">What needs doing</div>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} style={{width: '100%'}} autoFocus
            placeholder="e.g. Send signed contract to attorney"/>
          <div className="row gap-6 wrap mt-8">
            {PRESETS.map(pre => (
              <button key={pre} onClick={() => setTitle(pre)}
                className="tag tag--ghost" style={{cursor: 'pointer', border: '1px solid var(--rule)'}}>{pre}</button>
            ))}
          </div>
        </div>
        <div className="grid g-3">
          <div><div className="up dim mb-4">Due</div><input className="input" type="date" value={dueDate || ''} onChange={e => setDueDate(e.target.value)} style={{width: '100%'}}/></div>
          <div>
            <div className="up dim mb-4">Priority</div>
            <select className="select" value={priority} onChange={e => setPriority(e.target.value)} style={{width: '100%'}}>
              {TASK_PRIORITY.map(pr => <option key={pr} value={pr}>{TASK_PRIORITY_LABEL[pr]}</option>)}
            </select>
          </div>
          <div>
            <div className="up dim mb-4">Repeat</div>
            <select className="select" value={recurrence} onChange={e => setRecurrence(e.target.value)} style={{width: '100%'}}>
              {RECURRENCE.map(rc => <option key={rc} value={rc}>{RECURRENCE_LABEL[rc]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="up dim mb-4">Checklist (optional)</div>
          {checklist.length > 0 && (
            <div className="col gap-4 mb-8">
              {checklist.map(c => (
                <div key={c.id} className="row gap-8 items-center">
                  <button onClick={() => setChecklist(cl => cl.map(x => x.id === c.id ? { ...x, done: !x.done } : x))}
                    title="Toggle done"
                    style={{
                      width: 16, height: 16, borderRadius: 3, flexShrink: 0, cursor: 'pointer', fontSize: 10, lineHeight: '14px',
                      border: '1.5px solid ' + (c.done ? 'var(--sage)' : 'var(--rule)'),
                      background: c.done ? 'var(--sage)' : 'transparent', color: '#fff', padding: 0,
                    }}>{c.done ? '✓' : ''}</button>
                  <input className="input" value={c.text}
                    onChange={e => setChecklist(cl => cl.map(x => x.id === c.id ? { ...x, text: e.target.value } : x))}
                    style={{flex: 1}}/>
                  <button onClick={() => setChecklist(cl => cl.filter(x => x.id !== c.id))}
                    title="Remove" style={{background: 'none', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 15, padding: '0 4px'}}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="row gap-8 items-center">
            <input className="input" value={newItem} onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
              placeholder="Add a checklist item…" style={{flex: 1}}/>
            <Btn sz="sm" kind="ghost" onClick={addItem} disabled={!newItem.trim()}>+ Add</Btn>
          </div>
        </div>
        <div>
          <div className="up dim mb-4">Notes (optional)</div>
          <textarea className="input" rows="2" value={notes} onChange={e => setNotes(e.target.value)} style={{width: '100%'}}
            placeholder="Who to call, access notes, context…"/>
        </div>
        {editing && reminder.recurrence && reminder.recurrence !== 'none' && (
          <div className="small dim">Marking this done logs the date and rolls the next one forward by its repeat interval.</div>
        )}
        <div className="row gap-8 mt-8">
          {editing && <Btn kind="danger" sz="sm" onClick={() => { if (confirm('Delete this task?')) { deleteReminder(reminder.id); onClose(); } }}>Delete</Btn>}
          <div className="grow"/>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" disabled={!title || !dueDate || (needsProperty && !propId)} onClick={() => {
            const clean = checklist.map(c => ({ id: c.id, text: c.text.trim(), done: !!c.done })).filter(c => c.text);
            const patch = { title, dueDate, recurrence, priority, notes, checklist: clean, propertyId: propId };
            if (editing) updateReminder(reminder.id, patch); else addReminder(patch);
            onClose();
          }}>{editing ? 'Save' : 'Add task'}</Btn>
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

Object.assign(window, { RemindersPanel, TasksPanel: RemindersPanel, ReminderForm, TaskForm: ReminderForm, PriorityPip, MaintenancePanel, MaintenanceForm });
