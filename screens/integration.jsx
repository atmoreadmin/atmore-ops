// screens/integration.jsx — backend prep / Google Sheets integration

// Sheet schema: defines every tab + column in the canonical Google Sheets workbook
const SHEET_SCHEMA = {
  Properties: {
    description: 'Master list of every property — the spine of the system. Insurance, loan, tax and HOA details are folded in as columns (one row per property).',
    pk: 'id',
    rowSource: (s) => s.properties.map(p => {
      const ins = p.insurance || {}, loan = p.loanDetail || {}, tax = p.taxes || {};
      const hoas = (s.hoas || []).filter(h => h.propertyId === p.id);
      const h1 = hoas[0] || {}, h2 = hoas[1] || {};
      return {
        ...p,
        utilityNote: (p.utilities && p.utilities.note) || null,
        insCarrier: ins.carrier || null, insPolicy: ins.policyNumber || null, insPremium: ins.premium ?? null,
        insRenewal: ins.renewalDate || null, insAgent: ins.agentName || null, insAgentPhone: ins.agentPhone || null,
        loanLender: loan.lender || null, loanNumber: loan.loanNumber || null, loanPayment: loan.monthlyPayment ?? null,
        loanBalance: loan.currentBalance ?? null, loanRate: loan.interestRate ?? null, loanMaturity: loan.maturityDate || null,
        loanEscrowTaxes: loan.escrowedTaxes ?? null, loanEscrowIns: loan.escrowedInsurance ?? null, loanContact: loan.lenderContact || null,
        taxAnnual: tax.annualAmount ?? null, taxDueDate: tax.dueDate || null, taxEscrowed: tax.escrowed ?? null, taxParcel: tax.taxId || null,
        hoa1Name: h1.name || null, hoa1Url: h1.website || null, hoa1User: h1.username || null, hoa1Pass: h1.password || null, hoa1Monthly: h1.monthly ?? null,
        hoa2Name: h2.name || null, hoa2Url: h2.website || null, hoa2User: h2.username || null, hoa2Pass: h2.password || null, hoa2Monthly: h2.monthly ?? null,
      };
    }),
    columns: [
      { key: 'id',              label: 'ID',                 type: 'string', required: true,  notes: 'Internal ID' },
      { key: 'address',         label: 'Address',            type: 'string', required: true },
      { key: 'type',            label: 'Type',               type: 'enum',   required: true,  notes: 'Wholesale / Flip / Rental / 1031' },
      { key: 'status',          label: 'Status',             type: 'enum',   required: true,  notes: 'A — Coming Soon, etc.' },
      { key: 'statusCode',      label: 'Status Code',        type: 'string', required: true,  notes: 'A–K' },
      { key: 'city',            label: 'City',               type: 'string' },
      { key: 'county',          label: 'County',             type: 'string' },
      { key: 'state',           label: 'State',              type: 'string' },
      { key: 'zip',             label: 'Zip',                type: 'string' },
      { key: 'assigned',        label: 'Assigned Person',    type: 'string' },
      { key: 'loanType',        label: 'Loan Type',          type: 'enum' },
      { key: 'financingType',   label: 'Financing',          type: 'enum', notes: 'DSCR / Cash / Bridge' },
      { key: 'lockbox',         label: 'Lockbox Code',       type: 'string' },
      { key: 'ddDate',          label: 'DD Date',            type: 'date' },
      { key: 'signingDate',     label: 'Signing Date',       type: 'date' },
      { key: 'purchaseDate',    label: 'Purchase Date',      type: 'date' },
      { key: 'purchasePrice',   label: 'Purchase Price',     type: 'money' },
      { key: 'acqEarnest',      label: 'Earnest Money',      type: 'money', notes: 'Earnest deposit on the purchase (buy side)' },
      { key: 'purchaseFees',    label: 'Purchase Fees',      type: 'money' },
      { key: 'purchaseCredits', label: 'Purchase Credits',   type: 'money' },
      { key: 'purchaseLoan',    label: 'Purchase Loan',      type: 'money' },
      { key: 'acqExchangeFunds',label: '1031 Funds Brought In (Buy)', type: 'money', notes: 'Replacement side — exchange proceeds applied to this purchase, reduces cash to close' },
      { key: 'acqDDFee',        label: 'Due Diligence Fee (Buy)', type: 'money', notes: 'Non-refundable DD fee paid at purchase (already inside price)' },
      { key: 'rehab',           label: 'Rehab Spent',        type: 'money' },
      { key: 'rehabFunds',      label: 'Rehab Budget',       type: 'money' },
      { key: 'rehabDraws',      label: 'Rehab Funds From Lender', type: 'money', notes: 'Draws requested from the lender — repaid inside loan payoff' },
      { key: 'interest',        label: 'Interest Accrued',   type: 'money' },
      { key: 'salesDate',       label: 'Sales Date',         type: 'date' },
      { key: 'saleSigningDate',  label: 'Sale Signing Date',  type: 'date',   notes: 'Closing/signing appointment date (sale side)' },
      { key: 'saleSigningTime',  label: 'Sale Signing Time',  type: 'string', notes: 'HH:MM 24-hour' },
      { key: 'listPrice',       label: 'List Price',         type: 'money',  notes: 'Asking price while on market' },
      { key: 'salesPrice',      label: 'Sales Price',        type: 'money' },
      { key: 'grossProfit',     label: 'Gross Profit',       type: 'money' },
      { key: 'vestingLLC',      label: 'Vesting LLC',        type: 'string' },
      { key: 'driveUrl',        label: 'Drive Folder URL',   type: 'url' },
      { key: 'failedReason',    label: 'Failed Reason',      type: 'string',  notes: 'Only set for J-Failed' },
      { key: 'notes',           label: 'Notes',              type: 'string',  notes: 'Freeform property notes' },
      { key: 'attorney',        label: 'Closing Attorney',   type: 'string' },
      { key: 'attorneyContact', label: 'Attorney Contact',   type: 'string' },
      { key: 'closingTime',     label: 'Closing Time',       type: 'string', notes: 'HH:MM 24-hour' },
      { key: 'salesFees',        label: 'Sale Closing Costs',  type: 'money',  notes: 'Closing costs on the sale' },
      { key: 'salesCredits',     label: 'Seller Concessions',  type: 'money' },
      { key: 'salesLoanPayoff',  label: 'Loan Payoff at Close',type: 'money' },
      { key: 'atmoreLoanPrincipal', label: 'Atmore Loan Principal', type: 'money', notes: 'Principal Atmore fronted — nets to zero against payoff' },
      { key: 'atmoreLoanPayoff',    label: 'Atmore Loan Payoff',    type: 'money', notes: 'Amount repaid to Atmore; payoff − principal = interest cost' },
      { key: 'saleDDCollected',  label: 'DD Fee Collected',    type: 'money',  notes: 'Due diligence fee collected from buyer — counts as income' },
      { key: 'saleEarnest',      label: 'Buyer Earnest (Sale)',type: 'money',  notes: 'Buyer EMD — nets through closing, informational' },
      { key: 'exchangeFunds',    label: '1031 Funds Rolled Out (Sale)', type: 'money', notes: 'Relinquished side — sale proceeds rolled into the exchange when this property is sold' },
      { key: 'saleAttorney',     label: 'Sale Closing Attorney', type: 'text' },
      { key: 'saleCreditsReceived', label: 'Sale Credits Received', type: 'money', notes: 'Credits paid to you at closing (tax prorations etc.) — adds to profit' },
      { key: 'interestCredit',   label: 'Interest Credit',     type: 'money', notes: 'Credit received back after closing on the loan — reduces interest cost' },
      { key: 'otherFees',        label: 'Other Fees',          type: 'money', notes: 'Miscellaneous deal costs' },
      { key: 'cashToClose',      label: 'Cash To Close (Actual)', type: 'money', notes: 'From the purchase HUD — cash actually brought to closing' },
      { key: 'cashReceivedAtClose', label: 'Cash Received At Closing (Actual)', type: 'money', notes: 'From the sales HUD — cash actually received' },
      { key: 'contractDate',     label: 'Under Contract Date', type: 'date' },
      { key: 'buyerDDDate',      label: 'Buyer DD Deadline',   type: 'date' },
      { key: 'expectedCloseDate',label: 'Expected Close Date', type: 'date' },
      { key: 'utilityNote',      label: 'Utility Notes',       type: 'string', notes: 'Per-property note shown on the Utilities tab' },
      // ── Insurance (folded in) ──
      { key: 'insCarrier',   label: 'Insurance Carrier',   type: 'string' },
      { key: 'insPolicy',    label: 'Insurance Policy #',  type: 'string' },
      { key: 'insPremium',   label: 'Insurance Premium',   type: 'money' },
      { key: 'insRenewal',   label: 'Insurance Renewal',   type: 'date' },
      { key: 'insAgent',     label: 'Insurance Agent',     type: 'string' },
      { key: 'insAgentPhone',label: 'Insurance Agent Phone',type: 'string' },
      // ── Loan (folded in) ──
      { key: 'loanLender',     label: 'Loan Lender',        type: 'string' },
      { key: 'loanNumber',     label: 'Loan #',             type: 'string' },
      { key: 'loanPayment',    label: 'Loan Monthly Payment',type: 'money' },
      { key: 'loanBalance',    label: 'Loan Balance',       type: 'money' },
      { key: 'loanRate',       label: 'Loan Rate %',        type: 'number' },
      { key: 'loanMaturity',   label: 'Loan Maturity',      type: 'date' },
      { key: 'loanEscrowTaxes',label: 'Loan Escrows Taxes', type: 'bool' },
      { key: 'loanEscrowIns',  label: 'Loan Escrows Insurance',type: 'bool' },
      { key: 'loanContact',    label: 'Lender Contact',     type: 'string' },
      // ── Property tax (folded in) ──
      { key: 'taxAnnual',  label: 'Tax Annual Amount', type: 'money' },
      { key: 'taxDueDate', label: 'Tax Due Date',      type: 'date' },
      { key: 'taxEscrowed',label: 'Tax Escrowed',      type: 'bool' },
      { key: 'taxParcel',  label: 'Parcel / Tax ID',   type: 'string' },
      // ── HOA 1 & 2 (folded in; 3+ HOAs are rare and edited in-app) ──
      { key: 'hoa1Name',   label: 'HOA 1 Name',      type: 'string' },
      { key: 'hoa1Url',    label: 'HOA 1 Portal',    type: 'url' },
      { key: 'hoa1User',   label: 'HOA 1 Username',  type: 'string' },
      { key: 'hoa1Pass',   label: 'HOA 1 Password',  type: 'string' },
      { key: 'hoa1Monthly',label: 'HOA 1 Monthly',   type: 'money' },
      { key: 'hoa2Name',   label: 'HOA 2 Name',      type: 'string' },
      { key: 'hoa2Url',    label: 'HOA 2 Portal',    type: 'url' },
      { key: 'hoa2User',   label: 'HOA 2 Username',  type: 'string' },
      { key: 'hoa2Pass',   label: 'HOA 2 Password',  type: 'string' },
      { key: 'hoa2Monthly',label: 'HOA 2 Monthly',   type: 'money' },
    ],
  },
  Tenants: {
    description: 'Each lease — past, active, and prospective.',
    pk: 'id',
    rowSource: (s) => s.tenants,
    columns: [
      { key: 'id',         label: 'ID',                type: 'string', required: true },
      { key: 'propertyId', label: 'Property ID',       type: 'fk',     required: true, notes: 'References Properties.id' },
      { key: 'name',       label: 'Tenant Name',       type: 'string' },
      { key: 'phone',      label: 'Phone',             type: 'string' },
      { key: 'email',      label: 'Email',             type: 'string' },
      { key: 'moveIn',     label: 'Move-in Date',      type: 'date' },
      { key: 'leaseEnd',   label: 'Lease End',         type: 'date' },
      { key: 'rent',       label: 'Current Rent',      type: 'money' },
      { key: 'deposit',    label: 'Security Deposit',  type: 'money' },
      { key: 'source',     label: 'Payment Source',    type: 'enum' },
      { key: 'voucher',    label: 'Voucher / HCV info',type: 'string' },
      { key: 'phaPortion', label: 'Voucher (PHA) Portion', type: 'money', notes: 'Section 8 — monthly amount paid by the housing authority' },
      { key: 'tenantPortion', label: 'Tenant Responsibility', type: 'money', notes: 'Section 8 — monthly amount the tenant pays out of pocket' },
      { key: 'occupants',  label: 'Occupants',         type: 'number' },
      { key: 'lateFeeAmount',   label: 'Late Fee Amount',    type: 'money', notes: 'Blank = default 5% of rent; 0 = no late fee' },
      { key: 'lateFeeStartDay', label: 'Late Fee Start Day', type: 'number' },
      { key: 'lateFeeMax',      label: 'Late Fee Max Cap',   type: 'money' },
      { key: 'lateFeePerDay',   label: 'Late Fee Per Day',   type: 'bool' },
      { key: 'status',     label: 'Status',            type: 'enum', notes: 'active / past / vacant / prep / vacating' },
      { key: 'notes',      label: 'Notes',             type: 'string' },
    ],
  },
  RentLedger: {
    description: 'One row per month per tenant. The source of "who paid what."',
    pk: 'id',
    rowSource: (s) => s.rentLedger,
    columns: [
      { key: 'id',            label: 'ID',              type: 'string', required: true },
      { key: 'tenantId',      label: 'Tenant ID',       type: 'fk', required: true },
      { key: 'propertyId',    label: 'Property ID',     type: 'fk', required: true },
      { key: 'month',         label: 'Month',           type: 'string', required: true, notes: 'YYYY-MM' },
      { key: 'charge',        label: 'Charge',          type: 'money' },
      { key: 'paid',          label: 'Paid',            type: 'money' },
      { key: 'paidOn',        label: 'Paid On',         type: 'date' },
      { key: 'source',        label: 'Source',          type: 'enum' },
      { key: 'status',        label: 'Status',          type: 'enum', notes: 'paid / partial / late / vacate-due / not-due' },
      { key: 'lateFeeWaived', label: 'Late Fee Waived', type: 'bool' },
      { key: 'linkedTxId',    label: 'Linked Tx ID',    type: 'fk' },
      { key: 'linkedTxIds',   label: 'Linked Tx IDs',   type: 'string', notes: 'comma-separated, all payments in the month' },
      { key: 'reducedCharge', label: 'Reduced Charge',  type: 'bool' },
      { key: 'noAutoMatch',   label: 'No Auto Match',   type: 'bool' },
    ],
  },
  Transactions: {
    description: 'Unified ledger of all money in/out across accounts.',
    pk: 'id',
    rowSource: (s) => s.transactions,
    columns: [
      { key: 'id',          label: 'ID',          type: 'string', required: true },
      { key: 'date',        label: 'Date',        type: 'date',   required: true },
      { key: 'acct',        label: 'Account',     type: 'enum',   required: true },
      { key: 'desc',        label: 'Description', type: 'string', required: true },
      { key: 'amount',      label: 'Amount',      type: 'money',  required: true, notes: 'Signed: − for charges, + for deposits' },
      { key: 'payee',       label: 'Payee',       type: 'string' },
      { key: 'category',    label: 'Category',    type: 'enum' },
      { key: 'project',     label: 'Property',    type: 'string', notes: 'Address (lookup against Properties) or "multiple"' },
      { key: 'bucket',      label: 'Bucket',      type: 'enum',   notes: 'Properties / Rentals / Office' },
      { key: 'notes',       label: 'Notes',       type: 'string' },
      { key: 'importBatch', label: 'Import Batch',type: 'string' },
    ],
  },
  Contractors: {
    description: 'Address book + 1099 tracking.',
    pk: 'id',
    rowSource: (s) => s.contractors,
    columns: [
      { key: 'id',             label: 'ID',            type: 'string', required: true },
      { key: 'name',           label: 'Name',          type: 'string', required: true },
      { key: 'phone',          label: 'Phone',         type: 'string' },
      { key: 'email',          label: 'Email',         type: 'string' },
      { key: 'specialty',      label: 'Specialty',     type: 'string' },
      { key: 'entityType',     label: 'Entity Type',   type: 'enum', notes: 'sole_prop / llc / scorp / ccorp / partnership / unknown' },
      { key: 'w9OnFile',       label: 'W-9 On File',   type: 'bool' },
      { key: 'w9Date',         label: 'W-9 Received',  type: 'date' },
      { key: 'tin',            label: 'TIN/EIN',       type: 'string' },
      { key: 'mailingAddress', label: 'Mailing Address',type: 'string' },
      { key: 'isAttorney',     label: 'Is Attorney',   type: 'bool' },
      { key: 'paidByCardOnly', label: 'Card Only',     type: 'bool', notes: 'If true, exempt from 1099 (1099-K from processor)' },
      { key: 'notes',          label: 'Notes',         type: 'string' },
    ],
  },
  Refis: {
    description: 'Refinance sidecar on K-Rental properties.',
    pk: 'id',
    rowSource: (s) => s.refis || [],
    columns: [
      { key: 'id',              label: 'ID',              type: 'string', required: true },
      { key: 'propertyId',      label: 'Property ID',     type: 'fk', required: true },
      { key: 'status',          label: 'Status',          type: 'enum', notes: 'applied / appraisalScheduled / appraisalDone / closing / done' },
      { key: 'lender',          label: 'Lender',          type: 'string' },
      { key: 'applicationDate', label: 'Application Date',type: 'date' },
      { key: 'appraisalDate',   label: 'Appraisal Date',  type: 'date' },
      { key: 'appraisedValue',  label: 'Appraised Value', type: 'money' },
      { key: 'newLoanAmount',   label: 'New Loan Amount', type: 'money' },
      { key: 'interestRate',    label: 'Interest Rate',   type: 'number' },
      { key: 'cashOut',         label: 'Cash-Out',        type: 'money' },
      { key: 'targetClose',     label: 'Target Close',    type: 'date' },
      { key: 'actualClose',     label: 'Actual Close',    type: 'date' },
      { key: 'notes',           label: 'Notes',           type: 'string' },
    ],
  },
  Exchanges: {
    description: '1031 exchanges with 45/180-day clocks.',
    pk: 'id',
    rowSource: (s) => s.exchanges || [],
    columns: [
      { key: 'id',                     label: 'ID',                       type: 'string', required: true },
      { key: 'relinquishedAddress',    label: 'Relinquished Address',      type: 'string', required: true },
      { key: 'relinquishedCity',       label: 'City/State',                type: 'string' },
      { key: 'relinquishedPropId',     label: 'Relinquished Property ID',  type: 'fk', notes: 'References Properties.id — the sold property that started the exchange' },
      { key: 'relinquishedSoldDate',   label: 'Sold Date',                 type: 'date', required: true, notes: 'Clock start' },
      { key: 'relinquishedSalePrice',  label: 'Sale Price',                type: 'money' },
      { key: 'relinquishedClosingCosts', label: 'Seller Closing Costs',    type: 'money', notes: 'Commission, attorney, recording, transfer tax' },
      { key: 'sellerCredits',          label: 'Seller Credits to Buyer',   type: 'money', notes: 'Repair credits, closing-cost credits, warranty — reduces realized amount' },
      { key: 'sellerCreditsReceived',  label: 'Credits Received by Seller', type: 'money', notes: 'Proration reimbursements in seller favor (prepaid HOA / assessments) — adds to proceeds' },
      { key: 'qiFee',                  label: 'QI Fee',                    type: 'money', notes: 'Intermediary fee — reduces basis at tax time' },
      { key: 'ddReceived',             label: 'Paid to You Directly (DD Fee)', type: 'money', notes: 'Due diligence / earnest paid outside closing — never reaches QI; potential boot' },
      { key: 'exchangeFunds',          label: 'Exchange Funds',            type: 'money', notes: 'What the QI holds (typically sale − closing costs − QI fee)' },
      { key: 'fundsDeployed',          label: 'Funds Deployed',            type: 'money' },
      { key: 'qi',                     label: 'Qualified Intermediary',    type: 'string' },
      { key: 'qiContact',              label: 'QI Contact',                type: 'string' },
      { key: 'status',                 label: 'Status',                    type: 'enum', notes: 'active / closed / failed' },
      { key: 'identifiedPropIds',      label: 'Identified Replacements',   type: 'array', notes: 'Comma-separated Property IDs, max 3' },
      { key: 'closedPropIds',          label: 'Closed Replacements',       type: 'array' },
      { key: 'notes',                  label: 'Notes',                     type: 'string' },
    ],
  },
  Leads: {
    description: 'Showing inquiries on properties being marketed.',
    pk: 'id',
    rowSource: (s) => s.leads || [],
    columns: [
      { key: 'id',         label: 'ID',          type: 'string', required: true },
      { key: 'propertyId', label: 'Property ID', type: 'fk', required: true },
      { key: 'date',       label: 'Date',        type: 'date' },
      { key: 'name',       label: 'Name',        type: 'string' },
      { key: 'phone',      label: 'Phone',       type: 'string' },
      { key: 'source',     label: 'Source',      type: 'enum' },
      { key: 'status',     label: 'Status',      type: 'enum' },
      { key: 'notes',      label: 'Notes',       type: 'string' },
    ],
  },
  Offers: {
    description: 'Offers received on properties being sold, with itemized seller concessions. Net-to-seller = offer price − concessions − seller closing costs.',
    pk: 'id',
    rowSource: (s) => (s.offers || []).map(o => ({
      ...o,
      concClosingCost:  o.concessions?.closingCost  || 0,
      concRepairCredit: o.concessions?.repairCredit || 0,
      concHomeWarranty: o.concessions?.homeWarranty || 0,
      concRateBuydown:  o.concessions?.rateBuydown  || 0,
      concOther:        o.concessions?.other        || 0,
      netToSeller: offerNetToSeller(o),
    })),
    columns: [
      { key: 'id',               label: 'ID',                  type: 'string', required: true },
      { key: 'propertyId',       label: 'Property ID',         type: 'fk', required: true, notes: 'References Properties.id' },
      { key: 'date',             label: 'Date Received',       type: 'date' },
      { key: 'buyer',            label: 'Buyer',               type: 'string', required: true },
      { key: 'buyerAgent',       label: "Buyer's Agent",       type: 'string' },
      { key: 'agentContact',     label: 'Agent Contact',       type: 'string' },
      { key: 'offerPrice',       label: 'Offer Price',         type: 'money' },
      { key: 'earnestMoney',     label: 'Earnest Money',       type: 'money' },
      { key: 'financing',        label: 'Financing',           type: 'enum', notes: 'Cash / Conventional / FHA / VA / USDA / Hard money / Seller finance / Other' },
      { key: 'closeDate',        label: 'Proposed Close',      type: 'date' },
      { key: 'status',           label: 'Status',              type: 'enum', notes: 'received / countered / accepted / rejected / withdrawn / expired' },
      { key: 'concClosingCost',  label: 'Concession: Closing Cost', type: 'money' },
      { key: 'concRepairCredit', label: 'Concession: Repair Credit', type: 'money' },
      { key: 'concHomeWarranty', label: 'Concession: Home Warranty', type: 'money' },
      { key: 'concRateBuydown',  label: 'Concession: Rate Buydown',  type: 'money' },
      { key: 'concOther',        label: 'Concession: Other',   type: 'money' },
      { key: 'closingCosts',     label: 'Seller Closing Costs', type: 'money', notes: 'Manual — commission + fees per your listing agreement' },
      { key: 'netToSeller',      label: 'Net to Seller',       type: 'money', notes: 'Computed: offer − concessions − closing costs (recomputed on read)' },
      { key: 'contingencies',    label: 'Contingencies',       type: 'array', notes: 'Comma-separated: Inspection / Appraisal / Financing / Home sale' },
      { key: 'driveUrl',         label: 'Offer Document URL',  type: 'url', notes: 'Link to the signed offer / DocuSign / Drive file' },
      { key: 'notes',            label: 'Notes',               type: 'string' },
    ],
  },
  Lists: {
    description: 'All managed dropdown lists in one place — categories, payment sources, loan types, vesting LLCs, property types, bank accounts, and team members. The "List" column says which.',
    pk: 'list+id',
    rowSource: (s) => {
      const L = s.lists || {}; const rows = [];
      (L.categories || []).forEach(x => rows.push({ list: 'category', id: x.id, label: x.label, kind: x.kind || '', archived: !!x.archived, isDefault: !!x.isDefault }));
      (L.paymentSources || []).forEach(x => rows.push({ list: 'paymentSource', id: x.id, label: x.label, kind: '', archived: !!x.archived, isDefault: !!x.isDefault }));
      (L.loanTypes || []).forEach(x => rows.push({ list: 'loanType', id: x.id, label: x.label, kind: '', archived: !!x.archived, isDefault: !!x.isDefault }));
      (L.vestingLLCs || []).forEach(x => rows.push({ list: 'vestingLLC', id: x.id, label: x.label, kind: '', archived: !!x.archived, isDefault: !!x.isDefault }));
      (L.propertyTypes || []).forEach(x => rows.push({ list: 'propertyType', id: x.id, label: x.label, kind: '', archived: !!x.archived, isDefault: !!x.isDefault }));
      (s.accounts || []).forEach(x => rows.push({ list: 'account', id: x.id, label: x.label, kind: x.kind || 'checking', archived: false, isDefault: false }));
      (s.team || []).forEach(name => rows.push({ list: 'team', id: name, label: name, kind: '', archived: false, isDefault: false }));
      return rows;
    },
    columns: [
      { key: 'list',      label: 'List',      type: 'string', required: true, notes: 'category / paymentSource / loanType / vestingLLC / propertyType / account / team' },
      { key: 'id',        label: 'ID',        type: 'string', required: true },
      { key: 'label',     label: 'Label',     type: 'string', required: true },
      { key: 'kind',      label: 'Kind',      type: 'string', notes: 'category: income/expense; account: checking/savings/credit/cash' },
      { key: 'archived',  label: 'Archived',  type: 'bool' },
      { key: 'isDefault', label: 'Built-in',  type: 'bool' },
    ],
  },
  WebAccounts: {
    description: 'Vendor / portal logins (Adobe, Amazon, bank & HOA portals, etc.). Imported from your old Web Accounts sheet.',
    pk: 'id',
    rowSource: (s) => (s.webAccounts || []).map((w, i) => ({ id: w.id || ('wa' + (i + 1)), org: w.org || '', username: w.username || '', password: w.password || '', email: w.email || '', notes: w.notes || '' })),
    columns: [
      { key: 'id',       label: 'ID',           type: 'string', required: true },
      { key: 'org',      label: 'Organization', type: 'string', required: true },
      { key: 'username', label: 'Username',     type: 'string' },
      { key: 'password', label: 'Password',     type: 'string' },
      { key: 'email',    label: 'Email',        type: 'string' },
      { key: 'notes',    label: 'Notes',        type: 'string' },
    ],
  },
  Statuses: {
    description: 'Pipeline statuses (stages a property can be in). Order within lane "pipeline" sets the board order. lane = pipeline / rental / archive. system flags built-in stages that power features.',
    pk: 'code',
    rowSource: (s) => (s.statuses && s.statuses.length ? s.statuses : window.defaultStatuses()),
    columns: [
      { key: 'code',   label: 'Code',   type: 'string', required: true },
      { key: 'label',  label: 'Label',  type: 'string', required: true },
      { key: 'lane',   label: 'Lane',   type: 'enum',   notes: 'pipeline / rental / archive' },
      { key: 'system', label: 'System', type: 'bool',   notes: 'Built-in stage (powers features)' },
      { key: 'tone',   label: 'Color',  type: 'string', notes: 'Brand tone key, blank = built-in color' },
    ],
  },
  Tasks: {
    description: 'Per-property tasks & reminders — deadlines, recurring upkeep and inspections. Powers the Calendar. Checklist is stored as a JSON array in one cell.',
    pk: 'id',
    rowSource: (s) => (s.reminders || []).map(r => ({
      id: r.id,
      propertyId: r.propertyId || '',
      title: r.title || '',
      dueDate: r.dueDate || '',
      priority: r.priority || 'normal',
      recurrence: r.recurrence || 'none',
      done: !!r.done,
      lastDone: r.lastDone || '',
      checklist: JSON.stringify(r.checklist || []),
      notes: r.notes || '',
    })),
    columns: [
      { key: 'id',         label: 'ID',          type: 'string', required: true },
      { key: 'propertyId', label: 'Property ID', type: 'fk', required: true, notes: 'References Properties.id' },
      { key: 'title',      label: 'Task',        type: 'string', required: true },
      { key: 'dueDate',    label: 'Due Date',    type: 'date' },
      { key: 'priority',   label: 'Priority',    type: 'enum', notes: 'high / normal / low' },
      { key: 'recurrence', label: 'Repeat',      type: 'enum', notes: 'none / monthly / quarterly / semiannual / annual' },
      { key: 'done',       label: 'Done',        type: 'bool' },
      { key: 'lastDone',   label: 'Last Done',   type: 'date' },
      { key: 'checklist',  label: 'Checklist',   type: 'string', notes: 'JSON array of {id,text,done}' },
      { key: 'notes',      label: 'Notes',       type: 'string' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Below: collections + record sub-details that previously lived only in the
  // browser. Each is flattened into scalar rows (one row per item, with a
  // foreign key back to its parent) so it round-trips through the flat Sheet.
  // ─────────────────────────────────────────────────────────────────────────
  Maintenance: {
    description: 'Maintenance / "Log work" records — repairs and upkeep per property.',
    pk: 'id',
    rowSource: (s) => (s.maintenance || []).map(m => ({
      id: m.id, propertyId: m.propertyId || '', date: m.date || '',
      category: m.category || '', description: m.description || '',
      vendor: m.vendor || '', cost: m.cost ?? null, status: m.status || 'open',
    })),
    columns: [
      { key: 'id',          label: 'ID',          type: 'string', required: true },
      { key: 'propertyId',  label: 'Property ID', type: 'fk', notes: 'References Properties.id' },
      { key: 'date',        label: 'Date',        type: 'date' },
      { key: 'category',    label: 'Category',    type: 'string' },
      { key: 'description', label: 'Description', type: 'string', required: true },
      { key: 'vendor',      label: 'Vendor',      type: 'string' },
      { key: 'cost',        label: 'Cost',        type: 'number' },
      { key: 'status',      label: 'Status',      type: 'enum', notes: 'open / scheduled / done' },
    ],
  },
  AutoTagRules: {
    description: 'Auto-tag rules — regex patterns that suggest a category/project on import. Row order (Ord) sets priority; first match wins.',
    pk: 'id',
    rowSource: (s) => (s.autoTagRules || []).map((r, i) => ({
      id: r.id, ord: i, pattern: r.pattern || '', category: r.category || '',
      payee: r.payee || '', project: r.project || '', conf: r.conf ?? 80,
    })),
    columns: [
      { key: 'id',       label: 'ID',         type: 'string', required: true },
      { key: 'ord',      label: 'Ord',        type: 'number', notes: 'Priority order (0 = top)' },
      { key: 'pattern',  label: 'Pattern',    type: 'string', required: true, notes: 'Case-insensitive regex matched on description' },
      { key: 'category', label: 'Category',   type: 'string' },
      { key: 'payee',    label: 'Payee',      type: 'string' },
      { key: 'project',  label: 'Project',    type: 'string', notes: 'Property id, or a token like "extract"' },
      { key: 'conf',     label: 'Confidence', type: 'number' },
    ],
  },
  TransactionSplits: {
    description: 'Split lines for a transaction (one parent transaction divided across projects/categories). FK → Transactions.id.',
    pk: 'txId+ord',
    rowSource: (s) => {
      const rows = [];
      (s.transactions || []).forEach(t => (t.splits || []).forEach((sp, i) => rows.push({
        txId: t.id, ord: i, project: sp.project || '', category: sp.category || '', amount: sp.amount ?? null,
      })));
      return rows;
    },
    columns: [
      { key: 'txId',     label: 'Transaction ID', type: 'fk', required: true, notes: 'References Transactions.id' },
      { key: 'ord',      label: 'Ord',            type: 'number' },
      { key: 'project',  label: 'Project',        type: 'string' },
      { key: 'category', label: 'Category',       type: 'string' },
      { key: 'amount',   label: 'Amount',         type: 'number' },
    ],
  },
  TenantRentHistory: {
    description: 'Rent-change history per tenant — the dated rent amounts that drive the ledger. FK → Tenants.id.',
    pk: 'tenantId+ord',
    rowSource: (s) => {
      const rows = [];
      (s.tenants || []).forEach(t => (t.rentHistory || []).forEach((h, i) => rows.push({
        tenantId: t.id, ord: i, effectiveDate: h.effectiveDate || '', amount: h.amount ?? null, note: h.note || '',
      })));
      return rows;
    },
    columns: [
      { key: 'tenantId',      label: 'Tenant ID',      type: 'fk', required: true, notes: 'References Tenants.id' },
      { key: 'ord',           label: 'Ord',            type: 'number' },
      { key: 'effectiveDate', label: 'Effective Date', type: 'date' },
      { key: 'amount',        label: 'Amount',         type: 'number' },
      { key: 'note',          label: 'Note',           type: 'string' },
    ],
  },
  ContractorTen99: {
    description: '1099 issuance history per contractor — one row per tax year. FK → Contractors.id.',
    pk: 'contractorId+taxYear',
    rowSource: (s) => {
      const rows = [];
      (s.contractors || []).forEach(c => (c.ten99History || []).forEach(h => rows.push({
        contractorId: c.id, taxYear: h.taxYear ?? null, status: h.status || '',
        issuedDate: h.issuedDate || '', amountReported: h.amountReported ?? null,
      })));
      return rows;
    },
    columns: [
      { key: 'contractorId',   label: 'Contractor ID',   type: 'fk', required: true, notes: 'References Contractors.id' },
      { key: 'taxYear',        label: 'Tax Year',        type: 'number' },
      { key: 'status',         label: 'Status',          type: 'enum', notes: 'issued / etc.' },
      { key: 'issuedDate',     label: 'Issued Date',     type: 'date' },
      { key: 'amountReported', label: 'Amount Reported', type: 'number' },
    ],
  },
  StageHistory: {
    description: 'Pipeline stage-change log per property — the audit trail of status moves and notes. FK → Properties.id.',
    pk: 'propertyId+ord',
    rowSource: (s) => {
      const rows = [];
      (s.properties || []).forEach(p => (p.stageHistory || []).forEach((h, i) => rows.push({
        propertyId: p.id, ord: i, from: h.from || '', to: h.to || '', at: h.at || '', note: h.note || '', by: h.by || '',
      })));
      return rows;
    },
    columns: [
      { key: 'propertyId', label: 'Property ID', type: 'fk', required: true, notes: 'References Properties.id' },
      { key: 'ord',        label: 'Ord',         type: 'number' },
      { key: 'from',       label: 'From',        type: 'string', notes: 'Status code moved from' },
      { key: 'to',         label: 'To',          type: 'string', notes: 'Status code moved to' },
      { key: 'at',         label: 'At',          type: 'date' },
      { key: 'note',       label: 'Note',        type: 'string' },
      { key: 'by',         label: 'By',          type: 'string', notes: 'import / user / capture / settings' },
    ],
  },
  FeeItems: {
    description: 'Itemized purchase/sale closing-fee lines per property. Kind = purchase or sale. FK → Properties.id.',
    pk: 'propertyId+kind+ord',
    rowSource: (s) => {
      const rows = [];
      (s.properties || []).forEach(p => {
        (p.purchaseFeeItems || []).forEach((it, i) => rows.push({ propertyId: p.id, kind: 'purchase', ord: i, label: it.label || '', amount: it.amount ?? null }));
        (p.saleFeeItems || []).forEach((it, i) => rows.push({ propertyId: p.id, kind: 'sale', ord: i, label: it.label || '', amount: it.amount ?? null }));
      });
      return rows;
    },
    columns: [
      { key: 'propertyId', label: 'Property ID', type: 'fk', required: true, notes: 'References Properties.id' },
      { key: 'kind',       label: 'Kind',        type: 'enum', notes: 'purchase / sale' },
      { key: 'ord',        label: 'Ord',         type: 'number' },
      { key: 'label',      label: 'Label',       type: 'string' },
      { key: 'amount',     label: 'Amount',      type: 'number' },
    ],
  },
  Utilities: {
    description: 'Per-property utility accounts (electric / water / gas / trash) — provider, account number, on/off status. FK → Properties.id.',
    pk: 'propertyId+type',
    rowSource: (s) => {
      const rows = [];
      const TYPES = ['electric', 'water', 'gas', 'trash'];
      (s.properties || []).forEach(p => {
        const u = p.utilities || {};
        TYPES.forEach(type => {
          const r = u[type];
          if (r && (r.provider || r.account || (r.status && r.status !== ''))) {
            rows.push({ propertyId: p.id, type, provider: r.provider || '', account: r.account || '', status: r.status || '' });
          }
        });
      });
      return rows;
    },
    columns: [
      { key: 'propertyId', label: 'Property ID', type: 'fk', required: true, notes: 'References Properties.id' },
      { key: 'type',       label: 'Type',        type: 'enum', notes: 'electric / water / gas / trash' },
      { key: 'provider',   label: 'Provider',    type: 'string' },
      { key: 'account',    label: 'Account #',   type: 'string' },
      { key: 'status',     label: 'Status',      type: 'enum', notes: 'on / transferred / off' },
    ],
  },
  CompletedEvents: {
    description: 'Calendar events marked done. One row per completed event key (derived rent/lease/tax/insurance events; tasks track their own done flag).',
    pk: 'key',
    rowSource: (s) => Object.keys(s.completedEvents || {}).filter(k => s.completedEvents[k]).map(key => ({ key })),
    columns: [
      { key: 'key', label: 'Event Key', type: 'string', required: true },
    ],
  },
  ExchangeDraws: {
    description: '1031 exchange fund draws — money deployed from an exchange into a replacement property. FK → Exchanges.id.',
    pk: 'exchangeId+ord',
    rowSource: (s) => {
      const rows = [];
      (s.exchanges || []).forEach(e => (e.draws || []).forEach((d, i) => rows.push({
        exchangeId: e.id, ord: i, propId: d.propId || '', amount: d.amount ?? null, date: d.date || '', note: d.note || '',
      })));
      return rows;
    },
    columns: [
      { key: 'exchangeId', label: 'Exchange ID', type: 'fk', required: true, notes: 'References Exchanges.id' },
      { key: 'ord',        label: 'Ord',         type: 'number' },
      { key: 'propId',     label: 'Property ID', type: 'fk', notes: 'References Properties.id' },
      { key: 'amount',     label: 'Amount',      type: 'number' },
      { key: 'date',       label: 'Date',        type: 'date' },
      { key: 'note',       label: 'Note',        type: 'string' },
    ],
  },
};

// Expose schema globally so the sync layer can read it
window.SHEET_SCHEMA = SHEET_SCHEMA;

function IntegrationScreen({ embedded } = {}) {
  const store = useStore();
  const [view, setView] = useState('sync');
  const [exporting, setExporting] = useState(false);

  function formatCell(value, type) {
    if (value == null || value === '') return '';
    if (type === 'money') return typeof value === 'number' ? value : '';
    if (type === 'date') return value;
    if (type === 'bool') return value ? 'TRUE' : 'FALSE';
    if (type === 'array') return Array.isArray(value) ? value.join(',') : value;
    return value;
  }

  function exportWorkbook(opts) {
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      for (const [tabName, def] of Object.entries(SHEET_SCHEMA)) {
        const headers = def.columns.map(c => c.label);
        const data = opts.includeData ? def.rowSource(store) : [];
        const rows = data.map(item => def.columns.map(c => formatCell(item[c.key], c.type)));
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        // Set column widths
        ws['!cols'] = def.columns.map(c => ({ wch: Math.max(c.label.length + 2, 14) }));
        XLSX.utils.book_append_sheet(wb, ws, tabName);
      }
      const fname = opts.includeData
        ? `atmore-ops-full-${TODAY()}.xlsx`
        : `atmore-ops-template-${TODAY()}.xlsx`;
      XLSX.writeFile(wb, fname);
    } finally {
      setExporting(false);
    }
  }

  const seg = (
    <Segmented value={view}
      options={[
        {value:'sync', label:'Sync'},
        {value:'schema', label:'Schema'},
        {value:'export', label:'Export workbook'},
        {value:'strategy', label:'Strategy'},
      ]}
      onChange={setView}/>
  );

  return (
    <div>
      {embedded ? (
        <div className="row between items-center mb-16">
          <div className="up dim">Google Sheets integration · production handoff</div>
          {seg}
        </div>
      ) : (
        <div className="section-h">
          <div>
            <div className="crumbs">Backend prep · Google Sheets integration</div>
            <h1>Production handoff</h1>
          </div>
          {seg}
        </div>
      )}

      {view === 'sync' && <SyncView/>}
      {view === 'schema' && <SchemaView/>}
      {view === 'export' && <ExportView onExport={exportWorkbook} exporting={exporting}/>}
      {view === 'strategy' && <StrategyView/>}
    </div>
  );
}

function SchemaView() {
  return (
    <div className="col gap-16">
      <Card>
        <div className="card__body">
          <div className="small" style={{lineHeight: 1.7, color: 'var(--ink-2)', maxWidth: 720}}>
            This is the canonical data model. {Object.keys(SHEET_SCHEMA).length} tabs total. Use this as the blueprint for the Google Sheet — once it exists with these columns, the app can read/write directly via Sheets API or Apps Script. Foreign keys (<span className="mono">fk</span>) reference other tabs' <span className="mono">id</span> columns.
          </div>
        </div>
      </Card>
      {Object.entries(SHEET_SCHEMA).map(([name, def]) => (
        <Card key={name}>
          <CardHead title={name} right={
            <div className="row gap-8 items-center">
              <Tag tone="ghost">{def.columns.length} columns</Tag>
              <Tag tone="blue">pk: {def.pk}</Tag>
            </div>
          }/>
          <div className="card__body" style={{padding: '10px 16px 4px 16px'}}>
            <div className="small dim mb-12">{def.description}</div>
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Column</th><th>Label</th><th>Type</th><th>Required</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {def.columns.map(c => (
                <tr key={c.key}>
                  <td><span className="mono small">{c.key}</span></td>
                  <td className="small">{c.label}</td>
                  <td><Tag tone={c.type === 'fk' ? 'blue' : c.type === 'money' ? 'sage' : c.type === 'date' ? 'ochre' : 'ghost'}>{c.type}</Tag></td>
                  <td className="small dim">{c.required ? '✓' : '—'}</td>
                  <td className="small dim">{c.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function ExportView({ onExport, exporting }) {
  const store = useStore();
  const counts = Object.entries(SHEET_SCHEMA).map(([name, def]) => ({ name, n: def.rowSource(store).length }));
  const totalRows = counts.reduce((a,c) => a + c.n, 0);

  return (
    <div className="col gap-16">
      <Card>
        <CardHead title="Multi-tab Excel export"/>
        <div className="card__body">
          <div className="small" style={{lineHeight: 1.7, color: 'var(--ink-2)', maxWidth: 720, marginBottom: 16}}>
            Generate an XLSX workbook with all {Object.keys(SHEET_SCHEMA).length} tabs structured per the schema. Upload it to Google Drive → "Open with Google Sheets" — instant production-ready workbook with your data already in place.
          </div>
          <div className="grid g-2 mb-16">
            <div style={{padding: '16px 18px', background: 'var(--blue-tint)', borderRadius: 6, border: '1px solid var(--blue-soft)'}}>
              <div className="serif" style={{fontSize: 18, fontWeight: 500, color: 'var(--blue-deep)'}}>Full workbook (recommended)</div>
              <div className="small mt-4 mb-12" style={{color: 'var(--ink-2)'}}>Schema + all your current data. {totalRows.toLocaleString()} rows across {counts.length} tabs.</div>
              <Btn kind="primary" onClick={() => onExport({ includeData: true })} disabled={exporting}>
                {exporting ? 'Generating…' : '⤓ Download full workbook'}
              </Btn>
            </div>
            <div style={{padding: '16px 18px', background: 'var(--paper-3)', borderRadius: 6, border: '1px solid var(--rule)'}}>
              <div className="serif" style={{fontSize: 18, fontWeight: 500}}>Empty template</div>
              <div className="small mt-4 mb-12" style={{color: 'var(--ink-2)'}}>Schema only — no data. Useful if you want to set up the Sheet structure and let team enter data manually.</div>
              <Btn onClick={() => onExport({ includeData: false })} disabled={exporting}>
                {exporting ? 'Generating…' : '⤓ Download empty template'}
              </Btn>
            </div>
          </div>
          <table className="tbl">
            <thead><tr><th>Tab</th><th className="num">Rows</th></tr></thead>
            <tbody>
              {counts.map(c => (
                <tr key={c.name}>
                  <td><span className="mono small">{c.name}</span></td>
                  <td className="num mono small">{c.n.toLocaleString()}</td>
                </tr>
              ))}
              <tr style={{borderTop: '2px solid var(--ink)'}}>
                <td style={{fontWeight: 600}}>Total</td>
                <td className="num mono" style={{fontWeight: 600}}>{totalRows.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StrategyView() {
  return (
    <div className="col gap-16" style={{maxWidth: 820}}>
      <Card>
        <CardHead title="Setup checklist"/>
        <div className="card__body col gap-10">
          <Step n={1} title="Generate the workbook">
            On the Export tab, download the full workbook with current data.
          </Step>
          <Step n={2} title="Upload to Google Drive">
            In your team's shared Drive folder, upload the XLSX. Right-click → Open with Google Sheets. This creates a native Sheet with the same structure.
          </Step>
          <Step n={3} title="Lock down sharing">
            Edit access only for the 6 people who run operations. View-only for anyone else who needs visibility.
          </Step>
          <Step n={4} title="Wire the app to the Sheet">
            Choose one of the two integration paths below (Apps Script or Sheets API). The data shapes are already aligned.
          </Step>
          <Step n={5} title="Cut over">
            Stop maintaining the old "Untitled spreadsheet" and "Atmore Transactions 2026" files. The new Sheet becomes the source of truth.
          </Step>
        </div>
      </Card>

      <Card>
        <CardHead title="Integration path A · Apps Script (recommended for v1)"/>
        <div className="card__body col gap-8" style={{color: 'var(--ink-2)', lineHeight: 1.6, fontSize: 13}}>
          <div><strong>What it is:</strong> a script that lives inside the Google Sheet itself. The app calls a published Apps Script Web App URL via fetch.</div>
          <div><strong>Pros:</strong> no OAuth dance, no separate hosting, instant deploy. Reads/writes go through the script's permissions, which run as the script owner.</div>
          <div><strong>Cons:</strong> Apps Script is rate-limited and slower than direct API. Not great for high-volume writes.</div>
          <div><strong>Verdict:</strong> perfect fit for ~6 users editing a few records at a time. Ship this first.</div>
        </div>
      </Card>

      <Card>
        <CardHead title="Integration path B · Sheets API + OAuth (v2)"/>
        <div className="card__body col gap-8" style={{color: 'var(--ink-2)', lineHeight: 1.6, fontSize: 13}}>
          <div><strong>What it is:</strong> the app authenticates each user against Google directly via OAuth. Reads and writes go through the official Sheets v4 API.</div>
          <div><strong>Pros:</strong> faster, scales better, no rate limits to speak of. Per-user audit trail (who edited what) comes for free.</div>
          <div><strong>Cons:</strong> requires Google Cloud project setup, OAuth client, consent screens, possibly app verification if you go beyond test users.</div>
          <div><strong>Verdict:</strong> when path A starts feeling slow or you want stronger per-user attribution.</div>
        </div>
      </Card>

      <Card>
        <CardHead title="Conflict resolution"/>
        <div className="card__body col gap-8" style={{color: 'var(--ink-2)', lineHeight: 1.6, fontSize: 13}}>
          <div><strong>When two people edit the same record simultaneously:</strong> last-write-wins. Both writes go through, the second one overwrites the first. Acceptable for this volume.</div>
          <div><strong>Future hardening:</strong> add a per-row <span className="mono">updatedAt</span> column; the client sends the value it loaded; if the server's current value is newer, it returns a conflict and the app shows a "this was edited by Edward 12s ago — refresh?" toast.</div>
        </div>
      </Card>

      <Card>
        <CardHead title="What this prototype is missing for production"/>
        <div className="card__body col gap-6 small" style={{color: 'var(--ink-2)', lineHeight: 1.7}}>
          <div>· <strong>Per-user identity</strong> — currently everyone is "user". Apps Script gets the active user's email for free; we'd start stamping it on stageHistory, ten99History, edits.</div>
          <div>· <strong>Validation on writes</strong> — the spreadsheet won't reject bad data. The app should validate before sending.</div>
          <div>· <strong>Offline mode</strong> — if someone's WiFi drops, the app should queue writes locally and replay when reconnected.</div>
          <div>· <strong>Document storage</strong> — currently a Drive folder URL per property. Acceptable for v1; can evolve to first-class uploads later.</div>
          <div>· <strong>Real audit trail</strong> — beyond stage changes. Every edit logged with user + timestamp + before/after.</div>
        </div>
      </Card>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="row gap-12 items-start" style={{padding: '8px 0', borderBottom: '1px solid var(--rule-soft)'}}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'var(--blue)', color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: 12, flexShrink: 0,
      }}>{n}</div>
      <div>
        <div style={{fontWeight: 500, fontSize: 14}}>{title}</div>
        <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4}}>{children}</div>
      </div>
    </div>
  );
}

window.IntegrationScreen = IntegrationScreen;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SyncView — connect to Apps Script Web App, push/pull data
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function SyncView() {
  const store = useStore();
  const [config, setConfig] = useState(Sync.loadConfig());
  const [url, setUrl] = useState(config.url || '');
  const [status, setStatus] = useState('idle');  // idle | working | ok | error
  const [statusMsg, setStatusMsg] = useState('');
  const [lastMeta, setLastMeta] = useState(null);
  const [showWalkthrough, setShowWalkthrough] = useState(!Sync.isConfigured());

  function setBusy(msg) { setStatus('working'); setStatusMsg(msg); }
  function setOk(msg) { setStatus('ok'); setStatusMsg(msg); }
  function setErr(msg) { setStatus('error'); setStatusMsg(String(msg)); }

  async function saveAndPing() {
    const prevUrl = (Sync.config && Sync.config.url) || '';
    const isNewUrl = url !== prevUrl;
    // Connecting to a new Sheet turns auto-sync ON and resets sync history,
    // so the first connect seeds/adopts the Sheet cleanly.
    Sync.saveConfig(isNewUrl
      ? { url, autoSync: true, lastSyncedAt: null, lastSheetWriteAt: null }
      : { url, autoSync: Sync.config.autoSync !== false });
    setConfig(Sync.loadConfig());
    setBusy('Pinging Apps Script…');
    try {
      const res = await Sync.ping();
      if (res.ok) {
        const m = await Sync.meta();
        setLastMeta(m);
        setOk('Connected. Workbook: ' + (m.workbookName || '—'));
        if (window.SyncEngine) SyncEngine.refreshConfig();
      } else {
        setErr(res.error || 'Ping returned not-ok');
      }
    } catch (e) { setErr(e.message); }
  }

  async function pull() {
    if (!confirm('Replace local data with what is in the Google Sheet?\n\nYour current local changes will be lost unless you push first.')) return;
    setBusy('Pulling from Sheet…');
    try {
      const data = await Sync.pull();
      const newState = deserializeFromSheet(data);
      Store.state = newState;
      Store.save();
      Store.notify();
      setOk('Pulled ' + Object.values(data.tabs).reduce((a,r) => a + r.length, 0) + ' rows.');
      const m = await Sync.meta();
      setLastMeta(m);
    } catch (e) { setErr(e.message); }
  }

  async function push() {
    if (!confirm('Replace the Google Sheet with your local data?\n\nThis overwrites everything currently in the Sheet.')) return;
    setBusy('Pushing to Sheet…');
    try {
      const res = await Sync.push(Store.state);
      if (res.ok) {
        setOk('Pushed at ' + res.wroteAt);
        const m = await Sync.meta();
        setLastMeta(m);
      } else {
        setErr(res.error || 'Push failed');
      }
    } catch (e) { setErr(e.message); }
  }

  function disconnect() {
    if (!confirm('Disconnect from the Google Sheet? Local data is untouched; you can reconnect anytime.')) return;
    Sync.saveConfig({ url: '' });
    setConfig(Sync.loadConfig());
    setUrl('');
    setStatus('idle');
    setStatusMsg('');
    setLastMeta(null);
    setShowWalkthrough(true);
    if (window.SyncEngine) SyncEngine.refreshConfig();
  }

  const tone = status === 'ok' ? 'sage' : status === 'error' ? 'brick' : status === 'working' ? 'ochre' : 'ghost';

  return (
    <div className="col gap-16">
      {showWalkthrough && <SyncSetup onDone={() => setShowWalkthrough(false)}/>}

      <Card accent={Sync.isConfigured()}>
        <CardHead title="Connection" right={
          <div className="row gap-8 items-center">
            <Tag tone={tone}>{status === 'idle' ? (Sync.isConfigured() ? 'Connected' : 'Not configured') : statusMsg || status}</Tag>
            {Sync.isConfigured() && <Btn sz="sm" kind="ghost" onClick={disconnect}>Disconnect</Btn>}
            {!showWalkthrough && <Btn sz="sm" kind="ghost" onClick={() => setShowWalkthrough(true)}>Setup walkthrough</Btn>}
          </div>
        }/>
        <div className="card__body col gap-10">
          <div>
            <div className="up dim mb-4">Apps Script Web App URL</div>
            <div className="row gap-8">
              <input className="input mono" type="url" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/AKfycb…/exec"
                style={{flex: 1, fontSize: 12}}/>
              <Btn kind="primary" onClick={saveAndPing} disabled={!url}>Save & test</Btn>
            </div>
            <div className="tiny dim mt-4">From Apps Script → Deploy → Manage deployments → copy the Web app URL.</div>
          </div>

          {statusMsg && (
            <div style={{
              padding: '8px 12px', borderRadius: 4, fontSize: 13,
              background: status === 'ok' ? 'var(--sage-soft)' : status === 'error' ? 'var(--brick-soft)' : 'var(--ochre-soft)',
              color:      status === 'ok' ? 'var(--sage)'      : status === 'error' ? 'var(--brick)'      : 'var(--ochre)',
            }}>{status === 'error' ? '⚠ ' : status === 'ok' ? '✓ ' : '◌ '}{statusMsg}</div>
          )}
        </div>
      </Card>

      {Sync.isConfigured() && (
        <>
          <Card>
            <CardHead title="Automatic sync" right={
              <label className="row gap-8 items-center" style={{cursor: 'pointer'}}>
                <input type="checkbox" defaultChecked={config.autoSync !== false}
                  onChange={e => { Sync.saveConfig({ autoSync: e.target.checked }); setConfig(Sync.loadConfig()); if (window.SyncEngine) SyncEngine.refreshConfig(); }}/>
                <span className="small">{config.autoSync !== false ? 'On' : 'Off'}</span>
              </label>
            }/>
            <div className="card__body small" style={{color: 'var(--ink-2)', lineHeight: 1.6}}>
              When on, the app <strong>loads the latest from the Sheet when you open it</strong> and <strong>saves your changes back a couple seconds after you stop editing</strong> — so moving between computers just works, with nothing to remember. The status pill in the top bar always shows where things stand. Manual Push/Pull below still work anytime.
            </div>
          </Card>

          <Card>
            <CardHead title="Sync"/>
            <div className="card__body">
              <div className="grid g-2 mb-16">
                <div style={{padding: '16px 18px', background: 'var(--blue-tint)', borderRadius: 6, border: '1px solid var(--blue-soft)'}}>
                  <div className="serif" style={{fontSize: 17, fontWeight: 500, color: 'var(--blue-deep)'}}>↥ Push to Sheet</div>
                  <div className="small mt-4 mb-12" style={{color: 'var(--ink-2)', lineHeight: 1.5}}>
                    Replace the Google Sheet with your current local data. Use this when you've made changes here that you want others to see.
                  </div>
                  <Btn kind="primary" onClick={push} disabled={status === 'working'}>Push now</Btn>
                </div>
                <div style={{padding: '16px 18px', background: 'var(--paper-3)', borderRadius: 6, border: '1px solid var(--rule)'}}>
                  <div className="serif" style={{fontSize: 17, fontWeight: 500}}>↧ Pull from Sheet</div>
                  <div className="small mt-4 mb-12" style={{color: 'var(--ink-2)', lineHeight: 1.5}}>
                    Replace local data with what's in the Sheet. Use this when someone else has been editing the Sheet.
                  </div>
                  <Btn onClick={pull} disabled={status === 'working'}>Pull now</Btn>
                </div>
              </div>

              <div className="small dim" style={{padding: '10px 12px', background: 'var(--paper-3)', borderRadius: 4, lineHeight: 1.55}}>
                <strong>Workflow tip:</strong> before making big changes, Pull to get the latest. After you're done, Push to share with the team. Conflicts use last-write-wins — coordinate verbally for now.
              </div>
            </div>
          </Card>

          {lastMeta && (
            <Card>
              <CardHead title="Sheet status"/>
              <div className="card__body">
                <div className="grid g-3 mb-12">
                  <div><div className="up dim">Workbook</div><div className="small mt-4">{lastMeta.workbookName}</div></div>
                  <div><div className="up dim">Last write</div><div className="small mt-4 mono">{lastMeta.lastWriteAt ? fmtDate(lastMeta.lastWriteAt.slice(0,10), {full: true}) + ' ' + lastMeta.lastWriteAt.slice(11,16) : '—'}</div></div>
                  <div><div className="up dim">Total rows</div><div className="small mt-4 mono">{Object.values(lastMeta.counts || {}).reduce((a,n) => a + n, 0).toLocaleString()}</div></div>
                </div>
                <table className="tbl">
                  <thead><tr><th>Tab</th><th className="num">In sheet</th><th className="num">Locally</th><th>Match?</th></tr></thead>
                  <tbody>
                    {Object.entries(lastMeta.counts || {}).map(([tab, sheetN]) => {
                      const def = SHEET_SCHEMA[tab];
                      const localN = def ? def.rowSource(store).length : 0;
                      const match = sheetN === localN;
                      return (
                        <tr key={tab}>
                          <td><span className="mono small">{tab}</span></td>
                          <td className="num mono small">{sheetN}</td>
                          <td className="num mono small">{localN}</td>
                          <td>{match ? <Tag tone="sage">✓</Tag> : <Tag tone="ochre">Δ {Math.abs(sheetN-localN)}</Tag>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      <LocalBackupCard />
    </div>
  );
}

function LocalBackupCard() {
  const [msg, setMsg] = useState('');
  const fileRef = React.useRef(null);

  function onFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (!confirm('Restore from this backup? It replaces all current data in the app.\n\n(Your Google Sheet is not touched until the next push.)')) return;
        const n = restoreBackupFromText(reader.result);
        setMsg('✓ Restored ' + n + ' properties from backup.');
      } catch (err) {
        setMsg('⚠ ' + err.message);
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  }

  return (
    <Card>
      <CardHead title="Local backup" right={<Tag tone="ghost">safety net</Tag>}/>
      <div className="card__body">
        <div className="small mb-16" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>
          Download a complete snapshot of everything as a single file you can keep anywhere — independent of the Google Sheet. Works even if sync isn’t set up. Use Restore to load a snapshot back in (on this or any other computer).
        </div>
        <div className="row gap-8">
          <Btn kind="primary" onClick={downloadBackup}>⤓ Download backup</Btn>
          <Btn kind="ghost" onClick={() => fileRef.current && fileRef.current.click()}>↥ Restore from file…</Btn>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} style={{display: 'none'}}/>
        </div>
        {msg && <div className="small mt-12" style={{color: msg[0] === '⚠' ? 'var(--brick)' : 'var(--sage)'}}>{msg}</div>}
      </div>
    </Card>
  );
}

function SyncSetup({ onDone }) {
  return (
    <Card>
      <CardHead title="One-time setup walkthrough" right={<Btn sz="sm" kind="ghost" onClick={onDone}>Hide</Btn>}/>
      <div className="card__body col gap-12">
        <div className="small" style={{color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720}}>
          The first time only — about 10 minutes. After this, you and your team can read/write the Google Sheet from this app.
        </div>

        <Step n={1} title="Create the Google Sheet">
          On the <strong>Export workbook</strong> tab, click "Download empty template." Upload the .xlsx to Drive, right-click → Open with Google Sheets, save it (Cmd+S) to convert. Rename to <span className="mono">Atmore Operations · Master</span>.
        </Step>
        <Step n={2} title="Open Apps Script">
          In the new Sheet: <strong>Extensions → Apps Script</strong>. A new tab opens with a code editor.
        </Step>
        <Step n={3} title="Paste the bridge script">
          Delete the placeholder code. Open <span className="mono">Apps Script Bridge.gs</span> in this project's file list (left sidebar) and copy the entire contents. Paste into the Apps Script editor. Hit Save (Cmd+S).
        </Step>
        <Step n={4} title="Initialize the tabs">
          At the top of the editor there's a dropdown showing functions. <strong>First-time setup:</strong> pick <span className="mono">setup</span> and click <strong>Run</strong> — this creates the tab structure. <strong>Upgrading a Sheet that already has data:</strong> pick <span className="mono">migrate</span> instead — it adds any new tabs/columns without touching your existing rows. (Avoid re-running <span className="mono">setup</span> on a populated Sheet — it clears every tab.) Google will ask for permissions the first time — review and allow.
        </Step>
        <Step n={5} title="Deploy as a Web App">
          Click <strong>Deploy → New deployment → Select type → Web app</strong>. Configure:<br/>
          <span className="mono small">Execute as: Me · Who has access: Anyone</span><br/>
          Click <strong>Deploy</strong>. Copy the resulting Web App URL.
        </Step>
        <Step n={6} title="Paste the URL above">
          Paste into the field above, click "Save & test." A green ✓ confirms connection.
        </Step>
        <Step n={7} title="Push your data">
          Click "Push now" to send your current prototype data to the Sheet. Open the Sheet in Google to see the rows populated.
        </Step>
      </div>
    </Card>
  );
}
