import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword, makeToken, createSessionStore } from '../lib/auth.mjs';

test('hashPassword: rejects passwords shorter than 8 chars', async () => {
  await assert.rejects(() => hashPassword('short'));
});

test('hashPassword + verifyPassword: round-trip succeeds for the correct password', async () => {
  const { salt, hash } = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', salt, hash), true);
});

test('verifyPassword: fails for the wrong password', async () => {
  const { salt, hash } = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('wrong password here', salt, hash), false);
});

test('verifyPassword: fails gracefully on missing salt/hash', async () => {
  assert.equal(await verifyPassword('anything', null, null), false);
});

test('makeToken: returns a unique hex string each call', () => {
  const a = makeToken();
  const b = makeToken();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]+$/);
});

test('createSessionStore: issue() then resolve() round-trips the username', () => {
  const sessions = createSessionStore();
  const token = sessions.issue('alice');
  assert.equal(sessions.resolve(token), 'alice');
});

test('createSessionStore: resolve() returns null for unknown token', () => {
  const sessions = createSessionStore();
  assert.equal(sessions.resolve('bogus'), null);
});

test('createSessionStore: resolve() returns null for an expired token', () => {
  const sessions = createSessionStore(-1); // already expired
  const token = sessions.issue('alice');
  assert.equal(sessions.resolve(token), null);
});

test('createSessionStore: revoke() invalidates the token', () => {
  const sessions = createSessionStore();
  const token = sessions.issue('alice');
  sessions.revoke(token);
  assert.equal(sessions.resolve(token), null);
});
