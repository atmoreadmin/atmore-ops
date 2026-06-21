// screens/pipeline.jsx — kanban pipeline + K-Rental sidecar

function PipelineScreen() {
  const store = useStore();
  const [typeFilter, setTypeFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const [adding, setAdding] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);

  const COLUMNS = STATUS_ORDER.slice(); // pipeline lane, in order (incl. custom + B)
  const hasK = !!getStatus('K');
  const archiveCodes = getStatuses().filter(s => s.lane === 'archive').map(s => s.code);
  const TOGGLEABLE = [...COLUMNS, ...(hasK ? ['K'] : [])]; // pipeline stages + Rental (if it exists)

  const PIPE_STATUS_KEY = 'atmore.pipeline.hiddenStatuses';
  // Persist HIDDEN codes (not visible) so newly-added statuses appear by default.
  const [hiddenStatuses, setHiddenStatuses] = useState(() => {
    try {
      const saved = localStorage.getItem(PIPE_STATUS_KEY);
      if (saved) { const arr = JSON.parse(saved); if (Array.isArray(arr)) return arr; }
    } catch (e) {}
    return [];
  });
  function persistHidden(next) {
    setHiddenStatuses(next);
    try { localStorage.setItem(PIPE_STATUS_KEY, JSON.stringify(next)); } catch (e) {}
  }
  function toggleStatus(code) {
    persistHidden(hiddenStatuses.includes(code)
      ? hiddenStatuses.filter(c => c !== code)
      : [...hiddenStatuses, code]);
  }
  function resetStatuses() { persistHidden([]); }

  const hidSet = new Set(hiddenStatuses);
  const visibleStatuses = TOGGLEABLE.filter(c => !hidSet.has(c));
  const visSet = new Set(visibleStatuses);
  const visibleColumns = COLUMNS.filter(c => visSet.has(c));
  const showK = visSet.has('K');

  // ── Top scrollbar synced to the kanban (so the scrollbar sits above, not below) ──
  const kanbanRef = React.useRef(null);
  const topbarRef = React.useRef(null);
  const [scrollW, setScrollW] = React.useState(0);

  const props = store.properties.filter(p => {
    const archived = archiveCodes.includes(p.statusCode);
    if (archived && !showArchive) return false;
    if (typeFilter !== 'all' && p.type !== typeFilter) return false;
    if (ownerFilter !== 'all' && p.assigned !== ownerFilter) return false;
    if (search && !p.address.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const byStage = {};
  props.forEach(p => {
    byStage[p.statusCode] = byStage[p.statusCode] || [];
    byStage[p.statusCode].push(p);
  });

  const today = TODAY();

  const types = ['all', ...new Set(store.properties.map(p => p.type).filter(Boolean))];
  const owners = ['all', ...[...store.team].sort((a,b)=>String(a??'').localeCompare(String(b??''),undefined,{sensitivity:'base'}))];
  const archivedCount = store.properties.filter(p => archiveCodes.includes(p.statusCode)).length;

  const totalCols = visibleColumns.length + (showK ? 1 : 0) + (showArchive ? archiveCodes.length : 0);

  React.useLayoutEffect(() => {
    const el = kanbanRef.current;
    if (!el) return;
    const update = () => setScrollW(el.scrollWidth);
    update();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    window.addEventListener('resize', update);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', update); };
  }, [totalCols, props.length, showArchive]);

  function syncFromTop() {
    if (kanbanRef.current && topbarRef.current) kanbanRef.current.scrollLeft = topbarRef.current.scrollLeft;
  }
  function syncFromKanban() {
    if (kanbanRef.current && topbarRef.current) topbarRef.current.scrollLeft = kanbanRef.current.scrollLeft;
  }

  const gridStyle = { gridTemplateColumns: `repeat(${Math.max(1, totalCols)}, minmax(220px, 1fr))` };

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Properties</div>
          <h1>Active properties · {props.length}</h1>
        </div>
        <div className="row gap-8 items-center">
          <PropViewToggle view="board"/>
          <Btn sz="sm" onClick={() => setAdding(true)}>+ New property</Btn>
        </div>
      </div>

      <Card className="mb-16">
        <div className="card__body row gap-12 items-center wrap">
          <input className="input" placeholder="Search address…" value={search} onChange={e => setSearch(e.target.value)} style={{flex: '1 1 220px'}}/>
          <div className="row gap-8 items-center">
            <span className="up dim">Type</span>
            <select className="select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All' : t}</option>)}
            </select>
          </div>
          <div className="row gap-8 items-center">
            <span className="up dim">Owner</span>
            <select className="select" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
              {owners.map(o => <option key={o} value={o}>{o === 'all' ? 'All' : o}</option>)}
            </select>
          </div>
          <div className="grow"/>
          <div style={{position: 'relative'}}>
            <Btn sz="sm" kind="ghost" onClick={() => setStatusMenuOpen(v => !v)}>
              Statuses ({visibleStatuses.length}/{TOGGLEABLE.length}) ▾
            </Btn>
            {statusMenuOpen && (
              <>
                <div onClick={() => setStatusMenuOpen(false)} style={{position: 'fixed', inset: 0, zIndex: 40}}/>
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 41,
                  background: 'var(--paper)', border: '1px solid var(--rule)',
                  borderRadius: 6, boxShadow: '0 6px 24px rgba(28,26,20,0.15)',
                  minWidth: 230, padding: '6px 0',
                }}>
                  <div className="row between items-center" style={{padding: '6px 14px', borderBottom: '1px solid var(--rule)'}}>
                    <span className="up dim">Show statuses</span>
                    <button onClick={resetStatuses} className="tiny" style={{background: 'transparent', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit'}}>All</button>
                  </div>
                  {TOGGLEABLE.map(code => {
                    const isOn = visSet.has(code);
                    return (
                      <label key={code} className="row gap-8 items-center"
                        style={{padding: '6px 14px', cursor: 'pointer', fontSize: 13}}
                        onMouseOver={e => { e.currentTarget.style.background = 'var(--paper-3)'; }}
                        onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}>
                        <input type="checkbox" checked={isOn} onChange={() => toggleStatus(code)}/>
                        <Pip code={code}/>
                        <span>{STATUS_LABEL[code]}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <Tag tone={showArchive ? 'solid-blue' : 'ghost'} style={{cursor: 'pointer'}}>
            <span onClick={() => setShowArchive(v => !v)}>{showArchive ? '✓ ' : ''}Show archive ({archivedCount})</span>
          </Tag>
        </div>
      </Card>

      {totalCols === 0 ? (
        <Card><div className="card__body"><Empty title="No statuses shown" sub="Use the Statuses menu above to show pipeline columns."/></div></Card>
      ) : (
      <>
      <div ref={topbarRef} className="kanban-scrolltop" onScroll={syncFromTop}>
        <div style={{width: scrollW, height: 1}}/>
      </div>
      <div className="kanban" ref={kanbanRef} style={gridStyle} onScroll={syncFromKanban}>
        {visibleColumns.map(code => (
          <div key={code} className="kanban__col"
            style={dragOver === code ? {borderColor: 'var(--blue)', background: 'var(--blue-tint)'} : null}
            onDragOver={(e) => { e.preventDefault(); setDragOver(code); }}
            onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; setDragOver(null); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const propId = e.dataTransfer.getData('text/plain');
              const p = getProperty(propId);
              if (p && p.statusCode !== code) {
                changeStage(propId, code, { note: 'Moved via pipeline drag' });
              }
            }}>
            <div className="kanban__head">
              <div className="label row gap-8 items-center">
                <Pip code={code}/>
                <span>{STATUS_LABEL[code]}</span>
              </div>
              <span className="small dim">{(byStage[code]||[]).length}</span>
            </div>
            <div className="kanban__body">
              {(byStage[code] || []).map(p => <PCard key={p.id} p={p} today={today}/>)}
              {(byStage[code] || []).length === 0 && <div className="dim small text-c" style={{padding: 20}}>—</div>}
            </div>
          </div>
        ))}

        {/* K-Rental sidecar */}
        {showK && (
        <div className="kanban__col"
          style={dragOver === 'K' ? {borderColor: '#fff', background: 'var(--blue-deep)'} : {borderColor: 'var(--blue)', background: 'var(--blue-tint)'}}
          onDragOver={(e) => { e.preventDefault(); setDragOver('K'); }}
          onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; setDragOver(null); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(null);
            const propId = e.dataTransfer.getData('text/plain');
            const p = getProperty(propId);
            if (p && p.statusCode !== 'K') changeStage(propId, 'K', { note: 'Moved via pipeline drag' });
          }}>
          <div className="kanban__head" style={{background: 'var(--blue)', color: 'white', borderColor: 'var(--blue)'}}>
            <div className="label row gap-8 items-center">
              <span className="pip pip--K" style={{borderColor: 'white'}}>K</span>
              <span>Rental</span>
            </div>
            <span className="small" style={{color: 'rgba(255,255,255,0.85)'}}>{(byStage.K||[]).length}</span>
          </div>
          <div className="kanban__body" style={{background: 'var(--blue-tint)'}}>
            {(byStage.K || []).map(p => <PCard key={p.id} p={p} today={today} rental/>)}
            {(byStage.K || []).length === 0 && <div className="dim small text-c" style={{padding: 20}}>—</div>}
          </div>
        </div>
        )}

        {showArchive && archiveCodes.map(code => (
          <div key={code} className="kanban__col" style={{borderColor: 'var(--rule)', opacity: 0.85}}>
            <div className="kanban__head">
              <div className="label row gap-8 items-center">
                <Pip code={code}/>
                <span>{STATUS_LABEL[code]}</span>
              </div>
              <span className="small dim">{(byStage[code]||[]).length}</span>
            </div>
            <div className="kanban__body">
              {(byStage[code] || []).map(p => <PCard key={p.id} p={p} today={today}/>)}
              {(byStage[code] || []).length === 0 && <div className="dim small text-c" style={{padding: 20}}>—</div>}
            </div>
          </div>
        ))}
      </div>
      </>
      )}
      {adding && <AddPropertyModal onClose={() => setAdding(false)}/>}
    </div>
  );
}

function PCard({ p, today, rental }) {
  // staleness now based on days in current stage from stageHistory
  const days = daysInCurrentStage(p);
  const stale = (p.statusCode === 'C' && days > 60)
    || (p.statusCode === 'F' && days > 45)
    || (p.statusCode === 'G' && days > 21);
  const tenant = rental ? getTenantsForProperty(p.id)[0] : null;
  const nOffers = rental ? 0 : activeOfferCount(p.id);
  const bestNet = nOffers > 0 ? bestNetForProperty(p.id) : null;
  return (
    <div
      className={'pcard' + (stale ? ' pcard--stale' : '')}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.style.opacity = 0.5; }}
      onDragEnd={(e) => { e.currentTarget.style.opacity = 1; }}
      onClick={() => nav('/property/'+p.id)}>
      <div className="pcard__addr">{p.address}</div>
      <div className="pcard__row">
        <Tag tone="ghost">{p.type}</Tag>
        {p.assigned && <Av name={p.assigned}/>}
      </div>
      {rental && tenant && tenant.rent > 0 && (
        <div className="pcard__row" style={{marginTop: 6}}>
          <span className="mono" style={{color: 'var(--sage)', fontWeight: 600}}>{fmtMoney(tenant.rent)}/mo</span>
          <span className="dim">{tenant.source}</span>
        </div>
      )}
      {!rental && p.purchasePrice && (
        <div className="pcard__row" style={{marginTop: 6}}>
          <span className="mono dim">{fmtMoney(Math.abs(p.purchasePrice))}</span>
          {p.rehab > 0 && <span className="mono dim">+ {fmtMoney(p.rehab)} rehab</span>}
        </div>
      )}
      {!rental && nOffers > 0 && (
        <div className="pcard__row" style={{marginTop: 6}}>
          <Tag tone="blue">{nOffers} offer{nOffers > 1 ? 's' : ''}</Tag>
          <span className="mono" style={{color: 'var(--sage)', fontWeight: 600}}>{fmtMoney(bestNet)} net</span>
        </div>
      )}
      {stale && <div className="tiny" style={{color: 'var(--brick)', marginTop: 4, fontWeight: 500}}>⚠ Stale · {days} days in stage</div>}
    </div>
  );
}

window.PipelineScreen = PipelineScreen;

// AddPropertyModal mounted by PipelineScreen via state
const _pipeAddPropertyHook = null;
