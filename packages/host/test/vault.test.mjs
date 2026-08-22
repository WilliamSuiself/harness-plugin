// Pure ESM unit tests for packages/host/lib/vault.mjs
// Uses Node.js built-in test runner only — no external dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Vault, DEFAULT_CATEGORIES } from '../lib/vault.mjs';

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
  assert.deepEqual(v.snapshot.entries, []);
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

test('vault: upsert() with value omitted defaults to "" for a brand-new entry', async () => {
  const v = new Vault();
  await v.unlock(null, 'pw');
  // No `value` key at all — mirrors the web UI's "quick add: title only"
  // flow (packages/host/lib/index.mjs POST /upsert), which lets the user
  // create a bare title and fill in content afterwards.
  v.upsert({ id: 'n1', kind: 'note', label: 'Draft title' });
  assert.equal(v.get('n1').value, '');
});

test('vault: upsert() with value omitted on an EDIT preserves the existing value', async () => {
  const v = new Vault();
  await v.unlock(null, 'pw');
  v.upsert({ id: 'c1', kind: 'credential', label: 'GitHub Token', value: 'ghp_secret' });
  // Editing just the label, without resubmitting the value — this is how
  // the web UI edits a hidden credential (the real secret never reaches
  // the client, so it must never be able to accidentally blank it out).
  v.upsert({ id: 'c1', kind: 'credential', label: 'GitHub Token (renamed)' });
  const entry = v.get('c1');
  assert.equal(entry.value, 'ghp_secret', 'omitted value must not overwrite the existing secret');
  assert.equal(entry.label, 'GitHub Token (renamed)');
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

test('vault: unlock(null) seeds the default category catalog', async () => {
  const v = new Vault();
  await v.unlock(null, 'pw');
  assert.deepEqual(v.listCategories(), DEFAULT_CATEGORIES);
});

test('vault: addCategory / removeCategory dedupe case-insensitively', async () => {
  const v = new Vault();
  await v.unlock(null, 'pw');
  v.addCategory('旅行');
  v.addCategory('旅行'); // duplicate, ignored
  v.addCategory('  旅行  '); // duplicate after trim, ignored
  assert.equal(v.listCategories().filter((c) => c === '旅行').length, 1);
  v.removeCategory('旅行');
  assert.equal(v.listCategories().includes('旅行'), false);
});

test('vault: upsert with a new tag auto-registers it as a category', async () => {
  const v = new Vault();
  await v.unlock(null, 'pw');
  v.upsert({ id: 'n1', kind: 'note', label: 'Trip', value: 'Tokyo', tags: ['旅行', '工作'] });
  const cats = v.listCategories();
  assert.ok(cats.includes('旅行'), 'new tag should be auto-registered');
  assert.equal(cats.filter((c) => c === '工作').length, 1, '既有默认类目不应重复');
});

test('vault: unlock() backfills categories/tombstones when a legacy snapshot omits them', async () => {
  // Simulate an envelope sealed by a pre-categories client (no categories/
  // tombstones fields in the decrypted JSON) by unlocking, hand-editing the
  // in-memory snapshot back to the legacy shape, then re-sealing.
  const v1 = new Vault();
  await v1.unlock(null, 'pw');
  v1.upsert({ id: 'p1', kind: 'note', label: 'Old', value: 'Legacy entry' });
  v1.snapshot = { version: 1, entries: v1.snapshot.entries }; // strip categories/tombstones
  const envelope = await v1.sealWith('pw');

  const v2 = new Vault();
  await v2.unlock(envelope, 'pw');
  assert.deepEqual(v2.listCategories(), DEFAULT_CATEGORIES, 'should backfill the default catalog');
  assert.deepEqual(v2.snapshot.tombstones, [], 'should backfill an empty tombstone list');
});

test('vault: mergeSnapshot keeps the newer copy of each entry by updatedAt', async () => {
  const local = new Vault();
  await local.unlock(null, 'pw');
  // upsert() always stamps updatedAt = Date.now(), so to deterministically
  // simulate "the remote copy is newer" we give the remote entry a
  // far-future updatedAt rather than relying on wall-clock timing.
  local.upsert({ id: 'a', kind: 'note', label: 'A', value: 'local-old' });
  local.upsert({ id: 'b', kind: 'note', label: 'B', value: 'local-only' });
  const future = Date.now() + 10_000_000;

  const remoteSnapshot = {
    version: 1,
    entries: [
      { id: 'a', kind: 'note', label: 'A', value: 'remote-newer', createdAt: 1, updatedAt: future },
      { id: 'c', kind: 'note', label: 'C', value: 'remote-only', createdAt: 5, updatedAt: 5 },
    ],
    categories: ['旅行'],
    tombstones: [],
  };
  local.mergeSnapshot(remoteSnapshot);
  const byId = Object.fromEntries(local.list().map((e) => [e.id, e]));
  assert.equal(byId.a.value, 'remote-newer', 'newer updatedAt should win');
  assert.equal(byId.b.value, 'local-only', 'local-only entry should be kept');
  assert.equal(byId.c.value, 'remote-only', 'remote-only entry should be kept');
  assert.ok(local.listCategories().includes('旅行'), 'remote category should be unioned in');
});

test('vault: mergeSnapshot honors a tombstone over an older remote copy (no resurrection)', async () => {
  const local = new Vault();
  await local.unlock(null, 'pw');
  local.upsert({ id: 'a', kind: 'note', label: 'A', value: 'v1', createdAt: 1, updatedAt: 1 });
  local.remove('a'); // records a tombstone with deletedAt = now (large)

  const remoteSnapshot = {
    version: 1,
    entries: [{ id: 'a', kind: 'note', label: 'A', value: 'stale-copy', createdAt: 1, updatedAt: 1 }],
    categories: [],
    tombstones: [],
  };
  local.mergeSnapshot(remoteSnapshot);
  assert.equal(local.get('a'), undefined, 'deleted entry should not be resurrected by a stale remote copy');
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
