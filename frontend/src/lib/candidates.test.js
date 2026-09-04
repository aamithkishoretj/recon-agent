import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateEvidence, candidatesFor, isCandidateCase, isAIInvestigable, evidenceState, candidateCurrency, candidateMoney, comparisonIndexes, comparisonRows } from './candidates.js';

const records = ['l', 'l2', 's', 'b'].map(record_id => ({ record_id, currency: 'INR' }));
const candidate = (ledger = 'l') => ({
  references: { ledger: ['ORDER-1'], settlement: ['SET-1'], bank: ['BANK-1'] },
  record_ids: { ledger: [ledger], settlement: ['s'], bank: ['b'] },
  score: 50, identity_verified: false,
  signals: { financial_arithmetic: 40, settlement_window: 6, bank_window: 4, ledger_identity: 0, bank_identity: 0, payment_method: 0 },
  link_evidence: { order_metadata_agrees: false, payment_reference_similarity: 0, settlement_lag_hours: 0 },
  arithmetic: { expected_settlement: 10000, reported_settlement: 10000, observed_bank_total: 10000, fee: 0,
    rounding_tolerance_paise: 5, settlement_row_differences_paise: [0], financially_verified: true },
});

test('recognizes legacy ambiguity and capped candidate search without treating ordinary cases as candidates', () => {
  assert.equal(isCandidateCase({ category: 'ambiguous_candidate' }), true);
  assert.equal(isCandidateCase({ category: 'unknown_adjustment', system_evidence: { evidence: { candidate_review_required: true } } }), true);
  assert.equal(isCandidateCase({ category: 'amount_discrepancy' }), false);
  assert.equal(isCandidateCase(null), false);
});
test('AI investigation includes only open amount and candidate-ambiguity cases', () => {
  assert.equal(isAIInvestigable({ status: 'open', category: 'amount_discrepancy' }), true);
  assert.equal(isAIInvestigable({ status: 'open', category: 'ambiguous_candidate' }), true);
  assert.equal(isAIInvestigable({ status: 'open', category: 'unknown_adjustment', system_evidence: { evidence: { candidate_review_required: true } } }), true);
  assert.equal(isAIInvestigable({ status: 'in_review', category: 'ambiguous_candidate' }), false);
  assert.equal(isAIInvestigable({ status: 'open', category: 'missing_ledger' }), false);
});
test('missing, capped and malformed evidence has no invented candidates', () => {
  for (const evidence of [undefined, null, [], { candidates: 'bad' }, { candidates: [] }]) {
    assert.deepEqual(candidatesFor({ system_evidence: { evidence } }), []);
  }
  assert.deepEqual(candidateEvidence(null), {});
  assert.deepEqual(candidatesFor({ system_evidence: { evidence: { candidates: [null, 'bad', [], candidate()] } } }), [candidate()]);
});
test('unsupported evidence is not mislabelled a conflict', () => {
  assert.equal(evidenceState(false), 'Not established');
  assert.equal(evidenceState(true), 'Established');
  assert.equal(evidenceState(undefined), 'Not recorded');
  assert.equal(evidenceState('false'), 'Not recorded');
});
test('currency requires all candidate records and agrees across sources', () => {
  assert.equal(candidateCurrency(candidate(), records), 'INR');
  assert.equal(candidateCurrency(candidate(), records.slice(0, 2)), null);
  assert.equal(candidateCurrency(candidate(), records.map(row => ({ ...row, currency: row.record_id === 'b' ? 'USD' : 'INR' }))), null);
  assert.equal(candidateCurrency({}, records), null);
  assert.equal(candidateCurrency(candidate(), records.map(row => ({ ...row, currency: '' }))), null);
});
test('money renders zero, signs and paise accurately without defaulting missing values to zero', () => {
  assert.equal(candidateMoney(0, 'INR'), '₹0.00');
  assert.equal(candidateMoney(5, 'INR'), '₹0.05');
  assert.equal(candidateMoney(-5, 'INR'), '-₹0.05');
  assert.equal(candidateMoney(500, null), 'Currency unavailable');
  for (const value of [undefined, null, NaN, Infinity, '0']) assert.equal(candidateMoney(value, 'INR'), 'Not recorded');
});
test('comparison selection stays valid for empty, single, changed and multi-candidate cases', () => {
  assert.deepEqual(comparisonIndexes(0), []);
  assert.deepEqual(comparisonIndexes(1, [8, 9]), [0]);
  assert.deepEqual(comparisonIndexes(4, [3, 1]), [3, 1]);
  assert.deepEqual(comparisonIndexes(2, [1, 1]), [1, 0]);
  assert.deepEqual(comparisonIndexes(2, [-1, 8]), [0, 1]);
});
test('different ledger IDs are highlighted even when external references and amounts are identical', () => {
  const rows = comparisonRows([candidate(), candidate('l2')], records, 'summary', true);
  assert.deepEqual(rows.map(row => row.key), ['ledger']);
  assert.equal(rows[0].different, true);
});
test('differences filter keeps equal evidence available when turned off', () => {
  assert.equal(comparisonRows([candidate(), candidate('l2')], records, 'score', true).length, 0);
  assert.equal(comparisonRows([candidate(), candidate('l2')], records, 'score', false).length, 6);
  assert.equal(comparisonRows([candidate()], records, 'score', true).length, 6);
});
test('rule scores remain points and missing scores remain missing', () => {
  const rows = comparisonRows([candidate(), {}], records, 'score');
  assert.deepEqual(rows[0].values, ['40 / 40 points', 'Not recorded']);
  assert.deepEqual(rows[3].values, ['0 / 25 points', 'Not recorded']);
});
test('timing, similarity zero and false flags remain distinct from unrecorded evidence', () => {
  const rows = comparisonRows([candidate()], records, 'links');
  assert.equal(rows.find(row => row.key === 'payment_reference_similarity').value, '0.0000 / 1');
  assert.equal(rows.find(row => row.key === 'settlement_lag_hours').value, '0 hours');
  assert.equal(rows.find(row => row.key === 'order_metadata_agrees').value, 'Not established');
  assert.equal(rows.find(row => row.key === 'exact_bank_component').value, 'Not recorded');
});
test('financial checks preserve backend amounts and distinguish unknown checks from passing checks', () => {
  const rows = comparisonRows([candidate()], records, 'financial');
  assert.equal(rows.find(row => row.key === 'fee').value, '₹0.00');
  assert.equal(rows.find(row => row.key === 'rounding_tolerance_paise').value, '₹0.05');
  assert.equal(rows.find(row => row.key === 'settlement_rows').value, '₹0.00');
  assert.equal(rows.find(row => row.key === 'ledger_to_bank_diff_paise').value, 'Not recorded');
});
test('presentation never changes candidates or exposes private truth fields', () => {
  const candidates = [candidate(), candidate('l2')];
  candidates[0].true_ledger_refs = ['PRIVATE-GROUND-TRUTH'];
  const before = JSON.stringify(candidates);
  for (const section of ['summary', 'score', 'links', 'financial']) {
    assert.ok(!JSON.stringify(comparisonRows(candidates, records, section)).includes('PRIVATE-GROUND-TRUTH'));
  }
  assert.equal(JSON.stringify(candidates), before);
});
