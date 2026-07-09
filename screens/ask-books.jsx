// screens/ask-books.jsx — "Ask the books": query-style search over transactions.
// Two layers:
//   1. Structured engine (always works, incl. on GitHub Pages): parses payee /
//      property / category / date-range keywords out of a freeform question,
//      filters transactions (splits flattened), and shows total + breakdowns.
//   2. AI answer (works where window.claude is available): sends the question to
//      Claude with a query_transactions tool that runs the same engine in-page.

// ── Flatten splits so per-property / per-category math is correct ──
function askFlattenTxs() {
  const out = [];
  (Store.state.transactions || []).forEach(t => {
    if (t.splits && t.splits.length) {
      t.splits.forEach(s => out.push({ ...t, amount: s.amount, category: s.category || t.category, project: s.project || t.project }));
    } else out.push(t);
  });
  return out;
}

// ── Core query engine — shared by the structured UI and the AI tool ──
// filters: { payee, project, category, text, dateFrom, dateTo, direction }
function askRunQuery(filters) {
  const f = filters || {};
  const lc = v => (v || '').toLowerCase();
  const txs = askFlattenTxs().filter(t => {
    if (f.payee    && !lc(t.payee).includes(lc(f.payee)) && !lc(t.desc).includes(lc(f.payee))) return false;
    if (f.project  && !lc(t.project).includes(lc(f.project))) return false;
    if (f.category && !lc(t.category).includes(lc(f.category))) return false;
    if (f.text     && !(lc(t.desc) + ' ' + lc(t.payee) + ' ' + lc(t.category) + ' ' + lc(t.project)).includes(lc(f.text))) return false;
    if (f.dateFrom && (!t.date || t.date < f.dateFrom)) return false;
    if (f.dateTo   && (!t.date || t.date > f.dateTo)) return false;
    if (f.direction === 'out' && !(t.amount < 0)) return false;
    if (f.direction === 'in'  && !(t.amount > 0)) return false;
    return true;
  });
  const sum = a => a.reduce((x, t) => x + t.amount, 0);
  const groupSum = key => {
    const m = {};
    txs.forEach(t => { const k = t[key] || '(untagged)'; m[k] = (m[k] || 0) + t.amount; });
    return Object.entries(m).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  };
  return {
    txs,
    count: txs.length,
    total: sum(txs),
    totalOut: sum(txs.filter(t => t.amount < 0)),
    totalIn: sum(txs.filter(t => t.amount > 0)),
    byProject: groupSum('project'),
    byPayee: groupSum('payee'),
    byCategory: groupSum('category'),
  };
}

// ── Keyword parser for the structured layer ──
const ASK_MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12, jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
function askParseQuestion(q) {
  const lc = q.toLowerCase();
  const txs = askFlattenTxs();
  const uniq = key => [...new Set(txs.map(t => t[key]).filter(Boolean))];
  const found = (list) => {
    // longest match wins so "6131 Coach Hill Ln" beats "Hill"
    let best = null;
    list.forEach(v => {
      const vl = v.toLowerCase();
      // match on whole value or any word ≥4 chars from the value appearing in the query
      const words = vl.split(/[^a-z0-9]+/).filter(w => w.length >= 4);
      if (lc.includes(vl) || words.some(w => lc.includes(w))) {
        if (!best || vl.length > best.toLowerCase().length) best = v;
      }
    });
    return best;
  };
  const filters = {};
  const matched = [];
  const payee = found(uniq('payee'));
  if (payee) { filters.payee = payee; matched.push(['Payee', payee]); }
  const project = found(uniq('project'));
  if (project) { filters.project = project; matched.push(['Property', project]); }
  const category = found(uniq('category'));
  if (category && (!payee || category.toLowerCase() !== payee.toLowerCase())) {
    filters.category = category; matched.push(['Category', category]);
  }
  // Date ranges: "in 2025", "since March", "March 2026", "last month", "this month", "this year"
  const now = Store.state.today || new Date().toISOString().slice(0, 10);
  const y = parseInt(now.slice(0, 4)), m = parseInt(now.slice(5, 7));
  const pad = n => String(n).padStart(2, '0');
  const yearM = lc.match(/\b(20\d\d)\b/);
  const monthM = lc.match(new RegExp('\\b(' + Object.keys(ASK_MONTHS).join('|') + ')\\b'));
  if (lc.includes('this month')) { filters.dateFrom = `${y}-${pad(m)}-01`; matched.push(['Period', 'this month']); }
  else if (lc.includes('last month')) {
    const lm = m === 1 ? 12 : m - 1, ly = m === 1 ? y - 1 : y;
    filters.dateFrom = `${ly}-${pad(lm)}-01`; filters.dateTo = `${ly}-${pad(lm)}-31`;
    matched.push(['Period', 'last month']);
  }
  else if (lc.includes('this year')) { filters.dateFrom = `${y}-01-01`; matched.push(['Period', 'this year']); }
  else if (monthM) {
    const mm = ASK_MONTHS[monthM[1]];
    const yy = yearM ? parseInt(yearM[1]) : y;
    if (lc.includes('since')) { filters.dateFrom = `${yy}-${pad(mm)}-01`; matched.push(['Period', 'since ' + monthM[1] + ' ' + yy]); }
    else { filters.dateFrom = `${yy}-${pad(mm)}-01`; filters.dateTo = `${yy}-${pad(mm)}-31`; matched.push(['Period', monthM[1] + ' ' + yy]); }
  }
  else if (yearM) { filters.dateFrom = yearM[1] + '-01-01'; filters.dateTo = yearM[1] + '-12-31'; matched.push(['Period', yearM[1]]); }
  // Direction hints
  if (/\b(charged|paid|spent|cost|expense|cash out|owe)\b/.test(lc)) filters.direction = 'out';
  else if (/\b(received|collected|income|rent came|deposit)\b/.test(lc)) filters.direction = 'in';
  return { filters, matched };
}

// ── AI layer ──
async function askAI(question) {
  const txs = askFlattenTxs();
  const uniq = key => [...new Set(txs.map(t => t[key]).filter(Boolean))];
  const sys = `You answer questions about a real-estate business's transaction ledger. Today is ${Store.state.today}.
Use the query_transactions tool to get real numbers — never estimate. Amounts: negative = money out (expenses), positive = money in.
Known payees: ${uniq('payee').slice(0, 120).join(', ')}
Known properties: ${uniq('project').slice(0, 80).join(', ')}
Known categories: ${uniq('category').join(', ')}
Match names loosely (the user may misspell). Answer concisely with real figures, formatted as currency. Break down by property or payee when useful.`;
  return await window.claude.complete({
    system: sys,
    messages: [{ role: 'user', content: question }],
    max_tokens: 1500,
    tools: [{
      name: 'query_transactions',
      description: 'Filter the transaction ledger and get totals + breakdowns. All filters optional, case-insensitive substring match.',
      input_schema: {
        type: 'object',
        properties: {
          payee: { type: 'string', description: 'Match payee or description' },
          project: { type: 'string', description: 'Match property address' },
          category: { type: 'string', description: 'Match category' },
          text: { type: 'string', description: 'Free-text match on any field' },
          dateFrom: { type: 'string', description: 'YYYY-MM-DD inclusive' },
          dateTo: { type: 'string', description: 'YYYY-MM-DD inclusive' },
          direction: { type: 'string', enum: ['in', 'out'], description: 'in = money received, out = money spent' },
        },
      },
      run: async (input) => {
        const r = askRunQuery(input);
        return JSON.stringify({
          count: r.count,
          total: Math.round(r.total * 100) / 100,
          totalOut: Math.round(r.totalOut * 100) / 100,
          totalIn: Math.round(r.totalIn * 100) / 100,
          byProperty: r.byProject.slice(0, 30).map(([k, v]) => [k, Math.round(v * 100) / 100]),
          byPayee: r.byPayee.slice(0, 30).map(([k, v]) => [k, Math.round(v * 100) / 100]),
          byCategory: r.byCategory.slice(0, 30).map(([k, v]) => [k, Math.round(v * 100) / 100]),
          sample: r.txs.slice(0, 15).map(t => ({ date: t.date, payee: t.payee, desc: (t.desc || '').slice(0, 60), amount: t.amount, project: t.project, category: t.category })),
        });
      },
    }],
  });
}

function AskBooksCard({ onViewRows }) {
  const [q, setQ] = React.useState('');
  const [result, setResult] = React.useState(null);   // structured result
  const [aiText, setAiText] = React.useState(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiErr, setAiErr] = React.useState(null);
  const hasAI = !!(window.claude && window.claude.complete);

  function runStructured(question) {
    const { filters, matched } = askParseQuestion(question);
    if (!matched.length && !filters.direction) { setResult({ empty: true }); return; }
    setResult({ ...askRunQuery(filters), filters, matched });
  }
  function submit(e) {
    e.preventDefault();
    if (!q.trim()) { setResult(null); setAiText(null); return; }
    setAiText(null); setAiErr(null);
    runStructured(q.trim());
  }
  async function runAI() {
    setAiBusy(true); setAiErr(null); setAiText(null);
    try { setAiText(await askAI(q.trim())); }
    catch (err) { setAiErr(String(err && err.message || err)); }
    setAiBusy(false);
  }

  const Row = ({ label, value }) => (
    <div className="row between items-center" style={{padding: '3px 0'}}>
      <div className="tiny dim">{label}</div>
      <div className="mono tiny">{value}</div>
    </div>
  );

  return (
    <Card>
      <div className="card__head"><span className="card__title">Ask the books</span></div>
      <div className="card__body">
        <form onSubmit={submit} className="row gap-8 items-center wrap">
          <input className="input" style={{flex: '1 1 320px'}} value={q} onChange={e => setQ(e.target.value)}
            placeholder='e.g. "How much has Erasda charged across all properties?"'/>
          <Btn kind="primary" sz="sm" type="submit">Search</Btn>
          {hasAI && <Btn kind="ghost" sz="sm" type="button" disabled={aiBusy || !q.trim()} onClick={runAI}>{aiBusy ? 'Thinking…' : '✦ AI answer'}</Btn>}
        </form>

        {result && result.empty && (
          <div className="tiny dim" style={{marginTop: 10}}>
            Couldn't match a payee, property, category, or period in that question — try including a name that appears in the ledger{hasAI ? ', or use ✦ AI answer' : ''}.
          </div>
        )}

        {result && !result.empty && (
          <div style={{marginTop: 12}}>
            <div className="row gap-8 items-center wrap mb-8">
              {result.matched.map(([k, v]) => <Tag key={k + v} tone="ghost">{k}: {v}</Tag>)}
              {result.filters.direction && <Tag tone="ghost">{result.filters.direction === 'out' ? 'money out' : 'money in'}</Tag>}
              <div className="grow"/>
              <div className="tiny dim">{result.count} transaction{result.count === 1 ? '' : 's'}</div>
            </div>
            <div className="grid g-3">
              <div className="stat">
                <div className="stat__label">Money out</div>
                <div className="stat__value">{fmtMoney(Math.abs(result.totalOut))}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Money in</div>
                <div className="stat__value">{fmtMoney(result.totalIn)}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Net</div>
                <div className="stat__value">{fmtMoney(result.total)}</div>
              </div>
            </div>
            {result.byProject.length > 1 && (
              <div style={{marginTop: 10}}>
                <div className="up dim mb-4">By property</div>
                {result.byProject.slice(0, 8).map(([k, v]) => <Row key={k} label={k} value={fmtMoney(v)}/>)}
                {result.byProject.length > 8 && <div className="tiny dim">+ {result.byProject.length - 8} more…</div>}
              </div>
            )}
            {!result.filters.payee && result.byPayee.length > 1 && (
              <div style={{marginTop: 10}}>
                <div className="up dim mb-4">By payee</div>
                {result.byPayee.slice(0, 8).map(([k, v]) => <Row key={k} label={k} value={fmtMoney(v)}/>)}
                {result.byPayee.length > 8 && <div className="tiny dim">+ {result.byPayee.length - 8} more…</div>}
              </div>
            )}
            {result.count > 0 && onViewRows && (
              <div style={{marginTop: 10}}>
                <Btn kind="ghost" sz="sm" onClick={() => onViewRows(new Set(result.txs.map(t => t.id)))}>View these rows in the table ↓</Btn>
              </div>
            )}
          </div>
        )}

        {aiErr && <div className="tiny" style={{marginTop: 10, color: 'var(--brick)'}}>AI answer failed: {aiErr}</div>}
        {aiText && (
          <div style={{marginTop: 12, padding: '10px 12px', background: 'rgba(42,111,219,0.05)', border: '1px solid var(--rule)', borderRadius: 6, whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 13}}>
            <div className="up dim mb-4">✦ AI answer</div>
            {aiText}
          </div>
        )}
      </div>
    </Card>
  );
}

window.AskBooksCard = AskBooksCard;
