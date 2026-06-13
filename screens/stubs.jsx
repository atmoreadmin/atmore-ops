// screens/stubs.jsx — now only used for the Coming Soon UI as a helper for future screens

function ComingSoon({ title, sub, items }) {
  return (
    <div>
      <div className="section-h">
        <div>
          <div className="crumbs">{title}</div>
          <h1>{title}</h1>
        </div>
      </div>
      <Card>
        <div className="card__body" style={{padding: 40}}>
          <div className="row gap-20 items-start" style={{maxWidth: 800}}>
            <div style={{width: 80, height: 80, background: 'var(--paper-3)', border: '1px solid var(--rule)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'var(--ink-3)', flexShrink: 0}}>🚧</div>
            <div>
              <h2 className="serif" style={{fontSize: 22, margin: 0, fontWeight: 500}}>Coming soon</h2>
              <p style={{color: 'var(--ink-2)', maxWidth: 600, lineHeight: 1.6, marginTop: 8}}>{sub}</p>
              {items && (
                <div className="col gap-6 mt-16">
                  <div className="up dim">Will include</div>
                  {items.map((it, i) => <div key={i} className="small">· {it}</div>)}
                </div>
              )}
              <div className="row gap-8 mt-20">
                <Btn kind="ghost" onClick={() => nav('/dashboard')}>← Back to dashboard</Btn>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

window.ComingSoon = ComingSoon;
