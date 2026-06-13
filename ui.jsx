// ui.jsx — reusable presentational components

function Card({ children, alert, accent, className, style }) {
  let cls = 'card';
  if (alert) cls += ' card--alert';
  if (accent) cls += ' card--accent';
  if (className) cls += ' ' + className;
  return <div className={cls} style={style}>{children}</div>;
}

function CardHead({ title, meta, right }) {
  return (
    <div className="card__head">
      <div className="row gap-8 items-baseline">
        <h3>{title}</h3>
        {meta && <span className="meta">{meta}</span>}
      </div>
      {right}
    </div>
  );
}

function Tag({ tone, children, dot, style }) {
  let cls = 'tag';
  if (tone) cls += ' tag--' + tone;
  return (
    <span className={cls} style={style}>
      {dot && <span className="dot" style={{background: 'currentColor'}}/>}
      <span className="tag__txt">{children}</span>
    </span>
  );
}

function Btn({ kind, sz, children, onClick, icon, style, disabled, href, target, title, className }) {
  let cls = 'btn';
  if (kind) cls += ' btn--' + kind;
  if (sz) cls += ' btn--' + sz;
  if (className) cls += ' ' + className;
  // Render as <a> when an href is provided — anchors with target="_blank" survive
  // sandboxed-iframe popup blocking better than window.open(). rel set for safety.
  if (href) {
    return <a className={cls} href={href} target={target || '_blank'} rel="noopener noreferrer"
      style={{textDecoration: 'none', ...style}} title={title}
      onClick={(e) => { if (disabled) e.preventDefault(); else if (onClick) onClick(e); }}>{icon}{children}</a>;
  }
  return <button className={cls} onClick={onClick} style={style} disabled={disabled} title={title}>{icon}{children}</button>;
}

function Av({ name, size }) {
  const style = size ? { width:size, height:size, fontSize:size*0.42 } : null;
  return <span className="av" style={style}>{initials(name)}</span>;
}

// ManagedSelect — dropdown that reads from a managed list and lets the user
// add a new item inline via the "+ Add new…" option.
function ManagedSelect({ listKey, value, onChange, placeholder = '— pick —', style, filter }) {
  const store = useStore();
  let items = getList(listKey);
  if (filter) items = items.filter(filter);
  function handleChange(v) {
    if (v === '__add__') {
      const newLabel = window.prompt('Add new ' + listKey.replace(/([A-Z])/g, ' $1').toLowerCase().trim() + ':');
      if (!newLabel || !newLabel.trim()) return;
      addListItem(listKey, { label: newLabel.trim() });
      onChange(newLabel.trim());
      return;
    }
    onChange(v);
  }
  return (
    <select className="select" value={value} onChange={e => handleChange(e.target.value)} style={style}>
      <option value="">{placeholder}</option>
      {value && !items.some(o => o.label === value) && <option value={value}>{value}</option>}
      {items.map(o => <option key={o.id} value={o.label}>{o.label}</option>)}
      <option disabled>──────────</option>
      <option value="__add__">+ Add new…</option>
    </select>
  );
}

function Pip({ code, label }) {
  const tone = (typeof STATUS_TONE !== 'undefined') ? STATUS_TONE[code] : null;
  const t = tone && (typeof STATUS_TONES !== 'undefined') ? STATUS_TONES[tone] : null;
  const style = t ? { background: t.bg, color: t.fg, borderColor: t.border } : undefined;
  return <span className={'pip pip--' + code} style={style}>{code}{label ? '·'+label : ''}</span>;
}

function StatusBadge({ code, full }) {
  return (
    <span className="row gap-6 items-center">
      <Pip code={code}/>
      {full && <span className="small mid" style={{whiteSpace: 'nowrap'}}>{STATUS_LABEL[code] || ''}</span>}
    </span>
  );
}

function Progress({ pct, tone, style }) {
  let cls = 'progress';
  if (tone) cls += ' progress--' + tone;
  return <div className={cls} style={style}><i style={{width: Math.max(0, Math.min(100, pct))+'%'}}/></div>;
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(o => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        return (
          <button key={val}
            className={'seg__btn ' + (value === val ? 'seg__btn--active' : '')}
            onClick={() => onChange(val)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Modal({ title, children, onClose, right }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{title}</h2>
          <div className="row gap-8 items-center">
            {right}
            <Btn kind="ghost" sz="sm" onClick={onClose}>✕</Btn>
          </div>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

function AtmoreLogo({ size=28 }) {
  return (
    <div className="row items-center gap-10">
      <svg width={size} height={size} viewBox="0 0 80 80">
        <path d="M40 14 L72 50 L60 50 L40 28 L20 50 L8 50 Z" fill="#34637f"/>
        <rect x="34" y="38" width="12" height="16" fill="#34637f"/>
        <path d="M20 50 L8 62 L20 62 L40 40 Z" fill="#a89c83" opacity=".85"/>
        <path d="M60 50 L72 62 L60 62 L40 40 Z" fill="#a89c83" opacity=".85"/>
      </svg>
      <div className="col" style={{lineHeight: 1.05}}>
        <div className="serif" style={{ fontWeight: 600, fontSize: 18, color: 'var(--ink)', letterSpacing:'-0.01em' }}>Atmore</div>
        <div style={{ color: 'var(--ink-3)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.22em', marginTop: 2 }}>Operations</div>
      </div>
    </div>
  );
}

// Empty state
function Empty({ icon, title, sub, action }) {
  return (
    <div className="col items-center gap-8 text-c" style={{padding: '36px 20px', color: 'var(--ink-3)'}}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        border: '1px solid var(--rule)', background: 'var(--paper-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, color: 'var(--ink-3)', marginBottom: 2,
      }}>{icon || '○'}</div>
      <div className="serif" style={{fontSize: 16, color: 'var(--ink-2)'}}>{title}</div>
      {sub && <div className="small" style={{maxWidth: 240, textWrap: 'pretty'}}>{sub}</div>}
      {action && <div className="mt-12">{action}</div>}
    </div>
  );
}

// Rent status helpers
function rentStatusTone(s) {
  return s === 'paid' ? 'sage'
    : s === 'partial' ? 'ochre'
    : s === 'late' ? 'ochre'
    : s === 'upcoming' ? 'blue'
    : s === 'vacate-due' ? 'brick'
    : 'ghost';
}
function rentStatusLabel(s) {
  return ({
    'paid': 'Paid',
    'partial': 'Partial',
    'late': 'Late',
    'upcoming': 'Due',
    'vacate-due': 'Vacate due',
    'vacant': 'Vacant',
    'prep': 'Prepping',
  })[s] || s;
}

Object.assign(window, {
  Card, CardHead, Tag, Btn, Av, Pip, StatusBadge, Progress, Segmented, Modal,
  AtmoreLogo, Empty, rentStatusTone, rentStatusLabel, ManagedSelect,
});
