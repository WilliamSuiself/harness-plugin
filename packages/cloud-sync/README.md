# MemoryPets Cloud Sync Relay

A minimal, **zero-knowledge** sync relay for MemoryPets. It lets the browser
plugin and a future mobile app share the same encrypted vault, without the
server ever seeing plaintext entries or the vault's master password.

## Security model

- The relay only ever stores/serves the opaque `envelope` object produced by
  `Vault.sealWith()` — `{ version, kdf: { salt, iterations, keyLen }, ciphertext, iv }`.
  It never parses the ciphertext and never sees the master password.
- Account login (username/password) is a **completely separate secret** from
  the vault master password. It only controls who may read/write a given
  user's blob on this relay — think of it as "which mailbox is mine", not
  "can decrypt my mail".
- Account passwords are hashed with `scrypt` (salted, 64-byte derived key)
  before being stored — see `lib/auth.mjs`.
- Session tokens are random 32-byte hex strings, held only in memory (not
  persisted) — restarting the relay invalidates all sessions and clients
  must re-login.

## Sync protocol

Optimistic concurrency, "whoever has the latest version wins the write":

1. Client GETs `/vault` → `{ envelope, version, updatedAt }` (or
   `{ envelope: null, version: 0 }` if nothing has been synced yet).
2. Client decrypts locally with the master password, merges with local
   changes (or just always treats server as source of truth if it's newer).
3. Client PUTs `/vault` with `{ envelope, expectedVersion, deviceId }` where
   `expectedVersion` is the version it last read.
4. If another device already wrote a newer version, the relay returns
   `409 { conflict: true, current }` — the client should GET again, resolve
   (e.g. "keep server / keep mine / manual merge"), and retry the PUT with
   the new `expectedVersion`.

There is no field-level merge on the server — it cannot merge ciphertext.
Conflict resolution is a client-side concern (typically: last-write-wins by
`updatedAt`, or prompting the user).

## Running the relay

```bash
cd packages/cloud-sync
CLOUD_SYNC_PORT=8787 CLOUD_SYNC_DATA_DIR=./data npm start
```

Env vars:

| Var                    | Default        | Notes                                   |
|-------------------------|----------------|------------------------------------------|
| `CLOUD_SYNC_PORT`       | `8787`         | Listen port                             |
| `CLOUD_SYNC_HOST`       | `127.0.0.1`    | Use `0.0.0.0` to expose beyond localhost |
| `CLOUD_SYNC_DATA_DIR`   | `./data`       | Where `accounts.json` / `vaults/*.json` live |

For real deployment, put this behind HTTPS (e.g. Caddy/nginx/Cloudflare
Tunnel) — the relay itself speaks plain HTTP and assumes TLS termination is
handled upstream.

## API reference

See `../../docs/MOBILE_SYNC_API.md` for the full REST contract, crypto
parameters, and example client flow (used by both the browser host module —
`packages/host/lib/cloud-sync.mjs` — and any future mobile app).

## Tests

```bash
npm test
```
