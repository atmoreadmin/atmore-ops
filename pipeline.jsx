// screens/notice.jsx — batch vacate notice generator with print/PDF

function NoticeScreen() {
  const store = useStore();
  const [selected, setSelected] = useState(new Set());
  const [previewing, setPreviewing] = useState(null);

  const month = getCurrentMonth();
  const due = getLedgerForMonth(month).filter(r => r.status === 'vacate-due');

  // Default-select all
  React.useEffect(() => {
    if (selected.size === 0 && due.length > 0) {
      setSelected(new Set(due.map(r => r.id)));
    }
    // eslint-disable-next-line
  }, [due.length]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === due.length) setSelected(new Set());
    else setSelected(new Set(due.map(r => r.id)));
  }
  function printSelected() {
    const rows = due.filter(r => selected.has(r.id));
    openPrintWindow(rows);
  }

  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">Vacate notices</div>
          <h1>{due.length} ready · {selected.size} selected</h1>
        </div>
        <div className="row gap-8">
          <Btn kind="ghost" sz="sm" onClick={toggleAll}>{selected.size === due.length ? 'Deselect all' : 'Select all'}</Btn>
          <Btn kind="primary" disabled={selected.size === 0} onClick={printSelected}>
            🖨 Print / save PDF ({selected.size})
          </Btn>
        </div>
      </div>

      {due.length === 0 ? (
        <Card><div className="card__body"><Empty icon="✓" title="No notices currently due" sub="A notice is auto-flagged once a tenant is past day 11 of the month without payment."/></div></Card>
      ) : (
        <div className="row gap-16 items-start">
          {/* List */}
          <div className="col gap-12 grow" style={{minWidth: 0}}>
            {due.map(r => {
              const t = getTenant(r.tenantId);
              const p = getProperty(r.propertyId);
              const isSel = selected.has(r.id);
              const lateFee = lateFeeFor(r);
              const total = r.charge - r.paid + lateFee;
              return (
                <Card key={r.id} alert={isSel}>
                  <div className="card__body row gap-14 items-start">
                    <input type="checkbox" checked={isSel} onChange={() => toggle(r.id)} style={{marginTop: 6, transform: 'scale(1.2)'}}/>
                    <div className="grow">
                      <div className="row gap-10 items-center">
                        <div className="serif" style={{fontSize: 18, fontWeight: 500}}>{t?.name}</div>
                        <Tag tone="brick">{daysBetween(r.month + '-01', TODAY())} days late</Tag>
                      </div>
                      <div className="addr-sub mt-4">{p?.address}, {p?.city} {p?.state} {p?.zip}</div>
                      <div className="row gap-20 mt-12">
                        <div>
                          <div className="up dim">Rent owed</div>
                          <div className="mono mt-2">{fmtMoney(r.charge - r.paid)}</div>
                        </div>
                        <div>
                          <div className="up dim">+ Late fee (5%)</div>
                          <div className="mono mt-2">{fmtMoney(lateFee)}</div>
                        </div>
                        <div>
                          <div className="up dim">Total due</div>
                          <div className="serif mt-2" style={{fontSize: 18, color: 'var(--brick)', fontWeight: 500}}>{fmtMoney(total)}</div>
                        </div>
                        <div>
                          <div className="up dim">Last payment</div>
                          <div className="small mt-2 mono">{r.paidOn ? fmtDate(r.paidOn, {full: true}) : 'none'}</div>
                        </div>
                      </div>
                    </div>
                    <Btn kind="ghost" sz="sm" onClick={() => setPreviewing(r)}>Preview</Btn>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Template sidebar */}
          <div style={{width: 320, flexShrink: 0}}>
            <Card>
              <CardHead title="Template"/>
              <div className="card__body col gap-10">
                <div className="small" style={{lineHeight: 1.6, color: 'var(--ink-2)'}}>
                  10-day notice to pay or quit, formatted per N.C. Gen. Stat. § 42-3.
                </div>
                <div className="up dim">Variables filled per tenant</div>
                <div className="col gap-4 small">
                  <div>· Tenant name + premises</div>
                  <div>· Charge from ledger</div>
                  <div>· Late fee (5% of rent)</div>
                  <div>· Today's date</div>
                  <div>· Company letterhead</div>
                </div>
                <div className="divider"/>
                <div className="small dim" style={{lineHeight: 1.5}}>The template is hard-coded against N.C. Gen. Stat. § 42-3 for now. To customize copy or layout, edit <span className="mono">screens/notice.jsx</span> · <span className="mono">renderNoticeHtml()</span>.</div>
              </div>
            </Card>

            <Card className="mt-16">
              <CardHead title="What 'Print / save PDF' does"/>
              <div className="card__body small" style={{color: 'var(--ink-2)', lineHeight: 1.6}}>
                Opens a print-ready page with all selected notices, one per page. Use your browser's print dialog (Cmd/Ctrl+P) to save as PDF or print.
              </div>
            </Card>
          </div>
        </div>
      )}

      <div className="small dim mt-20" style={{maxWidth: 660}}>
        Notices are generated from a generic 10-day pay-or-quit template. You should have your attorney review the template for your jurisdiction before relying on it for filings.
      </div>

      {previewing && <NoticePreview ledgerEntry={previewing} onClose={() => setPreviewing(null)}/>}
    </div>
  );
}

function NoticePreview({ ledgerEntry, onClose }) {
  return (
    <Modal title="Notice preview" onClose={onClose}
      right={<Btn sz="sm" kind="primary" onClick={() => openPrintWindow([ledgerEntry])}>🖨 Print</Btn>}>
      <div style={{background: 'white', border: '1px solid var(--rule)', padding: '36px 44px', borderRadius: 6, color: '#1c1a14', fontFamily: 'IBM Plex Sans'}}>
        {renderNoticeHtml(ledgerEntry)}
      </div>
    </Modal>
  );
}

// Shared notice content (renders as JSX in preview, also serialized for print window)
function renderNoticeHtml(r) {
  const t = getTenant(r.tenantId);
  const p = getProperty(r.propertyId);
  const lateFee = lateFeeFor(r);
  const totalDue = r.charge - r.paid + lateFee;
  const today = TODAY();
  return (
    <>
      <div className="row between items-start mb-16">
        <AtmoreLogo size={36}/>
        <div className="small" style={{textAlign:'right', color:'#4a463c'}}>
          Atmore Properties, LLC<br/>
          P.O. Box 12345 · Charlotte, NC 28202<br/>
          704-555-0100
        </div>
      </div>
      <div style={{borderTop: '2px solid #1c1a14', marginBottom: 18}}/>
      <div className="text-c mb-16">
        <div className="serif" style={{fontSize: 20, fontWeight: 600, letterSpacing: '0.04em'}}>10-DAY NOTICE TO PAY RENT OR QUIT</div>
        <div className="small dim" style={{marginTop: 4}}>(In compliance with N.C. Gen. Stat. § 42-3)</div>
      </div>
      <div className="small" style={{lineHeight: 1.7}}>
        <p><strong>To:</strong> {t?.name || '—'}<br/>
        <strong>Premises:</strong> {p?.address}, {p?.city} {p?.state} {p?.zip}<br/>
        <strong>Date:</strong> {fmtDate(today, {full: true})}</p>

        <p>You are hereby notified that you are in default on the payment of rent for the above-described premises. The total amount currently due and owing is:</p>

        <table style={{width: '100%', fontSize: 13, marginTop: 8, marginBottom: 8, borderCollapse: 'collapse'}}>
          <tbody>
            <tr><td style={{padding: '4px 0', borderBottom: '1px dotted #c9c2b5'}}>Rent for {fmtMonthLong(r.month)}</td><td className="text-r mono">{fmtMoney(r.charge)}</td></tr>
            {r.paid > 0 && <tr><td style={{padding: '4px 0', borderBottom: '1px dotted #c9c2b5'}}>Less amount already paid</td><td className="text-r mono" style={{color: '#4d6e42'}}>−{fmtMoney(r.paid)}</td></tr>}
            <tr><td style={{padding: '4px 0', borderBottom: '1px dotted #c9c2b5'}}>Late fee (5% per lease §6.b)</td><td className="text-r mono">{fmtMoney(lateFee)}</td></tr>
            <tr><td style={{padding: '4px 0', fontWeight: 600, borderTop: '1px solid #1c1a14'}}>Total due</td><td className="text-r mono" style={{fontWeight: 600}}>{fmtMoney(totalDue)}</td></tr>
          </tbody>
        </table>

        <p>You are required to pay the above amount in full <strong>within ten (10) days</strong> of receipt of this notice, or to surrender possession of the premises. If you fail to do either, legal proceedings for possession of the premises will be instituted against you.</p>

        <p>Payment may be made via the methods previously used (Zelle, certified check) at the address above. This notice does not waive landlord's right to collect any additional rent, fees, or damages that accrue.</p>

        <div className="row between" style={{marginTop: 32, gap: 24}}>
          <div className="grow"><div style={{borderBottom: '1px solid #1c1a14'}}>&nbsp;</div><div className="tiny dim mt-4">Landlord / authorized agent</div></div>
          <div className="grow"><div style={{borderBottom: '1px solid #1c1a14'}}>&nbsp;</div><div className="tiny dim mt-4">Date</div></div>
        </div>
      </div>
    </>
  );
}

// Opens a new window with all selected notices stitched together for printing
function openPrintWindow(rows) {
  const win = window.open('', '_blank', 'width=850,height=1100');
  if (!win) { alert('Pop-up blocked — please allow pop-ups to print.'); return; }
  const styles = `
    @page { size: letter; margin: 0.75in; }
    body { font-family: 'IBM Plex Sans', system-ui, sans-serif; color: #1c1a14; margin: 0; padding: 0; }
    .notice { padding: 0; page-break-after: always; min-height: 9in; }
    .notice:last-child { page-break-after: auto; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .head-right { text-align: right; font-size: 12px; color: #4a463c; line-height: 1.5; }
    .divider { border-top: 2px solid #1c1a14; margin-bottom: 18px; }
    .title { text-align: center; margin-bottom: 18px; }
    .title h1 { font-family: 'Source Serif 4', Georgia, serif; font-size: 20px; font-weight: 600; letter-spacing: 0.04em; margin: 0; }
    .title .ref { font-size: 11px; color: #8a8473; margin-top: 4px; }
    .body { font-size: 13px; line-height: 1.7; }
    .body p { margin: 10px 0; }
    .charges { width: 100%; margin: 8px 0; border-collapse: collapse; }
    .charges td { padding: 5px 0; border-bottom: 1px dotted #c9c2b5; }
    .charges .total td { border-top: 1px solid #1c1a14; border-bottom: none; font-weight: 600; }
    .charges td.r { text-align: right; font-family: 'IBM Plex Mono', monospace; }
    .charges td.green { color: #4d6e42; }
    .sig { display: flex; gap: 24px; margin-top: 36px; }
    .sig > div { flex: 1; }
    .sig .line { border-bottom: 1px solid #1c1a14; padding-bottom: 2px; }
    .sig .label { font-size: 11px; color: #8a8473; margin-top: 4px; }
    .logo-wrap { display: flex; align-items: center; gap: 10px; }
    .logo-wrap svg { display: block; }
    .logo-wrap .name { font-family: 'Source Serif 4', Georgia, serif; font-weight: 600; font-size: 18px; }
    .logo-wrap .tag { font-size: 9px; letter-spacing: 0.16em; color: #8a8473; }
  `;
  const noticeHtml = (r) => {
    const t = getTenant(r.tenantId);
    const p = getProperty(r.propertyId);
    const lateFee = lateFeeFor(r);
    const totalDue = r.charge - r.paid + lateFee;
    return `
      <div class="notice">
        <div class="head">
          <div class="logo-wrap">
            <svg width="36" height="36" viewBox="0 0 80 80">
              <path d="M40 14 L72 50 L60 50 L40 28 L20 50 L8 50 Z" fill="#34637f"/>
              <rect x="34" y="38" width="12" height="16" fill="#34637f"/>
              <path d="M20 50 L8 62 L20 62 L40 40 Z" fill="#a89c83" opacity=".85"/>
              <path d="M60 50 L72 62 L60 62 L40 40 Z" fill="#a89c83" opacity=".85"/>
            </svg>
            <div>
              <div class="name">Atmore</div>
              <div class="tag">OPERATIONS</div>
            </div>
          </div>
          <div class="head-right">
            Atmore Properties, LLC<br/>
            P.O. Box 12345 · Charlotte, NC 28202<br/>
            704-555-0100
          </div>
        </div>
        <div class="divider"></div>
        <div class="title">
          <h1>10-DAY NOTICE TO PAY RENT OR QUIT</h1>
          <div class="ref">(In compliance with N.C. Gen. Stat. § 42-3)</div>
        </div>
        <div class="body">
          <p><strong>To:</strong> ${esc(t?.name || '—')}<br/>
          <strong>Premises:</strong> ${esc(p?.address || '')}, ${esc(p?.city || '')} ${esc(p?.state || '')} ${esc(p?.zip || '')}<br/>
          <strong>Date:</strong> ${esc(fmtDate(TODAY(), {full: true}))}</p>

          <p>You are hereby notified that you are in default on the payment of rent for the above-described premises. The total amount currently due and owing is:</p>

          <table class="charges">
            <tbody>
              <tr><td>Rent for ${esc(fmtMonthLong(r.month))}</td><td class="r">${esc(fmtMoney(r.charge))}</td></tr>
              ${r.paid > 0 ? `<tr><td>Less amount already paid</td><td class="r green">−${esc(fmtMoney(r.paid))}</td></tr>` : ''}
              <tr><td>Late fee (5% per lease §6.b)</td><td class="r">${esc(fmtMoney(lateFee))}</td></tr>
              <tr class="total"><td>Total due</td><td class="r">${esc(fmtMoney(totalDue))}</td></tr>
            </tbody>
          </table>

          <p>You are required to pay the above amount in full <strong>within ten (10) days</strong> of receipt of this notice, or to surrender possession of the premises. If you fail to do either, legal proceedings for possession of the premises will be instituted against you.</p>

          <p>Payment may be made via the methods previously used (Zelle, certified check) at the address above. This notice does not waive landlord's right to collect any additional rent, fees, or damages that accrue.</p>

          <div class="sig">
            <div><div class="line">&nbsp;</div><div class="label">Landlord / authorized agent</div></div>
            <div><div class="line">&nbsp;</div><div class="label">Date</div></div>
          </div>
        </div>
      </div>
    `;
  };
  const allHtml = rows.map(noticeHtml).join('');
  win.document.write(`<!doctype html><html><head><title>Vacate Notices · ${rows.length}</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap" rel="stylesheet">
    <style>${styles}</style></head><body>${allHtml}<script>setTimeout(() => window.print(), 600);</script></body></html>`);
  win.document.close();
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

window.NoticeScreen = NoticeScreen;
window.openPrintWindow = openPrintWindow;
