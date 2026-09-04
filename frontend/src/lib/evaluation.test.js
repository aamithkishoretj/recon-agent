import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePercent } from './evaluation.js';

test('missing denominator is N/A, not zero or perfect', () => {
  assert.equal(scorePercent(null), 'N/A');
  assert.equal(scorePercent(undefined), 'N/A');
  assert.equal(scorePercent(NaN), 'N/A');
});
test('zero and perfect ratios are displayed accurately', () => {
  assert.equal(scorePercent(0), '0.00%');
  assert.equal(scorePercent(1), '100.00%');
  assert.equal(scorePercent(.763), '76.30%');
});
test('small nonzero failures are never rounded to zero', () => {
  assert.equal(scorePercent(.0000001), '<0.01%');
  assert.equal(scorePercent(.9999999), '>99.99%');
});
