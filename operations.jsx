// operations.jsx — data layer for the Spend log (checks + phone sales) and Team
// (employees + time off). Both are operational records: the spend log is a
// real-time note of money going out and NEVER posts to the books — reports,
// P&L and property costs read imported bank transactions only.

const SPEND_METHODS = { check: 'Check', phone: 'Phone sale' };
const DEFAULT_VENDORS = ['Lowes', 'Home Depot'];
const DEFAULT_CARDS = ['3521', '4956'];
const DEFAULT_CHECK_ACCTS = ['1272', '2810'];

const TIME_OFF_TYPES = ['pto', 'sick', 'unpaid', 'holiday', 'bereavement'];
const TIME_OFF_LABEL = { pto: 'PTO', sick: 'Sick', unpaid: 'Unpaid', holiday: 'Holiday', bereavement: 'Bereavement' };
const TIME_OFF_TONE = { pto: 'blue', sick: 'brick', unpaid: 'ghost', holiday: 'sage', bereavement: 'ghost' };

function defaultEmployees() {
  const at = new Date().toISOString();
  return ['Edward', 'David', 'Kerim', 'Anthony'].map((n, i) => ({ id: 'em' + (i + 1), name: n, updatedAt: at }));
}

// ─── Week helpers (weeks start Monday) ───
function weekStartISO(iso) {
  const d = new Date(iso + 'T12:00:00');
  const dow = (d.getUTCDay() + 6) % 7;              // Mon = 0
  return addDaysISO(iso, -dow);
}
function weekEndISO(iso) { return addDaysISO(weekStartISO(iso), 6); }
function fmtDayLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function fmtShortDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ─── Spend log ───
function addSpendEntry(rec) {
  Store.update(s => {
    s.spendLog = s.spendLog || [];
    BC('spend:mutator-in rows=' + s.spendLog.length);
    const id = nextId(s.spendLog, 'sp', 101);
    BC('spend:got-id ' + id);
    s.spendLog.push({
      id,
      date: rec.date || s.today,
      time: rec.time || new Date().toTimeString().slice(0, 5),
      method: rec.method === 'check' ? 'check' : 'phone',
      amount: Number(rec.amount) || 0,
      vendor: rec.vendor || '',
      contractorId: rec.contractorId || '',
      contractorName: rec.contractorName || '',
      propertyId: rec.propertyId || '',
      cardLast4: rec.cardLast4 || '',
      checkNumber: rec.checkNumber || '',
      note: rec.note || '',
      voided: false,
      updatedAt: new Date().toISOString(),
    });
    BC('spend:pushed');
  });
}
function updateSpendEntry(id, patch) {
  Store.update(s => {
    const e = (s.spendLog || []).find(x => x.id === id);
    if (e) Object.assign(e, patch, { updatedAt: new Date().toISOString() });
  });
}
function deleteSpendEntry(id) {
  Store.update(s => { markDeleted(s, 'spendLog', id); s.spendLog = (s.spendLog || []).filter(e => e.id !== id); });
}
function toggleSpendVoid(id) {
  Store.update(s => {
    const e = (s.spendLog || []).find(x => x.id === id);
    if (e) { e.voided = !e.voided; e.updatedAt = new Date().toISOString(); }
  });
}

// Newest first. The screen re-sorts and filters on top of this.
function spendEntries(fromIso, toIso) {
  return (Store.state.spendLog || [])
    .filter(e => (!fromIso || e.date >= fromIso) && (!toIso || e.date <= toIso))
    .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || String(b.id).localeCompare(String(a.id)));
}
function spendTotal(entries) {
  return entries.reduce((a, e) => a + (e.voided ? 0 : (Number(e.amount) || 0)), 0);
}
function spendPayeeName(e) {
  if (e.vendor) return e.vendor;
  if (e.contractorName) return e.contractorName;
  const c = e.contractorId ? (Store.state.contractors || []).find(c => c.id === e.contractorId) : null;
  return c ? c.name : '—';
}
function spendPickerName(e) {
  if (e.method === 'check') return '';   // a check has a payee, not a pickup person
  if (e.contractorId) {
    const c = (Store.state.contractors || []).find(c => c.id === e.contractorId);
    if (c) return c.name;
  }
  return e.contractorName || '';
}
function spendPropertyLabel(e) {
  const p = e.propertyId ? getProperty(e.propertyId) : null;
  return p ? p.address : '';
}
// Which fields are worth a nudge at save time. Amount is the only hard requirement.
function spendWarnings(rec) {
  const w = [];
  if (!rec.vendor && !rec.contractorId && !rec.contractorName) w.push('payee or vendor');
  if (!rec.propertyId) w.push('property');
  if (rec.method === 'check' && !rec.checkNumber) w.push('check number');
  if (rec.method === 'phone' && !rec.cardLast4) w.push('card');
  if (rec.method === 'phone' && !rec.contractorId && !rec.contractorName) w.push('who picked it up');
  return [...new Set(w)];
}
// Gaps in the written check sequence — a check written but never logged.
function checkSequenceGaps() {
  const nums = (Store.state.spendLog || [])
    .filter(e => e.method === 'check' && /^\d+$/.test(String(e.checkNumber || '')))
    .map(e => parseInt(e.checkNumber, 10))
    .sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < nums.length; i++) {
    const step = nums[i] - nums[i - 1];
    if (step > 1 && step <= 25) for (let n = nums[i - 1] + 1; n < nums[i]; n++) gaps.push(n);
  }
  return gaps;
}
function lastCheckNumber() {
  const nums = (Store.state.spendLog || [])
    .filter(e => e.method === 'check' && /^\d+$/.test(String(e.checkNumber || '')))
    .map(e => parseInt(e.checkNumber, 10));
  return nums.length ? Math.max(...nums) : null;
}
// Weekly summary: grouped by property with subtotals, Unassigned last.
function weeklySpendSummary(anyDateInWeek) {
  const from = weekStartISO(anyDateInWeek), to = weekEndISO(anyDateInWeek);
  const rows = spendEntries(from, to).filter(e => !e.voided);
  const byProp = new Map();
  rows.forEach(e => {
    const key = e.propertyId || '';
    if (!byProp.has(key)) byProp.set(key, []);
    byProp.get(key).push(e);
  });
  const groups = [...byProp.entries()].map(([pid, items]) => ({
    propertyId: pid,
    label: pid ? (getProperty(pid) || {}).address || 'Unknown property' : 'Unassigned',
    items: items.slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))),
    total: items.reduce((a, e) => a + (Number(e.amount) || 0), 0),
  }));
  groups.sort((a, b) => (a.propertyId ? 0 : 1) - (b.propertyId ? 0 : 1) || b.total - a.total);
  return { from, to, groups, total: groups.reduce((a, g) => a + g.total, 0), count: rows.length };
}

// ─── Employees & time off ───
function addEmployee(name) {
  const n = (name || '').trim();
  if (!n) return;
  Store.update(s => {
    s.employees = s.employees || [];
    if (s.employees.some(e => String(e.name || '').toLowerCase() === n.toLowerCase())) return;
    const id = nextId(s.employees, 'em', 1);
    // Ids get reused, and a stale delete for this id may still be circulating.
    // Stamping the re-creation lets it outrank that older delete (see
    // _dropTombstoned) instead of being silently removed on the next sync.
    s.employees.push({ id, name: n, updatedAt: new Date().toISOString() });
    s.tombstones = (s.tombstones || []).filter(t => !(t.coll === 'employees' && String(t.id) === String(id)));
  });
}
function renameEmployee(id, name) {
  const n = (name || '').trim();
  if (!n) return;
  Store.update(s => {
    const e = (s.employees || []).find(x => x.id === id);
    if (e) { e.name = n; e.updatedAt = new Date().toISOString(); }
  });
}
// Removing someone takes their time-off records with them.
function removeEmployee(id) {
  Store.update(s => {
    markDeleted(s, 'employees', id);
    (s.timeOff || []).forEach(t => { if (t.employeeId === id) markDeleted(s, 'timeOff', t.id); });
    s.employees = (s.employees || []).filter(e => e.id !== id);
    s.timeOff = (s.timeOff || []).filter(t => t.employeeId !== id);
  });
}
function addTimeOff(rec) {
  Store.update(s => {
    s.timeOff = s.timeOff || [];
    s.timeOff.push({
      id: nextId(s.timeOff, 'to', 101),
      employeeId: rec.employeeId,
      type: TIME_OFF_TYPES.includes(rec.type) ? rec.type : 'pto',
      startDate: rec.startDate,
      endDate: rec.endDate || rec.startDate,
      halfDay: !!rec.halfDay,
      note: rec.note || '',
      updatedAt: new Date().toISOString(),
    });
  });
}
function updateTimeOff(id, patch) {
  Store.update(s => {
    const t = (s.timeOff || []).find(x => x.id === id);
    if (t) Object.assign(t, patch, { updatedAt: new Date().toISOString() });
  });
}
function deleteTimeOff(id) {
  Store.update(s => { markDeleted(s, 'timeOff', id); s.timeOff = (s.timeOff || []).filter(t => t.id !== id); });
}
function timeOffDays(t) {
  if (t.halfDay) return 0.5;
  let n = 0;
  for (let d = t.startDate, guard = 0; d <= (t.endDate || t.startDate) && guard < 400; d = addDaysISO(d, 1), guard++) n++;
  return n;
}
function timeOffForEmployee(empId, year) {
  return (Store.state.timeOff || [])
    .filter(t => t.employeeId === empId && (!year || String(t.startDate).slice(0, 4) === String(year)))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}
function timeOffYtd(empId, year) {
  return timeOffForEmployee(empId, year).reduce((a, t) => a + timeOffDays(t), 0);
}
function timeOffOnDate(iso) {
  return (Store.state.timeOff || []).filter(t => iso >= t.startDate && iso <= (t.endDate || t.startDate));
}
function employeeName(id) {
  const e = (Store.state.employees || []).find(x => x.id === id);
  return e ? e.name : '—';
}

Object.assign(window, {
  SPEND_METHODS, DEFAULT_VENDORS, DEFAULT_CARDS, DEFAULT_CHECK_ACCTS,
  TIME_OFF_TYPES, TIME_OFF_LABEL, TIME_OFF_TONE, defaultEmployees,
  weekStartISO, weekEndISO, fmtDayLabel, fmtShortDay,
  addSpendEntry, updateSpendEntry, deleteSpendEntry, toggleSpendVoid,
  spendEntries, spendTotal, spendPayeeName, spendPickerName, spendPropertyLabel,
  spendWarnings, checkSequenceGaps, lastCheckNumber, weeklySpendSummary,
  addEmployee, renameEmployee, removeEmployee,
  addTimeOff, updateTimeOff, deleteTimeOff,
  timeOffDays, timeOffForEmployee, timeOffYtd, timeOffOnDate, employeeName,
});
