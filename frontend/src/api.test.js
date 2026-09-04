import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoCases, previewImport, reconcileImport, reviewException } from './api.js';

test('review sends the loaded status for stale-review protection', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ new_status: 'reopened' }) };
  });
  await reviewException('example', { action: 'reject', reviewer_name: 'Demo', notes: 'Missing evidence', expected_status: 'in_review' });
  assert.equal(request.url, '/api/exceptions/example/review');
  assert.equal(request.body.expected_status, 'in_review');
});
test('validation errors are readable instead of object Object', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 422, json: async () => ({ detail: [{ msg: 'Notes are required' }] }) }));
  await assert.rejects(reviewException('example', {}), /Notes are required/);
});
test('import preview sends three CSV payloads and reconciliation encodes the run ID', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    return { ok: true, json: async () => ({ status: 'ok' }) };
  });
  const files = { ledger: { filename: 'ledger.csv', content: 'a' }, settlement: { filename: 'settlement.csv', content: 'b' }, bank: { filename: 'bank.csv', content: 'c' } };
  await previewImport(files);
  await reconcileImport('run/id');
  assert.deepEqual(requests[0], { url: '/api/import-runs/preview', method: 'POST', body: files });
  assert.equal(requests[1].url, '/api/import-runs/run%2Fid/reconcile');
  assert.equal(requests[1].method, 'POST');
});
test('showcase metadata comes from the active local dataset', async (t) => {
  let requested;
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested = url;
    return { ok: true, json: async () => ({ available: false, cases: [] }) };
  });
  assert.deepEqual(await getDemoCases(), { available: false, cases: [] });
  assert.equal(requested, '/api/demo-cases');
});
