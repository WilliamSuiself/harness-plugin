// Password hashing + session token helpers for the cloud-sync relay.
//
// SECURITY NOTE: this hashes the ACCOUNT password (used only to authenticate
// who may read/write a given user's encrypted blob on this relay). It is a
// completely different secret from the MemoryPets master password, which
// never leaves the user's device and this server never sees.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const SALT_LEN = 16;
const KEY_LEN = 64;
const TOKEN_LEN = 32;

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('password must be at least 8 characters');
  }
  const salt = randomBytes(SALT_LEN).toString('hex');
  const derived = await scrypt(password, salt, KEY_LEN);
  return { salt, hash: derived.toString('hex') };
}

export async function verifyPassword(password, salt, hash) {
  if (typeof password !== 'string' || !salt || !hash) return false;
  const derived = await scrypt(password, salt, KEY_LEN);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function makeToken() {
  return randomBytes(TOKEN_LEN).toString('hex');
}

// In-memory session store. Tokens do not survive a server restart — clients
// must re-login, which is an acceptable MVP tradeoff (no persistent session
// secrets to leak from disk).
export function createSessionStore(ttlMs = 30 * 24 * 60 * 60 * 1000) {
  const sessions = new Map(); // token -> { username, expiresAt }

  return {
    issue(username) {
      const token = makeToken();
      sessions.set(token, { username, expiresAt: Date.now() + ttlMs });
      return token;
    },
    resolve(token) {
      if (!token) return null;
      const s = sessions.get(token);
      if (!s) return null;
      if (s.expiresAt < Date.now()) {
        sessions.delete(token);
        return null;
      }
      return s.username;
    },
    revoke(token) {
      sessions.delete(token);
    },
    size() {
      return sessions.size;
    },
  };
}
