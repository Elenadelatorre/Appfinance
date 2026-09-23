import test from 'node:test';
import assert from 'node:assert/strict';

const storageMock = {
  getItem() {
    return null;
  },
  setItem() {},
  removeItem() {}
};
globalThis.localStorage = storageMock;
globalThis.sessionStorage = storageMock;
globalThis.location = { search: '', hostname: 'localhost' };
globalThis.document = {
  querySelector() {
    return null;
  }
};
globalThis.addEventListener = () => {};

const {
  normalizeAccountRef,
  matchesAccountReference
} = await import('../src/features/transactions/transactions.js');

test('normalizeAccountRef normalizes accents, separators, and whitespace', () => {
  assert.equal(
    normalizeAccountRef('Santander · Principal'),
    'santander principal'
  );
  assert.equal(
    normalizeAccountRef('  Banco Bilbao  '),
    normalizeAccountRef('Banco Bilbao')
  );
});

test('matchesAccountReference accepts legacy account names and ids', () => {
  const account = { id: 'acc_123', name: 'Santander · Principal' };
  assert.equal(matchesAccountReference(account, 'acc_123'), true);
  assert.equal(matchesAccountReference(account, 'Santander'), true);
  assert.equal(matchesAccountReference(account, 'santander principal'), true);
  assert.equal(matchesAccountReference(account, 'otra cuenta'), false);
});
