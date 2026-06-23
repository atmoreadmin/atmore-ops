// store.jsx — data layer with localStorage persistence
// All mutations go through Store.update(fn) so React re-renders.
// SEED is loaded from seed.js (window.SEED).

const STORAGE_KEY = 'atmore-ops-v1';

// Clean-start worked example — 8115 Tremaine Ct, Unit A. Real HUD-1 figures,
// structured the new way: DD fees and EMD captured explicitly, loan payoff kept
// OUT of profit. Net profit resolves to $33,689.
//   Cost basis = |price| + |fees| − |credits| + rehab + interest = 91,817.19
//   Net proceeds = price − |fees| − |credits| + DD collected = 125,506.16
//   Net profit = 33,688.97  → stored rounded as 33,689
function CLEAN_START_TREMAINE() {
  return {
    id: 'p-tremaine', address: '8115 Tremaine Ct A', type: 'Flip',
    status: 'I - Sold', statusCode: 'I',
    city: 'Charlotte', county: 'Mecklenburg', state: 'NC', zip: 28227,
    assigned: '', loanType: 'LendingHome', lockbox: '',
    ddDate: null, signingDate: '2020-08-28', purchaseDate: '2020-08-28',
    // ── Acquisition (buy side) ──
    purchasePrice: -69000,        // contract price, HUD line 101
    purchaseFees: -4803.12,       // buyer closing costs + HOA proration (line 120 − price)
    purchaseCredits: 0,
    purchaseLoan: -55200,         // new loan, HUD line 202
    acqEarnest: 0,                // no EMD on the purchase
    acqDDFee: -3000,              // DD fee paid (already inside price — informational)
    acqExchangeFunds: 0,
    purchaseFeeItems: [],
    // ── Holding ──
    rehab: 9285.57, rehabFunds: 0, interest: 8728.50,
    // ── Disposition (sell side) ──
    listPrice: null,
    salesDate: '2025-08-18',
    salesPrice: 130000,           // HUD line 401
    salesFees: -5493.84,          // seller closing costs & prorations, net
    salesCredits: 0,
    salesLoanPayoff: -55412.10,   // repaid borrowed funds — NOT a profit cost
    saleDDCollected: 1000,        // DD fee collected from buyer — counts as income
    saleEarnest: 1000,            // buyer EMD (nets through closing — informational)
    saleFeeItems: [],
    buyerDDDate: null,
    // ── Result ──
    grossProfit: 33689,           // net profit (DD collected in, payoff out)
    atmoreLoanPayoff: null, exchangeFunds: 0, interestCredit: null, failedReason: null,
    hoaName: '', hoaWebsite: '', hoaUser: '', hoaPass: '',
    vestingLLC: 'Atmore Properties LLC',
    attorney: '', attorneyContact: '',
    stageHistory: [{ from: null, to: 'I', at: '2020-08-28', note: 'Imported from HUD-1', by: 'import' }],
  };
}

const Store = {
  state: null,
  subs: new Set(),

  load() {
    let saved = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) {}
    if (saved && saved._v === 12) {
      this.state = saved.data;
      // Lazy migration — offers added after v10; seed sample data exactly once
      if (!this.state.offers) this.state.offers = [];
      if (!this.state._offersSeeded) { seedOffers(this.state); this.state._offersSeeded = true; this.save(); }
      if (!Array.isArray(this.state.statuses) || !this.state.statuses.length) { this.state.statuses = defaultStatuses(); this.save(); }
      if (this.state.lists && !this.state.lists.propertyTypes) {
        this.state.lists.propertyTypes = [
          { id:'pt-wholesale', label:'Wholesale',        archived:false, isDefault:true },
          { id:'pt-flip',      label:'Flip',             archived:false, isDefault:true },
          { id:'pt-rental',    label:'Rental',           archived:false, isDefault:true },
          { id:'pt-1031',      label:'1031',             archived:false, isDefault:true },
          { id:'pt-1031-repl', label:'1031 Replacement', archived:false, isDefault:true },
        ];
        this.save();
      }
    } else {
      this.state = JSON.parse(JSON.stringify(window.SEED));
      this.state.uiState = { selectedPropertyId: null, propertyTab: 'summary' };
      // Seed stage history for each property: a single initial entry
      this.state.properties.forEach(p => {
        p.stageHistory = [{
          from: null, to: p.statusCode,
          at: p.purchaseDate || p.signingDate || p.ddDate || this.state.today,
          note: 'Initial stage (imported from spreadsheet)',
          by: 'import',
        }];
      });

      // Seed 1099 / W-9 tracking fields on contractors
      // Names match the real payees derived from your transaction data
      const PRESET = {
        'Erasto':       { entityType: 'sole_prop', w9OnFile: true, w9Date: '2025-01-08', tin: '***-**-5821', issued2025: true },
        'Elmer':        { entityType: 'llc',       w9OnFile: true, w9Date: '2024-11-20', tin: '**-***6612', issued2025: true },
        'Abraham':      { entityType: 'sole_prop', w9OnFile: false, w9Date: null,        tin: null },
        'Juventino':    { entityType: 'sole_prop', w9OnFile: false, w9Date: null,        tin: null },
        'TNT Staging':  { entityType: 'scorp',     w9OnFile: true, w9Date: '2024-08-15', tin: '**-***9001' },
        'Oscar Perez':  { entityType: 'sole_prop', w9OnFile: true, w9Date: '2025-02-14', tin: '***-**-3201' },
        'Amancio':      { entityType: 'sole_prop', w9OnFile: false, w9Date: null,        tin: null },
        'Walter':       { entityType: 'unknown',   w9OnFile: false, w9Date: null,        tin: null },
        'Jose Lopez':   { entityType: 'llc',       w9OnFile: true, w9Date: '2025-03-02', tin: '**-***1180' },
        'Wilber':       { entityType: 'sole_prop', w9OnFile: false, w9Date: null,        tin: null },
      };
      this.state.contractors.forEach(c => {
        const preset = PRESET[c.name] || {};
        c.entityType = preset.entityType || 'unknown';
        c.w9OnFile = !!preset.w9OnFile;
        c.w9Date = preset.w9Date || null;
        c.tin = preset.tin || '';
        c.mailingAddress = '';
        c.isAttorney = !!preset.isAttorney;
        c.paidByCardOnly = false;
        c.ten99History = preset.issued2025
          ? [{ taxYear: 2025, status: 'issued', issuedDate: '2026-01-22', amountReported: c.ytd }]
          : [];
      });

      // Phase 3 — property schema additions
      const LLCS = ['Atmore Properties LLC', 'Atmore Rentals LLC', 'Atmore 1031 Holdings LLC', 'Atmore Flip Holdings LLC'];
      const CARRIERS = ['State Farm', 'Allstate', 'Travelers', 'NREIG', 'American Modern'];
      this.state.properties.forEach((p, i) => {
        // Coerce numeric type cells back to strings (SheetJS gave us 1031 as a number)
        if (typeof p.type === 'number') p.type = String(p.type);
        const typeStr = String(p.type || '');
        // Vesting LLC — different LLC by property type
        p.vestingLLC = typeStr === 'Rental' || p.statusCode === 'K' ? 'Atmore Rentals LLC'
          : typeStr.includes('1031') ? 'Atmore 1031 Holdings LLC'
          : typeStr === 'Flip' ? 'Atmore Flip Holdings LLC'
          : 'Atmore Properties LLC';
        p.driveUrl = '';
        // Insurance — only for properties we own (past purchase)
        const owned = ['C','D','E','F','G','H','K'].includes(p.statusCode);
        if (owned) {
          const carrierIdx = (i + parseInt(p.id.slice(1))) % CARRIERS.length;
          // Renewal dates spread across the year
          const renewMonth = ((i * 31 + 7) % 12) + 1;
          const renewDay   = ((i * 17 + 3) % 28) + 1;
          p.insurance = {
            carrier: CARRIERS[carrierIdx],
            policyNumber: 'POL-' + (2024 + (i%3)) + '-' + (1000 + i*7),
            premium: 850 + ((i * 91) % 1100),
            renewalDate: `2026-${String(renewMonth).padStart(2,'0')}-${String(renewDay).padStart(2,'0')}`,
            agentName: 'Insurance agent',
            agentPhone: '704-555-0' + (200 + (i%80)),
          };
          // Make a few renewals urgent for demo
          if (i % 11 === 0) p.insurance.renewalDate = '2026-06-14';
          if (i % 13 === 5) p.insurance.renewalDate = '2026-06-05';
        } else {
          p.insurance = null;
        }
        // Loan detail — if there's a purchase loan
        if (p.purchaseLoan && owned) {
          const monthlyRate = 0.0775 / 12;
          const balance = Math.abs(p.purchaseLoan);
          p.loanDetail = {
            loanNumber: (p.loanType || 'LN') + '-' + (2024 + (i%3)) + '-' + (3000 + i*5),
            lender: p.loanType || 'LendingHome',
            monthlyPayment: Math.round(balance * monthlyRate * 100) / 100,
            currentBalance: balance,
            maturityDate: p.purchaseDate ? addMonthsISO(p.purchaseDate, 12) : null,
            escrowedTaxes: false,
            escrowedInsurance: false,
            interestRate: 7.75,
            lenderContact: '',
          };
        } else {
          p.loanDetail = null;
        }
        // Property tax — estimate as 1.1% of purchase price
        if (p.purchasePrice && owned) {
          const annual = Math.round(Math.abs(p.purchasePrice) * 0.011);
          p.taxes = {
            annualAmount: annual,
            dueDate: '2026-09-01',  // Mecklenburg uses Sep 1
            escrowed: false,
            taxId: '055-' + (100 + i*3) + '-' + ((i * 47) % 1000),
          };
        } else {
          p.taxes = null;
        }
      });

      // Leads / showings log — a few for properties on the market
      this.state.leads = [];
      const onMarket = this.state.properties.filter(p => ['F','E'].includes(p.statusCode));
      const LEAD_SAMPLES = [
        { name: 'Sarah Mitchell', phone: '704-555-0412', source: 'Zillow',      status: 'showing-scheduled', notes: 'Wants Saturday 2pm. Family of 4.' },
        { name: 'Marcus Johnson', phone: '980-555-0398', source: 'Realtor.com', status: 'showing-done',      notes: 'Came in too low. $10k below ask.' },
        { name: 'Priya Patel',    phone: '704-555-0277', source: 'Drive-by',    status: 'application-pending', notes: 'Strong app, references back tomorrow.' },
        { name: 'Tony Esposito',  phone: '980-555-0188', source: 'Facebook',    status: 'lost',              notes: 'Picked another property in Pineville.' },
        { name: 'Tasha Robinson', phone: '704-555-0556', source: 'Referral',    status: 'new',               notes: 'Friend of current tenant. Calling Mon.' },
      ];
      onMarket.slice(0, 4).forEach((p, i) => {
        const lead = LEAD_SAMPLES[i % LEAD_SAMPLES.length];
        const lead2 = LEAD_SAMPLES[(i + 2) % LEAD_SAMPLES.length];
        this.state.leads.push({
          id: 'ld' + (i*2+1), propertyId: p.id,
          date: '2026-05-' + (15 + i),
          ...lead,
        });
        if (i % 2 === 0) this.state.leads.push({
          id: 'ld' + (i*2+2), propertyId: p.id,
          date: '2026-05-' + (10 + i),
          ...lead2,
        });
      });

      // Managed lists
      this.state.lists = {
        categories: [
          { id:'c-rental-income',     label:'Rental Income',     kind:'income',  archived:false, isDefault:true },
          { id:'c-refi-cashout',      label:'Refi Cash-Out',      kind:'income',  archived:false, isDefault:true },
          { id:'c-contractor',        label:'Contractor Payment', kind:'expense', archived:false, isDefault:true },
          { id:'c-supplies',          label:'Job Supplies',       kind:'expense', archived:false, isDefault:true },
          { id:'c-interest',          label:'Interest Payment',   kind:'expense', archived:false, isDefault:true },
          { id:'c-loan',              label:'Loan Repayment',     kind:'expense', archived:false, isDefault:true },
          { id:'c-hoa',               label:'HOA Expense',        kind:'expense', archived:false, isDefault:true },
          { id:'c-utilities',         label:'Utilities',          kind:'expense', archived:false, isDefault:true },
          { id:'c-subscription',      label:'Subscription',       kind:'expense', archived:false, isDefault:true },
          { id:'c-marketing',         label:'Marketing',          kind:'expense', archived:false, isDefault:true },
          { id:'c-insurance',         label:'Insurance',          kind:'expense', archived:false, isDefault:true },
          { id:'c-property-tax',      label:'Property Tax',       kind:'expense', archived:false, isDefault:true },
          { id:'c-misc',              label:'Misc',               kind:null,      archived:false, isDefault:true },
        ],
        paymentSources: [
          { id:'ps-zelle',        label:'Zelle',         archived:false, isDefault:true },
          { id:'ps-turbotenant',  label:'TurboTenant',   archived:false, isDefault:true },
          { id:'ps-section8',     label:'Section 8',     archived:false, isDefault:true },
          { id:'ps-cash-check',   label:'Cash/Check',    archived:false, isDefault:true },
          { id:'ps-other',        label:'Other',         archived:false, isDefault:true },
        ],
        loanTypes: [
          { id:'lt-lendinghome', label:'LendingHome',   archived:false, isDefault:true },
          { id:'lt-kiavi',       label:'Kiavi',         archived:false, isDefault:true },
          { id:'lt-lima-one',    label:'Lima One',      archived:false, isDefault:true },
          { id:'lt-cmg',         label:'CMG Financial', archived:false, isDefault:true },
          { id:'lt-sba',         label:'SBA',           archived:false, isDefault:true },
          { id:'lt-wholesale',   label:'Wholesale',     archived:false, isDefault:true },
          { id:'lt-cash',        label:'Cash',          archived:false, isDefault:true },
        ],
        vestingLLCs: [
          { id:'vl-properties',   label:'Atmore Properties LLC',     archived:false, isDefault:true },
          { id:'vl-rentals',      label:'Atmore Rentals LLC',        archived:false, isDefault:true },
          { id:'vl-1031',         label:'Atmore 1031 Holdings LLC',  archived:false, isDefault:true },
          { id:'vl-flip',         label:'Atmore Flip Holdings LLC',  archived:false, isDefault:true },
        ],
        propertyTypes: [
          { id:'pt-wholesale', label:'Wholesale',        archived:false, isDefault:true },
          { id:'pt-flip',      label:'Flip',             archived:false, isDefault:true },
          { id:'pt-rental',    label:'Rental',           archived:false, isDefault:true },
          { id:'pt-1031',      label:'1031',             archived:false, isDefault:true },
          { id:'pt-1031-repl', label:'1031 Replacement', archived:false, isDefault:true },
        ],
      };

      // Initialize rent history for active tenants (one entry at move-in)
      this.state.tenants.forEach(t => {
        if (t.rent > 0 && t.moveIn) {
          t.rentHistory = [{ effectiveDate: t.moveIn, amount: t.rent, note: 'Initial lease rate' }];
        } else {
          t.rentHistory = [];
        }
      });

      // Seed Refis on a few K-Rentals
      const kProps = this.state.properties.filter(p => p.statusCode === 'K');
      this.state.refis = [];
      if (kProps[0]) this.state.refis.push({
        id:'rf1', propertyId: kProps[0].id, status: 'closing',
        lender: 'CMG Financial', applicationDate: '2026-04-15',
        appraisalDate: '2026-04-29', appraisedValue: 268000,
        newLoanAmount: 201000, interestRate: 7.45, cashOut: 41800,
        targetClose: '2026-06-02', actualClose: null,
        notes: 'Cash-out for next acquisition.',
      });
      if (kProps[1]) this.state.refis.push({
        id:'rf2', propertyId: kProps[1].id, status: 'appraisalDone',
        lender: 'Kiavi', applicationDate: '2026-05-02',
        appraisalDate: '2026-05-18', appraisedValue: 245000,
        newLoanAmount: 183750, interestRate: 7.65, cashOut: 32400,
        targetClose: '2026-06-18', actualClose: null,
        notes: '',
      });
      if (kProps[2]) this.state.refis.push({
        id:'rf3', propertyId: kProps[2].id, status: 'appraisalScheduled',
        lender: 'Lima One', applicationDate: '2026-05-12',
        appraisalDate: '2026-05-31', appraisedValue: null,
        newLoanAmount: null, interestRate: null, cashOut: null,
        targetClose: '2026-06-24', actualClose: null,
        notes: '',
      });
      if (kProps[3]) this.state.refis.push({
        id:'rf4', propertyId: kProps[3].id, status: 'applied',
        lender: 'CMG Financial', applicationDate: '2026-05-20',
        appraisalDate: null, appraisedValue: null,
        newLoanAmount: null, interestRate: null, cashOut: null,
        targetClose: '2026-07-10', actualClose: null,
        notes: 'Waiting on insurance docs.',
      });

      // Seed 1031 exchanges using H-Pending properties as candidates
      const hProps = this.state.properties.filter(p => p.statusCode === 'H' || p.type === '1031 Replacement' || p.type === '1031');
      const eProps = this.state.properties.filter(p => p.type === '1031 Replacement' || p.type === '1031');
      this.state.exchanges = [
        {
          id: 'ex1',
          relinquishedAddress: '6407 Windsor Gate Ln',
          relinquishedCity: 'Charlotte, NC',
          relinquishedSoldDate: '2026-04-14',
          relinquishedSalePrice: 179900,
          relinquishedClosingCosts: 10770,
          qiFee: 1150,
          exchangeFunds: 167980,
          fundsDeployed: 0,
          qi: '1031 Exchange Place',
          qiContact: 'maria@1031xchplace.example',
          status: 'active',
          identifiedPropIds: eProps.slice(0,2).map(p => p.id),
          closedPropIds: [],
          notes: 'Two replacements identified. Need one more by 45-day to use 3-property rule.',
        },
        {
          id: 'ex2',
          relinquishedAddress: '1612 Sharon Rd W #67',
          relinquishedCity: 'Charlotte, NC',
          relinquishedSoldDate: '2026-03-22',
          relinquishedSalePrice: 195000,
          relinquishedClosingCosts: 11680,
          qiFee: 1200,
          exchangeFunds: 182120,
          fundsDeployed: 61500,
          draws: [
            { propId: eProps.slice(2,3).map(p => p.id)[0], amount: 61500, date: '2026-04-30', note: 'closed — balance from new loan' },
          ],
          qi: '1031 Exchange Place',
          qiContact: 'maria@1031xchplace.example',
          status: 'active',
          identifiedPropIds: eProps.slice(2,4).map(p => p.id),
          closedPropIds: eProps.slice(2,3).map(p => p.id),
          notes: 'One replacement closed (6131 Coach Hill). Second under contract.',
        },
        {
          id: 'ex3',
          relinquishedAddress: '2914 Sandgate Dr',
          relinquishedCity: 'Charlotte, NC',
          relinquishedSoldDate: '2025-11-08',
          relinquishedSalePrice: 220000,
          relinquishedClosingCosts: 13140,
          qiFee: 1100,
          exchangeFunds: 205760,
          fundsDeployed: 205760,
          qi: '1031 Exchange Place',
          qiContact: 'maria@1031xchplace.example',
          status: 'closed',
          identifiedPropIds: [],
          closedPropIds: [],
          notes: 'Successfully completed.',
        },
      ];

      seedOffers(this.state);
      this.state._offersSeeded = true;
      this.state.statuses = defaultStatuses();

      // ── CLEAN START (v11) ─────────────────────────────────────────────
      // Per request: wipe all imported demo deals and start fresh. Tremaine Ct
      // is seeded as the one fully-worked example using its real HUD numbers,
      // structured the new way (DD fees + EMD captured, loan payoff kept out
      // of profit). Roll out the rest by entering each deal through the app.
      this.state.properties = [ CLEAN_START_TREMAINE() ];
      this.state.tenants = [];
      this.state.transactions = [];
      this.state.offers = [];
      this.state.leads = [];
      this.state.rentLedger = [];
      this.state.refis = [];
      this.state.exchanges = [];
      this.state.hoas = [];
      this.state.contractors = [];
      this.state.uiState = { selectedPropertyId: null, propertyTab: 'summary' };

      // A clean start is locally authoritative. Pause auto-sync so the stale
      // Google Sheet (old deals, missing the new columns) can't overwrite this
      // fresh data. The user re-enables sync after running migrate() + pushing.
      try {
        const SK = 'atmore-sync-config-v1';
        const cfg = JSON.parse(localStorage.getItem(SK) || '{}');
        if (cfg && cfg.url) { cfg.autoSync = false; localStorage.setItem(SK, JSON.stringify(cfg)); }
      } catch (e) {}

      this.save();
    }

    // Advance the app clock forward to the real current date (never backward), so rent
    // posts, deadlines, and the rent roll reflect the present rather than a frozen seed date.
    try {
      const realToday = new Date().toISOString().slice(0, 10);
      if (this.state.today && realToday > this.state.today) {
        this.state.today = realToday;
        this.save();
      }
    } catch (e) {}

    // Ensure newer top-level collections exist on older saved states.
    if (!Array.isArray(this.state.webAccounts)) { this.state.webAccounts = []; this.save(); }
    if (!Array.isArray(this.state.maintenance)) { this.state.maintenance = []; this.save(); }
    if (!Array.isArray(this.state.reminders)) {
      // First run with reminders: pre-load a recurring quarterly inspection for each
      // active rental so the cadence is set up out of the box. Due dates are staggered.
      const rentals = (this.state.properties || []).filter(p => p.statusCode === 'K' || p.statusCode === 'D');
      const base = this.state.today || '2026-01-01';
      this.state.reminders = rentals.map((p, i) => ({
        id: 'rm' + (i + 1),
        propertyId: p.id,
        title: 'Quarterly inspection',
        dueDate: addMonthsISO(base, 1) ? new Date(new Date(base + 'T12:00:00').getTime() + (i % 12) * 7 * 86400000).toISOString().slice(0, 10) : base,
        recurrence: 'quarterly',
        lastDone: null,
        done: false,
        notes: 'Walk the unit, photograph condition, check smoke/CO detectors and HVAC filter.',
      }));
      this.save();
    }

    // Backfill task fields added after reminders shipped (priority + checklist), so
    // every task carries a consistent shape. Idempotent: only writes if something's missing.
    if (Array.isArray(this.state.reminders)) {
      let touched = false;
      this.state.reminders.forEach(r => {
        if (r.priority == null) { r.priority = 'normal'; touched = true; }
        if (!Array.isArray(r.checklist)) { r.checklist = []; touched = true; }
      });
      if (touched) this.save();
    }

    // several charges for the same tenant+month, plus a mix of "2026-01" and
    // "2026-01-01" month formats that the dedup logic couldn't see as equal — so the
    // same charge rendered over and over on the property ledger. Normalize months to
    // YYYY-MM and collapse to one row per tenant+month, keeping the most settled row
    // (paid / linked wins). Idempotent: a clean ledger is left untouched (no re-save).
    if (dedupeRentLedger(this.state)) this.save();
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ _v:12, data: this.state }));
    } catch (e) { console.warn('persist failed', e); }
  },

  notify() {
    this.subs.forEach(fn => fn());
  },

  update(mutator) {
    mutator(this.state);
    this.save();
    this.notify();
  },

  reset() {
    localStorage.removeItem(STORAGE_KEY);
    this.load();
    this.notify();
  },

  blank() {
    // Start with an empty workspace — keep the schema-required shapes, no real data
    const seed = JSON.parse(JSON.stringify(window.SEED));
    this.state = {
      _v: 6,
      today: seed.today,
      properties: [],
      tenants: [],
      rentLedger: [],
      transactions: [],
      hoas: [],
      contractors: [],
      refis: [],
      exchanges: [],
      leads: [],
      offers: [],
      _offersSeeded: true,
      statuses: defaultStatuses(),
      completedEvents: {},       // calendar events marked done (keyed)
      accounts: seed.accounts,   // keep account list, it's structural
      team: seed.team,           // keep team list
      lists: {                   // keep the managed lists w/ defaults
        categories: [
          { id:'c-rental-income', label:'Rental Income', kind:'income', archived:false, isDefault:true },
          { id:'c-contractor',    label:'Contractor Payment', kind:'expense', archived:false, isDefault:true },
          { id:'c-supplies',      label:'Job Supplies',   kind:'expense', archived:false, isDefault:true },
          { id:'c-interest',      label:'Interest Payment', kind:'expense', archived:false, isDefault:true },
          { id:'c-hoa',           label:'HOA Expense',    kind:'expense', archived:false, isDefault:true },
          { id:'c-utilities',     label:'Utilities',      kind:'expense', archived:false, isDefault:true },
          { id:'c-insurance',     label:'Insurance',      kind:'expense', archived:false, isDefault:true },
          { id:'c-property-tax',  label:'Property Tax',   kind:'expense', archived:false, isDefault:true },
          { id:'c-misc',          label:'Misc',           kind:null,      archived:false, isDefault:true },
        ],
        paymentSources: [
          { id:'ps-zelle',       label:'Zelle',       archived:false, isDefault:true },
          { id:'ps-turbotenant', label:'TurboTenant', archived:false, isDefault:true },
          { id:'ps-section8',    label:'Section 8',   archived:false, isDefault:true },
          { id:'ps-cash-check',  label:'Cash/Check',  archived:false, isDefault:true },
        ],
        loanTypes: [
          { id:'lt-lendinghome', label:'LendingHome', archived:false, isDefault:true },
          { id:'lt-cash',        label:'Cash',        archived:false, isDefault:true },
        ],
        propertyTypes: [
          { id:'pt-wholesale', label:'Wholesale',        archived:false, isDefault:true },
          { id:'pt-flip',      label:'Flip',             archived:false, isDefault:true },
          { id:'pt-rental',    label:'Rental',           archived:false, isDefault:true },
          { id:'pt-1031',      label:'1031',             archived:false, isDefault:true },
          { id:'pt-1031-repl', label:'1031 Replacement', archived:false, isDefault:true },
        ],
      },
      uiState: { selectedPropertyId: null, propertyTab: 'summary' },
    };
    this.save();
    this.notify();
  },
};

Store.load();

function useStore() {
  const [, setN] = React.useState(0);
  React.useEffect(() => {
    const fn = () => setN(n => n + 1);
    Store.subs.add(fn);
    return () => Store.subs.delete(fn);
  }, []);
  return Store.state;
}

// ────────── Selectors / helpers ──────────

const TODAY = () => Store.state?.today || '2026-05-27';

function getProperty(id) {
  return Store.state.properties.find(p => p.id === id);
}
function getPropertyByAddr(addr) {
  if (!addr) return null;
  const a = addr.toLowerCase().trim();
  return Store.state.properties.find(p => p.address.toLowerCase().trim() === a)
    || Store.state.properties.find(p => p.address.toLowerCase().includes(a.split(',')[0]));
}
function getTenant(id) { return Store.state.tenants.find(t => t.id === id); }
function getTenantsForProperty(propId) {
  return Store.state.tenants.filter(t => t.propertyId === propId);
}
function getActiveTenants() {
  return Store.state.tenants.filter(t => t.status === 'active' && t.rent > 0);
}
function getLedgerForMonth(month) {
  return Store.state.rentLedger.filter(r => r.month === month);
}
// Materialize missing rent charges for a month so active tenants always appear on
// the rent roll (e.g. after a fresh start, a new tenant, or the month rolling over).
// Idempotent: only writes when something is actually missing, so it's safe to call on render.
function ensureLedgerForMonth(month) {
  const s = Store.state;
  if (!month) return;
  const active = (s.tenants || []).filter(t => t.status === 'active' && (t.rent || 0) > 0);
  const have = new Set((s.rentLedger || []).filter(r => r.month === month).map(r => r.tenantId));
  const missing = active.filter(t => {
    if (have.has(t.id)) return false;
    if (t.moveIn && t.moveIn.slice(0, 7) > month) return false;       // not moved in yet
    // Stop charging only once a tenant has ACTUALLY moved out. Key off moveOut
    // (set by moveOutTenant when the lease is retired), NOT leaseEnd: a tenant
    // who is still status:'active' past their lease-end date is a holdover /
    // month-to-month renter and continues to owe rent. Using leaseEnd here
    // silently dropped month-to-month tenants from the rent roll.
    if (t.moveOut && t.moveOut.slice(0, 7) < month) return false;     // moved out before this month
    return true;
  });
  // Heal: a tenant who moved in during this very month shouldn't read as "vacate-due"/"late"
  // on a still-unpaid charge — that's an artifact, not a real notice. Downgrade to "Due".
  const toHeal = (s.rentLedger || []).filter(r =>
    r.month === month && (r.paid || 0) === 0 && (r.status === 'vacate-due' || r.status === 'late') &&
    (() => { const t = (s.tenants || []).find(x => x.id === r.tenantId); return t && t.moveIn && t.moveIn.slice(0, 7) === month; })()
  );
  if (missing.length === 0 && toHeal.length === 0) return;
  Store.update(st => {
    let lid = (st.rentLedger.reduce((a, r) => Math.max(a, parseInt(r.id.slice(1)) || 0), 0)) + 1;
    const curMonth = st.today.slice(0, 7);
    st.rentLedger.forEach(r => {
      if (toHeal.some(h => h.id === r.id)) r.status = 'upcoming';
    });
    missing.forEach(t => {
      // Freshly auto-posted charges read as "Due" for the current/future month; only
      // genuinely past months post as Late. (Avoids falsely flagging a new tenant.)
      const status = month < curMonth ? 'late' : 'upcoming';
      st.rentLedger.push({
        id: 'r' + (lid++), tenantId: t.id, propertyId: t.propertyId,
        month, charge: t.rent, paid: 0, paidOn: null,
        source: t.source, status, linkedTxId: null,
      });
    });
  });
}
function getLedgerForTenant(tenantId) {
  // Defensive dedupe at read time: collapse any rows that share a month (normalized to
  // YYYY-MM) so a tenant's ledger never shows the same charge twice, even if the stored
  // data re-bloats from a Sheet pull before the load-time migration re-runs.
  const rows = Store.state.rentLedger.filter(r => r.tenantId === tenantId);
  const byMonth = new Map();
  for (const r of rows) {
    const month = (r.month || '').slice(0, 7);
    const cur = byMonth.get(month);
    if (!cur || (r.paid || 0) > (cur.paid || 0)) byMonth.set(month, r);
  }
  return [...byMonth.values()].sort((a, b) => (a.month || '').localeCompare(b.month || ''));
}

// Collapse duplicate rent-ledger rows in place. Normalizes every month to YYYY-MM and
// keeps a single row per tenant+month, merging so paid/linked data survives. Returns
// true if anything changed (so callers can decide whether to persist).
function dedupeRentLedger(state) {
  const led = state && state.rentLedger;
  if (!Array.isArray(led) || led.length === 0) return false;
  const byKey = new Map();
  let changed = false;
  for (const r of led) {
    const month = (r.month || '').slice(0, 7);
    if (r.month !== month) { r.month = month; changed = true; }
    const key = r.tenantId + '|' + month;
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, r); continue; }
    changed = true;
    // Merge the duplicate into the row we keep; prefer the one carrying a real payment.
    const keep = (cur.paid || 0) >= (r.paid || 0) ? cur : r;
    keep.paid = Math.max(cur.paid || 0, r.paid || 0);
    keep.linkedTxId = cur.linkedTxId || r.linkedTxId || null;
    keep.paidOn = cur.paidOn || r.paidOn || null;
    keep.lateFeeWaived = cur.lateFeeWaived || r.lateFeeWaived || false;
    if ((keep.paid || 0) > 0 && keep.status !== 'paid' && keep.status !== 'partial') {
      keep.status = keep.paid >= keep.charge ? 'paid' : 'partial';
    }
    byKey.set(key, keep);
  }
  if (byKey.size !== led.length) changed = true;
  if (changed) state.rentLedger = [...byKey.values()];
  return changed;
}
function getTxForProperty(propId) {
  const prop = getProperty(propId);
  if (!prop) return [];
  const addrLower = prop.address.toLowerCase();
  const addrShort = addrLower.split(',')[0].replace(/\s*#\w+\s*$/,'').trim();
  return Store.state.transactions.filter(t => {
    if (!t.project) return false;
    const pl = t.project.toLowerCase().trim();
    return pl === addrLower || pl.includes(addrShort) || addrLower.includes(pl);
  });
}
function untaggedTransactions() {
  return Store.state.transactions.filter(t => !t.category || !t.project);
}
function getCurrentMonth() { return TODAY().slice(0,7); }

// ────────── Checks & balances (reconciliation + data integrity) ──────────
// Categories that represent rehab spend (matches contractor + supplies tagging).
const REHAB_CATS = ['Contractor Payment', 'Job Supplies'];
// Non-property "project" buckets a transaction can be tagged to (overhead that
// isn't tied to a specific address). Valid everywhere a property tag is, but
// never treated as a real property (so they don't show on the Properties tab
// or get flagged as orphaned transactions).
const OVERHEAD_PROJECTS = ['Office', 'Rentals (general)'];
const ARCHIVED_CODES = ['I', 'J'];
function isArchived(p) { return ARCHIVED_CODES.includes(p.statusCode); }

// Sum of expense transactions (incl. splits) tagged to a property's address
// whose category counts as rehab spend. Returns a positive dollar figure.
function taggedRehabForProperty(p) {
  const addr = (p.address || '').toLowerCase().trim();
  if (!addr) return 0;
  let total = 0;
  for (const t of Store.state.transactions) {
    if (t.splits && t.splits.length) {
      for (const sp of t.splits) {
        if ((sp.project || '').toLowerCase().trim() === addr && REHAB_CATS.includes(sp.category)) {
          total += Math.abs(sp.amount || 0);
        }
      }
    } else if ((t.project || '').toLowerCase().trim() === addr && REHAB_CATS.includes(t.category)) {
      total += Math.abs(t.amount || 0);
    }
  }
  return Math.round(total);
}

// Cross-screen "review the flagged items" handoff. An integrity row stashes its
// problem-record ids here, navigates to the target screen, and that screen pops
// the focus on mount to pre-filter itself. Type-matched so stale focus can't leak.
let PENDING_FOCUS = null;
function focusIssue(issue) {
  PENDING_FOCUS = (issue && issue.focus && issue.focus.ids && issue.focus.ids.length)
    ? { type: issue.focus.type, ids: issue.focus.ids.slice(), label: issue.title, checkId: issue.id }
    : null;
  if (typeof window !== 'undefined' && window.nav) window.nav(issue.route);
  else window.location.hash = issue.route;
}
function takeFocus(type) {
  if (PENDING_FOCUS && PENDING_FOCUS.type === type) {
    const f = PENDING_FOCUS;
    PENDING_FOCUS = null;
    return f;
  }
  return null;
}
// Of the records originally flagged, which still fail the same check right now?
// Re-runs the check live so corrected items fall out of a focused review list.
function liveFocusIds(focus) {
  if (!focus || !focus.ids) return [];
  const check = buildIntegrityChecks().find(c => c.id === focus.checkId);
  if (!check || !check.focus) return [];
  const stillFailing = new Set(check.focus.ids);
  return focus.ids.filter(id => stillFailing.has(id));
}

// Run every check and return a flat list of issue groups, each:
// { id, severity:'high'|'med'|'low', title, detail, items:[string], route, action }
// Severity: high = likely error / compliance risk; med = reconciliation gap; low = FYI.
function buildIntegrityChecks() {
  const s = Store.state;
  const out = [];
  const props = s.properties.filter(p => !isArchived(p));
  const REHAB_TOL = 100; // ignore sub-$100 drift

  // 1. Rehab spent understated vs. tagged transactions (soft reconciliation)
  const understated = [];
  for (const p of props) {
    const tagged = taggedRehabForProperty(p);
    const spent = p.rehab || 0;
    if (tagged > 0 && tagged - spent > REHAB_TOL) {
      understated.push({ p, tagged, spent });
    }
  }
  if (understated.length) {
    const uAddrs = understated.map(u => (u.p.address || '').toLowerCase().trim());
    const uTxIds = s.transactions.filter(t => {
      if (t.splits && t.splits.length) return t.splits.some(sp => uAddrs.includes((sp.project||'').toLowerCase().trim()) && REHAB_CATS.includes(sp.category));
      return uAddrs.includes((t.project||'').toLowerCase().trim()) && REHAB_CATS.includes(t.category);
    }).map(t => t.id);
    out.push({
      id: 'rehab-understated', severity: 'med',
      title: `${understated.length} propert${understated.length===1?'y has':'ies have'} rehab spend not reflected on the P&L`,
      detail: 'Transactions are tagged as rehab spend but “Rehab spent” is lower. Rehab spent is sheet-driven, so this is a heads-up, not necessarily an error.',
      items: understated.map(u => `${u.p.address} — ${fmtMoney(u.spent)} recorded vs ${fmtMoney(u.tagged)} tagged (${fmtMoney(u.tagged - u.spent)} gap)`),
      route: '/transactions', action: 'Review transactions',
      focus: { type: 'transactions', ids: uTxIds },
    });
  }

  // 2. Rehab spent exceeds budget (overrun)
  const overruns = props.filter(p => (p.rehabFunds || 0) > 0 && (p.rehab || 0) > p.rehabFunds + REHAB_TOL)
    .map(p => ({ p, over: p.rehab - p.rehabFunds }));
  if (overruns.length) {
    out.push({
      id: 'rehab-overrun', severity: 'high',
      title: `${overruns.length} rehab budget${overruns.length===1?'':'s'} exceeded`,
      detail: 'Rehab spent is over the budget you set on the property.',
      items: overruns.map(o => `${o.p.address} — ${fmtMoney(o.p.rehab)} spent vs ${fmtMoney(o.p.rehabFunds)} budget (${fmtMoney(o.over)} over)`),
      route: '/properties', action: 'Review properties',
      focus: { type: 'properties', ids: overruns.map(o => o.p.id) },
    });
  }

  // 3. W-9 missing on contractors that require a 1099 (≥ $600 YTD, or attorney)
  const year = parseInt(TODAY().slice(0,4));
  const w9Missing = s.contractors.filter(c => ten99Status(c, year) === 'w9_missing')
    .sort((a,b) => (b.ytd||0) - (a.ytd||0));
  if (w9Missing.length) {
    out.push({
      id: 'w9-missing', severity: 'high',
      title: `${w9Missing.length} contractor${w9Missing.length===1?'':'s'} need a W-9 before 1099s`,
      detail: `Paid ≥ $600 this year with no W-9 on file. Collect before January ${year+1} filing.`,
      items: w9Missing.map(c => `${c.name} — ${fmtMoney(c.ytd)} YTD`),
      route: '/contractors', action: 'Open address book',
      focus: { type: 'contractors', ids: w9Missing.map(c => c.id) },
    });
  }

  // 4. Sale date before purchase date (data-entry error)
  const badDates = props.filter(p => p.salesDate && p.purchaseDate && p.salesDate < p.purchaseDate);
  if (badDates.length) {
    out.push({
      id: 'date-order', severity: 'high',
      title: `${badDates.length} propert${badDates.length===1?'y has':'ies have'} a sale date before purchase`,
      detail: 'Sale date is earlier than the purchase date — likely a typo.',
      items: badDates.map(p => `${p.address} — bought ${fmtDate(p.purchaseDate)}, sold ${fmtDate(p.salesDate)}`),
      route: '/properties', action: 'Review properties',
      focus: { type: 'properties', ids: badDates.map(p => p.id) },
    });
  }

  // 5. Rent paid exceeds charge for the current month (possible misapplied payment)
  const overpaid = getLedgerForMonth(getCurrentMonth()).filter(r => r.paid - r.charge > 1);
  if (overpaid.length) {
    out.push({
      id: 'rent-overpaid', severity: 'low',
      title: `${overpaid.length} rent payment${overpaid.length===1?'':'s'} exceed the amount charged`,
      detail: 'Could be a prepayment or a misapplied payment — worth a glance.',
      items: overpaid.map(r => `${getTenant(r.tenantId)?.name || 'Tenant'} — paid ${fmtMoney(r.paid)} vs ${fmtMoney(r.charge)} charged`),
      route: '/rent', action: 'Open rent roll',
    });
  }

  // 6. Duplicate transactions (same date + amount + payee)
  const seen = {};
  for (const t of s.transactions) {
    if (!t.payee || !t.amount) continue;
    const key = `${t.date}|${t.amount}|${t.payee.toLowerCase().trim()}`;
    (seen[key] = seen[key] || []).push(t);
  }
  const dupes = Object.values(seen).filter(g => g.length > 1);
  if (dupes.length) {
    out.push({
      id: 'tx-dupes', severity: 'med',
      title: `${dupes.length} possible duplicate transaction${dupes.length===1?'':'s'}`,
      detail: 'Same date, amount, and payee appear more than once — check for a double bank import.',
      items: dupes.slice(0, 6).map(g => `${fmtDate(g[0].date)} · ${g[0].payee} · ${fmtMoney(Math.abs(g[0].amount))} ×${g.length}`),
      route: '/transactions', action: 'Review transactions',
      focus: { type: 'transactions', ids: dupes.flatMap(g => g.map(t => t.id)) },
    });
  }

  // 7. Orphaned transactions — tagged to a property address that no longer exists
  const addrSet = new Set(s.properties.map(p => (p.address || '').toLowerCase().trim()));
  // Sentinels + non-property overhead buckets (e.g. "Office") are valid tags, not orphans.
  const SENTINELS = new Set(['', 'multiple', ...OVERHEAD_PROJECTS.map(o => o.toLowerCase())]);
  const orphans = s.transactions.filter(t => {
    const pr = (t.project || '').toLowerCase().trim();
    if (SENTINELS.has(pr) || pr.startsWith('extract')) return false;
    return !addrSet.has(pr);
  });
  if (orphans.length) {
    out.push({
      id: 'tx-orphan', severity: 'med',
      title: `${orphans.length} transaction${orphans.length===1?'':'s'} tagged to an unknown property`,
      detail: 'These reference a property address that isn’t in your list — likely renamed or deleted.',
      items: Array.from(new Set(orphans.map(t => t.project))).slice(0, 6).map(pr => `“${pr}”`),
      route: '/transactions', action: 'Review transactions',
      focus: { type: 'transactions', ids: orphans.map(t => t.id) },
    });
  }

  // 8. Sold properties missing close-out financials
  const soldGaps = s.properties.filter(p => p.statusCode === 'I').map(p => {
    const want = ['salesPrice', 'salesDate', 'salesFees', 'salesCredits'];
    return { p, miss: want.filter(k => isEmptyVal(p[k])) };
  }).filter(x => x.miss.length);
  if (soldGaps.length) {
    out.push({
      id: 'sold-incomplete', severity: 'med',
      title: `${soldGaps.length} sold propert${soldGaps.length===1?'y is':'ies are'} missing close-out details`,
      detail: 'Closing costs or concessions weren’t recorded, so net profit may be overstated.',
      items: soldGaps.map(x => `${x.p.address} — missing ${x.miss.map(k => (FIELD_META[k]?.label || k).toLowerCase()).join(', ')}`),
      route: '/properties', action: 'Review properties',
      focus: { type: 'properties', ids: soldGaps.map(x => x.p.id) },
    });
  }

  // 9. Active properties missing fields expected at their current stage
  const stageGaps = s.properties.filter(p => !isArchived(p)).map(p => ({
    p, miss: (STAGE_EXPECTED_FIELDS[p.statusCode] || []).filter(k => isEmptyVal(p[k])),
  })).filter(x => x.miss.length);
  if (stageGaps.length) {
    out.push({
      id: 'stage-gaps', severity: 'low',
      title: `${stageGaps.length} propert${stageGaps.length===1?'y is':'ies are'} missing stage data`,
      detail: 'Fields normally filled by this point in the pipeline are still blank.',
      items: stageGaps.map(x => `${x.p.address} (${STATUS_LABEL[x.p.statusCode]}) — ${x.miss.map(k => (FIELD_META[k]?.label || k).toLowerCase()).join(', ')}`),
      route: '/properties', action: 'Review properties',
      focus: { type: 'properties', ids: stageGaps.map(x => x.p.id) },
    });
  }

  // Attach a content signature to each check so a cleared check reappears if its
  // underlying items change. Then drop any the user has marked done (same signature).
  out.forEach(issue => { issue.sig = checkSignature(issue); });
  return out;
}

// Stable signature of a check's contents (id + its item lines).
function checkSignature(issue) {
  const raw = issue.id + '|' + (issue.items || []).join('|');
  let h = 0;
  for (let i = 0; i < raw.length; i++) { h = (h * 31 + raw.charCodeAt(i)) | 0; }
  return issue.id + ':' + (h >>> 0).toString(36);
}

// All currently-failing checks, minus the ones the user cleared (by matching signature).
function getActiveIntegrityChecks() {
  const dismissed = (Store.state.uiState && Store.state.uiState.dismissedChecks) || {};
  return buildIntegrityChecks().filter(i => dismissed[i.id] !== i.sig);
}
function getDismissedIntegrityChecks() {
  const dismissed = (Store.state.uiState && Store.state.uiState.dismissedChecks) || {};
  return buildIntegrityChecks().filter(i => dismissed[i.id] === i.sig);
}
function dismissCheck(id, sig) {
  Store.update(s => {
    if (!s.uiState) s.uiState = {};
    if (!s.uiState.dismissedChecks) s.uiState.dismissedChecks = {};
    s.uiState.dismissedChecks[id] = sig;
  });
}
function restoreCheck(id) {
  Store.update(s => {
    if (s.uiState && s.uiState.dismissedChecks) delete s.uiState.dismissedChecks[id];
  });
}
function clearAllChecks(issues) {
  Store.update(s => {
    if (!s.uiState) s.uiState = {};
    if (!s.uiState.dismissedChecks) s.uiState.dismissedChecks = {};
    issues.forEach(i => { s.uiState.dismissedChecks[i.id] = i.sig; });
  });
}

// ────────── Auto-tag rules (editable; drive bank-import suggestions) ──────────
const DEFAULT_AUTO_TAG_RULES = [
  { pattern: 'lendinghome',              category: 'Interest Payment',   project: '',              conf: 99 },
  { pattern: 'sba loan',                 category: 'Loan Repayment',     project: '',              conf: 99 },
  { pattern: 'turbotenant',              category: 'Rental Income',      project: '',              conf: 92 },
  { pattern: 'hcv|charlottha',           category: 'Rental Income',      project: 'multiple',      conf: 85 },
  { pattern: 'csi community',            category: 'HOA Expense',        project: '',              conf: 85 },
  { pattern: 'lowes|home depot|menards', category: 'Job Supplies',       project: 'extract',       conf: 60 },
  { pattern: 'amazon|amzn',              category: 'Job Supplies',       project: 'extract',       conf: 55 },
  { pattern: 'zelle payment from',       category: 'Rental Income',      project: 'extract-zelle', conf: 90 },
  { pattern: '^check\\s+\\d+',           category: 'Contractor Payment', project: '',              conf: 50 },
  { pattern: 'microsoft|adobe|google',   category: 'Subscription',       project: '',              conf: 95 },
  { pattern: 'duke-energy|duke energy',  category: 'Utilities',          project: 'extract',       conf: 70 },
];
function ensureAutoTagRules(s) {
  if (!Array.isArray(s.autoTagRules)) {
    s.autoTagRules = DEFAULT_AUTO_TAG_RULES.map((r, i) => ({ id: 'atr' + (i + 1), ...r }));
  }
  return s.autoTagRules;
}
function getAutoTagRules() {
  if (!Array.isArray(Store.state.autoTagRules)) Store.update(s => ensureAutoTagRules(s));
  return Store.state.autoTagRules || [];
}
function compileAutoTagRule(r) { try { return new RegExp(r.pattern, 'i'); } catch (e) { return null; } }
function newAutoTagId() { return 'atr' + Date.now().toString(36) + Math.floor(Math.random() * 1e3); }
function addAutoTagRule(rule) {
  const id = newAutoTagId();
  Store.update(s => { ensureAutoTagRules(s); s.autoTagRules.push({ id, conf: 80, project: '', ...rule }); });
  return id;
}
function updateAutoTagRule(id, patch) {
  Store.update(s => { ensureAutoTagRules(s); const r = s.autoTagRules.find(x => x.id === id); if (r) Object.assign(r, patch); });
}
function deleteAutoTagRule(id) {
  Store.update(s => { ensureAutoTagRules(s); s.autoTagRules = s.autoTagRules.filter(x => x.id !== id); });
}
function moveAutoTagRule(id, dir) {
  Store.update(s => {
    ensureAutoTagRules(s);
    const i = s.autoTagRules.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.autoTagRules.length) return;
    const [r] = s.autoTagRules.splice(i, 1);
    s.autoTagRules.splice(j, 0, r);
  });
}
function resetAutoTagRules() {
  Store.update(s => { s.autoTagRules = DEFAULT_AUTO_TAG_RULES.map((r, i) => ({ id: 'atr' + (i + 1), ...r })); });
}

function markPaid(ledgerId, fullAmt) {
  Store.update(s => {
    const r = s.rentLedger.find(x => x.id === ledgerId);
    if (!r) return;
    r.paid = fullAmt != null ? fullAmt : r.charge;
    r.paidOn = s.today;
    r.status = r.paid >= r.charge ? 'paid' : 'partial';
  });
}

function markUnpaid(ledgerId) {
  Store.update(s => {
    const r = s.rentLedger.find(x => x.id === ledgerId);
    if (!r) return;
    r.paid = 0; r.paidOn = null;
    // Determine status by date
    const todayDay = parseInt(s.today.slice(-2));
    if (r.month === s.today.slice(0,7) && todayDay > 11) r.status = 'vacate-due';
    else if (r.month === s.today.slice(0,7) && todayDay > 5) r.status = 'late';
    else r.status = 'late';
  });
}

// Auto-reconcile: when a Rental Income transaction is tagged to a property for a month,
// mark that tenant's still-unpaid charge as paid and link it. Idempotent — only writes
// when an unlinked, unpaid charge finds a matching transaction.
function autoReconcileRentForMonth(month) {
  const s = Store.state;
  if (!month) return;
  const rows = (s.rentLedger || []).filter(r => r.month === month && (r.paid || 0) === 0 && !r.linkedTxId);
  if (rows.length === 0) return;
  const usedTx = new Set((s.rentLedger || []).filter(r => r.linkedTxId).map(r => r.linkedTxId));
  const monthStart = month + '-01';
  const monthEnd = addMonthsISO(monthStart, 1);
  const updates = [];
  for (const r of rows) {
    const prop = (s.properties || []).find(p => p.id === r.propertyId);
    if (!prop) continue;
    const tenant = (s.tenants || []).find(t => t.id === r.tenantId);
    const activeOnProp = (s.tenants || []).filter(t => t.propertyId === r.propertyId && t.status === 'active').length;
    const addrLower = (prop.address || '').toLowerCase().trim();
    const addrShort = addrLower.split(',')[0].replace(/\s*#\w+\s*$/, '').trim();
    const firstName = tenant && tenant.name ? tenant.name.split(' ')[0].toLowerCase() : '';
    const taggedToProp = pj => { const pl = (pj || '').toLowerCase().trim(); return pl && (pl === addrLower || pl.includes(addrShort) || addrLower.includes(pl)); };
    // Income transactions tagged to this property (direct or via a split slice) in the month.
    const cand = [];
    for (const tx of (s.transactions || [])) {
      if (usedTx.has(tx.id)) continue;
      if (!(tx.date >= monthStart && tx.date < monthEnd)) continue;
      if (!/rent/i.test(tx.category || '')) {
        // also allow split slices whose category is rental income
      }
      // direct tag
      let amt = 0;
      if (tx.amount > 0 && taggedToProp(tx.project) && /rent/i.test(tx.category || '')) amt = tx.amount;
      // split slice tagged to this property
      if (!amt && tx.splits && tx.splits.length) {
        const slice = tx.splits.find(sp => taggedToProp(sp.project) && /rent/i.test(sp.category || tx.category || ''));
        if (slice && slice.amount > 0) amt = slice.amount;
      }
      if (!amt) continue;
      // If several tenants share the property, require the name to match to avoid mis-assigning.
      if (activeOnProp > 1 && firstName && !(tx.desc || '').toLowerCase().includes(firstName)) continue;
      cand.push({ tx, amt, nameMatch: firstName && (tx.desc || '').toLowerCase().includes(firstName) });
    }
    if (cand.length === 0) continue;
    // Prefer name matches and closeness to the charge.
    cand.sort((a, b) => (b.nameMatch - a.nameMatch) || (Math.abs(a.amt - r.charge) - Math.abs(b.amt - r.charge)));
    const sum = cand.reduce((a, c) => a + c.amt, 0);
    const primary = cand[0];
    usedTx.add(primary.tx.id);
    updates.push({ id: r.id, txId: primary.tx.id, paid: Math.min(sum, r.charge), paidOn: primary.tx.date });
  }
  if (updates.length === 0) return;
  Store.update(st => {
    updates.forEach(u => {
      const r = st.rentLedger.find(x => x.id === u.id);
      if (!r) return;
      r.linkedTxId = u.txId;
      r.paid = u.paid;
      r.paidOn = u.paidOn || st.today;
      r.status = r.paid >= r.charge ? 'paid' : 'partial';
    });
  });
}

// Re-validate auto-linked rent rows: if the linked transaction was deleted or moved to a
// different month, unlink the charge and reset it to unpaid so it can re-match correctly.
function validateRentLinks() {
  const s = Store.state;
  const txById = new Map((s.transactions || []).map(t => [t.id, t]));
  const stale = (s.rentLedger || []).filter(r => {
    if (!r.linkedTxId) return false;
    const tx = txById.get(r.linkedTxId);
    if (!tx) return true;                                   // transaction deleted
    if ((tx.date || '').slice(0, 7) !== r.month) return true; // transaction moved to another month
    return false;
  });
  if (stale.length === 0) return;
  Store.update(st => {
    const curMonth = st.today.slice(0, 7);
    stale.forEach(sr => {
      const r = st.rentLedger.find(x => x.id === sr.id);
      if (!r) return;
      r.linkedTxId = null; r.paid = 0; r.paidOn = null;
      r.status = r.month < curMonth ? 'late' : 'upcoming';
    });
  });
}

// Keep auto-linked rent rows in sync with their transaction's CURRENT amount, so editing a
// transaction's amount updates the payment (e.g. a $3,100 partial corrected to a $3,200 full).
function syncLinkedRentAmounts() {
  const s = Store.state;
  const txById = new Map((s.transactions || []).map(t => [t.id, t]));
  const fixes = [];
  for (const r of (s.rentLedger || [])) {
    if (!r.linkedTxId) continue;
    const tx = txById.get(r.linkedTxId);
    if (!tx) continue;                                  // deletion handled by validateRentLinks
    if ((tx.date || '').slice(0, 7) !== r.month) continue; // month move handled by validateRentLinks
    const prop = (s.properties || []).find(p => p.id === r.propertyId);
    if (!prop) continue;
    const addrLower = (prop.address || '').toLowerCase().trim();
    const addrShort = addrLower.split(',')[0].replace(/\s*#\w+\s*$/, '').trim();
    const taggedToProp = pj => { const pl = (pj || '').toLowerCase().trim(); return pl && (pl === addrLower || pl.includes(addrShort) || addrLower.includes(pl)); };
    let amt = 0;
    if (tx.amount > 0 && taggedToProp(tx.project) && /rent/i.test(tx.category || '')) amt = tx.amount;
    if (!amt && tx.splits) { const sl = tx.splits.find(sp => taggedToProp(sp.project) && /rent/i.test(sp.category || tx.category || '')); if (sl && sl.amount > 0) amt = sl.amount; }
    if (!amt) continue;
    const newPaid = Math.min(amt, r.charge);
    const newStatus = newPaid >= r.charge ? 'paid' : 'partial';
    if (newPaid !== r.paid || newStatus !== r.status) fixes.push({ id: r.id, paid: newPaid, status: newStatus, paidOn: tx.date });
  }
  if (fixes.length === 0) return;
  Store.update(st => {
    fixes.forEach(f => { const r = st.rentLedger.find(x => x.id === f.id); if (r) { r.paid = f.paid; r.status = f.status; r.paidOn = f.paidOn; } });
  });
}

// Reconcile rent across every month that has rental-income transactions (each payment
// connects to the month it was dated in), plus the current month. Posts any missing
// charge rows first so a payment always has a charge to land on.
function reconcileRentAcrossMonths() {
  validateRentLinks();
  const s = Store.state;
  const months = new Set([s.today.slice(0, 7)]);
  (s.transactions || []).forEach(tx => {
    if (!tx.date) return;
    const isRentDirect = tx.amount > 0 && tx.project && /rent/i.test(tx.category || '');
    const isRentSplit = tx.splits && tx.splits.some(sp => /rent/i.test(sp.category || tx.category || ''));
    if (isRentDirect || isRentSplit) months.add(tx.date.slice(0, 7));
  });
  months.forEach(m => ensureLedgerForMonth(m));
  months.forEach(m => autoReconcileRentForMonth(m));
  syncLinkedRentAmounts();
}

const STAGE_LABEL_MAP = {
  A:'A - Coming Soon', B:'B - Rehab Not Started', C:'C - Rehab',
  D:'D - Ready To Rent', E:'E - Ready To List', F:'F - On Market',
  G:'G - Under Contract', H:'H - Pending 1031', I:'I - Sold',
  J:'J - Failed', K:'K - Rental',
};

// Property field metadata — drives close-out prompts, "fill missing" dialogs,
// and the integrity gap checks so labels/types live in one place.
const FIELD_META = {
  purchaseDate:    { label: 'Purchase date',            kind: 'date'  },
  purchasePrice:   { label: 'Purchase price',           kind: 'money' },
  acqEarnest:      { label: 'Earnest money (buy)',      kind: 'money' },
  acqDDFee:        { label: 'Due-diligence fee (buy)',  kind: 'money' },
  acqExchangeFunds:{ label: '1031 funds brought in (buy)', kind: 'money' },
  rehabFunds:      { label: 'Rehab budget',             kind: 'money' },
  rehab:           { label: 'Rehab spent',              kind: 'money' },
  interest:        { label: 'Interest accrued',         kind: 'money' },
  listPrice:       { label: 'List price',               kind: 'money' },
  salesDate:       { label: 'Sale date',                kind: 'date'  },
  salesPrice:      { label: 'Sale price',               kind: 'money' },
  salesFees:       { label: 'Closing costs',            kind: 'money' },
  salesCredits:    { label: 'Seller concessions',       kind: 'money' },
  salesLoanPayoff: { label: 'Loan payoff at closing',   kind: 'money' },
  atmoreLoanPrincipal: { label: 'Atmore loan principal',  kind: 'money' },
  atmoreLoanPayoff: { label: 'Atmore loan payoff',        kind: 'money' },
  saleDDCollected: { label: 'Due-diligence fee collected', kind: 'money' },
  saleEarnest:     { label: 'Earnest money (sale)',     kind: 'money' },
  exchangeFunds:   { label: '1031 funds rolled out (sale)', kind: 'money' },
};

// Keys changeStage will persist when present in opts.
const STAGE_PERSIST_KEYS = [
  'purchaseDate','purchasePrice','purchaseFees','purchaseCredits','purchaseFeeItems','saleFeeItems','rehabFunds','rehab','interest','listPrice',
  'acqEarnest','acqDDFee','acqExchangeFunds',
  'salesDate','saleSigningDate','saleSigningTime','salesPrice','salesFees','salesCredits','salesLoanPayoff','saleDDCollected','saleEarnest',
  'atmoreLoanPrincipal','atmoreLoanPayoff',
  'exchangeFunds','grossProfit','failedReason',
  'attorney','attorneyContact','buyerDDDate','expectedCloseDate','contractDate',
];

// Fields a property is expected to have once it reaches a given stage.
// Drives the "fill missing data" prompt on forward moves + integrity gap flags.
// (G — Under Contract has its own dedicated dialog, so it's not in this generic map.)
const STAGE_EXPECTED_FIELDS = {
  C: ['purchaseDate', 'rehabFunds'],     // entering Rehab → acquired + has a budget
  D: ['rehab'],                          // Ready to Rent → rehab spend recorded
  E: ['rehab'],                          // Ready to List → rehab spend recorded
  F: ['listPrice'],                      // On Market → asking price set
};

// Utilities tracked per property. Drives the Utilities tab/editor and the
// "leaving Coming Soon" setup prompt.
const UTILITY_TYPES = [
  { key: 'electric', label: 'Electric',      icon: '⚡' },
  { key: 'water',    label: 'Water / sewer', icon: '💧' },
  { key: 'gas',      label: 'Gas',           icon: '🔥' },
  { key: 'trash',    label: 'Trash',         icon: '🗑' },
];
const UTILITY_STATUS = { '': 'Not set up', on: 'On — our name', transferred: 'Transferred', off: 'Off' };
const UTILITY_STATUS_TONE = { '': 'ghost', on: 'sage', transferred: 'blue', off: 'brick' };

// True once any utility has a provider, account, or non-default status.
function utilitiesSetUp(p) {
  const u = p && p.utilities;
  if (!u) return false;
  return UTILITY_TYPES.some(t => {
    const r = u[t.key];
    return r && (r.provider || r.account || (r.status && r.status !== ''));
  });
}

function isEmptyVal(v) { return v == null || v === '' || (typeof v === 'number' && isNaN(v)); }

// Expected-but-empty fields for a property entering `code`.
function missingExpectedFields(p, code) {
  return (STAGE_EXPECTED_FIELDS[code] || []).filter(k => isEmptyVal(p[k]));
}

function changeStage(propId, newCode, opts = {}) {
  Store.update(s => {
    const p = s.properties.find(x => x.id === propId);
    if (!p) return;
    const oldCode = p.statusCode;
    if (oldCode === newCode) return;
    p.statusCode = newCode;
    p.status = STAGE_LABEL_MAP[newCode] || newCode;
    // Apply optional field updates (close-out, stage data, etc.)
    STAGE_PERSIST_KEYS.forEach(k => { if (opts[k] !== undefined) p[k] = opts[k]; });
    // Push to history
    p.stageHistory = p.stageHistory || [];
    p.stageHistory.push({
      from: oldCode, to: newCode,
      at: s.today,
      note: opts.note || '',
      by: opts.by || 'user',
    });
  });
}

// Legacy alias
const advanceStage = changeStage;

// Edit close-out / sale financials WITHOUT a stage change. changeStage no-ops when
// oldCode === newCode, so an already-Sold property needs this to persist edits.
// Only writes the close-out-relevant keys; logs an audit note if one is supplied.
function updateCloseout(propId, fields = {}) {
  Store.update(s => {
    const p = s.properties.find(x => x.id === propId);
    if (!p) return;
    STAGE_PERSIST_KEYS.forEach(k => { if (fields[k] !== undefined) p[k] = fields[k]; });
    if (fields.note) {
      p.stageHistory = p.stageHistory || [];
      p.stageHistory.push({ from: p.statusCode, to: p.statusCode, at: s.today, note: fields.note, by: 'user' });
    }
  });
}

function daysInCurrentStage(p) {
  if (!p.stageHistory || p.stageHistory.length === 0) return null;
  const last = p.stageHistory[p.stageHistory.length - 1];
  return daysBetween(last.at, TODAY());
}

function stageBackwardCount(p) {
  const hist = p.stageHistory || [];
  let n = 0;
  for (let i = 1; i < hist.length; i++) {
    const prev = STATUS_ORDER.indexOf(hist[i-1].to);
    const curr = STATUS_ORDER.indexOf(hist[i].to);
    if (prev >= 0 && curr >= 0 && curr < prev) n++;
  }
  return n;
}

function tagTransaction(txId, fields) {
  Store.update(s => {
    const i = s.transactions.findIndex(x => x.id === txId);
    if (i === -1) return;
    // Replace the row object AND the array with fresh references so every
    // consumer (including any memoized list) re-renders immediately — an
    // in-place Object.assign keeps the same refs and can leave the view stale
    // until a full reload.
    s.transactions[i] = { ...s.transactions[i], ...fields };
    s.transactions = s.transactions.slice();
  });
}

function setUI(patch) {
  Store.update(s => Object.assign(s.uiState, patch));
}

// ─── Contractor mutations ───
function addContractor(c) {
  Store.update(s => {
    const id = 'c' + (s.contractors.length + 100);
    s.contractors.push({ id, name: c.name, phone: c.phone || '', email: c.email || '',
      specialty: c.specialty || '', notes: c.notes || '',
      ytd: 0, jobs: 0, lastPaid: '', properties: [] });
  });
}
function updateContractor(id, patch) {
  Store.update(s => {
    const c = s.contractors.find(x => x.id === id);
    if (c) Object.assign(c, patch);
  });
}
function deleteContractor(id) {
  Store.update(s => {
    s.contractors = (s.contractors || []).filter(c => c.id !== id);
  });
}

// ─── Refi mutations ───
const REFI_STAGES = ['applied','appraisalScheduled','appraisalDone','closing','done'];
const REFI_STAGE_LABEL = {
  applied:'Applied', appraisalScheduled:'Appraisal scheduled',
  appraisalDone:'Appraisal done', closing:'Closing', done:'Done',
};
function updateRefi(id, patch) {
  Store.update(s => {
    const r = s.refis.find(x => x.id === id);
    if (r) Object.assign(r, patch);
  });
}
function addRefi(refi) {
  Store.update(s => {
    const id = 'rf' + (s.refis.length + 100);
    s.refis.push({ id, status: 'applied', applicationDate: s.today, ...refi });
  });
}

// ─── Exchange mutations ───
function getExchange(id) { return Store.state.exchanges.find(e => e.id === id); }
function updateExchange(id, patch) {
  Store.update(s => {
    const e = s.exchanges.find(x => x.id === id);
    if (e) Object.assign(e, patch);
  });
}

// ─── 1099 helpers ───
const ENTITY_LABEL = {
  unknown:     'Unknown',
  sole_prop:   'Sole proprietor',
  llc:         'LLC',
  scorp:       'S-corp',
  ccorp:       'C-corp',
  partnership: 'Partnership',
};
const ENTITY_OPTS = ['unknown','sole_prop','llc','scorp','partnership','ccorp'];

function ten99Status(c, year) {
  const history = (c.ten99History || []).find(h => h.taxYear === year);
  if (history && history.status === 'issued') return 'issued';
  if (c.paidByCardOnly) return 'exempt_card';
  if (c.isAttorney) {
    if ((c.ytd || 0) < 600) return 'not_required';
    if (!c.w9OnFile) return 'w9_missing';
    return 'ready';
  }
  if (c.entityType === 'scorp' || c.entityType === 'ccorp') return 'exempt_corp';
  if ((c.ytd || 0) < 600) return 'not_required';
  if (!c.w9OnFile) return 'w9_missing';
  return 'ready';
}
function ten99StatusLabel(s) {
  return ({
    'not_required': 'Not required',
    'exempt_corp':  'Exempt (corp)',
    'exempt_card':  'Exempt (card payments)',
    'w9_missing':   'W-9 missing',
    'ready':        'Ready to issue',
    'issued':       'Issued',
  })[s] || s;
}
function ten99StatusTone(s) {
  return ({
    'not_required': 'ghost',
    'exempt_corp':  'ghost',
    'exempt_card':  'ghost',
    'w9_missing':   'brick',
    'ready':        'ochre',
    'issued':       'sage',
  })[s] || 'ghost';
}
function markTen99Issued(contractorId, year, issuedDate) {
  Store.update(s => {
    const c = s.contractors.find(x => x.id === contractorId);
    if (!c) return;
    c.ten99History = c.ten99History || [];
    const existing = c.ten99History.find(h => h.taxYear === year);
    if (existing) {
      existing.status = 'issued';
      existing.issuedDate = issuedDate;
      existing.amountReported = c.ytd;
    } else {
      c.ten99History.push({ taxYear: year, status: 'issued', issuedDate, amountReported: c.ytd });
    }
  });
}
function unmarkTen99Issued(contractorId, year) {
  Store.update(s => {
    const c = s.contractors.find(x => x.id === contractorId);
    if (!c) return;
    c.ten99History = (c.ten99History || []).filter(h => h.taxYear !== year);
  });
}

Object.assign(window, {
  ENTITY_LABEL, ENTITY_OPTS,
  ten99Status, ten99StatusLabel, ten99StatusTone,
  markTen99Issued, unmarkTen99Issued,
});

function addMonthsISO(iso, n) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0,10);
}

// ─── Property mutations ───
function updateProperty(propId, patch) {
  Store.update(s => {
    const p = s.properties.find(x => x.id === propId);
    if (p) Object.assign(p, patch);
  });
}

// Permanently remove a property and cascade-clean its dependents. Transactions
// are kept but untagged (their project pointer is cleared) so financial history
// stays intact; the orphan check won't fire because the tag is removed.
function deleteProperty(propId) {
  Store.update(s => {
    const prop = s.properties.find(x => x.id === propId);
    if (!prop) return;
    const addr = (prop.address || '').toLowerCase().trim();
    const tenantIds = new Set((s.tenants || []).filter(t => t.propertyId === propId).map(t => t.id));
    s.properties = s.properties.filter(x => x.id !== propId);
    s.tenants    = (s.tenants || []).filter(t => t.propertyId !== propId);
    s.offers     = (s.offers || []).filter(o => o.propertyId !== propId);
    s.leads      = (s.leads || []).filter(l => l.propertyId !== propId);
    s.rentLedger = (s.rentLedger || []).filter(r => !tenantIds.has(r.tenantId));
    s.refis      = (s.refis || []).filter(r => r.propertyId !== propId);
    (s.transactions || []).forEach(t => {
      if ((t.project || '').toLowerCase().trim() === addr) t.project = '';
      if (t.splits) t.splits.forEach(sp => { if ((sp.project || '').toLowerCase().trim() === addr) sp.project = ''; });
    });
    if (s.uiState && s.uiState.selectedPropertyId === propId) s.uiState.selectedPropertyId = null;
  });
}

// ─── Lead mutations ───
function getLeadsForProperty(propId) {
  return (Store.state.leads || []).filter(l => l.propertyId === propId)
    .sort((a,b) => b.date.localeCompare(a.date));
}
function addLead(lead) {
  Store.update(s => {
    s.leads = s.leads || [];
    const id = 'ld' + (s.leads.length + 100);
    s.leads.push({ id, ...lead });
  });
}
function updateLead(id, patch) {
  Store.update(s => {
    const l = (s.leads || []).find(x => x.id === id);
    if (l) Object.assign(l, patch);
  });
}
function deleteLead(id) {
  Store.update(s => {
    s.leads = (s.leads || []).filter(l => l.id !== id);
  });
}
const LEAD_STATUS = ['new', 'showing-scheduled', 'showing-done', 'application-pending', 'lost', 'leased'];
const LEAD_STATUS_LABEL = {
  'new': 'New',
  'showing-scheduled': 'Showing scheduled',
  'showing-done': 'Showing done',
  'application-pending': 'Application pending',
  'lost': 'Lost',
  'leased': 'Leased',
};
const LEAD_STATUS_TONE = {
  'new': 'blue',
  'showing-scheduled': 'ochre',
  'showing-done': 'tan',
  'application-pending': 'ochre',
  'lost': 'ghost',
  'leased': 'sage',
};

// ─── Maintenance log + reminders ───
// Per-property upkeep: a log of work done/requested, and scheduled reminders
// (one-off or recurring — e.g. quarterly inspections).
const MAINT_CATEGORIES = ['Inspection', 'Repair', 'Turnover', 'Preventive', 'Appliance', 'Landscaping', 'Pest control', 'Other'];
const MAINT_STATUS = ['open', 'scheduled', 'done'];
const MAINT_STATUS_LABEL = { open: 'Open', scheduled: 'Scheduled', done: 'Done' };
const MAINT_STATUS_TONE = { open: 'ochre', scheduled: 'blue', done: 'sage' };

// Recurrence cadence → months between occurrences. 'none' = one-off.
const RECURRENCE = ['none', 'monthly', 'quarterly', 'semiannual', 'annual'];
const RECURRENCE_MONTHS = { none: 0, monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const RECURRENCE_LABEL = { none: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every 6 months', annual: 'Annual' };

function getMaintenanceForProperty(propId) {
  return (Store.state.maintenance || []).filter(m => m.propertyId === propId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function addMaintenance(rec) {
  Store.update(s => {
    s.maintenance = s.maintenance || [];
    const id = 'mt' + (s.maintenance.reduce((a, m) => Math.max(a, parseInt(m.id.slice(2)) || 0), 100) + 1);
    s.maintenance.push({ id, status: 'open', ...rec });
  });
}
function updateMaintenance(id, patch) {
  Store.update(s => {
    const m = (s.maintenance || []).find(x => x.id === id);
    if (m) Object.assign(m, patch);
  });
}
function deleteMaintenance(id) {
  Store.update(s => { s.maintenance = (s.maintenance || []).filter(m => m.id !== id); });
}

function getRemindersForProperty(propId) {
  return (Store.state.reminders || []).filter(r => r.propertyId === propId)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
}
function addReminder(rec) {
  Store.update(s => {
    s.reminders = s.reminders || [];
    const id = 'rm' + (s.reminders.reduce((a, r) => Math.max(a, parseInt(r.id.slice(2)) || 0), 100) + 1);
    s.reminders.push({ id, recurrence: 'none', done: false, lastDone: null, priority: 'normal', checklist: [], ...rec });
  });
}
function updateReminder(id, patch) {
  Store.update(s => {
    const r = (s.reminders || []).find(x => x.id === id);
    if (r) Object.assign(r, patch);
  });
}
function deleteReminder(id) {
  Store.update(s => { s.reminders = (s.reminders || []).filter(r => r.id !== id); });
}
// Mark a reminder complete. One-off → done. Recurring → log lastDone and roll the
// due date forward by its cadence (skipping past any missed cycles so it lands in the future).
function completeReminder(id) {
  Store.update(s => {
    const r = (s.reminders || []).find(x => x.id === id);
    if (!r) return;
    const today = TODAY();
    r.lastDone = today;
    const months = RECURRENCE_MONTHS[r.recurrence] || 0;
    if (!months) { r.done = true; return; }
    let next = addMonthsISO(r.dueDate || today, months);
    let guard = 0;
    while (next && next <= today && guard < 60) { next = addMonthsISO(next, months); guard++; }
    r.dueDate = next;
    r.done = false;
  });
}
// All open reminders due within `withinDays` (includes overdue back to -daysPast).
function getUpcomingReminders(withinDays = 14, daysPast = 30) {
  const today = TODAY();
  return (Store.state.reminders || [])
    .filter(r => !r.done && r.dueDate)
    .map(r => ({ reminder: r, property: getProperty(r.propertyId), days: daysBetween(today, r.dueDate) }))
    .filter(x => x.property && x.days != null && x.days <= withinDays && x.days >= -daysPast)
    .sort((a, b) => a.reminder.dueDate.localeCompare(b.reminder.dueDate));
}


// ─── Transaction splits ───
function splitTransaction(txId, splits) {
  // splits: [{ project, amount, category }]
  Store.update(s => {
    const t = s.transactions.find(x => x.id === txId);
    if (!t) return;
    t.splits = splits.map(p => ({ project: p.project, amount: p.amount, category: p.category || '' }));
    t.project = 'multiple';
    // Compose category as 'multiple' if splits use different cats; else single category
    const cats = new Set(t.splits.map(s => s.category).filter(Boolean));
    if (cats.size === 1) t.category = [...cats][0];
    else t.category = 'multiple';
  });
}
function clearSplit(txId) {
  Store.update(s => {
    const t = s.transactions.find(x => x.id === txId);
    if (!t) return;
    delete t.splits;
  });
}
function txSplitsForProperty(propAddr) {
  // Returns transaction slices: { tx, amount, category } where the property matches a split
  const out = [];
  for (const t of Store.state.transactions) {
    if (!t.splits) continue;
    for (const sp of t.splits) {
      if ((sp.project || '').toLowerCase().trim() === (propAddr || '').toLowerCase().trim()) {
        out.push({ tx: t, amount: sp.amount, category: sp.category });
      }
    }
  }
  return out;
}

// ─── Rent ledger ↔ transaction linking ───
function linkLedgerToTransaction(ledgerId, txId) {
  Store.update(s => {
    const r = s.rentLedger.find(x => x.id === ledgerId);
    if (r) r.linkedTxId = txId;
  });
}
function findMatchingTxForLedger(ledger) {
  // Find recent transactions in the same/adjacent month with positive amount roughly matching
  const t = Store.state.tenants.find(x => x.id === ledger.tenantId);
  if (!t) return [];
  const monthStart = ledger.month + '-01';
  return Store.state.transactions
    .filter(tx => tx.amount > 0)
    .filter(tx => tx.date >= monthStart && tx.date <= addMonthsISO(monthStart, 1))
    .map(tx => {
      let score = 0;
      // Amount match
      if (Math.abs(tx.amount - ledger.charge) < 1) score += 50;
      else if (Math.abs(tx.amount - ledger.charge) < 50) score += 20;
      // Name in description
      if (t.name && tx.desc.toLowerCase().includes(t.name.split(' ')[0].toLowerCase())) score += 40;
      if (t.name && tx.desc.toLowerCase().includes(t.name.toLowerCase())) score += 30;
      // Section 8 deposits
      if (t.source === 'Section 8' && /hcv|charlottha/i.test(tx.desc)) score += 25;
      // TurboTenant
      if (t.source === 'TurboTenant' && /turbotenant/i.test(tx.desc)) score += 25;
      return { tx, score };
    })
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score)
    .slice(0, 8);
}

// ─── Duplicate detection ───
function isDuplicateTransaction(date, amount, desc) {
  return Store.state.transactions.some(t =>
    t.date === date && Math.abs(t.amount - amount) < 0.01 && t.desc === desc
  );
}

// ─── Add tenant ───
function addTenant(tenantData, startLedger = true) {
  Store.update(s => {
    const id = 'tn' + (s.tenants.length + 100);
    s.tenants.push({ id, status: 'active', ...tenantData });
    if (startLedger && tenantData.moveIn && tenantData.rent > 0) {
      // Generate ledger entries from moveIn month through current month, all as upcoming
      const start = tenantData.moveIn.slice(0,7);
      const cur = s.today.slice(0,7);
      let m = start;
      let lid = (s.rentLedger.reduce((a,r) => Math.max(a, parseInt(r.id.slice(1))||0), 0)) + 1;
      while (m <= cur) {
        s.rentLedger.push({
          id: 'r' + (lid++), tenantId: id, propertyId: tenantData.propertyId,
          month: m, charge: tenantData.rent, paid: 0, paidOn: null,
          source: tenantData.source, status: m === cur ? 'paid' : 'paid', linkedTxId: null,
        });
        // Increment month
        const d = new Date(m + '-01T12:00:00'); d.setMonth(d.getMonth() + 1);
        m = d.toISOString().slice(0,7);
      }
    }
    // Retire any prior tenant still on this property — a new lease means the old
    // occupant (placeholder vacant/prep, or a still-active tenant) has moved on.
    s.tenants.forEach(x => {
      if (x.propertyId === tenantData.propertyId && x.id !== id && x.status !== 'past') {
        x.status = 'past';
        if (!x.moveOut) x.moveOut = tenantData.moveIn || s.today;
      }
    });
  });
}

// ─── Move out a tenant — retire the lease and record the deposit disposition ───
function moveOutTenant(tenantId, opts = {}) {
  Store.update(s => {
    const t = s.tenants.find(x => x.id === tenantId);
    if (!t) return;
    const date = opts.moveOut || s.today;
    t.status = 'past';
    t.moveOut = date;
    if (!t.leaseEnd || date < t.leaseEnd) t.leaseEnd = date;
    t.depositReturn = {
      depositOnFile: opts.depositOnFile != null ? opts.depositOnFile : (t.deposit || 0),
      refunded: opts.refunded || 0,
      withheld: opts.withheld || 0,
      reason: opts.reason || '',
      settledOn: date,
    };
    if (opts.note != null && opts.note !== '') t.notes = opts.note;
    // Drop unpaid future rent charges past the move-out month so the rent roll
    // doesn't keep billing a unit nobody lives in. Paid history is untouched.
    if (opts.dropFutureCharges !== false) {
      const moMonth = date.slice(0, 7);
      s.rentLedger = (s.rentLedger || []).filter(r =>
        !(r.tenantId === tenantId && r.month > moMonth && (r.paid || 0) === 0));
    }
  });
}

// ─── Edit a past tenant's move-out date / deposit settlement (no ledger changes) ───
function updateDepositSettlement(tenantId, opts = {}) {
  Store.update(s => {
    const t = s.tenants.find(x => x.id === tenantId);
    if (!t) return;
    if (opts.moveOut) {
      t.moveOut = opts.moveOut;
      if (!t.leaseEnd || opts.moveOut < t.leaseEnd) t.leaseEnd = opts.moveOut;
    }
    t.depositReturn = {
      ...(t.depositReturn || {}),
      depositOnFile: opts.depositOnFile != null ? opts.depositOnFile : (t.depositReturn?.depositOnFile || t.deposit || 0),
      refunded: opts.refunded != null ? opts.refunded : (t.depositReturn?.refunded || 0),
      withheld: opts.withheld != null ? opts.withheld : (t.depositReturn?.withheld || 0),
      reason: opts.reason != null ? opts.reason : (t.depositReturn?.reason || ''),
      settledOn: opts.moveOut || t.moveOut || t.depositReturn?.settledOn,
    };
    if (opts.note != null && opts.note !== '') t.notes = opts.note;
  });
}

// ─── Update tenant (edit lease / contact / Section 8 details) ───
function updateTenant(tenantId, patch) {
  Store.update(s => {
    const t = s.tenants.find(x => x.id === tenantId);
    if (!t) return;
    const oldRent = t.rent;
    Object.assign(t, patch);
    // If rent changed, keep current/upcoming unpaid ledger charges in step.
    if (patch.rent != null && patch.rent !== oldRent) {
      const cur = s.today.slice(0, 7);
      (s.rentLedger || []).forEach(r => {
        if (r.tenantId === tenantId && r.month >= cur && (r.paid || 0) === 0) r.charge = patch.rent;
      });
    }
    if (patch.source) {
      (s.rentLedger || []).forEach(r => {
        if (r.tenantId === tenantId && r.month >= s.today.slice(0, 7) && (r.paid || 0) === 0) r.source = patch.source;
      });
    }
  });
}

// ─── Add property ───
function addProperty(propData) {
  let newId;
  Store.update(s => {
    newId = 'p' + (s.properties.length + 1000);
    const today = s.today;
    const code = propData.statusCode || 'A';
    s.properties.push({
      id: newId,
      address: propData.address,
      type: propData.type || 'Wholesale',
      status: STAGE_LABEL_MAP[code] || (code + ' - Coming Soon'),
      statusCode: code,
      city: propData.city || '',
      county: propData.county || '',
      state: propData.state || 'NC',
      zip: propData.zip || '',
      assigned: propData.assigned || '',
      loanType: propData.loanType || '',
      lockbox: '',
      ddDate: propData.ddDate || null,
      signingDate: propData.signingDate || null,
      purchaseDate: null,
      purchasePrice: propData.purchasePrice || null,
      purchaseFees: null, purchaseCredits: null, purchaseLoan: null,
      acqEarnest: propData.acqEarnest || null, acqDDFee: propData.acqDDFee || null, acqExchangeFunds: null,
      salesDate: null, salesPrice: null, salesFees: null, salesCredits: null, salesLoanPayoff: null,
      saleDDCollected: null, saleEarnest: null,
      rehab: null, rehabFunds: propData.rehabFunds || null,
      interest: null, atmoreLoanPayoff: null, atmoreLoanPrincipal: null, exchangeFunds: null, interestCredit: null, grossProfit: null,
      hoaName: '', hoaWebsite: '', hoaUser: '', hoaPass: '',
      vestingLLC: propData.vestingLLC || 'Atmore Properties LLC',
      driveUrl: propData.driveUrl || '',
      insurance: null, loanDetail: null, taxes: null,
      stageHistory: [{ from: null, to: code, at: today, note: 'Added via app', by: 'user' }],
    });
  });
  return newId;
}

// ─── Add HOA ───
function addHOA(hoaData) {
  Store.update(s => {
    const id = 'h' + (s.hoas.length + 100);
    s.hoas.push({
      id, propertyId: hoaData.propertyId,
      name: hoaData.name || '',
      website: hoaData.website || '',
      username: hoaData.username || '',
      password: hoaData.password || '',
      lastVerified: hoaData.lastVerified || Store.state.today,
    });
  });
}
function updateHOA(id, patch) {
  Store.update(s => {
    const h = s.hoas.find(x => x.id === id);
    if (h) Object.assign(h, patch);
  });
}
function deleteHOA(id) {
  Store.update(s => { s.hoas = s.hoas.filter(h => h.id !== id); });
}

Object.assign(window, {
  splitTransaction, clearSplit, txSplitsForProperty,
  linkLedgerToTransaction, findMatchingTxForLedger,
  isDuplicateTransaction,
  addTenant, updateTenant, moveOutTenant, updateDepositSettlement, addProperty, addHOA, updateHOA, deleteHOA,
});

// ─── Bulk transaction tag mutation ───
function bulkTagTransactions(ids, fields) {
  Store.update(s => {
    const idSet = new Set(ids);
    s.transactions = s.transactions.map(t => idSet.has(t.id) ? { ...t, ...fields } : t);
  });
}
function bulkDeleteTransactions(ids) {
  Store.update(s => {
    const idSet = new Set(ids);
    s.transactions = s.transactions.filter(t => !idSet.has(t.id));
  });
}

Object.assign(window, {
  updateProperty, deleteProperty,
  getLeadsForProperty, addLead, updateLead, deleteLead,
  LEAD_STATUS, LEAD_STATUS_LABEL, LEAD_STATUS_TONE,
  getMaintenanceForProperty, addMaintenance, updateMaintenance, deleteMaintenance,
  getRemindersForProperty, addReminder, updateReminder, deleteReminder, completeReminder, getUpcomingReminders,
  MAINT_CATEGORIES, MAINT_STATUS, MAINT_STATUS_LABEL, MAINT_STATUS_TONE,
  RECURRENCE, RECURRENCE_MONTHS, RECURRENCE_LABEL,
  bulkTagTransactions, bulkDeleteTransactions,
  addMonthsISO,
});

// ─── Offers (sale-side: offers RECEIVED on properties we're selling) ───
const OFFER_STATUS = ['received', 'countered', 'accepted', 'rejected', 'withdrawn', 'expired'];
const OFFER_STATUS_LABEL = {
  received: 'Received', countered: 'Countered', accepted: 'Accepted',
  rejected: 'Rejected', withdrawn: 'Withdrawn', expired: 'Expired',
};
const OFFER_STATUS_TONE = {
  received: 'blue', countered: 'ochre', accepted: 'sage',
  rejected: 'ghost', withdrawn: 'ghost', expired: 'ghost',
};
const FINANCING_TYPES = ['Cash', 'Conventional', 'FHA', 'VA', 'USDA', 'Hard money', 'Seller finance', 'Other'];
const CONTINGENCY_TYPES = ['Inspection', 'Appraisal', 'Financing', 'Home sale'];
// Itemized seller concessions — each is a dollar amount the seller gives up
const CONCESSION_FIELDS = [
  { key: 'closingCost',  label: 'Closing-cost credit' },
  { key: 'repairCredit', label: 'Repair credit' },
  { key: 'homeWarranty', label: 'Home warranty' },
  { key: 'rateBuydown',  label: 'Rate buydown' },
  { key: 'other',        label: 'Other credit' },
];
// Sale-side stages where Offers tab is relevant
const SALE_SIDE_STAGES = ['E', 'F', 'G', 'H', 'I'];

function emptyConcessions() {
  return { closingCost: 0, repairCredit: 0, homeWarranty: 0, rateBuydown: 0, other: 0 };
}
function offerTotalConcessions(o) {
  const c = o.concessions || {};
  return CONCESSION_FIELDS.reduce((a, f) => a + (Number(c[f.key]) || 0), 0);
}
// The number that actually matters: what lands in the seller's pocket
function offerNetToSeller(o) {
  return (Number(o.offerPrice) || 0) - offerTotalConcessions(o) - (Number(o.closingCosts) || 0);
}
const OFFER_ACTIVE = ['received', 'countered', 'accepted'];
function isOfferActive(o) { return OFFER_ACTIVE.includes(o.status); }

function getOffersForProperty(propId) {
  return (Store.state.offers || []).filter(o => o.propertyId === propId)
    .sort((a, b) => offerNetToSeller(b) - offerNetToSeller(a));
}
function bestNetForProperty(propId) {
  const active = (Store.state.offers || []).filter(o => o.propertyId === propId && isOfferActive(o));
  if (active.length === 0) return null;
  return Math.max(...active.map(offerNetToSeller));
}
function activeOfferCount(propId) {
  return (Store.state.offers || []).filter(o => o.propertyId === propId && isOfferActive(o)).length;
}
function addOffer(offer) {
  Store.update(s => {
    s.offers = s.offers || [];
    const id = 'of' + (s.offers.reduce((a, o) => Math.max(a, parseInt(o.id.slice(2)) || 0), 100) + 1);
    s.offers.push({ id, concessions: emptyConcessions(), contingencies: [], ...offer });
  });
}
function updateOffer(id, patch) {
  Store.update(s => {
    const o = (s.offers || []).find(x => x.id === id);
    if (o) Object.assign(o, patch);
  });
}
function deleteOffer(id) {
  Store.update(s => { s.offers = (s.offers || []).filter(o => o.id !== id); });
}
// Accepting an offer can roll the property to Under Contract.
// Other open offers are LEFT as backups (decline them manually if you want).
// Optionally persists a `patch` of edits in the SAME mutation (one render, not two).
function acceptOffer(id, { patch = null, advanceToUnderContract = false } = {}) {
  Store.update(s => {
    const o = (s.offers || []).find(x => x.id === id);
    if (!o) return;
    if (patch) Object.assign(o, patch);
    o.status = 'accepted';
  });
  if (advanceToUnderContract) {
    const o = (Store.state.offers || []).find(x => x.id === id);
    if (o) {
      const p = getProperty(o.propertyId);
      if (p && p.statusCode !== 'G') {
        changeStage(o.propertyId, 'G', { note: `Accepted offer from ${o.buyer || 'buyer'}`, by: 'offers' });
      }
    }
  }
}

// Move a property to Under Contract from accepted terms. Ties the stage change
// to the offers system so net-to-seller math + the Offers tab stay in sync, and
// writes the contract/closing fields the close-out later prefills from.
//   opts: { offerId?, terms:{buyer,offerPrice,earnestMoney,financing,concessionsTotal,
//           closeDate,contingencies}, closing:{attorney,attorneyContact,buyerDDDate}, note }
function goUnderContract(propId, { offerId = null, terms = {}, closing = {}, note = '' } = {}) {
  const t = terms, c = closing;
  const concObj = { ...emptyConcessions(), other: Number(t.concessionsTotal) || 0 };
  Store.update(s => {
    s.offers = s.offers || [];
    let offer = offerId ? s.offers.find(o => o.id === offerId) : null;
    const offerFields = {
      buyer: t.buyer || (offer && offer.buyer) || 'Buyer',
      offerPrice: t.offerPrice != null && t.offerPrice !== '' ? Number(t.offerPrice) : (offer ? offer.offerPrice : null),
      earnestMoney: t.earnestMoney != null && t.earnestMoney !== '' ? Number(t.earnestMoney) : (offer ? offer.earnestMoney : null),
      financing: t.financing || (offer && offer.financing) || 'Conventional',
      closeDate: t.closeDate || (offer && offer.closeDate) || '',
      contingencies: t.contingencies || (offer && offer.contingencies) || [],
      ddDeadline: c.buyerDDDate || (offer && offer.ddDeadline) || '',
    };
    // Concessions: keep the offer's itemized breakdown unless the user changed the
    // total (then store the new total as a single line so net-to-seller stays correct).
    if (offer) {
      const origTotal = offerTotalConcessions(offer);
      const newTotal = (t.concessionsTotal == null || t.concessionsTotal === '') ? null : Number(t.concessionsTotal);
      if (newTotal != null && newTotal !== origTotal) offerFields.concessions = concObj;
    } else if (t.concessionsTotal != null && t.concessionsTotal !== '') {
      offerFields.concessions = concObj;
    }
    if (offer) {
      Object.assign(offer, offerFields, { status: 'accepted' });
    } else {
      const id = 'of' + (s.offers.reduce((a, o) => Math.max(a, parseInt(o.id.slice(2)) || 0), 100) + 1);
      offer = { id, propertyId: propId, date: s.today, status: 'accepted', closingCosts: null,
        concessions: emptyConcessions(), contingencies: [], ...offerFields };
      s.offers.push(offer);
    }
    // Property contract/closing fields (close-out prefills from salesPrice / salesCredits)
    const p = s.properties.find(x => x.id === propId);
    if (p) {
      if (offer.offerPrice != null) p.salesPrice = offer.offerPrice;
      const concTotal = offerTotalConcessions(offer);
      if (concTotal > 0) p.salesCredits = concTotal;
      if (c.attorney) p.attorney = c.attorney;
      if (c.attorneyContact) p.attorneyContact = c.attorneyContact;
      if (c.buyerDDDate) p.buyerDDDate = c.buyerDDDate;
      else if (offer.dueDiligenceDate) p.buyerDDDate = offer.dueDiligenceDate;
      else if (offer.dueDiligenceDays != null) {
        const base = s.today;
        const d = new Date(base + 'T12:00:00');
        d.setDate(d.getDate() + Number(offer.dueDiligenceDays));
        p.buyerDDDate = d.toISOString().slice(0, 10);
      }
      if (c.saleSigningDate) p.saleSigningDate = c.saleSigningDate;
      if (c.saleSigningTime) p.saleSigningTime = c.saleSigningTime;
      if (offer.dueDiligenceFee != null) p.saleDDCollected = Math.abs(offer.dueDiligenceFee);
      if (offer.closeDate) p.expectedCloseDate = offer.closeDate;
      p.contractDate = s.today;
    }
  });
  changeStage(propId, 'G', { note: note || `Under contract — ${terms.buyer || 'buyer'}`, by: 'contract' });
}

// Offers still needing a response (received / countered), oldest first — for the dashboard
function offersAwaitingResponse() {
  const today = TODAY();
  return (Store.state.offers || [])
    .filter(o => o.status === 'received' || o.status === 'countered')
    .map(o => ({ offer: o, property: getProperty(o.propertyId), days: daysBetween(o.date, today) }))
    .filter(x => x.property)
    .sort((a, b) => b.days - a.days);
}

// Seed sample offers onto sale-side properties (gated once by _offersSeeded flag in load)
function seedOffers(s) {
  s.offers = [];
  const mkList = p => {
    const base = Math.abs(p.purchasePrice || 0);
    // Use 1.5× basis as a rough ARV; floor to a realistic house price for low-basis/wholesale rows
    return base > 60000 ? Math.round((base * 1.5) / 1000) * 1000 : 189000;
  };
  // Prefer On-Market, then Under-Contract, then Ready-to-List
  const order = { F: 0, G: 1, E: 2 };
  const candidates = s.properties
    .filter(p => p.statusCode in order)
    .sort((a, b) => order[a.statusCode] - order[b.statusCode]);
  let n = 100;
  const push = (o) => s.offers.push({ id: 'of' + (n++), contingencies: [], ...o });

  // First sale-side property: two competing offers — demonstrates net-to-seller ranking
  if (candidates[0]) {
    const p = candidates[0]; const list = mkList(p); p.listPrice = list;
    push({
      propertyId: p.id, date: '2026-05-22',
      buyer: 'Daniel & Rosa Vega', buyerAgent: 'Keller Williams — T. Brooks', agentContact: '704-555-0431',
      offerPrice: list, earnestMoney: 3000, financing: 'FHA', closeDate: '2026-07-15',
      status: 'countered',
      concessions: { closingCost: 7000, repairCredit: 1500, homeWarranty: 550, rateBuydown: 0, other: 0 },
      closingCosts: Math.round(list * 0.07), contingencies: ['Inspection', 'Appraisal', 'Financing'],
      notes: 'Full price on paper but leaning on us for closing help. Countered concessions down to ~$4k.',
    });
    push({
      propertyId: p.id, date: '2026-05-24',
      buyer: 'BlueDoor Capital LLC', buyerAgent: '(unrepresented)', agentContact: 'acq@bluedoorcap.example',
      offerPrice: list - 12000, earnestMoney: 10000, financing: 'Cash', closeDate: '2026-06-12',
      status: 'received',
      concessions: emptyConcessions(),
      closingCosts: Math.round((list - 12000) * 0.05), contingencies: [],
      notes: 'Cash, 14-day close, waiving inspection. Lower headline price but clean and fast.',
    });
  }
  // Second sale-side property: a single offer
  if (candidates[1]) {
    const p = candidates[1]; const list = mkList(p); p.listPrice = list;
    push({
      propertyId: p.id, date: '2026-05-20',
      buyer: 'Marcus Allen', buyerAgent: 'Redfin — S. Kim', agentContact: '980-555-0177',
      offerPrice: list - 5000, earnestMoney: 4000, financing: 'Conventional', closeDate: '2026-07-01',
      status: 'received',
      concessions: { closingCost: 5000, repairCredit: 0, homeWarranty: 0, rateBuydown: 3000, other: 0 },
      closingCosts: Math.round((list - 5000) * 0.07), contingencies: ['Inspection', 'Appraisal', 'Financing'],
      notes: 'Asking for a 2-1 rate buydown. Strong pre-approval letter attached.',
    });
  }
}

Object.assign(window, {
  OFFER_STATUS, OFFER_STATUS_LABEL, OFFER_STATUS_TONE,
  FINANCING_TYPES, CONTINGENCY_TYPES, CONCESSION_FIELDS, SALE_SIDE_STAGES,
  emptyConcessions, offerTotalConcessions, offerNetToSeller, isOfferActive,
  getOffersForProperty, bestNetForProperty, activeOfferCount,
  addOffer, updateOffer, deleteOffer, acceptOffer, offersAwaitingResponse,
  goUnderContract,
});

// ─── CSV export ───
function toCSV(rows, columns) {
  // columns: [{ key, label, fn?: (row) => string|number }]
  const esc = v => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v) : String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? '"' + s + '"' : s;
  };
  const head = columns.map(c => esc(c.label)).join(',');
  const body = rows.map(r => columns.map(c => esc(c.fn ? c.fn(r) : r[c.key])).join(',')).join('\n');
  return head + '\n' + body;
}
function downloadCSV(filename, rows, columns) {
  const csv = toCSV(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Backup / restore ───
function downloadBackup() {
  const json = JSON.stringify({ _v: 10, exportedAt: new Date().toISOString(), data: Store.state }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `atmore-ops-backup-${TODAY()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function restoreBackup(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!parsed.data || !parsed.data.properties) throw new Error('Not a valid Atmore backup file');
  Store.state = parsed.data;
  Store.save();
  Store.notify();
}

// ─── Vacancy analysis ───
function getVacancyReport(year) {
  // For each property that's ever been a rental, compute vacant days in the year
  const yearStart = year + '-01-01';
  const yearEnd = (year + 1) + '-01-01';
  const today = TODAY();
  const out = [];
  Store.state.properties.forEach(p => {
    if (p.statusCode !== 'K' && p.statusCode !== 'D') return;
    const tenants = getTenantsForProperty(p.id);
    const hasActive = tenants.some(t => t.status === 'active');
    const vacant = tenants.find(t => t.status === 'vacant');
    const prep = tenants.find(t => t.status === 'prep');
    if (!hasActive && (vacant || prep || p.statusCode === 'K')) {
      // Estimate vacant days = days since most recent paid ledger entry (or year start)
      const lastPaid = Store.state.rentLedger
        .filter(r => r.propertyId === p.id && r.status === 'paid')
        .sort((a,b) => b.month.localeCompare(a.month))[0];
      const startVacant = lastPaid ? lastPaid.month + '-15' : yearStart;
      const effectiveStart = startVacant > yearStart ? startVacant : yearStart;
      const effectiveEnd = today < yearEnd ? today : yearEnd;
      const days = Math.max(0, daysBetween(effectiveStart, effectiveEnd));
      if (days === 0) return;
      // Estimated carrying cost: monthly insurance + tax + mortgage per vacant month
      const monthlyCost = ((p.insurance?.premium || 0) + (p.taxes?.annualAmount || 0)) / 12 + (p.loanDetail?.monthlyPayment || 0);
      // Estimated lost rent = average rent for K-Rental properties
      const avgRent = getActiveTenants().reduce((a,t) => a + t.rent, 0) / Math.max(getActiveTenants().length, 1);
      out.push({
        property: p,
        vacantSince: effectiveStart,
        days,
        carryingCost: Math.round(monthlyCost * days / 30),
        lostRent: Math.round(avgRent * days / 30),
        status: prep ? 'prepping' : vacant ? 'vacant' : 'no tenant',
      });
    }
  });
  return out;
}

Object.assign(window, { toCSV, downloadCSV, downloadBackup, restoreBackup, getVacancyReport });

// ─── Late fees on rent ledger ───
const LATE_FEE_PCT = 0.05; // 5% of monthly rent
function lateFeeFor(ledger) {
  if (!ledger) return 0;
  if (ledger.lateFeeWaived) return 0;
  if (ledger.status !== 'late' && ledger.status !== 'vacate-due' && ledger.status !== 'partial') return 0;
  // No late fee if paid in full
  if (ledger.paid >= ledger.charge) return 0;
  return Math.round(ledger.charge * LATE_FEE_PCT);
}
function totalOwedFor(ledger) {
  return Math.max(0, ledger.charge - ledger.paid) + lateFeeFor(ledger);
}
function waiveLateFee(ledgerId, waive = true) {
  Store.update(s => {
    const r = s.rentLedger.find(x => x.id === ledgerId);
    if (r) r.lateFeeWaived = waive;
  });
}

Object.assign(window, {
  lateFeeFor, totalOwedFor, waiveLateFee, LATE_FEE_PCT,
});

// ─── Tenant rent history ───
function getRentForMonth(tenant, monthIso) {
  const dayOne = monthIso + '-01';
  const history = (tenant.rentHistory || []).slice().sort((a,b) => a.effectiveDate.localeCompare(b.effectiveDate));
  let amount = tenant.rent || 0;
  for (const h of history) {
    if (h.effectiveDate <= dayOne) amount = h.amount;
    else break;
  }
  return amount;
}
function addRentChange(tenantId, change) {
  Store.update(s => {
    const t = s.tenants.find(x => x.id === tenantId);
    if (!t) return;
    t.rentHistory = t.rentHistory || [];
    t.rentHistory.push({ effectiveDate: change.effectiveDate, amount: change.amount, note: change.note || '' });
    t.rentHistory.sort((a,b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const today = s.today;
    const mostRecentPast = t.rentHistory.filter(h => h.effectiveDate <= today).pop();
    if (mostRecentPast) t.rent = mostRecentPast.amount;
    // Update unpaid future ledger entries
    s.rentLedger.forEach(r => {
      if (r.tenantId !== tenantId) return;
      if (r.status === 'paid' || r.status === 'partial') return;
      const newAmt = getRentForMonth(t, r.month);
      if (newAmt !== r.charge) r.charge = newAmt;
    });
  });
}
function deleteRentChange(tenantId, idx) {
  Store.update(s => {
    const t = s.tenants.find(x => x.id === tenantId);
    if (!t || !t.rentHistory) return;
    t.rentHistory.splice(idx, 1);
  });
}

// ─── Lease renewal candidates ───
function getLeaseRenewalCandidates() {
  const today = TODAY();
  const out = [];
  Store.state.tenants.forEach(t => {
    if (t.status !== 'active' || !t.leaseEnd) return;
    const days = daysBetween(today, t.leaseEnd);
    if (days < -7 || days > 90) return;
    out.push({ tenant: t, days });
  });
  return out.sort((a,b) => a.days - b.days);
}

Object.assign(window, {
  getRentForMonth, addRentChange, deleteRentChange,
  getLeaseRenewalCandidates,
});

// ─── Managed lists (categories, payment sources, loan types) ───
function getList(listKey, { includeArchived = false } = {}) {
  const list = (Store.state.lists?.[listKey]) || [];
  const filtered = includeArchived ? list : list.filter(x => !x.archived);
  // Always alphabetical by label (case-insensitive), so every dropdown reads A→Z.
  // Coerce to String — some list items can carry a numeric label.
  return [...filtered].sort((a, b) =>
    String(a.label ?? '').localeCompare(String(b.label ?? ''), undefined, { sensitivity: 'base', numeric: true }));
}
// Properties sorted alphabetically by address — use for dropdown option lists.
function sortedProperties() {
  return [...(Store.state.properties || [])].sort((a, b) =>
    String(a.address ?? '').localeCompare(String(b.address ?? ''), undefined, { sensitivity: 'base', numeric: true }));
}
function addListItem(listKey, item) {
  Store.update(s => {
    s.lists = s.lists || {};
    s.lists[listKey] = s.lists[listKey] || [];
    const id = listKey + '-' + Date.now();
    s.lists[listKey].push({ id, archived: false, isDefault: false, ...item });
  });
}
function renameListItem(listKey, id, newLabel) {
  Store.update(s => {
    const item = s.lists[listKey].find(x => x.id === id);
    if (!item) return;
    const oldLabel = item.label;
    item.label = newLabel;
    if (listKey === 'categories') {
      s.transactions.forEach(t => {
        if (t.category === oldLabel) t.category = newLabel;
        if (t.splits) t.splits.forEach(sp => { if (sp.category === oldLabel) sp.category = newLabel; });
      });
    } else if (listKey === 'paymentSources') {
      s.tenants.forEach(tn => { if (tn.source === oldLabel) tn.source = newLabel; });
      s.rentLedger.forEach(r => { if (r.source === oldLabel) r.source = newLabel; });
    } else if (listKey === 'loanTypes') {
      s.properties.forEach(p => { if (p.loanType === oldLabel) p.loanType = newLabel; });
    } else if (listKey === 'vestingLLCs') {
      s.properties.forEach(p => { if (p.vestingLLC === oldLabel) p.vestingLLC = newLabel; });
    } else if (listKey === 'propertyTypes') {
      s.properties.forEach(p => { if (p.type === oldLabel) p.type = newLabel; });
    }
  });
}
function archiveListItem(listKey, id) {
  Store.update(s => {
    const item = s.lists[listKey].find(x => x.id === id);
    if (item) item.archived = !item.archived;
  });
}
function updateListItemKind(listKey, id, kind) {
  Store.update(s => {
    const item = s.lists[listKey].find(x => x.id === id);
    if (item) item.kind = kind;
  });
}
function countUsage(listKey, label) {
  const s = Store.state;
  if (listKey === 'categories') {
    let n = 0;
    s.transactions.forEach(t => {
      if (t.category === label) n++;
      if (t.splits) t.splits.forEach(sp => { if (sp.category === label) n++; });
    });
    return n;
  }
  if (listKey === 'paymentSources') {
    return s.tenants.filter(t => t.source === label).length
      + s.rentLedger.filter(r => r.source === label).length;
  }
  if (listKey === 'loanTypes') {
    return s.properties.filter(p => p.loanType === label).length;
  }
  if (listKey === 'vestingLLCs') {
    return s.properties.filter(p => p.vestingLLC === label).length;
  }
  if (listKey === 'propertyTypes') {
    return s.properties.filter(p => p.type === label).length;
  }
  return 0;
}

Object.assign(window, {
  getList, addListItem, renameListItem, archiveListItem, updateListItemKind, countUsage,
});

// ─── Bank accounts (referenced by transactions via acct = account id) ───
const ACCOUNT_KINDS = ['checking', 'savings', 'credit', 'cash'];
function addAccount(label, kind) {
  const id = 'acct-' + Date.now().toString(36);
  Store.update(s => {
    s.accounts = s.accounts || [];
    s.accounts.push({ id, label: (label || '').trim(), kind: kind || 'checking' });
  });
  return id;
}
function updateAccount(id, patch) {
  Store.update(s => {
    const a = (s.accounts || []).find(x => x.id === id);
    if (a) Object.assign(a, patch);
  });
}
function deleteAccount(id) {
  Store.update(s => { s.accounts = (s.accounts || []).filter(x => x.id !== id); });
}
function accountUsage(id) {
  return (Store.state.transactions || []).filter(t => String(t.acct) === String(id)).length;
}

// ─── Team members (referenced by properties via assigned = name string) ───
function addTeamMember(name) {
  const n = (name || '').trim();
  Store.update(s => {
    s.team = s.team || [];
    if (n && !s.team.includes(n)) s.team.push(n);
  });
}
function renameTeamMember(oldName, newName) {
  const n = (newName || '').trim();
  if (!n) return;
  Store.update(s => {
    const i = (s.team || []).indexOf(oldName);
    if (i >= 0) s.team[i] = n;
    // Propagate the rename to every property assigned to this person
    (s.properties || []).forEach(p => { if (p.assigned === oldName) p.assigned = n; });
  });
}
function removeTeamMember(name) {
  Store.update(s => { s.team = (s.team || []).filter(x => x !== name); });
}
function teamUsage(name) {
  return (Store.state.properties || []).filter(p => p.assigned === name).length;
}

Object.assign(window, {
  ACCOUNT_KINDS, addAccount, updateAccount, deleteAccount, accountUsage,
  addTeamMember, renameTeamMember, removeTeamMember, teamUsage,
});

// ─── Calendar event completion (events are derived; we persist a set of done keys) ───
function toggleEventDone(key) {
  if (!key) return;
  Store.update(s => {
    s.completedEvents = s.completedEvents || {};
    if (s.completedEvents[key]) delete s.completedEvents[key];
    else s.completedEvents[key] = true;
  });
}
function isEventDone(key) {
  return !!(Store.state.completedEvents && Store.state.completedEvents[key]);
}
Object.assign(window, { toggleEventDone, isEventDone });

// ─── Tasks: priority + checklist ───
const TASK_PRIORITY = ['high', 'normal', 'low'];
const TASK_PRIORITY_LABEL = { high: 'High', normal: 'Normal', low: 'Low' };
const TASK_PRIORITY_TONE  = { high: 'brick', normal: 'ghost', low: 'ghost' };

function toggleTaskChecklistItem(taskId, itemId) {
  Store.update(s => {
    const r = (s.reminders || []).find(x => x.id === taskId);
    if (!r || !Array.isArray(r.checklist)) return;
    const it = r.checklist.find(c => c.id === itemId);
    if (it) it.done = !it.done;
  });
}

function addDaysISO(iso, n) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Unified calendar event aggregation ──────────────────────────────────────
// One place that turns every dated thing in the app into a normalized event:
//   { key, cat, date, title, sub, propertyId?, taskId?, priority?, recurrence?, done, days }
// `cat` drives the legend, filters, and color. Derived (non-task) events use the
// existing completedEvents set for done-state; tasks use the reminders model.
const CAL_CATS = {
  task:      { label: 'Tasks',         color: 'var(--ochre)'     },
  rent:      { label: 'Rent due',      color: 'var(--sage)'      },
  lease:     { label: 'Lease ends',    color: 'var(--blue)'      },
  insurance: { label: 'Insurance',     color: 'var(--tan)'       },
  tax:       { label: 'Property tax',  color: '#7a5c1e'          },
  refi:      { label: 'Refi',          color: 'var(--blue-deep)' },
  exch:      { label: '1031',          color: 'var(--brick)'     },
  deal:      { label: 'Sale / closing',color: 'var(--blue-deep)' },
};
const CAL_CAT_ORDER = ['task', 'rent', 'lease', 'insurance', 'tax', 'refi', 'exch', 'deal'];

function buildCalendarEvents(fromIso, toIso) {
  const s = Store.state;
  const today = TODAY();
  const out = [];
  const inRange = d => d && d >= fromIso && d <= toIso;
  const push = e => { if (inRange(e.date)) out.push(e); };

  // Tasks (reminders) — open only; recurring tasks show their next occurrence
  (s.reminders || []).forEach(r => {
    if (r.done || !r.dueDate) return;
    const prop = getProperty(r.propertyId);
    push({
      key: 'task:' + r.id, cat: 'task', date: r.dueDate, taskId: r.id,
      title: r.title, sub: prop ? prop.address : '', propertyId: r.propertyId,
      priority: r.priority || 'normal', recurrence: r.recurrence || 'none', done: false,
    });
  });

  // Per-property dated milestones
  (s.properties || []).forEach(p => {
    if (p.insurance && p.insurance.renewalDate) {
      const k = 'ins:' + p.id + ':' + p.insurance.renewalDate;
      push({ key: k, cat: 'insurance', date: p.insurance.renewalDate,
        title: 'Insurance renewal' + (p.insurance.carrier ? ' · ' + p.insurance.carrier : ''),
        sub: p.address, propertyId: p.id, done: isEventDone(k) });
    }
    if (p.taxes && p.taxes.dueDate && !p.taxes.escrowed) {
      const k = 'tax:' + p.id + ':' + p.taxes.dueDate;
      push({ key: k, cat: 'tax', date: p.taxes.dueDate,
        title: 'Property tax due' + (p.taxes.annualAmount ? ' · ' + fmtMoney(p.taxes.annualAmount) : ''),
        sub: p.address, propertyId: p.id, done: isEventDone(k) });
    }
    if (p.signingDate) {
      const k = 'sign:' + p.id + ':' + p.signingDate;
      push({ key: k, cat: 'deal', date: p.signingDate, title: 'Signing' + (p.closingTime ? ' · ' + p.closingTime : ''),
        sub: p.address, propertyId: p.id, done: isEventDone(k) });
    }
    if (p.saleSigningDate) {
      const k = 'salesign:' + p.id + ':' + p.saleSigningDate;
      push({ key: k, cat: 'deal', date: p.saleSigningDate, title: 'Sale signing' + (p.saleSigningTime ? ' · ' + p.saleSigningTime : ''),
        sub: p.address, propertyId: p.id, done: isEventDone(k) });
    }
    if (p.ddDate) {
      const k = 'dd:' + p.id + ':' + p.ddDate;
      push({ key: k, cat: 'deal', date: p.ddDate, title: 'Due-diligence deadline',
        sub: p.address, propertyId: p.id, done: isEventDone(k) });
    }
    if (p.expectedCloseDate) {
      const k = 'close:' + p.id + ':' + p.expectedCloseDate;
      push({ key: k, cat: 'deal', date: p.expectedCloseDate, title: 'Expected closing',
        sub: p.address, propertyId: p.id, done: isEventDone(k) });
    }
  });

  // Lease ends
  (s.tenants || []).forEach(t => {
    if (t.status !== 'active' || !t.leaseEnd) return;
    const prop = getProperty(t.propertyId);
    const k = 'lease:' + t.id + ':' + t.leaseEnd;
    push({ key: k, cat: 'lease', date: t.leaseEnd, title: 'Lease ends · ' + (t.name || 'Tenant'),
      sub: prop ? prop.address : '', propertyId: t.propertyId, done: isEventDone(k) });
  });

  // Refi target closes
  (s.refis || []).forEach(r => {
    if (r.status === 'done' || !r.targetClose) return;
    const prop = getProperty(r.propertyId);
    const k = 'refi:' + r.id + ':' + r.targetClose;
    push({ key: k, cat: 'refi', date: r.targetClose,
      title: 'Refi target close' + (r.lender ? ' · ' + r.lender : ''),
      sub: prop ? prop.address : '', propertyId: r.propertyId, done: isEventDone(k) });
  });

  // 1031 exchange deadlines (45-day ID + 180-day close)
  (s.exchanges || []).forEach(e => {
    if (e.status !== 'active' || !e.relinquishedSoldDate) return;
    const k45 = 'x45:' + e.id, k180 = 'x180:' + e.id;
    push({ key: k45, cat: 'exch', date: addDaysISO(e.relinquishedSoldDate, 45),
      title: '45-day 1031 ID deadline', sub: e.relinquishedAddress || '', done: isEventDone(k45) });
    push({ key: k180, cat: 'exch', date: addDaysISO(e.relinquishedSoldDate, 180),
      title: '180-day 1031 close', sub: e.relinquishedAddress || '', done: isEventDone(k180) });
  });

  // Rent due — 1st of each month in range (portfolio-wide), if there are renters
  const renters = (s.tenants || []).filter(t => t.status === 'active' && (t.rent || 0) > 0);
  if (renters.length) {
    let m = fromIso.slice(0, 7);
    const endM = toIso.slice(0, 7);
    let guard = 0;
    while (m <= endM && guard < 240) {
      const d = m + '-01';
      const k = 'rent:' + m;
      push({ key: k, cat: 'rent', date: d,
        title: 'Rent due · ' + renters.length + ' tenant' + (renters.length === 1 ? '' : 's'),
        sub: '', done: isEventDone(k) });
      m = addMonthsISO(d, 1).slice(0, 7);
      guard++;
    }
  }

  out.forEach(e => { e.days = daysBetween(today, e.date); });
  out.sort((a, b) => a.date.localeCompare(b.date) || CAL_CAT_ORDER.indexOf(a.cat) - CAL_CAT_ORDER.indexOf(b.cat));
  return out;
}

// Upcoming events for the dashboard peek: a window around today, open items only.
function getUpcomingCalendarEvents(withinDays = 21, daysPast = 14) {
  const today = TODAY();
  return buildCalendarEvents(addDaysISO(today, -daysPast), addDaysISO(today, withinDays))
    .filter(e => !e.done)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Complete an event regardless of kind (task vs. derived milestone).
function completeCalendarEvent(e) {
  if (!e) return;
  if (e.taskId) completeReminder(e.taskId);
  else toggleEventDone(e.key);
}

Object.assign(window, {
  TASK_PRIORITY, TASK_PRIORITY_LABEL, TASK_PRIORITY_TONE, toggleTaskChecklistItem,
  addDaysISO, CAL_CATS, CAL_CAT_ORDER,
  buildCalendarEvents, getUpcomingCalendarEvents, completeCalendarEvent,
});

// ─── Transaction triage mutation ───
function commitImportRows(rows) {
  Store.update(s => {
    let nextId = (s.transactions.reduce((a,t) => Math.max(a, parseInt(t.id.slice(1))||0), 0)) + 1;
    rows.forEach(r => {
      s.transactions.push({
        id: 't' + (nextId++),
        date: r.date, acct: r.acct, desc: r.desc, amount: r.amount,
        payee: r.payee || '', category: r.category || '', project: r.project || '',
        monthSheet: '', importBatch: r.batch || s.today,
      });
    });
  });
}

// ────────── Display helpers ──────────

// ─── Pipeline statuses (data-driven; editable in Settings) ───────────────────
// Behaviour keys off the SYSTEM codes below (A utilities prompt, C/F/G staleness,
// G contract, I/J archive, K rental). Labels/colors/order are user-editable, and
// custom statuses can be added. `lane` places a status: pipeline (linear A→H),
// rental (K sidecar), or archive (I/J). STATUS_LABEL / STATUS_ORDER are kept live.
const SYSTEM_STATUS_INFO = {
  A: 'shows the "set up utilities" prompt when a property leaves it',
  C: 'drives the stale-deal warning (over 60 days)',
  F: 'drives the stale-deal warning (over 45 days)',
  G: 'is the Under Contract step and triggers the contract confirmation',
  H: 'is the Pending 1031 step',
  I: 'is the Sold archive state (powers P&L, tax binder, sold-gap checks)',
  J: 'is the Failed archive state',
  K: 'is the Rental sidecar (powers tenants, refi, rental vesting)',
};
function defaultStatuses() {
  return [
    { code:'A', label:'Coming Soon',       lane:'pipeline', system:true, tone:null },
    { code:'B', label:'Rehab Not Started', lane:'pipeline', system:true, tone:null },
    { code:'C', label:'Rehab',             lane:'pipeline', system:true, tone:null },
    { code:'D', label:'Ready to Rent',     lane:'pipeline', system:true, tone:null },
    { code:'E', label:'Ready to List',     lane:'pipeline', system:true, tone:null },
    { code:'F', label:'On Market',         lane:'pipeline', system:true, tone:null },
    { code:'G', label:'Under Contract',    lane:'pipeline', system:true, tone:null },
    { code:'H', label:'Pending 1031',      lane:'pipeline', system:true, tone:null },
    { code:'K', label:'Rental',            lane:'rental',   system:true, tone:null },
    { code:'I', label:'Sold',              lane:'archive',  system:true, tone:null },
    { code:'J', label:'Failed',            lane:'archive',  system:true, tone:null },
  ];
}

// Curated brand tones used for custom statuses and recoloring. Each maps to the
// same soft-bg / strong-fg / border recipe the default pips use.
const STATUS_TONES = {
  sand:  { bg:'#f0e8d8',            fg:'#6a5b30',           border:'#d8c98e' },
  ochre: { bg:'var(--ochre-soft)',  fg:'var(--ochre)',      border:'#d9b780' },
  sky:   { bg:'var(--blue-tint)',   fg:'var(--blue-deep)',  border:'var(--blue-soft)' },
  tan:   { bg:'var(--tan-soft)',    fg:'var(--tan)',        border:'#c8bd9e' },
  sage:  { bg:'var(--sage-soft)',   fg:'var(--sage)',       border:'#b9cba8' },
  blue:  { bg:'var(--blue-soft)',   fg:'var(--blue-deep)',  border:'var(--blue)' },
  brick: { bg:'var(--brick-soft)',  fg:'var(--brick)',      border:'#d8a89e' },
  slate: { bg:'var(--paper-3)',     fg:'var(--ink-2)',      border:'var(--rule)' },
};
const STATUS_TONE_KEYS = Object.keys(STATUS_TONES);

// Live, mutated-in-place so existing references across files stay valid.
const STATUS_LABEL = {};
const STATUS_ORDER = [];
const STATUS_TONE = {};   // code -> tone key (null = use the .pip--CODE class)
function getStatuses() {
  return (Store.state && Array.isArray(Store.state.statuses) && Store.state.statuses.length)
    ? Store.state.statuses : defaultStatuses();
}
function getStatus(code) { return getStatuses().find(s => s.code === code) || null; }
function rebuildStatusGlobals() {
  const list = getStatuses();
  Object.keys(STATUS_LABEL).forEach(k => delete STATUS_LABEL[k]);
  Object.keys(STATUS_TONE).forEach(k => delete STATUS_TONE[k]);
  STATUS_ORDER.length = 0;
  list.forEach(s => {
    STATUS_LABEL[s.code] = s.label;
    STATUS_TONE[s.code] = s.tone || null;
    if (s.lane === 'pipeline') STATUS_ORDER.push(s.code);
  });
}

// ── Status editor mutations ──
function nextStatusCode() {
  const used = new Set(getStatuses().map(s => s.code));
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!used.has(c)) return c; }
  let n = 1; while (used.has('S' + n)) n++; return 'S' + n; // overflow fallback
}
function nextStatusTone() {
  const used = getStatuses().map(s => s.tone).filter(Boolean);
  return STATUS_TONE_KEYS.find(t => !used.includes(t)) || STATUS_TONE_KEYS[used.length % STATUS_TONE_KEYS.length];
}
function addStatus({ label, lane = 'pipeline' } = {}) {
  const code = nextStatusCode();
  Store.update(s => {
    s.statuses = getStatuses().map(x => ({ ...x }));
    const item = { code, label: (label || 'New status').trim(), lane, system:false, tone: nextStatusTone() };
    if (lane === 'pipeline') {
      // insert after the last pipeline lane status
      let idx = -1;
      s.statuses.forEach((x, i) => { if (x.lane === 'pipeline') idx = i; });
      s.statuses.splice(idx + 1, 0, item);
    } else {
      s.statuses.push(item);
    }
    rebuildStatusGlobals();
  });
  return code;
}
function updateStatus(code, patch) {
  Store.update(s => {
    s.statuses = getStatuses().map(x => x.code === code ? { ...x, ...patch } : { ...x });
    rebuildStatusGlobals();
  });
}
function reorderStatus(code, dir) {  // dir: -1 up, +1 down — within the same lane
  Store.update(s => {
    const list = getStatuses().map(x => ({ ...x }));
    const i = list.findIndex(x => x.code === code);
    if (i < 0) return;
    const lane = list[i].lane;
    // find the adjacent index in the same lane in the requested direction
    let j = i + dir;
    while (j >= 0 && j < list.length && list[j].lane !== lane) j += dir;
    if (j < 0 || j >= list.length) return;
    const [moved] = list.splice(i, 1);
    list.splice(j, 0, moved);
    s.statuses = list;
    rebuildStatusGlobals();
  });
}
function deleteStatus(code, reassignTo) {
  Store.update(s => {
    s.statuses = getStatuses().filter(x => x.code !== code).map(x => ({ ...x }));
    if (reassignTo) {
      s.properties.forEach(p => {
        if (p.statusCode === code) {
          p.statusCode = reassignTo;
          p.stageHistory = p.stageHistory || [];
          p.stageHistory.push({ from: code, to: reassignTo, at: s.today, note: 'Status "'+code+'" deleted — reassigned', by: 'settings' });
        }
        // rewrite any history references so labels resolve
        (p.stageHistory || []).forEach(h => { if (h.to === code) h.to = reassignTo; if (h.from === code) h.from = reassignTo; });
      });
    }
    rebuildStatusGlobals();
  });
}
function statusUsage(code) {
  return (Store.state.properties || []).filter(p => p.statusCode === code).length;
}

function fmtMoney(n, opts={}) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const s = abs.toLocaleString(undefined, { minimumFractionDigits: opts.dp ?? 0, maximumFractionDigits: opts.dp ?? 0 });
  return (opts.sign && n>=0 ? '+' : '') + sign + '$' + s;
}
function fmtDate(iso, opts={}) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  if (isNaN(d.getTime())) return iso;
  const monthsShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (opts.full) return monthsShort[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  return monthsShort[d.getMonth()] + ' ' + d.getDate();
}
function daysBetween(a, b) {
  const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00');
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
}

Object.assign(window, {
  Store, useStore, TODAY,
  getProperty, getPropertyByAddr, getTenant, getTenantsForProperty, getActiveTenants,
  getLedgerForMonth, ensureLedgerForMonth, getLedgerForTenant, dedupeRentLedger, getTxForProperty, untaggedTransactions, getCurrentMonth,
  markPaid, markUnpaid, autoReconcileRentForMonth, reconcileRentAcrossMonths, advanceStage, changeStage, tagTransaction, setUI,
  daysInCurrentStage, stageBackwardCount,
  addContractor, updateContractor, deleteContractor,
  REFI_STAGES, REFI_STAGE_LABEL, updateRefi, addRefi,
  getExchange, updateExchange,
  commitImportRows,
  STATUS_LABEL, STATUS_ORDER, STAGE_LABEL_MAP,
  STATUS_TONES, STATUS_TONE, STATUS_TONE_KEYS, SYSTEM_STATUS_INFO,
  getStatuses, getStatus, defaultStatuses, rebuildStatusGlobals,
  addStatus, updateStatus, reorderStatus, deleteStatus, statusUsage,
  UTILITY_TYPES, UTILITY_STATUS, UTILITY_STATUS_TONE, utilitiesSetUp,
  fmtMoney, fmtDate, daysBetween, initials,
  buildIntegrityChecks, getActiveIntegrityChecks, getDismissedIntegrityChecks,
  dismissCheck, restoreCheck, clearAllChecks, focusIssue, takeFocus, liveFocusIds, OVERHEAD_PROJECTS,
  getAutoTagRules, addAutoTagRule, updateAutoTagRule, deleteAutoTagRule,
  moveAutoTagRule, resetAutoTagRules, compileAutoTagRule,
});

// Build the live status globals from current state, and keep them fresh on every
// store change (cheap — ~11 entries) so renames/recolors/reorders show instantly.
rebuildStatusGlobals();
const _origNotify = Store.notify.bind(Store);
Store.notify = function () { rebuildStatusGlobals(); _origNotify(); };
