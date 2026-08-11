// presence.jsx — multi-user layer: identity, record locks, offline read-only.
//
// Model (chosen with the user):
//  · Identity  = the signed-in Microsoft account.
//  · Lock      = one whole record (property, tenant, employee, entry…) held while
//                its editor is open. Stored as a row in the AppLocks SharePoint
//                list so every machine sees the same truth.
//  · Held by   someone else → the editor does not open; a small dialog offers
//                Take over or Cancel.
//  · Take over is immediate: the previous holder's edits are SAVED first, then
//                they drop to read-only with a notice.
//  · Abandoned locks self-release after 5 minutes with no typing (the heartbeat
//                stops, and a lock whose heartbeat has gone cold is free).
//  · Offline   → the whole app goes read-only. A lock lives on the server; a
//                machine that cannot reach it must not edit.

const LOCK_TAB = 'AppLocks';
const LOCK_STALE_MS = 5 * 60000;   // no heartbeat for this long = abandoned
const LOCK_BEAT_MS = 20000;        // heartbeat while actively editing
const LOCK_POLL_MS = 6000;         // how fast a takeover is noticed
const IDLE_MS = 5 * 60000;         // no typing for this long = release

const Presence = {
  // Stable per-BROWSER id (survives reloads) + a per-TAB id. The lock row stores
  // "device:tab": a lock whose device half is ours can be reclaimed silently, so
  // closing a tab or refreshing never locks you out of your own record for the
  // five minutes it takes the abandoned row to go stale.
  _device: (() => {
    try {
      let d = localStorage.getItem('om_device');
      if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem('om_device', d); }
      return d;
    } catch (e) { return 'dev' + Date.now(); }
  })(),
  _tab: (() => {
    try {
      let s = sessionStorage.getItem('om_session');
      if (!s) { s = Math.random().toString(36).slice(2, 8) + Date.now().toString(36); sessionStorage.setItem('om_session', s); }
      return s;
    } catch (e) { return 'sess' + Date.now(); }
  })(),
  _online: true,
  _subs: new Set(),

  session() { return this._device + ':' + this._tab; },
  device() { return this._device; },
  sameDevice(row) { return !!row && String(row.session || '').split(':')[0] === this._device; },

  // Who "you" are: the Microsoft account this browser is signed in with.
  me() {
    let name = '', email = '';
    try {
      const a = window.SP && SP.available && SP.available() ? SP.account() : null;
      if (a) { name = a.name || a.username || ''; email = a.username || ''; }
    } catch (e) {}
    if (!name) name = email || 'This device';
    return { name, email, session: this.session() };
  },

  // Locks only apply once SharePoint live sync is running. Before that the app
  // is a single-machine tool and gating edits would be pure friction.
  active() { try { return !!(window.SPSync && SPSync.liveOn() && (SP.config.listIds || {})[LOCK_TAB]); } catch (e) { return false; } },

  online() { return this._online; },
  setOnline(v) {
    v = !!v;
    if (v === this._online) return;
    this._online = v;
    this._subs.forEach(f => { try { f(); } catch (e) {} });
  },
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },

  // Read-only whenever we cannot reach the server that owns the locks.
  readOnly() { return this.active() && !this._online; },
};

// ── Lock store ────────────────────────────────────────────────────────────
// The AppLocks list is tiny (one row per record being edited right now), so
// every poll reads the whole thing. No filters, no indexes to go wrong.

const Locks = {
  _rows: [],
  _at: 0,
  _held: new Map(),      // key -> {itemId, label, onEvicted, idleAt}
  _timer: null,
  _savers: new Map(),    // key -> () => void   (called before an eviction)

  async _graph(path, opts) {
    try {
      const r = await SP.graph(path, opts);
      Presence.setOnline(true);
      return r;
    } catch (e) {
      // Network-shaped failures mean offline; permission/shape errors do not.
      if (/failed to fetch|networkerror|load failed|offline/i.test(String(e && e.message))) Presence.setOnline(false);
      // A dead session is NOT offline, but it does stop the heartbeat — and a lock
      // that has stopped beating looks identical to a healthy one from the inside,
      // while other machines watch it go cold and take the record. Say so instead
      // of letting the poll loop swallow it.
      if (e && e.needsSignIn) {
        try {
          if (window.SyncEngine) SyncEngine._set('error', 'Signed out of SharePoint — click to sign in. Until then your edits are not protected from other people’s changes.');
          if (window.SPSync && !this._signInLogged) { this._signInLogged = true; SPSync.logLine('✗ Lock heartbeat stopped: SharePoint sign-in expired'); }
        } catch (e2) {}
      }
      throw e;
    }
  },

  async _listId() {
    const lid = (SP.config.listIds || {})[LOCK_TAB];
    if (!lid) throw new Error('Lock list not provisioned');
    return { sid: await SP.siteId(), lid };
  },

  _parse(items) {
    return (items || []).map(it => {
      const f = it.fields || {};
      return {
        itemId: it.id,
        key: String(f.RecID || ''),
        holder: f.Holder || '',
        session: f.Session || '',
        label: f.Label || '',
        acquiredAt: f.AcquiredAt || '',
        heartbeatAt: f.HeartbeatAt || '',
        serverAt: it.lastModifiedDateTime || '',
      };
    }).filter(r => r.key);
  },

  // Two machines with clocks a few minutes apart would otherwise read each
  // other's live locks as abandoned. Both sides of this comparison are on the
  // SharePoint clock: the row's own lastModifiedDateTime, and our local clock
  // corrected by a skew measured from a row we wrote ourselves.
  _skew: 0,
  _wroteAt: 0,
  serverNow() { return Date.now() + this._skew; },
  _learnSkew(rows) {
    if (!this._wroteAt) return;
    const ours = rows.find(r => r.session === Presence.session() && r.serverAt);
    if (!ours) return;
    const d = Date.parse(ours.serverAt) - this._wroteAt;
    if (isFinite(d) && Math.abs(d) < 24 * 3600 * 1000) this._skew = d;
  },
  fresh(row) {
    if (!row) return false;
    const at = Date.parse(row.serverAt || row.heartbeatAt || row.acquiredAt || 0);
    return isFinite(at) && this.serverNow() - at < LOCK_STALE_MS;
  },

  async refresh(force) {
    if (!force && Date.now() - this._at < 2000) return this._rows;
    const { sid, lid } = await this._listId();
    const r = await this._graph('/sites/' + sid + '/lists/' + lid + '/items?expand=fields&$top=500');
    this._rows = this._parse(r.value);
    this._learnSkew(this._rows);
    this._at = Date.now();
    this._sweep(sid, lid);
    return this._rows;
  },

  // Rows are normally deleted when an editor closes, but a browser killed
  // mid-edit leaves one behind. Left to pile up they would eventually fill the
  // page of rows we read, hiding live locks and making every record look free.
  // Clear anything long dead, at most once every ten minutes.
  _sweep(sid, lid) {
    if (Date.now() - (this._sweptAt || 0) < 10 * 60000) return;
    this._sweptAt = Date.now();
    const dead = this._rows.filter(r => this.serverNow() - Date.parse(r.serverAt || r.heartbeatAt || 0) > 6 * 3600 * 1000);
    dead.slice(0, 40).forEach(r => {
      this._graph('/sites/' + sid + '/lists/' + lid + '/items/' + r.itemId, { method: 'DELETE' }).catch(() => {});
    });
  },

  // Live holder of a key, or null when free.
  holderOf(key, rows) {
    return (rows || this._rows).filter(r => r.key === key && this.fresh(r))
      .sort((a, b) => String(a.acquiredAt).localeCompare(String(b.acquiredAt)))[0] || null;
  },

  mine(key) { const h = this.holderOf(key); return !!h && h.session === Presence.session(); },

  // Every mutation of ONE key runs in order. Without this, closing an editor and
  // immediately reopening the same record raced: release's in-flight DELETE landed
  // after the new acquire had PATCHed that same row (the resume-our-own path
  // reuses the row), leaving this device believing it held a lock whose server row
  // no longer existed — then the poll saw no holder and flipped the editor to
  // read-only claiming someone else had taken over.
  _chain: new Map(),
  _serialize(key, fn) {
    const prev = this._chain.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.then(() => {}, () => {});
    this._chain.set(key, settled);
    // Don't accumulate an entry for every key ever locked: drop it once this is
    // the last queued operation for that key.
    settled.then(() => { if (this._chain.get(key) === settled) this._chain.delete(key); });
    return next;
  },

  // Try to take the lock. Returns {ok} or {ok:false, holder}.
  async acquire(key, label, opts) {
    if (!Presence.active()) return { ok: true };
    return this._serialize(key, () => this._acquire(key, label, opts || {}));
  },

  async _acquire(key, label, { force } = {}) {
    if (!Presence.active()) return { ok: true };
    const me = Presence.me();
    const { sid, lid } = await this._listId();
    const rows = await this.refresh(true);
    const holder = this.holderOf(key, rows);

    const ours = holder && (holder.session === Presence.session() || Presence.sameDevice(holder));
    if (holder && !ours && !force) return { ok: false, holder };

    const stamp = new Date().toISOString();
    const fields = { RecID: key, Holder: me.name, Session: Presence.session(), Label: label || '', AcquiredAt: stamp, HeartbeatAt: stamp };

    let itemId;
    if (holder) {
      // Take over (or resume our own) in place — one row per key stays the norm.
      await this._graph('/sites/' + sid + '/lists/' + lid + '/items/' + holder.itemId + '/fields', { method: 'PATCH', body: JSON.stringify(fields) });
      itemId = holder.itemId;
    } else {
      for (const dead of rows.filter(r => r.key === key)) {
        await this._graph('/sites/' + sid + '/lists/' + lid + '/items/' + dead.itemId, { method: 'DELETE' }).catch(() => {});
      }
      const created = await this._graph('/sites/' + sid + '/lists/' + lid + '/items', { method: 'POST', body: JSON.stringify({ fields }) });
      itemId = created.id;
      // Two machines can POST in the same instant. Re-read and let the earliest
      // AcquiredAt win; the loser removes its own row and reports the conflict.
      const after = await this.refresh(true);
      const winner = this.holderOf(key, after);
      if (winner && winner.session !== Presence.session() && !Presence.sameDevice(winner)) {
        await this._graph('/sites/' + sid + '/lists/' + lid + '/items/' + itemId, { method: 'DELETE' }).catch(() => {});
        return { ok: false, holder: winner };
      }
    }

    this._wroteAt = Date.now();
    this._held.set(key, { itemId, label, idleAt: Date.now() });
    this._startLoop();
    return { ok: true };
  },

  async release(key) {
    if (!Presence.active()) { this._held.delete(key); this._savers.delete(key); return; }
    return this._serialize(key, () => this._release(key));
  },

  async _release(key) {
    const h = this._held.get(key);
    this._held.delete(key);
    this._savers.delete(key);
    if (!h || !Presence.active()) return;
    try {
      const { sid, lid } = await this._listId();
      await this._graph('/sites/' + sid + '/lists/' + lid + '/items/' + h.itemId, { method: 'DELETE' });
    } catch (e) {}
    this._at = 0;
  },

  // Register the editor's save() so a takeover never loses what was typed.
  registerSaver(key, fn) { if (key) this._savers.set(key, fn); },

  // Called when this device loses a lock it thought it held. `alsoRelease` sends
  // the DELETE for our own row FIRST — _evict clears _held, and release() keys off
  // _held, so releasing afterwards is a no-op that leaves the row to go stale.
  _evict(key, reason, alsoRelease) {
    const h = this._held.get(key);
    if (!h) return;
    if (alsoRelease && Presence.active()) {
      // Through the same per-key chain as acquire/release, or this DELETE can land
      // after a fresh acquire has claimed the row.
      this._serialize(key, () => this._listId()
        .then(({ sid, lid }) => this._graph('/sites/' + sid + '/lists/' + lid + '/items/' + h.itemId, { method: 'DELETE' }))
        .then(() => { this._at = 0; })
        .catch(() => {}));
    }
    this._held.delete(key);
    const save = this._savers.get(key);
    this._savers.delete(key);
    // ORDER IS LOAD-BEARING: run the saver BEFORE onEvicted flips the editor to
    // read-only. Once that happens the modal's fieldset is disabled and the
    // eviction-save can no longer press the editor's Save button.
    if (save) { try { save(); } catch (e) {} }
    if (h.onEvicted) { try { h.onEvicted(reason); } catch (e) {} }
  },

  onEvicted(key, fn) { const h = this._held.get(key); if (h) h.onEvicted = fn; },

  // Who holds `key`, if it is someone else. Returns null when free/ours, the
  // holder row when taken, or the string 'offline' when we cannot tell.
  async heldByOther(key) {
    return this.anyHeldByOther(key ? [key] : []);
  },

  // Same question for MANY keys on a SINGLE lock read — for bulk actions, where
  // one request per row would fire hundreds of requests and stall.
  async anyHeldByOther(keys) {
    if (!Presence.active() || !keys || !keys.length) return null;
    try {
      const rows = await this.refresh(true);
      for (const key of keys) {
        const h = this.holderOf(key, rows);
        if (h && h.session !== Presence.session() && !Presence.sameDevice(h)) return h;
      }
      return null;
    } catch (e) { return 'offline'; }
  },

  // Any typing/clicking counts as activity for every lock this device holds.
  touch() { const now = Date.now(); this._held.forEach(h => { h.idleAt = now; }); },

  _startLoop() {
    if (this._timer) return;
    this._timer = setInterval(async () => {
      if (!this._held.size) { clearInterval(this._timer); this._timer = null; return; }
      let rows;
      try { rows = await this.refresh(true); } catch (e) { return; }
      const { sid, lid } = await this._listId().catch(() => ({}));
      const now = Date.now();
      for (const [key, h] of [...this._held]) {
        const holder = this.holderOf(key, rows);
        if (!holder || holder.session !== Presence.session()) {
          // A single odd read (throttled page, partial result) must never kick
          // someone out of an editor they legitimately hold.
          h.misses = (h.misses || 0) + 1;
          if (h.misses < 2) continue;
          this._evict(key, holder ? 'taken' : 'lost');
          continue;
        }
        h.misses = 0;
        if (now - h.idleAt > IDLE_MS) { this._evict(key, 'idle', true); continue; }
        if (now - (h.beatAt || 0) > LOCK_BEAT_MS && sid) {
          h.beatAt = now; this._wroteAt = now;
          this._graph('/sites/' + sid + '/lists/' + lid + '/items/' + h.itemId + '/fields', { method: 'PATCH', body: JSON.stringify({ HeartbeatAt: new Date().toISOString() }) }).catch(() => {});
        }
      }
    }, LOCK_POLL_MS);
  },
};

['keydown', 'pointerdown'].forEach(ev => window.addEventListener(ev, () => Locks.touch(), true));
window.addEventListener('beforeunload', () => { [...Locks._held.keys()].forEach(k => Locks.release(k)); });
window.addEventListener('online', () => Presence.setOnline(true));
window.addEventListener('offline', () => Presence.setOnline(false));

// ── React glue ────────────────────────────────────────────────────────────
// useEditLock drives the Modal: it acquires on open, holds while mounted, and
// reports the three states an editor cares about — checking, blocked, evicted.

function useEditLock(key, label, onEvictedSave) {
  const [, forceRender] = React.useReducer(x => x + 1, 0);
  const [state, setState] = React.useState(() => (key && Presence.active() ? 'checking' : 'ok'));
  const [holder, setHolder] = React.useState(null);
  const [notice, setNotice] = React.useState('');

  const claim = React.useCallback(async (force, gesture) => {
    if (!key || !Presence.active()) { setState('ok'); return; }
    setState('checking');
    try {
      // Take-over comes from a click, so a token refresh may legitimately prompt
      // here. The on-mount claim is not a gesture and must stay silent.
      const r = gesture ? await SP.interactive(() => Locks.acquire(key, label, { force }))
                        : await Locks.acquire(key, label, { force });
      if (r.ok) {
        setState('ok'); setNotice('');
        Locks.onEvicted(key, reason => {
          setNotice(reason === 'idle'
            ? 'Released after 5 minutes of no typing — your changes were saved.'
            : 'Someone else took over this record — your changes were saved.');
          setState('readonly');
        });
      } else { setHolder(r.holder); setState('blocked'); }
    } catch (e) {
      // Lock infrastructure unreachable: fail SAFE — read-only, never a silent
      // free-for-all that lets two machines edit the same record.
      setNotice('Cannot reach SharePoint — this record is read-only until the connection returns.');
      setState('readonly');
    }
  }, [key, label]);

  React.useEffect(() => { claim(false); return () => { if (key) Locks.release(key); }; }, [key]);

  // Keep the saver pointed at the CURRENT render's save function — it closes over
  // the editor's in-progress field state, so a stale one would write stale values.
  React.useEffect(() => { if (key && onEvictedSave && state !== 'readonly' && state !== 'blocked') Locks.registerSaver(key, onEvictedSave); });

  // Going offline puts the whole app in read-only; an already-open editor has to
  // hear about it too, not just the banner at the top of the page.
  React.useEffect(() => Presence.subscribe(forceRender), []);

  return {
    state, holder, notice,
    // Anything other than 'ok' is not editable — including 'checking'. acquire()
    // is a multi-request round trip, and until it answers we do not know whether
    // someone else holds this record. The editor's body is withheld during the
    // check, but its Save button lives in the modal header: leaving that live
    // would let a second person commit a stale snapshot over the holder's newer
    // values before the "In use" dialog ever appeared.
    readOnly: state !== 'ok' || Presence.readOnly(),
    takeOver: () => claim(true, true),
    registerSave: fn => Locks.registerSaver(key, fn),
  };
}

// Shown INSTEAD of the editor when someone else holds the record.
function LockedDialog({ holder, label, onTakeOver, onCancel }) {
  const [busy, setBusy] = React.useState(false);
  const since = holder && holder.acquiredAt ? new Date(holder.acquiredAt) : null;
  const mins = since ? Math.max(0, Math.round((Date.now() - since.getTime()) / 60000)) : 0;
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth: 420}}>
        <div className="modal__head"><h2>In use</h2></div>
        <div className="modal__body col gap-14">
          <div style={{fontSize: 15, lineHeight: 1.5}}>
            <strong>{(holder && holder.holder) || 'Someone'}</strong> is editing{label ? ' ' + label : ' this record'}
            {since ? <span className="dim"> — started {mins < 1 ? 'just now' : mins + ' min ago'}</span> : null}.
          </div>
          <div className="dim" style={{fontSize: 13, lineHeight: 1.5}}>
            Taking over saves their work first, then switches them to read-only.
          </div>
          <div className="row gap-8" style={{justifyContent: 'flex-end'}}>
            <Btn kind="ghost" onClick={onCancel}>Cancel</Btn>
            <Btn kind="primary" onClick={async () => { setBusy(true); await onTakeOver(); setBusy(false); }} disabled={busy}>
              {busy ? 'Taking over…' : 'Take over'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// Thin bar inside an editor that has gone read-only mid-session.
function LockNotice({ text, onResume }) {
  return (
    <div className="row items-center gap-10" style={{padding: '9px 12px', background: 'var(--ochre-soft)', border: '1px solid var(--ochre)', borderRadius: 'var(--radius-s)', marginBottom: 12, fontSize: 13}}>
      <span style={{flex: 1}}>{text}</span>
      {onResume ? <Btn sz="sm" kind="ghost" onClick={onResume}>Resume editing</Btn> : null}
    </div>
  );
}

// App-wide bar: offline means the whole app is read-only.
function OfflineBar() {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => Presence.subscribe(force), []);
  if (!Presence.readOnly()) return null;
  return (
    <div style={{padding: '7px 14px', background: 'var(--brick)', color: 'var(--paper)', fontSize: 13, textAlign: 'center'}}>
      Offline — the app is read-only until SharePoint is reachable again, so two machines can't edit the same record.
    </div>
  );
}

// Gate for DESTRUCTIVE actions that live outside an editor — a Remove button in a
// list, a bulk delete, a "reset to defaults". Opening an editor takes a lock, but
// these delete in one click with no editor at all, so without this check one
// person can delete the very record another has open (and a delete is the one
// action a take-over cannot undo). Returns true only if the caller may proceed.
async function confirmDestructive(key, label, message) {
  if (Presence.readOnly()) {
    alert('This computer can\u2019t reach SharePoint right now, so it\u2019s read-only. Deleting here would not reach anyone else.');
    return false;
  }
  const held = await Locks.heldByOther(key);
  if (held === 'offline') {
    alert('Can\u2019t reach SharePoint to check whether someone else has ' + (label || 'this record') + ' open. Try again in a moment.');
    return false;
  }
  if (held) {
    alert((held.holder || 'Someone') + ' has ' + (label || 'this record') + ' open right now.\n\nAsk them to close it before deleting \u2014 otherwise their work is lost with no way to get it back.');
    return false;
  }
  return confirm(message);
}

Object.assign(window, { Presence, Locks, useEditLock, LockedDialog, LockNotice, OfflineBar, confirmDestructive });
