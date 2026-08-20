// Pure ESM unit tests for packages/host/lib/plain-store.mjs
//
// PlainStore is the encryption-disabled counterpart to Vault: same public
// interface (list/get/upsert/remove/lock/isUnlocked/unlock/sealWith), but
// no key derivation and nothing is ever encrypted. These tests mirror
// vault.test.mjs so the two implementations stay behaviourally aligned.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PlainStore } from '../lib/plain-store.mjs';

test('plain-store: new store is locked', () => {
  const s = new PlainStore();
  assert.equal(s.isUnlocked(), false);
});

test('plain-store: locked store throws on list/get/upsert/remove/sealWith', async () => {
  const s = new PlainStore();
  assert.throws(() => s.list(), /Store is locked/);
  assert.throws(() => s.get('any'), /Store is locked/);
  assert.throws(() => s.upsert({ id: 'x', kind: 'profile', label: 'L', value: 'V' }), /Store is locked/);
  assert.throws(() => s.remove('x'), /Store is locked/);
  await assert.rejects(async () => s.sealWith(), /Store is locked/);
});

test('plain-store: unlock(null) creates an empty, unlocked store', async () => {
  const s = new PlainStore();
  await s.unlock(null);
  assert.equal(s.isUnlocked(), true);
  assert.deepEqual(s.list(), []);
});

test('plain-store: unlock(stored) restores entries verbatim (no decryption)', async () => {
  const stored = {
    version: 1,
    entries: [
      { id: 'p1', kind: 'profile', label: 'Name', value: 'Alice', createdAt: 1, updatedAt: 1 },
    ],
  };
  const s = new PlainStore();
  await s.unlock(stored);
  assert.equal(s.isUnlocked(), true);
  assert.deepEqual(s.list(), stored.entries);
});

test('plain-store: unlock(corrupted) throws', async () => {
  const s = new PlainStore();
  await assert.rejects(async () => s.unlock({ version: 1, entries: [{ bad: true }] }), /corrupted/i);
});

test('plain-store: upsert appends a new entry with generated timestamps', async () => {
  const s = new PlainStore();
  await s.unlock(null);
  s.upsert({ id: 'c1', kind: 'credential', label: 'GitHub Token', value: 'ghp_abc' });
  const list = s.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].value, 'ghp_abc');
  assert.equal(typeof list[0].createdAt, 'number');
  assert.equal(typeof list[0].updatedAt, 'number');
});

test('plain-store: upsert overwrites existing id in place, preserving createdAt', async () => {
  const s = new PlainStore();
  await s.unlock(null);
  s.upsert({ id: 'c1', kind: 'credential', label: 'A', value: 'v1' });
  const createdAt = s.get('c1').createdAt;
  s.upsert({ id: 'c1', kind: 'credential', label: 'A', value: 'v2' });
  const entry = s.get('c1');
  assert.equal(entry.value, 'v2');
  assert.equal(entry.createdAt, createdAt);
});

test('plain-store: remove deletes by id', async () => {
  const s = new PlainStore();
  await s.unlock(null);
  s.upsert({ id: 'c1', kind: 'credential', label: 'A', value: 'v1' });
  s.remove('c1');
  assert.deepEqual(s.list(), []);
});

test('plain-store: lock() resets snapshot and isUnlocked', async () => {
  const s = new PlainStore();
  await s.unlock(null);
  s.upsert({ id: 'c1', kind: 'credential', label: 'A', value: 'v1' });
  s.lock();
  assert.equal(s.isUnlocked(), false);
  assert.throws(() => s.list(), /Store is locked/);
});

test('plain-store: sealWith() returns the plaintext snapshot (no encryption)', async () => {
  const s = new PlainStore();
  await s.unlock(null);
  s.upsert({ id: 'c1', kind: 'credential', label: 'A', value: 'v1' });
  const out = await s.sealWith();
  assert.equal(out.version, 1);
  assert.equal(out.entries[0].value, 'v1');
  // sanity: no ciphertext/iv/kdf fields like an encrypted envelope would have
  assert.equal(out.ciphertext, undefined);
});

test('plain-store: round-trip — upsert, sealWith, new store, unlock, find entry', async () => {
  const s1 = new PlainStore();
  await s1.unlock(null);
  s1.upsert({ id: 'p1', kind: 'profile', label: 'Name', value: 'Bob' });
  const stored = await s1.sealWith();

  const s2 = new PlainStore();
  await s2.unlock(stored);
  assert.equal(s2.get('p1').value, 'Bob');
});
