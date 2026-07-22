// screens/calendar.jsx — unified Calendar: every dated thing in one place.
// Month grid + agenda views, type filters, and add-task. Tasks come from the
// per-property task model; everything else is derived (buildCalendarEvents).

const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CAL_DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const CAL_VIEW_KEY = 'atmore-cal-view-v1';
const CAL_MONTH_KEY = 'atmore-cal-month-v1';

function isoToParts(iso) { const [y,m,d] = iso.split('-').map(Number); return { y, m: m-1, d }; }
function ymToIso(y, m, d) { return y + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0'); }

// Relative due/overdue chip for an event's day count.
function eventDueChip(days, done) {
  if (done) return { text: 'done', tone: 'sage' };
  if (days == null) return { text: '', tone: 'ghost' };
  if (days < 0) return { text: `${-days}d overdue`, tone: 'brick' };
  if (days === 0) return { text: 'today', tone: 'ochre' };
  if (days <= 7) return { text: `in ${days}d`, tone: 'ochre' };
  if (days <= 30) return { text: `in ${days}d`, tone: 'blue' };
  return { text: `in ${days}d`, tone: 'ghost' };
}

function catColor(cat) { return (CAL_CATS[cat] || {}).color || 'var(--ink-3)'; }

function CalendarScreen() {
  useStore();
  const today = TODAY();
  const tp = isoToParts(today);

  const [view, setView] = useState(() => localStorage.getItem(CAL_VIEW_KEY) || 'month');
  const [cursor, setCursor] = useState(() => {
    const saved = localStorage.getItem(CAL_MONTH_KEY);
    if (saved && /^\d{4}-\d{2}$/.test(saved)) { const [y,m] = saved.split('-').map(Number); return { y, m: m-1 }; }
    return { y: tp.y, m: tp.m };
  });
  const [hidden, setHidden] = useState(() => new Set()); // hidden categories
  const [dayModal, setDayModal] = useState(null);   // iso date string
  const [adding, setAdding] = useState(null);        // { defaultDate } or true

  function setViewP(v) { setView(v); localStorage.setItem(CAL_VIEW_KEY, v); }
  // General (property-less) tasks have no property page to edit on — open the form here.
  function editTask(id) {
    const r = (Store.state.reminders || []).find(x => x.id === id);
    if (r) setAdding({ reminder: r });
  }
  function setCursorP(c) { setCursor(c); localStorage.setItem(CAL_MONTH_KEY, c.y + '-' + String(c.m+1).padStart(2,'0')); }
  function stepMonth(delta) {
    let { y, m } = cursor; m += delta;
    while (m < 0) { m += 12; y--; } while (m > 11) { m -= 12; y++; }
    setCursorP({ y, m });
  }
  function goToday() { setCursorP({ y: tp.y, m: tp.m }); }
  function toggleCat(cat) {
    setHidden(h => { const n = new Set(h); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });
  }
  const visible = e => !hidden.has(e.cat);

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Calendar</div>
          <h1>{view === 'month' ? `${CAL_MONTHS[cursor.m]} ${cursor.y}` : 'Upcoming'}</h1>
        </div>
        <div className="row gap-8 items-center">
          <Segmented value={view} options={[{value:'month',label:'▦ Month'},{value:'agenda',label:'☰ Agenda'}]} onChange={setViewP}/>
          <Btn onClick={() => setAdding({ defaultDate: today })}>+ Add task</Btn>
        </div>
      </div>

      <CalLegend hidden={hidden} onToggle={toggleCat}/>

      {view === 'month'
        ? <MonthGrid cursor={cursor} today={today} visible={visible}
            onStep={stepMonth} onToday={goToday} onDay={setDayModal}/>
        : <AgendaView today={today} visible={visible} onAdd={d => setAdding({ defaultDate: d })} onEditTask={editTask}/>}

      {dayModal && <DayModal date={dayModal} visible={visible}
        onClose={() => setDayModal(null)}
        onEditTask={id => { editTask(id); setDayModal(null); }}
        onAdd={() => { setAdding({ defaultDate: dayModal }); setDayModal(null); }}/>}
      {adding && <ReminderForm reminder={adding.reminder} defaultDate={adding.defaultDate} onClose={() => setAdding(null)}/>}
    </div>
  );
}

function CalLegend({ hidden, onToggle }) {
  return (
    <Card className="mb-16">
      <div className="card__body row gap-8 wrap items-center" style={{padding: '10px 14px'}}>
        <span className="up dim" style={{marginRight: 2}}>Show</span>
        {CAL_CAT_ORDER.map(cat => {
          const off = hidden.has(cat);
          return (
            <button key={cat} onClick={() => onToggle(cat)}
              className="row gap-6 items-center"
              style={{
                padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                border: '1px solid ' + (off ? 'var(--rule)' : 'var(--rule)'),
                background: off ? 'transparent' : 'var(--paper-3)',
                color: off ? 'var(--ink-4)' : 'var(--ink-2)', opacity: off ? 0.6 : 1,
              }}>
              <span style={{width: 9, height: 9, borderRadius: '50%', background: catColor(cat), flexShrink: 0, filter: off ? 'grayscale(1)' : 'none'}}/>
              {CAL_CATS[cat].label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function EventChip({ e, onClick }) {
  return (
    <button onClick={onClick}
      className="row gap-6 items-center"
      title={e.title + (e.sub ? ' — ' + e.sub : '')}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        padding: '2px 6px', borderRadius: 4, border: 'none', background: 'transparent',
        fontSize: 11.5, lineHeight: 1.3, opacity: e.done ? 0.5 : 1,
      }}>
      <span style={{width: 7, height: 7, borderRadius: '50%', background: catColor(e.cat), flexShrink: 0,
        boxShadow: !e.done && e.days < 0 ? '0 0 0 2px var(--brick-soft)' : 'none'}}/>
      <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        textDecoration: e.done ? 'line-through' : 'none',
        color: e.done ? 'var(--ink-3)' : (e.days < 0 ? 'var(--brick)' : 'var(--ink-2)'),
        fontWeight: e.cat === 'task' ? 500 : 400}}>{e.title}</span>
    </button>
  );
}

function MonthGrid({ cursor, today, visible, onStep, onToday, onDay }) {
  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const startDow = first.getUTCDay();                       // 0=Sun
  const gridStart = new Date(Date.UTC(cursor.y, cursor.m, 1 - startDow));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * 86400000);
    cells.push(ymToIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const rangeFrom = cells[0], rangeTo = cells[41];
  const all = buildCalendarEvents(rangeFrom, rangeTo).filter(visible);
  const byDay = {};
  all.forEach(e => { (byDay[e.date] = byDay[e.date] || []).push(e); });

  return (
    <Card>
      <div className="card__head">
        <div className="row gap-6 items-center">
          <Btn sz="sm" kind="ghost" onClick={() => onStep(-1)}>‹</Btn>
          <Btn sz="sm" kind="ghost" onClick={onToday}>Today</Btn>
          <Btn sz="sm" kind="ghost" onClick={() => onStep(1)}>›</Btn>
        </div>
        <span className="meta">{all.filter(e => !e.done).length} open this view</span>
      </div>
      <div className="card__body" style={{padding: 0}}>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderTop: '1px solid var(--rule-soft)'}}>
          {CAL_DOW.map(d => (
            <div key={d} className="up dim" style={{padding: '7px 8px', fontSize: 10, letterSpacing: '0.08em',
              borderRight: '1px solid var(--rule-soft)', borderBottom: '1px solid var(--rule)'}}>{d}</div>
          ))}
          {cells.map((iso, i) => {
            const parts = isoToParts(iso);
            const inMonth = parts.m === cursor.m;
            const isToday = iso === today;
            const evs = byDay[iso] || [];
            const shown = evs.slice(0, 3);
            const extra = evs.length - shown.length;
            return (
              <div key={iso} onClick={() => onDay(iso)}
                className="clickable"
                style={{
                  minHeight: 108, padding: '5px 6px', cursor: 'pointer',
                  borderRight: '1px solid var(--rule-soft)', borderBottom: '1px solid var(--rule-soft)',
                  background: !inMonth ? 'var(--paper-3)' : isToday ? 'var(--blue-tint)' : 'var(--paper-2)',
                }}>
                <div className="row between items-center" style={{marginBottom: 3}}>
                  <span style={{
                    fontSize: 12, fontWeight: isToday ? 700 : 500,
                    fontVariantNumeric: 'tabular-nums',
                    color: !inMonth ? 'var(--ink-4)' : isToday ? 'var(--blue-deep)' : 'var(--ink-2)',
                    width: isToday ? 20 : 'auto', height: isToday ? 20 : 'auto',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: isToday ? '50%' : 0, background: isToday ? 'var(--blue)' : 'transparent',
                    ...(isToday ? { color: '#fff' } : {}),
                  }}>{parts.d}</span>
                </div>
                <div className="col gap-2">
                  {shown.map(e => <EventChip key={e.key} e={e} onClick={ev => { ev.stopPropagation(); onDay(iso); }}/>)}
                  {extra > 0 && <span className="tiny dim" style={{paddingLeft: 6}}>+{extra} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function EventLine({ e, showDate, onEditTask }) {
  const chip = eventDueChip(e.days, e.done);
  const d = isoToParts(e.date);
  return (
    <div className="row gap-12 items-start" style={{padding: '11px 16px', borderBottom: '1px solid var(--rule-soft)', opacity: e.done ? 0.55 : 1}}>
      <button onClick={() => completeCalendarEvent(e)}
        title={e.done ? 'Mark not done' : (e.taskId ? 'Mark done' : 'Mark done')}
        style={{
          flexShrink: 0, marginTop: 1, width: 22, height: 22, borderRadius: 999, cursor: 'pointer',
          border: '1.5px solid ' + (e.done ? 'var(--sage)' : 'var(--rule)'),
          background: e.done ? 'var(--sage)' : 'transparent', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, lineHeight: 1, padding: 0,
        }}>{e.done ? '✓' : ''}</button>
      {showDate && (
        <div className="col items-center shrink-0" style={{width: 40}}>
          <div className="up" style={{fontSize: 9, color: 'var(--ink-3)'}}>{CAL_DOW[new Date(e.date+'T12:00:00').getDay()]}</div>
          <div className="serif" style={{fontSize: 20, lineHeight: 1.1, fontWeight: 500, fontVariantNumeric: 'tabular-nums'}}>{d.d}</div>
        </div>
      )}
      <span style={{width: 9, height: 9, borderRadius: '50%', background: catColor(e.cat), flexShrink: 0, marginTop: 5}}/>
      <div className="grow clickable" style={{minWidth: 0}} onClick={() => e.propertyId ? nav('/property/' + e.propertyId + (e.taskId ? '/tasks' : '')) : (e.taskId && onEditTask && onEditTask(e.taskId))}>
        <div className="row gap-8 items-center wrap">
          <span style={{fontWeight: 500, fontSize: 13, textDecoration: e.done ? 'line-through' : 'none'}}>{e.title}</span>
          {e.cat === 'task' && e.priority === 'high' && <span className="up" style={{fontSize: 9, color: 'var(--brick)', border: '1px solid var(--brick)', background: 'var(--brick-soft)', borderRadius: 4, padding: '1px 5px'}}>↑ High</span>}
          {e.recurrence && e.recurrence !== 'none' && <Tag tone="ghost">↻ {RECURRENCE_LABEL[e.recurrence]}</Tag>}
          <Tag tone="ghost" style={{color: catColor(e.cat)}}>{CAL_CATS[e.cat].label}</Tag>
        </div>
        {e.sub && <div className="addr-sub">{e.sub}</div>}
      </div>
      <Tag tone={chip.tone}>{chip.text}</Tag>
    </div>
  );
}

function AgendaView({ today, visible, onAdd, onEditTask }) {
  const from = addDaysISO(today, -30);
  const to = addDaysISO(today, 180);
  const events = buildCalendarEvents(from, to).filter(visible);
  const open = events.filter(e => !e.done);
  // Group by date
  const groups = [];
  const idx = {};
  open.forEach(e => {
    if (idx[e.date] == null) { idx[e.date] = groups.length; groups.push({ date: e.date, items: [] }); }
    groups[idx[e.date]].items.push(e);
  });

  if (open.length === 0) {
    return <Card><div className="card__body"><Empty icon="🗓" title="Nothing upcoming"
      sub="No tasks or deadlines in the next 6 months for the selected types."
      action={<Btn kind="ghost" sz="sm" onClick={() => onAdd(today)}>+ Add a task</Btn>}/></div></Card>;
  }

  return (
    <div className="col gap-16">
      {groups.map(g => {
        const days = daysBetween(today, g.date);
        const dp = isoToParts(g.date);
        const label = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
          : (days < 0 ? `${-days} days ago` : '');
        return (
          <Card key={g.date}>
            <div className="card__head">
              <h3 style={{color: days < 0 ? 'var(--brick)' : 'var(--ink)'}}>
                {CAL_DOW[new Date(g.date+'T12:00:00').getDay()]}, {CAL_MONTHS[dp.m].slice(0,3)} {dp.d}
              </h3>
              <span className="meta">{label}</span>
            </div>
            <div className="card__body" style={{padding: 0}}>
              {g.items.map(e => <EventLine key={e.key} e={e} showDate={false} onEditTask={onEditTask}/>)}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function DayModal({ date, visible, onClose, onAdd, onEditTask }) {
  useStore();
  const dp = isoToParts(date);
  const events = buildCalendarEvents(date, date).filter(visible);
  const title = `${CAL_DOW[new Date(date+'T12:00:00').getDay()]}, ${CAL_MONTHS[dp.m]} ${dp.d}, ${dp.y}`;
  return (
    <Modal title={title} onClose={onClose} right={<Btn sz="sm" onClick={onAdd}>+ Add task</Btn>}>
      {events.length === 0 ? (
        <Empty icon="○" title="Nothing on this day"
          sub="No tasks or deadlines fall on this date for the selected types."
          action={<Btn kind="ghost" sz="sm" onClick={onAdd}>+ Add a task</Btn>}/>
      ) : (
        <div className="col" style={{margin: '-4px -4px'}}>
          {events.map(e => <EventLine key={e.key} e={e} showDate={false} onEditTask={onEditTask}/>)}
        </div>
      )}
    </Modal>
  );
}

window.CalendarScreen = CalendarScreen;
