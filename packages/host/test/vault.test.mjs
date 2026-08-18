// Pure ESM unit tests for packages/host/lib/vault.mjs
// Uses Node.js built-in test runner only — no external dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Vault } from '../lib/vault.mjs';

test('vault: new vault is locked', async () => {
  const v = new Vault();
  assert.equal(v.isUnlocked(), false);
});

test('vault: locked vault throws on list/get/upsert/remove', async () => {
  const v = new Vault();
  assert.throws(() => v.list(), /Vault is locked/);
  assert.throws(() => v.get('any'), /Vault is locked/);
  assert.throws(() => v.upsert({ id: 'x', kind: 'profile', label: 'L', value: 'V' }), /Vault is locked/);
  assert.throws(() => v.remove('x'), /Vault is locked/);
  await assert.rejects(async () => v.sealWith('p'), /Vault is locked/);
});

test('vault: unlock(null, password) creates an empty vault', async () => {
  const v = new Vault();
  await v.unlock(null, 'master-password');
  assert.equal(v.isUnlocked(), true);
  assert.deepEqual(v.list(), []);
});

test('vault: unlock(envelope, wrongPassword) throws "Wrong master password."', async () => {
  const v1 = new Vault();
  await v1.unlock(null, 'right-password');
  v1.upsert({
    id: 'p1',
    kind: 'profile',
    label: 'Name',
    value: 'Alice',
  });
  const envelope = await v1.sealWith('right-password');

  const v2 = new Vault();
  await assert.rejects(
    async () => v2.unlock(envelope, 'wrong-password'),
    (err) => err instanceof Error && /Wrong master password/.test(err.message),
    'should throw Wrong master password',
  );
  assert.equal(v2.isUnlocked(), false, 'failed unlock should leave vault locked');
});

test('vault: unlock(envelope, correct password) restores the snapshot', async () => {
  const v1 = new Vault();
  await v1.unlock(null, 'master');
  const now = Date.now();
  v1.upsert({
    id: 'p1',
    kind: 'profile',
    label: 'Name',
    value: 'Alice',
    createdAt: now,
    updatedAt: now,
  });
  const envelope = await v1.sealWith('master');

  const v2 = new Vault();
  await v2.unlock(envelope, 'master');
  assert.equal(v2.isUnlocked(), true);
  const list = v2.list();
  assert.equal(list.length, 1);
  // The persisted entry must keep the same id and value.
  assert.equal(list[0].id, 'p1');
  assert.equal(list[0].label, 'Name');
  assert.equal(list[0].value, 'Alice');
  assert.equal(list[0].kind, 'profile');
});

test('vault: round-trip — upsert, sealWith, new vault, unlock, find entry', async () => {
  const v1 = new Vault();
  await v1.unlock(null, 'topsecret');
  v1.upsert({
    id: 'c1',
    kind: 'credential',
    label: 'GitHub Token',
    value: 'ghp_abcdef',
    hint: 'personal',
  });
  v1.upsert({
    id: 'p1',
    kind: 'profile',
    label: '主手机号',
    value: '13812345678',
  });
  const envelope = await v1.sealWith('topsecret');

  const v2 = new Vault();
  await v2.unlock(envelope, 'topsecret');
  const all = v2.list();
  assert.equal(all.length, 2);
  const gh = v2.get('c1');
  assert.ok(gh, 'c1 should be present');
  assert.equal(gh.value, 'ghp_abcdef');
  assert.equal(gh.hint, 'personal');
  const phone = v2.get('p1');
  assert.ok(phone, 'p1 should be present');
  assert.equal(phone.value, '13812345678');
});

test('vault: lock() resets snapshot and isUnlocked', async () => {
  const v = new Vault();
  await v.unlock(null, 'pw');
  v.upsert({
    id: 'p1',
    kind: 'profile',
    label: 'Name',
    value: 'Alice',
  });
  assert.equal(v.list().length, 1);
  assert.equal(v.isUnlocked(), true);

  v.lock();
  assert.equal(v.isUnlocked(), false);
  assert.deepEqual(v.snapshot, { version: 1, entries: [] });
  assert.throws(() => v.list(), /Vault is locked/);
});

test('vault: upsert finds existing id and overwrites value', async () => {
  const v = new Vault();
  await v.unlock(null, 'pw');
  const now = Date.now();
  v.upsert({ id: 'p1', kind: 'profile', label: 'Name', value: 'A', createdAt: now, updatedAt: now });
  assert.equal(v.list().length, 1);
  v.upsert({ id: 'p1', kind: 'profile', label: 'Name', value: 'B' });
  assert.equal(v.list().length, 1, 'should not duplicate, just overwrite');
  assert.equal(v.get('p1').value, 'B');
});

test('vault: remove deletes by id', async () => {
  const v = new Vault();
  await v.unlock(null, 'pw');
  v.upsert({ id: 'p1', kind: 'profile', label: 'Name', value: 'A' });
  v.upsert({ id: 'p2', kind: 'profile', label: 'Phone', value: '123' });
  v.remove('p1');
  assert.equal(v.list().length, 1);
  assert.equal(v.get('p1'), undefined);
  assert.equal(v.get('p2').value, '123');
});

test('vault: corrupted envelope (tampered ciphertext) throws', async () => {
  const v1 = new Vault();
  await v1.unlock(null, 'pw');
  v1.upsert({ id: 'p1', kind: 'profile', label: 'Name', value: 'Alice' });
  const envelope = await v1.sealWith('pw');

  // Tamper with the ciphertext.
  const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA' };

  const v2 = new Vault();
  await assert.rejects(
    async () => v2.unlock(tampered, 'pw'),
    (err) => err instanceof Error,
    'tampered envelope should not unlock',
  );
});
