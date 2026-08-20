import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../lib/server.mjs';

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'memorypets-cloud-sync-srv-'));
  const server = createServer({ dataDir: dir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

function request(baseUrl, method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(baseUrl + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, data: await r.json() }));
}

const ENVELOPE = { kdf: { salt: 's1', iterations: 250000, keyLen: 256 }, ciphertext: 'ct1', iv: 'iv1' };

test('server: register → login → get empty vault → put v1 → get v1 → put v2 (matching version)', async () => {
  await withServer(async (baseUrl) => {
    const reg = await request(baseUrl, 'POST', '/accounts/register', {
      body: { username: 'alice', password: 'correct horse battery' },
    });
    assert.equal(reg.status, 200);
    assert.equal(reg.data.ok, true);
    assert.equal(typeof reg.data.token, 'string');

    const login = await request(baseUrl, 'POST', '/accounts/login', {
      body: { username: 'alice', password: 'correct horse battery' },
    });
    assert.equal(login.status, 200);
    const token = login.data.token;

    const empty = await request(baseUrl, 'GET', '/vault', { token });
    assert.equal(empty.status, 200);
    assert.equal(empty.data.envelope, null);
    assert.equal(empty.data.version, 0);

    const put1 = await request(baseUrl, 'PUT', '/vault', {
      token,
      body: { envelope: ENVELOPE, expectedVersion: 0, deviceId: 'browser-1' },
    });
    assert.equal(put1.status, 200);
    assert.equal(put1.data.version, 1);

    const get1 = await request(baseUrl, 'GET', '/vault', { token });
    assert.equal(get1.data.version, 1);
    assert.deepEqual(get1.data.envelope, ENVELOPE);

    const envelope2 = { ...ENVELOPE, ciphertext: 'ct2' };
    const put2 = await request(baseUrl, 'PUT', '/vault', {
      token,
      body: { envelope: envelope2, expectedVersion: 1, deviceId: 'phone-1' },
    });
    assert.equal(put2.status, 200);
    assert.equal(put2.data.version, 2);
  });
});

test('server: register rejects a password shorter than 8 chars', async () => {
  await withServer(async (baseUrl) => {
    const r = await request(baseUrl, 'POST', '/accounts/register', {
      body: { username: 'bob', password: 'short' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.data.ok, false);
  });
});

test('server: register rejects a duplicate username', async () => {
  await withServer(async (baseUrl) => {
    await request(baseUrl, 'POST', '/accounts/register', { body: { username: 'carol', password: 'longenough1' } });
    const r = await request(baseUrl, 'POST', '/accounts/register', { body: { username: 'carol', password: 'longenough2' } });
    assert.equal(r.status, 400);
  });
});

test('server: login with wrong password returns 401', async () => {
  await withServer(async (baseUrl) => {
    await request(baseUrl, 'POST', '/accounts/register', { body: { username: 'dave', password: 'longenough1' } });
    const r = await request(baseUrl, 'POST', '/accounts/login', { body: { username: 'dave', password: 'wrongpassword' } });
    assert.equal(r.status, 401);
  });
});

test('server: /vault without a token returns 401', async () => {
  await withServer(async (baseUrl) => {
    const r = await request(baseUrl, 'GET', '/vault');
    assert.equal(r.status, 401);
  });
});

test('server: PUT /vault with a stale expectedVersion returns 409 with the current record', async () => {
  await withServer(async (baseUrl) => {
    const reg = await request(baseUrl, 'POST', '/accounts/register', { body: { username: 'erin', password: 'longenough1' } });
    const token = reg.data.token;
    await request(baseUrl, 'PUT', '/vault', { token, body: { envelope: ENVELOPE, expectedVersion: 0 } });

    const stale = await request(baseUrl, 'PUT', '/vault', {
      token,
      body: { envelope: { ...ENVELOPE, ciphertext: 'other' }, expectedVersion: 0 },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.conflict, true);
    assert.equal(stale.data.current.version, 1);
  });
});

test('server: PUT /vault rejects a malformed envelope', async () => {
  await withServer(async (baseUrl) => {
    const reg = await request(baseUrl, 'POST', '/accounts/register', { body: { username: 'frank', password: 'longenough1' } });
    const token = reg.data.token;
    const r = await request(baseUrl, 'PUT', '/vault', { token, body: { envelope: { not: 'valid' }, expectedVersion: 0 } });
    assert.equal(r.status, 400);
  });
});

test('server: unknown route returns 404', async () => {
  await withServer(async (baseUrl) => {
    const r = await request(baseUrl, 'GET', '/nope');
    assert.equal(r.status, 404);
  });
});
