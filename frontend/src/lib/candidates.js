import { money } from './workspace.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const finiteNumber = value => typeof value === 'number' && Number.isFinite(value);
export const evidenceState = value => value === true ? 'Established' : value === false ? 'Not established' : 'Not recorded';
export const candidateEvidence = exception => object(exception?.system_evidence?.evidence);
export const isCandidateCase = exception => exception?.category === 'ambiguous_candidate'
  || candidateEvidence(exception).candidate_review_required === true;
export const isAIInvestigable = exception => exception?.status === 'open'
  && (exception?.category === 'amount_discrepancy' || isCandidateCase(exception));

export function candidatesFor(exception) {
  const candidates = candidateEvidence(exception).candidates;
  return Array.isArray(candidates) ? candidates.filter(value => value && value === object(value)) : [];
}

export function candidateRecordIds(candidate) {
  return ['ledger', 'settlement', 'bank'].flatMap(source =>
    Array.isArray(candidate?.record_ids?.[source]) ? candidate.record_ids[source] : []);
}

// Currency must come from every linked source record, never an assumed default.
export function candidateCurrency(candidate, transactions = []) {
  const ids = candidateRecordIds(candidate);
  const records = ids.map(id => transactions.find(row => row.record_id === id));
  if (!ids.length || records.some(row => !row || !/^[A-Z]{3}$/.test(row.currency || ''))) return null;
  const currencies = new Set(records.map(row => row.currency));
  return currencies.size === 1 ? records[0].currency : null;
}

export function candidateMoney(value, currency) {
  if (!finiteNumber(value)) return 'Not recorded';
  if (!currency) return 'Currency unavailable';
  return money(value, currency);
}

export function comparisonIndexes(count, requested = [0, 1]) {
  if (!count) return [];
  const valid = index => Number.isInteger(index) && index >= 0 && index < count;
  const first = valid(requested[0]) ? requested[0] : 0;
  if (count === 1) return [first];
  const second = valid(requested[1]) && requested[1] !== first ? requested[1] : first === 0 ? 1 : 0;
  return [first, second];
}

const SIGNALS = [
  ['financial_arithmetic', 'Financial arithmetic', 40], ['settlement_window', 'Settlement timing', 6],
  ['bank_window', 'Bank timing', 4], ['ledger_identity', 'Ledger linkage', 25],
  ['bank_identity', 'Bank linkage', 20], ['payment_method', 'Payment method', 5],
];
const LINKS = [
  ['exact_ledger_component', 'Exact ledger–settlement component'], ['exact_bank_component', 'Exact bank component'],
  ['order_metadata_agrees', 'Ledger–settlement order agrees'], ['customer_metadata_agrees', 'Customer agrees'],
  ['payment_method_agrees', 'Payment method agrees'], ['payout_metadata_agrees', 'Payout reference agrees'],
  ['batch_metadata_agrees', 'Batch agrees'], ['bank_order_metadata_agrees', 'Ledger–bank order agrees'],
];
const FINANCIALS = [
  ['gross_ledger_amount', 'Ledger gross'], ['fee', 'Declared fee'], ['gst', 'Declared GST'], ['refunds', 'Refunds'],
  ['expected_settlement', 'Expected net'], ['reported_settlement', 'Reported settlement'], ['observed_bank_total', 'Observed bank'],
  ['ledger_to_reported_gross_diff_paise', 'Ledger vs reported gross difference'], ['refund_diff_paise', 'Refund difference'],
  ['ledger_to_settlement_diff_paise', 'Expected vs settlement difference'],
  ['settlement_to_bank_diff_paise', 'Settlement vs bank difference'], ['ledger_to_bank_diff_paise', 'Expected vs bank difference'],
  ['rounding_tolerance_paise', 'Rounding tolerance'],
];

export function candidateRows(candidate, transactions, section) {
  const currency = candidateCurrency(candidate, transactions);
  const arithmetic = object(candidate.arithmetic), links = object(candidate.link_evidence);
  if (section === 'score') return SIGNALS.map(([key, label, max]) => ({ key, label,
    value: finiteNumber(candidate.signals?.[key]) ? `${candidate.signals[key]} / ${max} points` : 'Not recorded' }));
  if (section === 'links') return [
    ...LINKS.map(([key, label]) => ({ key, label, value: evidenceState(links[key]) })),
    ...[['payment_reference_similarity', 'Payment reference similarity'], ['description_reference_similarity', 'Description reference similarity']]
      .map(([key, label]) => ({ key, label, value: finiteNumber(links[key]) ? `${links[key].toFixed(4)} / 1` : 'Not recorded' })),
    ...[['settlement_lag_hours', 'Ledger → settlement elapsed'], ['bank_lag_hours', 'Settlement → bank elapsed']]
      .map(([key, label]) => ({ key, label, value: finiteNumber(links[key]) ? `${links[key]} hours` : 'Not recorded' })),
  ];
  if (section === 'financial') return [
    ...FINANCIALS.map(([key, label]) => ({ key, label, value: candidateMoney(arithmetic[key], currency) })),
    { key: 'settlement_rows', label: 'Per-settlement row differences', value: Array.isArray(arithmetic.settlement_row_differences_paise)
      && arithmetic.settlement_row_differences_paise.length ? arithmetic.settlement_row_differences_paise.map(value => candidateMoney(value, currency)).join(' · ') : 'Not recorded' },
    { key: 'rule', label: 'Verification rule', value: arithmetic.rule_version || 'Not recorded' },
    { key: 'fee_basis', label: 'Fee basis', value: arithmetic.fee_basis || 'Not recorded' },
  ];
  return [
    ...['ledger', 'settlement', 'bank'].map(source => ({ key: source, label: `${source[0].toUpperCase()}${source.slice(1)} reference`,
      value: Array.isArray(candidate.references?.[source]) && candidate.references[source].length
        ? candidate.references[source].map(ref => ref || 'Missing reference').join(' · ') : 'Not recorded',
      // Two records can share a reference. Compare actual membership as well.
      identity: JSON.stringify(candidate.record_ids?.[source] || []) })),
    ...FINANCIALS.slice(4, 7).map(([key, label]) => ({ key, label, value: candidateMoney(arithmetic[key], currency) })),
  ];
}

export function comparisonRows(candidates, transactions, section, differencesOnly = false) {
  const columns = candidates.map(candidate => candidateRows(candidate, transactions, section));
  if (!columns.length) return [];
  return columns[0].map((row, index) => {
    const cells = columns.map(column => column[index]);
    return { ...row, values: cells.map(cell => cell.value), different: cells.some(cell => cell.value !== row.value || cell.identity !== row.identity) };
  }).filter(row => !differencesOnly || candidates.length < 2 || row.different);
}
