// Flat-file storage for the cloud-sync relay.
//
// Layout under `dataDir`:
//   accounts.json        { [username]: { salt, hash, createdAt } }
//   vaults/<username>.json  { envelope, version, updatedAt, deviceId }
//
// SECURITY: `envelope` here is the SAME opaque `{ version, kdf, ciphertext,
// iv }` structure produced by packages/host/lib/vault.mjs's sealWith(). This
// store never parses or decrypts it — it is treated as an opaque blob end to
// end. Only `accounts.json` contains anything server-derived (password
// hashes), and even those are salted/hashed, never plaintext.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Usernames are used to build filesystem paths (vaults/<username>.json) —
// restrict to a safe charset to rule out path traversal.
const SAFE_USERNAME = /^[a-zA-Z0-9_.@-]{3,64}$/;

export function isValidUsername(username) {
  return typeof username === 'string' && SAFE_USERNAME.test(username);
}

export function createFileStore(dataDir) {
  const accountsPath = join(dataDir, 'accounts.json');
  const vaultsDir = join(dataDir, 'vaults');
  const vaultPath = (username) => join(vaultsDir, `${username}.json`);

  async function readJsonFile(path, fallback) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return fallback;
    }
  }

  async function writeJsonFile(path, data) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2));
  }

  return {
    async getAccount(username) {
      const accounts = await readJsonFile(accountsPath, {});
      return accounts[username] ?? null;
    },

    async createAccount(username, salt, hash) {
      const accounts = await readJsonFile(accountsPath, {});
      if (accounts[username]) {
        throw new Error('username already registered');
      }
      accounts[username] = { salt, hash, createdAt: Date.now() };
      await writeJsonFile(accountsPath, accounts);
    },

    async getVaultRecord(username) {
      return readJsonFile(vaultPath(username), null);
    },

    // Optimistic-concurrency write. `expectedVersion` must match the
    // currently-stored version (0 if no record exists yet) or this throws
    // a `ConflictError` carrying the real current record so the caller can
    // present it to the client for manual resolution.
    async putVaultRecord(username, { envelope, expectedVersion, deviceId }) {
      const current = await this.getVaultRecord(username);
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        const err = new Error('version conflict');
        err.code = 'CONFLICT';
        err.current = current;
        throw err;
      }
      const record = {
        envelope,
        version: currentVersion + 1,
        updatedAt: Date.now(),
        deviceId: deviceId || null,
      };
      await writeJsonFile(vaultPath(username), record);
      return record;
    },
  };
}
