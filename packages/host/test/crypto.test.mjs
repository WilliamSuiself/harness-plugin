// Pure ESM unit tests for packages/host/lib/crypto.mjs
// Uses Node.js built-in test runner only — no external dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  randomBytes,
  toBase64,
  fromBase64,
  deriveKey,
  encryptString,
  decryptString,
} from '../lib/crypto.mjs';

test('crypto: randomBytes(n) returns n bytes as a Uint8Array', async () => {
  for (const n of [0, 1, 16, 32, 64]) {
    const out = randomBytes(n);
    assert.ok(out instanceof Uint8Array, `expected Uint8Array for n=${n}`);
    assert.equal(out.length, n, `expected length ${n} but got ${out.length}`);
  }
});

test('crypto: randomBytes produces different values on each call', async () => {
  const a = randomBytes(16);
  const b = randomBytes(16);
  assert.notDeepEqual(a, b, 'two randomBytes calls should not collide');
});

test('crypto: toBase64 / fromBase64 round-trip preserves bytes', async () => {
  const original = new Uint8Array([0, 1, 2, 3, 250, 251, 255, 16, 32, 64, 128]);
  const b64 = toBase64(original);
  assert.equal(typeof b64, 'string');
  // Standard base64 length is ceil(n/3)*4 with possible '=' padding.
  assert.ok(b64.length > 0);

  const decoded = fromBase64(b64);
  assert.ok(decoded instanceof Uint8Array);
  assert.equal(decoded.length, original.length);
  for (let i = 0; i < original.length; i++) {
    assert.equal(decoded[i], original[i], `byte ${i} mismatch`);
  }
});

test('crypto: toBase64 / fromBase64 round-trip on empty buffer', async () => {
  const empty = new Uint8Array(0);
  const b64 = toBase64(empty);
  const decoded = fromBase64(b64);
  assert.equal(decoded.length, 0);
});

test('crypto: deriveKey + encryptString + decryptString round-trip', async () => {
  const password = 'correct horse battery staple';
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const iterations = 50_000; // low for fast test runs (still fine for AES-GCM)
  const plaintext = 'hello world — 哈喽 MemoryPets 🐾';

  const key = await deriveKey(password, salt, iterations);
  const ciphertext = await encryptString(key, iv, plaintext);

  assert.equal(typeof ciphertext, 'string');
  assert.ok(ciphertext.length > 0);
  // Ciphertext should NOT equal the plaintext (sanity check).
  assert.notEqual(ciphertext, plaintext);

  const decrypted = await decryptString(key, iv, ciphertext);
  assert.equal(decrypted, plaintext);
});

test('crypto: decryptString with wrong password throws', async () => {
  const password = 'right-password';
  const wrongPassword = 'wrong-password';
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const iterations = 50_000;

  const correctKey = await deriveKey(password, salt, iterations);
  const ciphertext = await encryptString(correctKey, iv, 'top secret');

  const wrongKey = await deriveKey(wrongPassword, salt, iterations);
  await assert.rejects(
    async () => decryptString(wrongKey, iv, ciphertext),
    (err) => err instanceof Error,
    'decrypt with wrong key should throw',
  );
});

test('crypto: decryptString with tampered ciphertext throws', async () => {
  const password = 'p';
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, 50_000);
  const ciphertext = await encryptString(key, iv, 'data');

  // Flip one character in the middle of the base64 to tamper.
  const tampered = ciphertext.slice(0, -4) + 'AAAA';

  await assert.rejects(
    async () => decryptString(key, iv, tampered),
    (err) => err instanceof Error,
  );
});

test('crypto: deriveKey produces a CryptoKey object that is non-extractable', async () => {
  const salt = randomBytes(16);
  const key = await deriveKey('pw', salt, 50_000);
  assert.equal(typeof key, 'object');
  assert.ok(key !== null);
  // Non-extractable is part of the public contract.
  assert.equal(key.extractable, false);
});
