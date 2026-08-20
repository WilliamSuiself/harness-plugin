// Host-side client for the MemoryPets cloud-sync relay
// (packages/cloud-sync). Talks to a remote HTTP endpoint over `fetch` and
// persists only NON-SECRET-VAULT config locally (server URL, username,
// session token, last-known version, device id).
//
// SECURITY:
//   - This module NEVER has access to the vault master password. It only
//     ever pushes/pulls the OPAQUE `envelope` object produced by
//     `Vault.sealWith()` — the same ciphertext blob that's already written
//     to disk locally. It cannot decrypt it and neither can the relay.
//   - The cloud account (username/password) is a SEPARATE secret from the
//     vault master password; losing/leaking one does not expose the other.
//   - `saveConfig`/`loadConfig` are injectable so callers (and tests) can
//     swap in an in-memory store; the default implementation persists to
//     `cloudConfigPath()` from paths.mjs.

import { randomUUID } from 'node:crypto';
import { cloudConfigPath } from './paths.mjs';

const DEFAULT_CONFIG = {
  serverUrl: null,
  username: null,
  token: null,
  lastKnownVersion: 0,
  deviceId: null,
};

async function defaultLoadConfig() {
  try {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(cloudConfigPath(), 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function defaultSaveConfig(config) {
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = cloudConfigPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(config, null, 2));
  } catch { /* persistence failure is non-fatal — sync will just retry later */ }
}

function stripToken(config) {
  const { token, ...safe } = config;
  return { ...safe, loggedIn: !!token };
}

export function createCloudSyncClient({
  fetchImpl = globalThis.fetch,
  loadConfig = defaultLoadConfig,
  saveConfig = defaultSaveConfig,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('createCloudSyncClient requires a fetch implementation (global fetch unavailable?)');
  }

  async function request(config, method, path, body) {
    const res = await fetchImpl(config.serverUrl.replace(/\/+$/, '') + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty/non-JSON body */ }
    return { status: res.status, data };
  }

  return {
    async getStatus() {
      return stripToken(await loadConfig());
    },

    async register(serverUrl, username, password) {
      if (!serverUrl || !username || !password) {
        return { ok: false, error: 'serverUrl, username and password are all required' };
      }
      const config = { ...DEFAULT_CONFIG, serverUrl, username, deviceId: randomUUID() };
      const { status, data } = await request(config, 'POST', '/accounts/register', { username, password });
      if (status !== 200 || !data?.ok) {
        return { ok: false, error: data?.error || `register failed (HTTP ${status})` };
      }
      config.token = data.token;
      await saveConfig(config);
      return { ok: true, ...stripToken(config) };
    },

    async login(serverUrl, username, password) {
      if (!serverUrl || !username || !password) {
        return { ok: false, error: 'serverUrl, username and password are all required' };
      }
      const existing = await loadConfig();
      const config = { ...DEFAULT_CONFIG, ...existing, serverUrl, username, deviceId: existing.deviceId || randomUUID() };
      const { status, data } = await request(config, 'POST', '/accounts/login', { username, password });
      if (status !== 200 || !data?.ok) {
        return { ok: false, error: data?.error || `login failed (HTTP ${status})` };
      }
      config.token = data.token;
      await saveConfig(config);
      return { ok: true, ...stripToken(config) };
    },

    async logout() {
      await saveConfig({ ...DEFAULT_CONFIG });
      return { ok: true };
    },

    // Uploads `envelope` (the opaque Vault.sealWith() output) using the
    // last-known version as the optimistic-concurrency baseline. On success,
    // persists the new version so the next push/pull starts from there.
    // On conflict (someone else pushed a newer version first), returns
    // `{ ok:false, conflict:true, current }` WITHOUT overwriting local
    // config — the caller must resolve (e.g. pull + re-apply) before retrying.
    async push(envelope) {
      const config = await loadConfig();
      if (!config.serverUrl || !config.token) {
        return { ok: false, error: 'not logged in to cloud sync' };
      }
      const { status, data } = await request(config, 'PUT', '/vault', {
        envelope,
        expectedVersion: config.lastKnownVersion,
        deviceId: config.deviceId,
      });
      if (status === 409) {
        return { ok: false, conflict: true, current: data?.current };
      }
      if (status !== 200 || !data?.ok) {
        return { ok: false, error: data?.error || `push failed (HTTP ${status})` };
      }
      await saveConfig({ ...config, lastKnownVersion: data.version });
      return { ok: true, version: data.version, updatedAt: data.updatedAt };
    },

    // Downloads the current remote envelope. Does NOT touch local
    // lastKnownVersion by itself — callers must call `confirmVersion(version)`
    // once they've actually applied the envelope locally (e.g. successfully
    // unlocked/decrypted it), so a failed decrypt never desyncs the tracked
    // version from what's actually on disk.
    async pull() {
      const config = await loadConfig();
      if (!config.serverUrl || !config.token) {
        return { ok: false, error: 'not logged in to cloud sync' };
      }
      const { status, data } = await request(config, 'GET', '/vault');
      if (status !== 200 || !data?.ok) {
        return { ok: false, error: data?.error || `pull failed (HTTP ${status})` };
      }
      return { ok: true, envelope: data.envelope, version: data.version, updatedAt: data.updatedAt };
    },

    async confirmVersion(version) {
      const config = await loadConfig();
      await saveConfig({ ...config, lastKnownVersion: version });
    },
  };
}
