import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileStore, isValidUsername } from '../lib/store.mjs';

async function withTempStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'memorypets-cloud-sync-'));
  try {
    await fn(createFileStore(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('isValidUsername: accepts safe charset within length bounds', () => {
  assert.equal(isValidUsername('alice.bob-99@example'), true);
  assert.equal(isValidUsername('ab'), false); // too short
  assert.equal(isValidUsername('../../etc/passwd'), false);
  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername(null), false);
});

test('store: getAccount returns null for unknown username', async () => {
  await withTempStore(async (store) => {
    assert.equal(await store.getAccount('nobody'), null);
  });
});

test('store: createAccount then getAccount round-trips salt/hash', async () => {
  await withTempStore(async (store) => {
    await store.createAccount('alice', 'saltval', 'hashval');
    const acc = await store.getAccount('alice');
    assert.equal(acc.salt, 'saltval');
    assert.equal(acc.hash, 'hashval');
    assert.equal(typeof acc.createdAt, 'number');
  });
});

test('store: createAccount rejects duplicate usernames', async () => {
  await withTempStore(async (store) => {
    await store.createAccount('alice', 's1', 'h1');
    await assert.rejects(() => store.createAccount('alice', 's2', 'h2'));
  });
});

test('store: getVaultRecord returns null when nothing stored yet', async () => {
  await withTempStore(async (store) => {
    assert.equal(await store.getVaultRecord('alice'), null);
  });
});

test('store: putVaultRecord creates version=1 when expectedVersion=0 and nothing exists', async () => {
  await withTempStore(async (store) => {
    const envelope = { kdf: { salt: 'x', iterations: 1 }, ciphertext: 'ct', iv: 'iv' };
    const record = await store.putVaultRecord('alice', { envelope, expectedVersion: 0, deviceId: 'dev1' });
    assert.equal(record.version, 1);
    assert.equal(record.deviceId, 'dev1');
    assert.deepEqual(record.envelope, envelope);
  });
});

test('store: putVaultRecord increments version on subsequent matching write', async () => {
  await withTempStore(async (store) => {
    const envelope1 = { kdf: { salt: 'x', iterations: 1 }, ciphertext: 'ct1', iv: 'iv1' };
    const r1 = await store.putVaultRecord('alice', { envelope: envelope1, expectedVersion: 0 });
    const envelope2 = { kdf: { salt: 'x', iterations: 1 }, ciphertext: 'ct2', iv: 'iv2' };
    const r2 = await store.putVaultRecord('alice', { envelope: envelope2, expectedVersion: r1.version });
    assert.equal(r2.version, 2);
    assert.deepEqual((await store.getVaultRecord('alice')).envelope, envelope2);
  });
});

test('store: putVaultRecord throws a CONFLICT error when expectedVersion is stale', async () => {
  await withTempStore(async (store) => {
    const envelope = { kdf: { salt: 'x', iterations: 1 }, ciphertext: 'ct', iv: 'iv' };
    await store.putVaultRecord('alice', { envelope, expectedVersion: 0 });
    try {
      await store.putVaultRecord('alice', { envelope, expectedVersion: 0 }); // stale — real version is now 1
      assert.fail('expected a conflict error');
    } catch (e) {
      assert.equal(e.code, 'CONFLICT');
      assert.equal(e.current.version, 1);
    }
  });
});
