// MemoryPets cloud-sync relay — a zero-knowledge blob store.
//
// This server NEVER sees the MemoryPets master password and NEVER decrypts
// anything. It only stores/serves the opaque `envelope` object produced by
// packages/host/lib/vault.mjs's sealWith(), gated by a separate account
// (username/password) that has nothing to do with the vault's own crypto.
//
// Routes:
//   POST /accounts/register  { username, password }              -> { ok, token }
//   POST /accounts/login     { username, password }              -> { ok, token }
//   GET  /vault                          (Authorization: Bearer)  -> { ok, envelope, version, updatedAt }
//   PUT  /vault  { envelope, expectedVersion, deviceId }  (Bearer) -> { ok, version, updatedAt }
//                                                          on conflict -> 409 { ok:false, conflict:true, current }

import { createServer as createHttpServer } from 'node:http';
import { hashPassword, verifyPassword, createSessionStore } from './auth.mjs';
import { createFileStore, isValidUsername } from './store.mjs';

function jsonReply(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX = 5 * 1024 * 1024; // 5MB — generous for a vault blob, still bounded.
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function isValidEnvelope(env) {
  return (
    env &&
    typeof env === 'object' &&
    env.kdf &&
    typeof env.kdf.salt === 'string' &&
    typeof env.kdf.iterations === 'number' &&
    typeof env.ciphertext === 'string' &&
    typeof env.iv === 'string'
  );
}

export function createServer({ dataDir, sessionTtlMs } = {}) {
  if (!dataDir) throw new Error('createServer requires a dataDir');
  const store = createFileStore(dataDir);
  const sessions = createSessionStore(sessionTtlMs);

  const handle = async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      jsonReply(res, 400, { ok: false, error: 'bad request URL' });
      return;
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;

    try {
      // —— POST /accounts/register ——
      if (method === 'POST' && path === '/accounts/register') {
        const body = await readJsonBody(req);
        const { username, password } = body || {};
        if (!isValidUsername(username)) {
          jsonReply(res, 400, { ok: false, error: 'username must be 3-64 chars: letters/digits/._@-' });
          return;
        }
        try {
          const { salt, hash } = await hashPassword(password);
          await store.createAccount(username, salt, hash);
        } catch (e) {
          jsonReply(res, 400, { ok: false, error: e.message });
          return;
        }
        const token = sessions.issue(username);
        jsonReply(res, 200, { ok: true, token });
        return;
      }

      // —— POST /accounts/login ——
      if (method === 'POST' && path === '/accounts/login') {
        const body = await readJsonBody(req);
        const { username, password } = body || {};
        const account = username ? await store.getAccount(username) : null;
        const valid = account ? await verifyPassword(password, account.salt, account.hash) : false;
        if (!valid) {
          jsonReply(res, 401, { ok: false, error: 'invalid username or password' });
          return;
        }
        const token = sessions.issue(username);
        jsonReply(res, 200, { ok: true, token });
        return;
      }

      // —— everything below requires a valid session ——
      if (path === '/vault') {
        const username = sessions.resolve(bearerToken(req));
        if (!username) {
          jsonReply(res, 401, { ok: false, error: 'missing or expired session token' });
          return;
        }

        if (method === 'GET') {
          const record = await store.getVaultRecord(username);
          if (!record) {
            jsonReply(res, 200, { ok: true, envelope: null, version: 0, updatedAt: null });
            return;
          }
          jsonReply(res, 200, { ok: true, ...record });
          return;
        }

        if (method === 'PUT') {
          const body = await readJsonBody(req);
          const { envelope, deviceId } = body || {};
          const expectedVersion = Number(body?.expectedVersion);
          if (!isValidEnvelope(envelope)) {
            jsonReply(res, 400, { ok: false, error: 'envelope must be the opaque {kdf,ciphertext,iv} object from Vault.sealWith()' });
            return;
          }
          if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
            jsonReply(res, 400, { ok: false, error: 'expectedVersion (integer >= 0) is required' });
            return;
          }
          try {
            const record = await store.putVaultRecord(username, { envelope, expectedVersion, deviceId });
            jsonReply(res, 200, { ok: true, version: record.version, updatedAt: record.updatedAt });
          } catch (e) {
            if (e.code === 'CONFLICT') {
              jsonReply(res, 409, { ok: false, conflict: true, current: e.current });
              return;
            }
            throw e;
          }
          return;
        }

        jsonReply(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }

      jsonReply(res, 404, { ok: false, error: 'unknown endpoint: ' + method + ' ' + path });
    } catch (e) {
      jsonReply(res, 500, { ok: false, error: e?.message || String(e) });
    }
  };

  return createHttpServer(handle);
}
