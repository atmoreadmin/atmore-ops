// screens/settings.jsx — manage categories, payment sources, loan types

const LIST_DEFS = [
  { key:'categories',     title:'Transaction categories', sub:'Used on transactions, splits, bank import, and the tax binder.', hasKind:true },
  { key:'paymentSources', title:'Payment sources',        sub:'How rent payments arrive (Zelle, Section 8, TurboTenant…).' },
  { key:'loanTypes',      title:'Loan types',             sub:'Lenders and financing types tagged on properties.' },
  { key:'vestingLLCs',    title:'Vesting LLCs',           sub:'Which LLC holds title to each property.' },
  { key:'propertyTypes',  title:'Property types',         sub:'Wholesale, Flip, Rental, 1031 — tagged on every property.' },
];

function SettingsScreen() {
  const store = useStore();
  const [active, setActive] = useState('statuses');
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Settings · lists</div>
          <h1>Manage lists</h1>
        </div>
        <Segmented value={active}
          options={[
            {value:'statuses',       label:'Statuses'},
            {value:'categories',     label:'Categories'},
            {value:'paymentSources', label:'Sources'},
            {value:'loanTypes',      label:'Loan types'},
            {value:'vestingLLCs',    label:'Vesting LLCs'},
            {value:'propertyTypes',  label:'Property types'},
            {value:'accounts',       label:'Accounts'},
            {value:'team',           label:'Team'},
            {value:'webAccounts',    label:'Web logins'},
            {value:'integration',    label:'Integration'},
          ]}
          onChange={setActive}/>
      </div>

      {active === 'statuses' && <StatusesEditor/>}
      {active === 'accounts' && <AccountsEditor/>}
      {active === 'team' && <TeamEditor/>}
      {active === 'webAccounts' && <WebAccountsEditor/>}
      {active === 'integration' && <IntegrationScreen embedded/>}

      {LIST_DEFS.filter(d => d.key === active).map(def => (
        <ListEditor key={def.key} def={def} showArchived={showArchived} setShowArchived={setShowArchived}/>
      ))}

      {active !== 'integration' && (
        <div className="small dim mt-20" style={{maxWidth: 700, lineHeight: 1.6}}>
          Renaming an item propagates across all your existing transactions, tenants, and properties.
          Archiving hides it from dropdowns without affecting historical data. Default items can be archived but not deleted.
        </div>
      )}

      {active !== 'integration' && (
      <Card className="mt-24">
        <CardHead title="Backup & restore"/>
        <div className="card__body col gap-12">
          <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6}}>
            Download a JSON snapshot of all your data. Useful before risky changes or as a periodic backup.
            Restore overwrites everything — use carefully.
          </div>
          <div className="row gap-8">
            <Btn onClick={downloadBackup}>⤓ Download backup JSON</Btn>
            <Btn kind="ghost" onClick={() => document.getElementById('restore-input').click()}>↥ Restore from file</Btn>
            <input id="restore-input" type="file" accept="application/json" style={{display: 'none'}}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!confirm('Restore will overwrite all current data. Continue?')) { e.target.value = ''; return; }
                try {
                  const text = await file.text();
                  restoreBackup(text);
                  alert('Backup restored.');
                } catch (err) {
                  alert('Failed: ' + err.message);
                }
                e.target.value = '';
              }}/>
          </div>
        </div>
      </Card>
      )}
    </div>
  );
}

function ListEditor({ def, showArchived, setShowArchived }) {
  const store = useStore();
  const items = (store.lists?.[def.key] || [])
    .filter(x => showArchived || !x.archived)
    .slice()
    .sort((a, b) => String(a.label ?? '').localeCompare(String(b.label ?? ''), undefined, { sensitivity: 'base' }));
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState(def.hasKind ? 'expense' : null);

  return (
    <Card>
      <CardHead title={def.title} right={
        <div className="row gap-8 items-center">
          <Tag tone={showArchived ? 'solid-blue' : 'ghost'} style={{cursor:'pointer'}} onClick={() => setShowArchived(v => !v)}>
            <span>{showArchived ? '✓ ' : ''}Show archived</span>
          </Tag>
          <Btn sz="sm" kind="primary" onClick={() => setAdding(true)}>+ Add</Btn>
        </div>
      }/>
      <div className="card__body" style={{padding: '12px 16px 4px 16px'}}>
        <div className="small dim mb-12">{def.sub}</div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            {def.hasKind && <th style={{width: 110}}>Kind</th>}
            <th style={{width: 120}}>Usage</th>
            <th style={{width: 100}}>Default</th>
            <th style={{width: 280}}></th>
          </tr>
        </thead>
        <tbody>
          {adding && (
            <tr style={{background: 'var(--blue-tint)'}}>
              <td>
                <input className="input" autoFocus value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder="New name…" style={{width: '100%'}}/>
              </td>
              {def.hasKind && (
                <td>
                  <select className="select" value={newKind || ''} onChange={e => setNewKind(e.target.value || null)} style={{width: '100%'}}>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                    <option value="">Either</option>
                  </select>
                </td>
              )}
              <td className="dim small">—</td>
              <td className="dim small">No</td>
              <td>
                <div className="row gap-6">
                  <Btn sz="sm" kind="primary" disabled={!newLabel.trim()} onClick={() => {
                    addListItem(def.key, { label: newLabel.trim(), kind: newKind });
                    setNewLabel(''); setNewKind(def.hasKind ? 'expense' : null); setAdding(false);
                  }}>Add</Btn>
                  <Btn sz="sm" kind="ghost" onClick={() => { setNewLabel(''); setAdding(false); }}>Cancel</Btn>
                </div>
              </td>
            </tr>
          )}
          {items.map(item => <ListRow key={item.id} listKey={def.key} item={item} hasKind={def.hasKind}/>)}
        </tbody>
      </table>
    </Card>
  );
}

function ListRow({ listKey, item, hasKind }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const [label, setLabel] = useState(item.label);
  const usage = countUsage(listKey, item.label);

  if (deleting) {
    const targets = (Store.state.lists?.[listKey] || []).filter(x => x.id !== item.id && !x.archived);
    const needsReassign = usage > 0;
    const ready = !needsReassign || reassignTo;
    return (
      <tr style={{background: 'var(--brick-soft)'}}>
        <td colSpan={hasKind ? 5 : 4}>
          <div className="col gap-8" style={{padding: '4px 0'}}>
            <div className="small" style={{lineHeight: 1.5}}>
              {needsReassign
                ? <>Delete <strong>{item.label}</strong> and retag its <strong>{usage}</strong> record{usage === 1 ? '' : 's'} as:</>
                : <>Delete <strong>{item.label}</strong>? Nothing is tagged with it.</>}
            </div>
            <div className="row gap-8 items-center wrap">
              {needsReassign && (
                <select className="select" value={reassignTo} onChange={e => setReassignTo(e.target.value)} style={{minWidth: 220}}>
                  <option value="">— pick a replacement —</option>
                  {targets.map(t => <option key={t.id} value={t.label}>{t.label}</option>)}
                </select>
              )}
              <Btn sz="sm" kind="primary" disabled={!ready}
                onClick={() => { deleteListItem(listKey, item.id, needsReassign ? reassignTo : null); setDeleting(false); }}>
                Delete{needsReassign ? ' & retag' : ''}
              </Btn>
              <Btn sz="sm" kind="ghost" onClick={() => { setDeleting(false); setReassignTo(''); }}>Cancel</Btn>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  if (editing) {
    return (
      <tr style={{background: 'var(--blue-tint)'}}>
        <td>
          <input className="input" autoFocus value={label} onChange={e => setLabel(e.target.value)} style={{width: '100%'}}
            onKeyDown={e => {
              if (e.key === 'Enter' && label.trim() && label !== item.label) { renameListItem(listKey, item.id, label.trim()); setEditing(false); }
              if (e.key === 'Escape') { setLabel(item.label); setEditing(false); }
            }}/>
        </td>
        {hasKind && <td>
          <select className="select" value={item.kind || ''} onChange={e => updateListItemKind(listKey, item.id, e.target.value || null)} style={{width: '100%'}}>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
            <option value="">Either</option>
          </select>
        </td>}
        <td className="small dim">{usage} used</td>
        <td>{item.isDefault ? <Tag tone="ghost">Default</Tag> : <Tag tone="ghost">Custom</Tag>}</td>
        <td>
          <div className="row gap-6">
            <Btn sz="sm" kind="primary"
              disabled={!label.trim() || label === item.label}
              onClick={() => { renameListItem(listKey, item.id, label.trim()); setEditing(false); }}>
              Save
            </Btn>
            <Btn sz="sm" kind="ghost" onClick={() => { setLabel(item.label); setEditing(false); }}>Cancel</Btn>
          </div>
        </td>
      </tr>
    );
  }

  const kindLabel = item.kind === 'income' ? 'Income' : item.kind === 'expense' ? 'Expense' : 'Either';
  const kindTone = item.kind === 'income' ? 'sage' : item.kind === 'expense' ? 'brick' : 'ghost';

  return (
    <tr style={item.archived ? {opacity: 0.5} : null}>
      <td>
        <span className="serif" style={{fontSize: 14, fontWeight: 500, textDecoration: item.archived ? 'line-through' : null}}>{item.label}</span>
      </td>
      {hasKind && <td><Tag tone={kindTone}>{kindLabel}</Tag></td>}
      <td className="small dim">{usage ? `${usage} tagged` : '—'}</td>
      <td>{item.isDefault ? <Tag tone="ghost">Default</Tag> : <Tag tone="blue">Custom</Tag>}</td>
      <td>
        <div className="row gap-6">
          <Btn sz="sm" kind="ghost" onClick={() => setEditing(true)}>Rename</Btn>
          <Btn sz="sm" kind="ghost" onClick={() => {
            if (!item.archived && usage > 0 && !confirm(`"${item.label}" is used on ${usage} records. Archive it anyway? (Historical data keeps the label.)`)) return;
            archiveListItem(listKey, item.id);
          }}>{item.archived ? 'Restore' : 'Archive'}</Btn>
          {!item.isDefault && <Btn sz="sm" kind="ghost" onClick={() => setDeleting(true)}>Delete</Btn>}
        </div>
      </td>
    </tr>
  );
}

const ACCOUNT_KIND_LABEL = { checking: 'Checking', savings: 'Savings', credit: 'Credit card', cash: 'Cash' };

function AccountsEditor() {
  const store = useStore();
  const accounts = store.accounts || [];
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState('checking');

  return (
    <Card>
      <CardHead title="Bank accounts" right={
        <Btn sz="sm" kind="primary" onClick={() => setAdding(true)}>+ Add</Btn>
      }/>
      <div className="card__body" style={{padding: '12px 16px 4px 16px'}}>
        <div className="small dim mb-12">Accounts money flows through. Transactions and bank imports reference these — renaming is safe, deleting one leaves its past transactions tagged with the old account.</div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Label</th>
            <th style={{width: 130}}>Kind</th>
            <th style={{width: 120}}>Transactions</th>
            <th style={{width: 200}}></th>
          </tr>
        </thead>
        <tbody>
          {adding && (
            <tr style={{background: 'var(--blue-tint)'}}>
              <td><input className="input" autoFocus value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Operating — 4821" style={{width: '100%'}}/></td>
              <td>
                <select className="select" value={newKind} onChange={e => setNewKind(e.target.value)} style={{width: '100%'}}>
                  {ACCOUNT_KINDS.map(k => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
                </select>
              </td>
              <td className="dim small">—</td>
              <td>
                <div className="row gap-6">
                  <Btn sz="sm" kind="primary" disabled={!newLabel.trim()} onClick={() => {
                    addAccount(newLabel.trim(), newKind);
                    setNewLabel(''); setNewKind('checking'); setAdding(false);
                  }}>Add</Btn>
                  <Btn sz="sm" kind="ghost" onClick={() => { setNewLabel(''); setAdding(false); }}>Cancel</Btn>
                </div>
              </td>
            </tr>
          )}
          {accounts.map(a => <AccountRow key={a.id} acct={a}/>)}
          {accounts.length === 0 && !adding && (
            <tr><td colSpan="4" className="small dim" style={{padding: '16px'}}>No accounts yet — add your first.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function AccountRow({ acct }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(acct.label);
  const usage = accountUsage(acct.id);

  if (editing) {
    return (
      <tr style={{background: 'var(--blue-tint)'}}>
        <td><input className="input" autoFocus value={label} onChange={e => setLabel(e.target.value)} style={{width: '100%'}}
          onKeyDown={e => { if (e.key === 'Enter' && label.trim()) { updateAccount(acct.id, {label: label.trim()}); setEditing(false); } if (e.key === 'Escape') { setLabel(acct.label); setEditing(false); } }}/></td>
        <td>
          <select className="select" value={acct.kind || 'checking'} onChange={e => updateAccount(acct.id, {kind: e.target.value})} style={{width: '100%'}}>
            {ACCOUNT_KINDS.map(k => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
          </select>
        </td>
        <td className="small dim">{usage} tagged</td>
        <td>
          <div className="row gap-6">
            <Btn sz="sm" kind="primary" disabled={!label.trim()} onClick={() => { updateAccount(acct.id, {label: label.trim()}); setEditing(false); }}>Save</Btn>
            <Btn sz="sm" kind="ghost" onClick={() => { setLabel(acct.label); setEditing(false); }}>Cancel</Btn>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <span className="serif" style={{fontSize: 14, fontWeight: 500}}>{acct.label}</span>
        <span className="mono tiny dim" style={{marginLeft: 8}}>{acct.id}</span>
      </td>
      <td><Tag tone="ghost">{ACCOUNT_KIND_LABEL[acct.kind] || acct.kind || '—'}</Tag></td>
      <td className="small dim">{usage ? `${usage} tagged` : '—'}</td>
      <td>
        <div className="row gap-6">
          <Btn sz="sm" kind="ghost" onClick={() => setEditing(true)}>Rename</Btn>
          <Btn sz="sm" kind="ghost" onClick={() => {
            if (usage > 0 && !confirm(`"${acct.label}" is tagged on ${usage} transaction${usage===1?'':'s'}. Delete it anyway? Those transactions keep the old account ID.`)) return;
            if (usage === 0 && !confirm(`Delete account "${acct.label}"?`)) return;
            deleteAccount(acct.id);
          }}>Delete</Btn>
        </div>
      </td>
    </tr>
  );
}

function TeamEditor() {
  const store = useStore();
  const team = (store.team || []).slice().sort((a, b) => (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' }));
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  return (
    <Card>
      <CardHead title="Team members" right={
        <Btn sz="sm" kind="primary" onClick={() => setAdding(true)}>+ Add</Btn>
      }/>
      <div className="card__body" style={{padding: '12px 16px 4px 16px'}}>
        <div className="small dim mb-12">People a property can be assigned to. Renaming someone updates every property assigned to them.</div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th style={{width: 140}}>Assigned</th>
            <th style={{width: 200}}></th>
          </tr>
        </thead>
        <tbody>
          {adding && (
            <tr style={{background: 'var(--blue-tint)'}}>
              <td><input className="input" autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name…" style={{width: '100%'}}
                onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { addTeamMember(newName.trim()); setNewName(''); setAdding(false); } if (e.key === 'Escape') { setNewName(''); setAdding(false); } }}/></td>
              <td className="dim small">—</td>
              <td>
                <div className="row gap-6">
                  <Btn sz="sm" kind="primary" disabled={!newName.trim()} onClick={() => { addTeamMember(newName.trim()); setNewName(''); setAdding(false); }}>Add</Btn>
                  <Btn sz="sm" kind="ghost" onClick={() => { setNewName(''); setAdding(false); }}>Cancel</Btn>
                </div>
              </td>
            </tr>
          )}
          {team.map(name => <TeamRow key={name} name={name}/>)}
          {team.length === 0 && !adding && (
            <tr><td colSpan="3" className="small dim" style={{padding: '16px'}}>No team members yet — add the first.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function TeamRow({ name }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  const usage = teamUsage(name);

  if (editing) {
    return (
      <tr style={{background: 'var(--blue-tint)'}}>
        <td><input className="input" autoFocus value={val} onChange={e => setVal(e.target.value)} style={{width: '100%'}}
          onKeyDown={e => { if (e.key === 'Enter' && val.trim() && val !== name) { renameTeamMember(name, val.trim()); setEditing(false); } if (e.key === 'Escape') { setVal(name); setEditing(false); } }}/></td>
        <td className="small dim">{usage} propert{usage===1?'y':'ies'}</td>
        <td>
          <div className="row gap-6">
            <Btn sz="sm" kind="primary" disabled={!val.trim() || val === name} onClick={() => { renameTeamMember(name, val.trim()); setEditing(false); }}>Save</Btn>
            <Btn sz="sm" kind="ghost" onClick={() => { setVal(name); setEditing(false); }}>Cancel</Btn>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td><span className="row gap-8 items-center"><Av name={name}/><span className="serif" style={{fontSize: 14, fontWeight: 500}}>{name}</span></span></td>
      <td className="small dim">{usage ? `${usage} propert${usage===1?'y':'ies'}` : '—'}</td>
      <td>
        <div className="row gap-6">
          <Btn sz="sm" kind="ghost" onClick={() => setEditing(true)}>Rename</Btn>
          <Btn sz="sm" kind="ghost" onClick={() => {
            if (usage > 0 && !confirm(`${name} is assigned to ${usage} propert${usage===1?'y':'ies'}. Remove them anyway? Those properties keep the name until reassigned.`)) return;
            if (usage === 0 && !confirm(`Remove ${name} from the team?`)) return;
            removeTeamMember(name);
          }}>Remove</Btn>
        </div>
      </td>
    </tr>
  );
}

// ─── Statuses editor ─────────────────────────────────────────────────────────
const STATUS_LANES = [
  { key:'pipeline', title:'Pipeline stages', sub:'The linear flow shown left-to-right on the Pipeline board.' },
  { key:'rental',   title:'Rental',          sub:'The K-Rental sidecar — powers tenants, leases, and refi.' },
  { key:'archive',  title:'Archive',         sub:'Sold / failed outcomes. Hidden from the board unless “Show archive”.' },
];

function StatusesEditor() {
  const store = useStore();
  const statuses = store.statuses || defaultStatuses();
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  return (
    <Card>
      <CardHead title="Pipeline statuses" right={
        <Btn sz="sm" kind="primary" onClick={() => setAdding(true)}>+ Add stage</Btn>
      }/>
      <div className="card__body" style={{padding: '12px 16px 4px 16px'}}>
        <div className="small dim mb-12" style={{maxWidth: 760, lineHeight: 1.6}}>
          Rename, recolor, reorder, add, or remove the stages a property can be in. Changes appear everywhere instantly.
          <strong> Built-in stages</strong> (marked <Tag tone="ghost">Built-in</Tag>) power specific features — you can rename and recolor them freely, but you’ll be warned before deleting one.
        </div>
      </div>

      {adding && (
        <div className="card__body" style={{padding: '0 16px 12px 16px'}}>
          <div className="row gap-8 items-center" style={{background: 'var(--blue-tint)', padding: 10, borderRadius: 6}}>
            <input className="input" autoFocus value={newLabel} placeholder="New stage name…" style={{flex: '1 1 auto'}}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newLabel.trim()) { addStatus({ label: newLabel.trim() }); setNewLabel(''); setAdding(false); }
                if (e.key === 'Escape') { setNewLabel(''); setAdding(false); }
              }}/>
            <span className="tiny dim">Added to the end of the pipeline · auto-colored</span>
            <Btn sz="sm" kind="primary" disabled={!newLabel.trim()} onClick={() => { addStatus({ label: newLabel.trim() }); setNewLabel(''); setAdding(false); }}>Add</Btn>
            <Btn sz="sm" kind="ghost" onClick={() => { setNewLabel(''); setAdding(false); }}>Cancel</Btn>
          </div>
        </div>
      )}

      {STATUS_LANES.map(lane => {
        const rows = statuses.filter(s => s.lane === lane.key);
        if (!rows.length) return null;
        return (
          <div key={lane.key} style={{marginTop: 4}}>
            <div className="row between items-baseline" style={{padding: '10px 16px 2px 16px'}}>
              <span className="up dim">{lane.title}</span>
              <span className="tiny dim" style={{textTransform: 'none', letterSpacing: 0}}>{lane.sub}</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width: 64}}>Code</th>
                  <th>Name</th>
                  <th style={{width: 220}}>Color</th>
                  <th style={{width: 90}}>Properties</th>
                  <th style={{width: 70}}>Type</th>
                  <th style={{width: 230}}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <StatusRow key={s.code} status={s}
                    canUp={i > 0} canDown={i < rows.length - 1}
                    allStatuses={statuses}/>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </Card>
  );
}

function ToneSwatches({ value, onChange, allowDefault }) {
  return (
    <div className="row gap-4 items-center wrap">
      {allowDefault && (
        <button title="Built-in color" onClick={() => onChange(null)}
          style={{
            width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 11, lineHeight: 1,
            border: '1.5px solid ' + (!value ? 'var(--ink)' : 'var(--rule)'),
            background: 'repeating-linear-gradient(45deg, var(--paper-2), var(--paper-2) 3px, var(--paper-3) 3px, var(--paper-3) 6px)',
            color: 'var(--ink-3)',
          }}>·</button>
      )}
      {STATUS_TONE_KEYS.map(tk => {
        const t = STATUS_TONES[tk];
        const on = value === tk;
        return (
          <button key={tk} title={tk} onClick={() => onChange(tk)}
            style={{
              width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
              background: t.bg, border: '1.5px solid ' + (on ? 'var(--ink)' : t.border),
              boxShadow: on ? '0 0 0 2px var(--paper), 0 0 0 3px var(--ink)' : 'none',
            }}/>
        );
      })}
    </div>
  );
}

function StatusRow({ status, canUp, canDown, allStatuses }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(status.label);
  const [deleting, setDeleting] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const usage = statusUsage(status.code);
  const sysInfo = SYSTEM_STATUS_INFO[status.code];

  // valid reassignment targets: any other status
  const targets = allStatuses.filter(s => s.code !== status.code);

  if (deleting) {
    const needsReassign = usage > 0;
    const ready = !needsReassign || reassignTo;
    return (
      <tr style={{background: 'var(--brick-soft)'}}>
        <td><Pip code={status.code}/></td>
        <td colSpan="5">
          <div className="col gap-8" style={{padding: '4px 0'}}>
            <div className="small" style={{color: 'var(--ink)', lineHeight: 1.5}}>
              {status.system && sysInfo && (
                <div style={{marginBottom: 6, color: 'var(--brick)', fontWeight: 600}}>
                  ⚠ “{status.label}” is a built-in stage — it {sysInfo}. Deleting it may disable that feature.
                </div>
              )}
              {needsReassign
                ? <>Delete <strong>{status.label}</strong> and move its <strong>{usage}</strong> propert{usage===1?'y':'ies'} to:</>
                : <>Delete <strong>{status.label}</strong>? No properties are in this stage.</>}
            </div>
            <div className="row gap-8 items-center">
              {needsReassign && (
                <select className="select" value={reassignTo} onChange={e => setReassignTo(e.target.value)} style={{minWidth: 220}}>
                  <option value="">— pick a stage to move them to —</option>
                  {targets.map(t => <option key={t.code} value={t.code}>{t.code} · {t.label}</option>)}
                </select>
              )}
              <Btn sz="sm" kind="primary" disabled={!ready}
                onClick={() => { deleteStatus(status.code, needsReassign ? reassignTo : null); setDeleting(false); }}>
                Delete stage
              </Btn>
              <Btn sz="sm" kind="ghost" onClick={() => { setDeleting(false); setReassignTo(''); }}>Cancel</Btn>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td><Pip code={status.code}/></td>
      <td>
        {editing ? (
          <input className="input" autoFocus value={label} style={{width: '100%', maxWidth: 320}}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && label.trim()) { updateStatus(status.code, { label: label.trim() }); setEditing(false); }
              if (e.key === 'Escape') { setLabel(status.label); setEditing(false); }
            }}/>
        ) : (
          <span className="serif" style={{fontSize: 14, fontWeight: 500}}>{status.label}</span>
        )}
      </td>
      <td>
        <ToneSwatches value={status.tone} allowDefault={status.system}
          onChange={(tone) => updateStatus(status.code, { tone })}/>
      </td>
      <td className="small dim">{usage ? `${usage}` : '—'}</td>
      <td>{status.system ? <Tag tone="ghost">Built-in</Tag> : <Tag tone="blue">Custom</Tag>}</td>
      <td>
        <div className="row gap-6 items-center">
          <div className="col" style={{gap: 2}}>
            <button className="reorder-btn" disabled={!canUp} title="Move up"
              onClick={() => reorderStatus(status.code, -1)}>▲</button>
            <button className="reorder-btn" disabled={!canDown} title="Move down"
              onClick={() => reorderStatus(status.code, +1)}>▼</button>
          </div>
          {editing
            ? <Btn sz="sm" kind="primary" disabled={!label.trim()} onClick={() => { updateStatus(status.code, { label: label.trim() }); setEditing(false); }}>Save</Btn>
            : <Btn sz="sm" kind="ghost" onClick={() => setEditing(true)}>Rename</Btn>}
          {editing
            ? <Btn sz="sm" kind="ghost" onClick={() => { setLabel(status.label); setEditing(false); }}>Cancel</Btn>
            : <Btn sz="sm" kind="ghost" onClick={() => setDeleting(true)}>Delete</Btn>}
        </div>
      </td>
    </tr>
  );
}

window.SettingsScreen = SettingsScreen;

// ── Web logins (vendor / portal accounts) ──
function WebAccountsEditor() {
  const store = useStore();
  const list = store.webAccounts || [];
  const [q, setQ] = useState('');
  const [reveal, setReveal] = useState({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ org: '', username: '', password: '', email: '', notes: '' });
  const rows = list.filter(w => !q || (w.org + ' ' + w.username + ' ' + w.email).toLowerCase().includes(q.toLowerCase()));

  function save() {
    if (!draft.org.trim()) return;
    Store.update(s => {
      if (!Array.isArray(s.webAccounts)) s.webAccounts = [];
      s.webAccounts.push({ id: 'wa' + Date.now().toString(36), ...draft });
    });
    setDraft({ org: '', username: '', password: '', email: '', notes: '' });
    setAdding(false);
  }
  function remove(id) {
    if (!confirm('Delete this login?')) return;
    Store.update(s => { s.webAccounts = (s.webAccounts || []).filter(w => w.id !== id); });
  }

  return (
    <Card>
      <CardHead title={`Web logins · ${list.length}`} right={
        <div className="row gap-8 items-center">
          <input className="input" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{width: 180}}/>
          <Btn sz="sm" kind="ghost" onClick={() => setAdding(a => !a)}>+ Add</Btn>
        </div>}/>
      <div className="card__body">
        <div className="small dim mb-12">Vendor &amp; portal credentials (Adobe, Amazon, bank &amp; HOA portals…). Imported from your Web Accounts sheet; syncs with the workbook.</div>
        {adding && (
          <div className="grid g-2 mb-12" style={{padding: '12px 14px', background: 'var(--paper-3)', borderRadius: 6, border: '1px solid var(--rule)'}}>
            <div><div className="up dim mb-4">Organization</div><input className="input" value={draft.org} onChange={e => setDraft({...draft, org: e.target.value})} style={{width: '100%'}}/></div>
            <div><div className="up dim mb-4">Username</div><input className="input" value={draft.username} onChange={e => setDraft({...draft, username: e.target.value})} style={{width: '100%'}}/></div>
            <div><div className="up dim mb-4">Password</div><input className="input mono" value={draft.password} onChange={e => setDraft({...draft, password: e.target.value})} style={{width: '100%'}}/></div>
            <div><div className="up dim mb-4">Email</div><input className="input" value={draft.email} onChange={e => setDraft({...draft, email: e.target.value})} style={{width: '100%'}}/></div>
            <div className="row gap-8" style={{gridColumn: 'span 2'}}><div className="grow"/><Btn sz="sm" kind="ghost" onClick={() => setAdding(false)}>Cancel</Btn><Btn sz="sm" kind="primary" disabled={!draft.org.trim()} onClick={save}>Add login</Btn></div>
          </div>
        )}
        {rows.length === 0 ? <Empty icon="🔑" title="No web logins" sub={q ? 'None match your search.' : 'Add one or import from your Web Accounts sheet.'}/> : (
          <table className="tbl">
            <thead><tr><th>Organization</th><th>Username</th><th>Password</th><th>Email</th><th></th></tr></thead>
            <tbody>
              {rows.map(w => (
                <tr key={w.id}>
                  <td style={{fontWeight: 500}}>{w.org}</td>
                  <td className="mono small">{w.username || <span className="dim">—</span>}</td>
                  <td className="mono small">
                    {w.password ? (reveal[w.id]
                      ? <span className="row gap-6 items-center">{w.password} <button onClick={() => setReveal({...reveal, [w.id]: false})} style={{background:'none',border:'none',cursor:'pointer',color:'var(--blue)',font:'inherit',fontSize:11}}>hide</button></span>
                      : <button onClick={() => setReveal({...reveal, [w.id]: true})} style={{background:'none',border:'none',cursor:'pointer',color:'var(--blue)',font:'inherit',fontSize:12}}>•••••• reveal</button>)
                      : <span className="dim">—</span>}
                  </td>
                  <td className="small dim">{w.email || '—'}</td>
                  <td><button onClick={() => remove(w.id)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--brick)',font:'inherit',fontSize:11}}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}