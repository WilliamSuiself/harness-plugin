// Pure ESM unit tests for packages/host/lib/cloud-sync.mjs
// Uses a fake fetch + in-memory config store — no real network/disk I/O.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCloudSyncClient } from '../lib/cloud-sync.mjs';

function makeConfigStore(initial = {}) {
  let config = { serverUrl: null, username: null, token: null, lastKnownVersion: 0, deviceId: null, ...initial };
  return {
    async loadConfig() { return { ...config }; },
    async saveConfig(next) { config = { ...next }; },
    getRaw() { return config; },
  };
}

function makeFakeFetch(handler) {
  return async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : undefined;
    const method = opts?.method || 'GET';
    const auth = opts?.headers?.Authorization;
    const result = await handler({ url, method, body, auth });
    return {
      status: result.status,
      json: async () => result.data,
    };
  };
}

test('createCloudSyncClient: throws without a fetch implementation', () => {
  assert.throws(() => createCloudSyncClient({ fetchImpl: null }));
});

test('getStatus: never leaks the token, reports loggedIn correctly', async () => {
  const store = makeConfigStore({ token: 'secret-token', username: 'alice', serverUrl: 'http://x' });
  const client = createCloudSyncClient({ fetchImpl: makeFakeFetch(() => ({ status: 200, data: {} })), ...store });
  const status = await client.getStatus();
  assert.equal(status.loggedIn, true);
  assert.equal(status.username, 'alice');
  assert.equal('token' in status, false);
});

test('register: on success, persists serverUrl/username/token/deviceId', async () => {
  const store = makeConfigStore();
  const fetchImpl = makeFakeFetch(({ url, method, body }) => {
    assert.equal(method, 'POST');
    assert.ok(url.endsWith('/accounts/register'));
    assert.deepEqual(body, { username: 'alice', password: 'longenough1' });
    return { status: 200, data: { ok: true, token: 'tok123' } };
  });
  const client = createCloudSyncClient({ fetchImpl, ...store });
  const r = await client.register('http://relay.local', 'alice', 'longenough1');
  assert.equal(r.ok, true);
  const saved = store.getRaw();
  assert.equal(saved.token, 'tok123');
  assert.equal(saved.username, 'alice');
  assert.equal(saved.serverUrl, 'http://relay.local');
  assert.equal(typeof saved.deviceId, 'string');
});

test('register: missing fields returns a validation error without calling fetch', async () => {
  let called = false;
  const client = createCloudSyncClient({
    fetchImpl: makeFakeFetch(() => { called = true; return { status: 200, data: {} }; }),
    ...makeConfigStore(),
  });
  const r = await client.register('', 'alice', '');
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

test('register: relay error response is surfaced, nothing persisted', async () => {
  const store = makeConfigStore();
  const fetchImpl = makeFakeFetch(() => ({ status: 400, data: { ok: false, error: 'username taken' } }));
  const client = createCloudSyncClient({ fetchImpl, ...store });
  const r = await client.register('http://relay.local', 'alice', 'longenough1');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'username taken');
  assert.equal(store.getRaw().token, null);
});

test('login: succeeds and reuses an existing deviceId', async () => {
  const store = makeConfigStore({ deviceId: 'device-xyz' });
  const fetchImpl = makeFakeFetch(({ url }) => {
    assert.ok(url.endsWith('/accounts/login'));
    return { status: 200, data: { ok: true, token: 'newtok' } };
  });
  const client = createCloudSyncClient({ fetchImpl, ...store });
  const r = await client.login('http://relay.local', 'alice', 'longenough1');
  assert.equal(r.ok, true);
  assert.equal(store.getRaw().deviceId, 'device-xyz');
  assert.equal(store.getRaw().token, 'newtok');
});

test('login: 401 surfaces the relay error', async () => {
  const client = createCloudSyncClient({
    fetchImpl: makeFakeFetch(() => ({ status: 401, data: { ok: false, error: 'invalid username or password' } })),
    ...makeConfigStore(),
  });
  const r = await client.login('http://relay.local', 'alice', 'wrong');
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid/);
});

test('logout: resets config to defaults', async () => {
  const store = makeConfigStore({ token: 'tok', username: 'alice', serverUrl: 'http://x' });
  const client = createCloudSyncClient({ fetchImpl: makeFakeFetch(() => ({ status: 200, data: {} })), ...store });
  await client.logout();
  const saved = store.getRaw();
  assert.equal(saved.token, null);
  assert.equal(saved.username, null);
});

test('push: not logged in returns an error without calling fetch', async () => {
  let called = false;
  const client = createCloudSyncClient({
    fetchImpl: makeFakeFetch(() => { called = true; return { status: 200, data: {} }; }),
    ...makeConfigStore(),
  });
  const r = await client.push({ kdf: {}, ciphertext: 'x', iv: 'y' });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

test('push: success updates lastKnownVersion', async () => {
  const store = makeConfigStore({ serverUrl: 'http://relay.local', token: 'tok', lastKnownVersion: 3 });
  const fetchImpl = makeFakeFetch(({ method, body, auth }) => {
    assert.equal(method, 'PUT');
    assert.equal(auth, 'Bearer tok');
    assert.equal(body.expectedVersion, 3);
    return { status: 200, data: { ok: true, version: 4, updatedAt: 12345 } };
  });
  const client = createCloudSyncClient({ fetchImpl, ...store });
  const r = await client.push({ kdf: {}, ciphertext: 'x', iv: 'y' });
  assert.equal(r.ok, true);
  assert.equal(r.version, 4);
  assert.equal(store.getRaw().lastKnownVersion, 4);
});

test('push: 409 conflict does not update lastKnownVersion', async () => {
  const store = makeConfigStore({ serverUrl: 'http://relay.local', token: 'tok', lastKnownVersion: 3 });
  const fetchImpl = makeFakeFetch(() => ({
    status: 409,
    data: { ok: false, conflict: true, current: { version: 5, envelope: { ciphertext: 'newer' } } },
  }));
  const client = createCloudSyncClient({ fetchImpl, ...store });
  const r = await client.push({ kdf: {}, ciphertext: 'x', iv: 'y' });
  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
  assert.equal(r.current.version, 5);
  assert.equal(store.getRaw().lastKnownVersion, 3);
});

test('pull: success does not mutate lastKnownVersion until confirmVersion is called', async () => {
  const store = makeConfigStore({ serverUrl: 'http://relay.local', token: 'tok', lastKnownVersion: 1 });
  const fetchImpl = makeFakeFetch(({ method }) => {
    assert.equal(method, 'GET');
    return { status: 200, data: { ok: true, envelope: { ciphertext: 'blob' }, version: 5, updatedAt: 999 } };
  });
  const client = createCloudSyncClient({ fetchImpl, ...store });
  const r = await client.pull();
  assert.equal(r.ok, true);
  assert.equal(r.version, 5);
  assert.equal(store.getRaw().lastKnownVersion, 1);
  await client.confirmVersion(5);
  assert.equal(store.getRaw().lastKnownVersion, 5);
});

test('pull: not logged in returns an error', async () => {
  const client = createCloudSyncClient({ fetchImpl: makeFakeFetch(() => ({ status: 200, data: {} })), ...makeConfigStore() });
  const r = await client.pull();
  assert.equal(r.ok, false);
});
