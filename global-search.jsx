// global-search.jsx — Cmd+K / Ctrl+K palette

function GlobalSearch({ onClose }) {
  const store = useStore();
  const [q, setQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = React.useRef(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const results = React.useMemo(() => {
    const out = [];
    if (!q.trim()) {
      // Default: show recent + a hint
      store.properties.slice(0, 5).forEach(p => {
        out.push({ kind: 'property', id: p.id, label: p.address, sub: p.city + ' · ' + STATUS_LABEL[p.statusCode] });
      });
      return out;
    }
    const lc = q.toLowerCase();
    // Properties
    for (const p of store.properties) {
      if (p.address.toLowerCase().includes(lc) || (p.city||'').toLowerCase().includes(lc) || (p.vestingLLC||'').toLowerCase().includes(lc)) {
        out.push({ kind: 'property', id: p.id, label: p.address, sub: p.city + ', ' + p.state + ' · ' + STATUS_LABEL[p.statusCode], pip: p.statusCode });
      }
      if (out.length >= 80) break;
    }
    // Tenants
    for (const t of store.tenants) {
      if (!t.name) continue;
      if (t.name.toLowerCase().includes(lc) || (t.phone||'').toLowerCase().includes(lc) || (t.voucher||'').toLowerCase().includes(lc)) {
        out.push({ kind: 'tenant', id: t.id, label: t.name, sub: getProperty(t.propertyId)?.address || '—', propertyId: t.propertyId });
      }
    }
    // Contractors
    for (const c of store.contractors) {
      if (c.name.toLowerCase().includes(lc) || (c.specialty||'').toLowerCase().includes(lc)) {
        out.push({ kind: 'contractor', id: c.id, label: c.name, sub: (c.specialty || 'No specialty') + ' · ' + fmtMoney(c.ytd) + ' YTD' });
      }
    }
    // Leads
    for (const ld of (store.leads || [])) {
      if ((ld.name||'').toLowerCase().includes(lc) || (ld.phone||'').toLowerCase().includes(lc) || (ld.source||'').toLowerCase().includes(lc) || (ld.notes||'').toLowerCase().includes(lc)) {
        const prop = getProperty(ld.propertyId);
        out.push({ kind: 'lead', id: ld.id, label: ld.name, sub: (prop?.address || '—') + ' · ' + ld.source + ' · ' + LEAD_STATUS_LABEL[ld.status], propertyId: ld.propertyId });
      }
    }
    // Transactions — check description, payee, amount
    const numQ = parseFloat(lc.replace(/[$,]/g, ''));
    for (const t of store.transactions) {
      if (t.desc.toLowerCase().includes(lc) || (t.payee || '').toLowerCase().includes(lc) || (t.project || '').toLowerCase().includes(lc) ||
          (!isNaN(numQ) && numQ > 0 && Math.abs(t.amount) === numQ)) {
        out.push({ kind: 'tx', id: t.id, label: t.desc.slice(0, 60), sub: fmtDate(t.date) + ' · ' + fmtMoney(t.amount) + ' · ' + (t.project || t.category || 'untagged'),
                   amount: t.amount });
      }
      if (out.length >= 80) break;
    }
    return out.slice(0, 50);
  }, [q, store]);

  function pick(r) {
    if (!r) return;
    if (r.kind === 'property') nav('/property/' + r.id);
    else if (r.kind === 'tenant') nav('/property/' + r.propertyId + '/tenants');
    else if (r.kind === 'lead') nav('/property/' + r.propertyId + '/leads');
    else if (r.kind === 'contractor') nav('/contractors');
    else if (r.kind === 'tx') nav('/transactions');
    onClose();
  }

  function onKey(e) {
    if (e.key === 'Escape') { onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter')     { e.preventDefault(); pick(results[activeIdx]); }
  }

  React.useEffect(() => { setActiveIdx(0); }, [q]);

  return (
    <div className="modal-back" onClick={onClose} style={{alignItems: 'flex-start', paddingTop: '12vh'}}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--paper)', border: '1px solid var(--rule)',
          borderRadius: 10, width: '100%', maxWidth: 640,
          boxShadow: '0 12px 48px rgba(28,26,20,0.25)',
        }}>
        <div className="row gap-12 items-center" style={{padding: '14px 16px', borderBottom: '1px solid var(--rule)'}}>
          <span style={{fontSize: 18, color: 'var(--ink-3)'}}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search properties, tenants, contractors, transactions…"
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent', fontFamily: 'inherit',
              fontSize: 16, color: 'var(--ink)',
            }}/>
          <span className="kbd" style={{fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: 'var(--ink-3)'}}>esc</span>
        </div>

        <div style={{maxHeight: '60vh', overflowY: 'auto'}}>
          {results.length === 0 ? (
            <div className="card__body" style={{padding: 32, textAlign: 'center'}}>
              <div className="small dim">No matches for "{q}"</div>
            </div>
          ) : (
            results.map((r, i) => (
              <div key={r.kind + '-' + r.id} onClick={() => pick(r)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 16px', cursor: 'pointer',
                  background: i === activeIdx ? 'var(--blue-tint)' : 'transparent',
                  borderBottom: '1px solid var(--rule-soft)',
                }}>
                <KindIcon kind={r.kind}/>
                <div className="grow" style={{minWidth: 0}}>
                  <div style={{fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{r.label}</div>
                  <div className="small dim" style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{r.sub}</div>
                </div>
                {r.pip && <Pip code={r.pip}/>}
                {r.amount != null && <span className="mono small" style={{color: r.amount < 0 ? 'var(--brick)' : 'var(--sage)'}}>{fmtMoney(r.amount)}</span>}
                <span className="tiny dim up">{r.kind}</span>
              </div>
            ))
          )}
        </div>

        <div style={{padding: '8px 16px', borderTop: '1px solid var(--rule)', display: 'flex', gap: 14, justifyContent: 'space-between'}}>
          <span className="tiny dim">↑↓ navigate · ↵ open</span>
          <span className="tiny dim">{results.length} result{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}

function KindIcon({ kind }) {
  const icons = { property: '🏠', tenant: '👤', lead: '📞', contractor: '🔨', tx: '$' };
  const colors = { property: 'var(--blue-tint)', tenant: 'var(--sage-soft)', lead: 'var(--ochre-soft)', contractor: 'var(--ochre-soft)', tx: 'var(--paper-3)' };
  const fg = { property: 'var(--blue)', tenant: 'var(--sage)', lead: 'var(--ochre)', contractor: 'var(--ochre)', tx: 'var(--ink-2)' };
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 6,
      background: colors[kind], border: '1px solid ' + fg[kind],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, color: fg[kind], flexShrink: 0,
    }}>{icons[kind]}</div>
  );
}

window.GlobalSearch = GlobalSearch;
