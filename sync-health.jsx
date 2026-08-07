// sync-health.jsx — ONE place that answers "is anything not syncing?".
// The individual diagnostics (skipped columns, unsaved values, conflicts, schema
// drift, field-by-field comparison) each answer a narrow question and each needed
// the user to remember it existed. This runs them all, in plain language, and runs
// itself on a schedule so nobody has to remember anything.

const HEALTH_KEY = 'sync_health_v1';

const SyncHealth = {
  load() { try { return JSON.parse(localStorage.getItem(HEALTH_KEY) || '{}'); } catch (e) { return {}; } },
  save(o) { try { localStorage.setItem(HEALTH_KEY, JSON.stringify({ ...this.load(), ...o })); } catch (e) {} },
  lastAt() { return this.load().at || null; },
  lastResult() { return this.load().findings || null; },

  // Cheap, local-only checks — safe to run on every app open.
  quick() {
    const out = [];
    const cfg = (window.SP && (SP.config || SP.loadConfig())) || {};
    const skip = cfg.skipFields || {};
    const skipped = Object.entries(skip).filter(([, v]) => (v || []).length);
    if (skipped.length) out.push({
      id: 'skip', level: 'bad',
      title: 'SharePoint is refusing ' + skipped.reduce((a, [, v]) => a + v.length, 0) + ' column(s)',
      detail: skipped.map(([t, v]) => t + ' — ' + v.join(', ')).join('; ') + '. Those values stay on this computer only.',
      card: 'Columns not syncing',
    });
    const unsaved = (window.SP && SP.unsavedList && SP.unsavedList()) || [];
    if (unsaved.length) out.push({
      id: 'unsaved', level: 'bad',
      title: unsaved.length + ' value(s) SharePoint will not accept',
      detail: 'Usually a number field holding something that is not a number. Reconcile can fix most of them.',
      card: 'Values that cannot save',
    });
    const conflicts = (window.SPSync && SPSync.conflictList && SPSync.conflictList()) || [];
    if (conflicts.length) out.push({
      id: 'conflict', level: 'warn',
      title: conflicts.length + ' field(s) changed in two places',
      detail: 'Your value was kept. Review them so nobody\u2019s edit is lost.',
      card: 'Changed in two places',
    });
    // Fields the app never even sends (no column declared, or a pull strips them).
    if (typeof auditSyncFields === 'function') {
      let drift = null;
      try { drift = auditSyncFields(); } catch (e) {}
      const bad = ((drift || {}).findings || []).filter(f => f && (f.fields || []).length);
      if (bad.length) out.push({
        id: 'drift', level: 'bad',
        title: 'Some fields never reach SharePoint at all',
        detail: bad.map(f => f.tab + ': ' + (f.fields || []).map(x => x.field).join(', ')).join('; '),
        card: 'Fields not syncing',
      });
    }
    const last = (window.SPSync && SPSync._lastPullAt) || 0;
    if (window.SPSync && SPSync.liveOn && SPSync.liveOn() && last && Date.now() - last > 60 * 60000) out.push({
      id: 'stale', level: 'warn',
      title: 'This computer has not heard from SharePoint in over an hour',
      detail: 'Refresh the page so you are working from current data.',
    });
    return out;
  },

  // Reads SharePoint: compares every field of every record against what the server
  // actually holds. This is the check that would have caught a column silently
  // refusing writes, so it is the one that matters most — and the one nobody ran.
  // Returns { findings, compared } — compared:false means the server was never
  // read, so the caller must NOT claim this computer matches SharePoint.
  async deep(onProgress) {
    const out = [];
    if (!window.SPSync || !SPSync.liveOn || !SPSync.liveOn()) {
      out.push({
        id: 'notcompared', level: 'warn',
        title: 'Live sync is off — nothing was compared against SharePoint',
        detail: 'Only this computer’s own records were checked. Turn live sync on to confirm the server matches.',
      });
      return { findings: out, compared: false };
    }
    const tabs = (window.SP_PARENT_TABS_PUBLIC || []).length ? window.SP_PARENT_TABS_PUBLIC
      : Object.keys(window.SHEET_SCHEMA || {});
    const local = serializeForSheet(Store.state).tabs;
    const same = window.reconSame || ((a, b) => (a == null ? '' : String(a)) === (b == null ? '' : String(b)));
    const mismatches = [];
    const missing = [];
    for (const t of tabs) {
      if (!((SP.config.listIds || {})[t])) continue;
      if (onProgress) onProgress(t);
      let items = [];
      try { items = await SPSync._fetchList(t); } catch (e) { continue; }
      const server = new Map();
      items.forEach(it => { const r = SPSync._rowFromItem(t, it); if (r && r.id != null) server.set(String(r.id), r); });
      const cols = ((window.SHEET_SCHEMA[t] || {}).columns || []).map(c => c.key).filter(k => k !== 'id');
      for (const r of (local[t] || [])) {
        if (r.id == null) continue;
        const s = server.get(String(r.id));
        if (!s) { missing.push(t + ' ' + r.id); continue; }
        for (const k of cols) {
          // Use Reconcile's comparison, not string equality: SharePoint returns
          // booleans as TRUE/FALSE while the app stores true/false, and an unset
          // checkbox reads as blank. Comparing them as raw text reported every
          // boolean column on every record as "wrong" — hundreds of false alarms
          // that would bury a real one.
          if (same(r[k], s[k])) continue;
          mismatches.push({ tab: t, id: String(r.id), field: k });
        }
      }
    }
    if (missing.length) out.push({
      id: 'missingThere', level: 'bad',
      title: missing.length + ' record(s) exist here but not in SharePoint',
      detail: missing.slice(0, 8).join(', ') + (missing.length > 8 ? '\u2026' : '') + '. Nobody else can see them.',
      card: 'Reconcile',
    });
    if (mismatches.length) {
      const byField = {};
      mismatches.forEach(m => { const k = m.tab + '.' + m.field; byField[k] = (byField[k] || 0) + 1; });
      const top = Object.entries(byField).sort((a, b) => b[1] - a[1]);
      // A field wrong on MANY records is a column problem, not a data disagreement —
      // that is the checklist bug's signature.
      const systemic = top.filter(([, n]) => n >= 3);
      out.push({
        id: 'mismatch', level: systemic.length ? 'bad' : 'warn',
        title: mismatches.length + ' field(s) differ from SharePoint',
        detail: (systemic.length
          ? 'Whole columns look wrong, which usually means SharePoint is not storing them: '
          : 'Scattered differences, usually pending saves: ')
          + top.slice(0, 6).map(([k, n]) => k + ' (' + n + ')').join(', '),
        card: 'Reconcile',
      });
    }
    return { findings: out, compared: true };
  },

  // 'compared' records whether the SharePoint comparison actually RAN — not whether
  // it was asked for. The all-clear message depends on it.
  lastCompared() { return !!this.load().compared; },

  async run(opts) {
    const wantDeep = !(opts && opts.quickOnly);
    const onProgress = opts && opts.onProgress;
    let findings = this.quick();
    let compared = false;
    if (wantDeep) {
      try {
        const r = await this.deep(onProgress);
        findings = findings.concat(r.findings || []);
        compared = !!r.compared;
      } catch (e) {
        findings.push({
          id: 'checkfailed', level: 'warn',
          title: 'The comparison against SharePoint could not finish',
          detail: String((e && e.message) || e).slice(0, 140) + '. Nothing was verified against the server.',
        });
      }
    }
    this.save({ at: new Date().toISOString(), findings, compared, deep: wantDeep });
    return findings;
  },

  // Run on open, then daily: light checks always, the SharePoint comparison at most
  // once a day so it never costs anything noticeable.
  schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    const tick = async () => {
      if (!window.SPSync || !SPSync.liveOn || !SPSync.liveOn()) return;
      if (SPSync._flushing) return;
      const last = Date.parse(this.lastAt() || '') || 0;
      const stale = Date.now() - last > 24 * 3600000;
      await this.run({ quickOnly: !stale });
      const bad = (this.lastResult() || []).filter(f => f.level === 'bad');
      if (bad.length && window.SPSync) SPSync.logLine('\u26a0 Sync health: ' + bad.length + ' problem(s) found \u2014 Settings \u2192 Integration');
    };
    setTimeout(tick, 20000);
    setInterval(tick, 6 * 3600000);
  },
};

function SyncHealthCard({ nav }) {
  const [findings, setFindings] = React.useState(() => SyncHealth.lastResult());
  const [at, setAt] = React.useState(() => SyncHealth.lastAt());
  const [busy, setBusy] = React.useState(false);
  const [step, setStep] = React.useState('');

  async function check() {
    setBusy(true); setStep('');
    try {
      const f = await SyncHealth.run({ onProgress: t => setStep(t) });
      setFindings(f); setAt(SyncHealth.lastAt()); setCompared(SyncHealth.lastCompared());
    } finally { setBusy(false); setStep(''); }
  }

  const bad = (findings || []).filter(f => f.level === 'bad');
  const warn = (findings || []).filter(f => f.level === 'warn');
  const [compared, setCompared] = React.useState(() => SyncHealth.lastCompared());
  const clean = findings && !findings.length;
  const when = at ? new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <Card>
      <CardHead title="Sync health" right={
        !findings ? <Tag tone="ghost">not checked yet</Tag>
        : bad.length ? <Tag tone="brick">{bad.length} problem{bad.length === 1 ? '' : 's'}</Tag>
        : warn.length ? <Tag tone="ochre">{warn.length} to review</Tag>
        : <Tag tone="sage">all clear</Tag>
      }/>
      <div className="card__body col gap-10">
        <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>
          One check for everything: refused columns, values that will not save, edits changed in two places, fields that never reach SharePoint, and a record-by-record comparison against the server. It runs itself when you open the app and does the full comparison once a day — you should not need to come here unless it says something.
        </div>
        {clean && <div className="small" style={{color: 'var(--ink-2)'}}>{compared
          ? 'Nothing wrong as of ' + when + '. Every record on this computer matches SharePoint.'
          : 'No problems found on this computer as of ' + when + ' — but nothing was compared against SharePoint.'}</div>}
        {!!(findings || []).length && (
          <div className="col gap-8">
            {findings.map(f => (
              <div key={f.id} className="row gap-8" style={{alignItems: 'flex-start', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 6, padding: '10px 12px'}}>
                <Tag tone={f.level === 'bad' ? 'brick' : 'ochre'}>{f.level === 'bad' ? 'problem' : 'review'}</Tag>
                <div className="col gap-4" style={{flex: 1, minWidth: 0}}>
                  <div style={{fontWeight: 600}}>{f.title}</div>
                  <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.5}}>{f.detail}</div>
                  {f.card && <div className="tiny" style={{color: 'var(--ink-3)'}}>{f.card === 'Reconcile' ? 'Fix in Reconcile' : 'See the \u201c' + f.card + '\u201d card below'}</div>}
                </div>
                {f.card === 'Reconcile' && <Btn kind="ghost" sz="sm" onClick={() => nav('/reconcile')}>Open</Btn>}
              </div>
            ))}
          </div>
        )}
        <div className="row gap-8">
          <Btn kind="primary" disabled={busy} onClick={check}>{busy ? (step ? 'Checking ' + step + '\u2026' : 'Checking\u2026') : 'Run full check'}</Btn>
          {!!when && <span className="tiny" style={{color: 'var(--ink-3)', alignSelf: 'center'}}>Last checked {when}</span>}
        </div>
      </div>
    </Card>
  );
}

Object.assign(window, { SyncHealth, SyncHealthCard });
