import test from 'node:test';
import assert from 'node:assert/strict';
import { filesReady, formatFileSize, pipelineStages, validateImportFile } from './imports.js';

const file = (name = 'data.csv', size = 100) => ({ name, size });

test('only non-empty CSV files within the local limit are accepted', () => {
  assert.equal(validateImportFile(file()), null);
  assert.match(validateImportFile(file('data.txt')), /Only .csv/);
  assert.match(validateImportFile(file('data.csv', 0)), /empty/);
  assert.match(validateImportFile(file('data.csv', 2_000_001)), /2 MB/);
  assert.match(validateImportFile(null), /Choose/);
});

test('all three named source files are required', () => {
  assert.equal(filesReady({ ledger: file(), settlement: file(), bank: file() }), true);
  assert.equal(filesReady({ ledger: file(), settlement: file() }), false);
  assert.equal(filesReady({ ledger: file(), settlement: file(), bank: file('bank.txt') }), false);
});

test('file size labels preserve zero and switch to kilobytes', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(100), '100 B');
  assert.equal(formatFileSize(2048), '2.0 KB');
  assert.equal(formatFileSize(-1), 'Unknown size');
});

test('pipeline states do not claim completion early', () => {
  assert.deepEqual(pipelineStages('waiting').map(item => item.state), Array(6).fill('waiting'));
  assert.deepEqual(pipelineStages('uploaded').map(item => item.state), ['done', 'done', 'waiting', 'waiting', 'waiting', 'waiting']);
  assert.deepEqual(pipelineStages('running').map(item => item.state), ['done', 'done', 'active', 'active', 'active', 'waiting']);
  assert.deepEqual(pipelineStages('completed').map(item => item.state), Array(6).fill('done'));
});
