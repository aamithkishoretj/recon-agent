import test from 'node:test';
import assert from 'node:assert/strict';
import { bankActivity, csvText, explorerGroups, sourceSummary, fetchAll, filterRecords, money, recordAmount, searchRecord, sortRecords } from './workspace.js';

const txn = (id, source, amount, day = '2026-06-01') => ({ record_id: id, source_type: source, amount_minor_units: amount, timestamp_utc: day + 'T10:00:00', external_ref: id, currency: 'INR' });
const records = [
  { exception_id: 'case-a', category: 'duplicate', status: 'open', priority_score: 4, created_at: '2026-06-01', transactions: [txn('LEDG-000080', 'ledger', 10000)] },
  { exception_id: 'case-b', category: 'amount_discrepancy', status: 'in_review', priority_score: 9, created_at: '2026-06-02', ai_hypothesis: { confidence: 0.1 }, transactions: [txn('LEDG-000057', 'ledger', 20000)] },
  { exception_id: 'case-c', category: 'duplicate', status: 'resolved', priority_score: 2, created_at: '2026-06-03', transactions: [txn('LEDG-000071', 'ledger', -5000)] },
];

test('search is case-insensitive and searches references plus category across records', () => {
  assert.equal(searchRecord(records[0], 'ledg-000080 DUPLICATE'), true);
  assert.equal(searchRecord(records[0], 'missing'), false);
  assert.equal(filterRecords(records, { search: 'LEDG-000057' })[0].exception_id, 'case-b');
});
test('active includes both open and in-review cases, not resolved ones', () => {
  assert.deepEqual(filterRecords(records, { status: 'active' }).map(r => r.exception_id), ['case-a', 'case-b']);
});
test('category, search and bookmarks compose without leaking other rows', () => {
  assert.deepEqual(filterRecords(records, { category: 'duplicate', starred: true }, ['case-a', 'case-b']).map(r => r.exception_id), ['case-a']);
  assert.deepEqual(filterRecords(records, { starred: true }, []), []);
});
test('match-method filters use the backend match_type field', () => {
  assert.equal(filterRecords([{ match_id: 'm', match_type: 'fuzzy' }], { type: 'fuzzy' }).length, 1);
  assert.equal(filterRecords([{ match_id: 'm', match_type: 'fuzzy' }], { type: 'human' }).length, 0);
});
test('sorting handles amounts, direction and missing confidence without mutating input', () => {
  const original = records.map(r => r.exception_id);
  assert.equal(sortRecords(records, 'amount', 'desc')[0].exception_id, 'case-b');
  assert.equal(sortRecords(records, 'amount', 'asc')[0].exception_id, 'case-c');
  assert.equal(sortRecords(records, 'confidence')[0].exception_id, 'case-b');
  assert.deepEqual(records.map(r => r.exception_id), original);
});
test('largest transaction is an absolute display amount; money preserves refund signs', () => {
  assert.equal(recordAmount(records[2]), 5000);
  assert.match(money(-5000), /-/);
  assert.match(money(123456), /1,234\.56/);
});
test('bank activity deduplicates transactions linked to both match and exception', () => {
  const credit = txn('BANK-1', 'bank', 10000);
  const refund = txn('BANK-2', 'bank', -2500);
  const result = bankActivity([{ transactions: [credit, refund] }, { transactions: [credit, txn('LEDG-1', 'ledger', 10000)] }]);
  assert.deepEqual(result, [{ day: '2026-06-01', records: 2, value: 75 }]);
});
test('bank activity sorts real recorded days instead of synthesizing points', () => {
  const result = bankActivity([{ transactions: [txn('B2', 'bank', 100, '2026-06-09'), txn('B1', 'bank', 100, '2026-06-01')] }]);
  assert.deepEqual(result.map(r => r.day), ['2026-06-01', '2026-06-09']);
});
test('CSV protects formula cells and correctly escapes quotes, commas and newlines', () => {
  const output = csvText([{ ...records[0], exception_id: '=HYPERLINK("x")', transactions: [txn('ref, "quoted"\nnext', 'ledger', 123)] }]);
  assert.ok(output.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(output.includes('"ref, ""quoted""\nnext"'));
  assert.ok(output.includes('largest_transaction_paise'));
});
test('fetchAll reads every API page, including the last partial page', async () => {
  const calls = [];
  const rows = await fetchAll(async ({ limit, offset }) => {
    calls.push([limit, offset]);
    return Array.from({ length: offset < 1000 ? 500 : 1 }, (_, i) => ({ id: offset + i }));
  });
  assert.equal(rows.length, 1001);
  assert.deepEqual(calls, [[500, 0], [500, 500], [500, 1000]]);
});
test('fetchAll fails on malformed responses and does not silently return partial data', async () => {
  await assert.rejects(fetchAll(async () => null), /Unexpected records/);
  await assert.rejects(fetchAll(async ({ offset }) => { if (offset) throw new Error('offline'); return Array(500).fill({}); }), /offline/);
});

test('explorer shows existing matches without manufacturing records', () => {
  const matches = [{ match_id: 'm1', match_type: 'deterministic' }];
  assert.deepEqual(explorerGroups(matches, records, 0), matches);
  assert.deepEqual(explorerGroups([], records, 0), []);
});

test('exception explorer prioritizes unresolved cases without mutating the source', () => {
  assert.deepEqual(explorerGroups([], records, 1).map(r => r.exception_id), ['case-b', 'case-a']);
  assert.deepEqual(records.map(r => r.exception_id), ['case-a', 'case-b', 'case-c']);
});

test('hypothesis explorer excludes resolved cases and cases without hypotheses', () => {
  const cases = [...records, { ...records[1], exception_id: 'done', status: 'resolved' }, { ...records[0], status: 'in_review' }];
  assert.deepEqual(explorerGroups([], cases, 2).map(r => r.exception_id), ['case-b']);
});

test('source totals keep signs and distinguish missing evidence from zero', () => {
  const transactions = [txn('b1', 'bank', 10000), txn('b2', 'bank', -10000), txn('l1', 'ledger', 25000)];
  assert.equal(sourceSummary(transactions, 'bank').amount, money(0));
  assert.equal(sourceSummary(transactions, 'bank').rows.length, 2);
  assert.equal(sourceSummary(transactions, 'settlement').amount, 'No linked record');
  assert.deepEqual(sourceSummary(undefined, 'bank'), { rows: [], amount: 'No linked record' });
  assert.equal(sourceSummary([txn('refund', 'bank', -1250)], 'bank').amount, money(-1250));
});

test('source explorer does not sum different currencies', () => {
  const transactions = [txn('inr', 'bank', 10000), { ...txn('usd', 'bank', 10000), currency: 'USD' }];
  assert.equal(sourceSummary(transactions, 'bank').amount, 'Mixed currencies');
  assert.equal(sourceSummary(transactions, 'bank').rows.length, 2);
});
