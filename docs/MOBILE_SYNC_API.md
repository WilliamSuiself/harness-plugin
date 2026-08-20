# MemoryPets Mobile Sync API

This document is for whoever builds the mobile app: it specifies exactly
what the cloud-sync relay expects, and what crypto parameters your app must
match so that a vault created on the browser plugin can be decrypted on the
phone (and vice versa).

**Read the security model first** — the relay is a dumb, zero-knowledge
blob store. It never sees your master password or your plaintext data. All
encryption/decryption happens ON DEVICE, in your mobile app, using the same
algorithm as `packages/host/lib/crypto.mjs` / `vault.mjs`.

---

## 1. Two separate secrets — do not confuse them

| Secret                  | Where it lives                         | What it protects                          |
|--------------------------|-----------------------------------------|--------------------------------------------|
| **Master password**      | Only ever on-device, in memory/keychain | Decrypts the vault envelope (your notes/credentials) |
| **Cloud account password** | Sent to the relay over HTTPS, stored as a salted hash | Controls who may read/write your blob on the relay |

The mobile app needs to ask the user for **both**, but must never send the
master password to the relay, and must never use the master password as (or
derive) the cloud account password.

---

## 2. Vault crypto parameters (must match exactly)

To decrypt an envelope created by another device, use:

- **KDF**: PBKDF2-HMAC-SHA256
  - iterations: `250000` (also given explicitly in `envelope.kdf.iterations` — always use the value from the envelope, don't hard-code it, in case it changes later)
  - salt: `envelope.kdf.salt`, base64-encoded, 16 raw bytes
  - derived key length: 256 bits (`envelope.kdf.keyLen`)
- **Cipher**: AES-GCM, 256-bit key
  - IV: `envelope.iv`, base64-encoded, 12 raw bytes
  - ciphertext: `envelope.ciphertext`, base64-encoded (AES-GCM auth tag is appended to the ciphertext, per the WebCrypto/most AES-GCM library convention)

### Envelope JSON shape

```json
{
  "version": 1,
  "kdf": { "salt": "<base64, 16 bytes>", "iterations": 250000, "keyLen": 256 },
  "ciphertext": "<base64>",
  "iv": "<base64, 12 bytes>"
}
```

Decrypting `ciphertext` with the derived key + iv yields a UTF-8 JSON string:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "note_abc123_xy9z",
      "kind": "note",
      "label": "买牛奶",
      "value": "周五下班路上买两盒牛奶",
      "tags": ["家庭事务"],
      "dueDate": "2026-08-22",
      "createdAt": 1755600000000,
      "updatedAt": 1755600000000
    },
    {
      "id": "credential_def456_ab3c",
      "kind": "credential",
      "label": "GitHub Token",
      "value": "ghp_xxx...",
      "hint": "ends 8a1f",
      "createdAt": 1755600000000,
      "updatedAt": 1755600000000
    }
  ]
}
```

- `kind`: `"note"` (general-purpose) or `"credential"` (secret). You may also
  encounter legacy `"profile"` / `"work"` entries from before `"note"`
  existed — treat them the same as `"note"` for display purposes.
- `tags`: optional array of strings.
- `dueDate`: optional ISO date string (`YYYY-MM-DD`), only meaningful for `note`.
- `hint`: optional, only on `credential` entries — a non-secret hint shown
  in place of the real value.

**Reference implementations** (for exact byte-for-byte parameter agreement):
`packages/host/lib/crypto.mjs` (WebCrypto-based) and `packages/host/lib/vault.mjs`
(uses the above envelope shape via `sealWith()`/`unlock()`).

### Suggested platform crypto APIs

| Platform | KDF | AEAD |
|---|---|---|
| iOS/Swift | `CryptoKit` doesn't ship PBKDF2 directly — use `CommonCrypto`'s `CCKeyDerivationPBKDF` or `CryptoSwift`. | `CryptoKit.AES.GCM` |
| Android/Kotlin | `javax.crypto.SecretKeyFactory` with `PBKDF2WithHmacSHA256` | `javax.crypto.Cipher` with `AES/GCM/NoPadding` |
| React Native | `react-native-quick-crypto` or `expo-crypto` (check PBKDF2 + AES-GCM support) | same |

---

## 3. Cloud-sync relay REST API

Base URL: whatever you deploy `packages/cloud-sync` to (see its README).
All bodies are JSON; all responses are JSON with at least `{ "ok": boolean }`.

### `POST /accounts/register`

```json
// request
{ "username": "alice", "password": "at-least-8-chars" }
// response 200
{ "ok": true, "token": "<hex session token>" }
// response 400
{ "ok": false, "error": "username already registered" }
```

`username`: 3-64 chars, `[a-zA-Z0-9_.@-]`.

### `POST /accounts/login`

```json
// request
{ "username": "alice", "password": "at-least-8-chars" }
// response 200
{ "ok": true, "token": "<hex session token>" }
// response 401
{ "ok": false, "error": "invalid username or password" }
```

Store the returned `token`; sessions do not persist across a relay restart —
be ready to re-login and get a 401 on an expired/invalid token.

### `GET /vault`

Headers: `Authorization: Bearer <token>`

```json
// response 200, nothing synced yet
{ "ok": true, "envelope": null, "version": 0, "updatedAt": null }
// response 200, has data
{ "ok": true, "envelope": { "kdf": {...}, "ciphertext": "...", "iv": "..." }, "version": 3, "updatedAt": 1755600000000 }
// response 401
{ "ok": false, "error": "missing or expired session token" }
```

### `PUT /vault`

Headers: `Authorization: Bearer <token>`

```json
// request
{
  "envelope": { "kdf": {...}, "ciphertext": "...", "iv": "..." },
  "expectedVersion": 3,
  "deviceId": "my-phone-uuid"
}
// response 200 (write accepted)
{ "ok": true, "version": 4, "updatedAt": 1755600001000 }
// response 409 (someone else wrote first — expectedVersion is stale)
{ "ok": false, "conflict": true, "current": { "envelope": {...}, "version": 4, "updatedAt": ..., "deviceId": "..." } }
// response 400 (malformed envelope / missing expectedVersion)
{ "ok": false, "error": "..." }
```

`expectedVersion` MUST be the version you last read from `GET /vault` (or
`0` if you've never synced before). This is optimistic concurrency — if
another device pushed a newer version first, you get `409` with the winning
record; re-fetch, decide how to reconcile (see below), then retry the PUT
with the new `expectedVersion`.

---

## 4. Recommended client sync flow

1. On app start / "sync now": `GET /vault`.
2. If `envelope === null` → nothing in the cloud yet → go to step 4 (push).
3. If `envelope` is present:
   - Try to decrypt it with the user's master password.
     - Success → this is valid vault state. Compare `updatedAt`/`version`
       against what you have locally. If remote is newer, replace your
       local copy and skip to done.
     - Failure → the remote vault was sealed with a different master
       password (rare — e.g. user changed their password on only one
       device). Surface this to the user; do not silently overwrite.
4. To push local changes: `PUT /vault` with your local envelope and the
   `expectedVersion` you last read.
   - `200` → done, remember the new `version`.
   - `409` → another device won the race. Take its `current.envelope`,
     decrypt-and-adopt it (same as step 3), then retry your push with the
     new version if you still have local changes to contribute (there is no
     field-level merge — plan your own conflict UI, e.g. "keep mine / keep
     theirs / merge manually by exporting both to Markdown and combining").

This exact push→conflict→pull→retry flow is already implemented for the
browser host plugin in `packages/host/lib/cloud-sync.mjs` (see `push()` /
`pull()` / `confirmVersion()`) — feel free to read it as a reference
implementation of this same protocol in JavaScript.

---

## 5. What the browser plugin exposes today (for parity reference)

The browser-side REST surface (`packages/host/lib/index.mjs`) that talks to
the SAME relay:

- `POST /memorypets-api/cloud/register` `{ serverUrl, username, password }`
- `POST /memorypets-api/cloud/login` `{ serverUrl, username, password }`
- `POST /memorypets-api/cloud/logout`
- `GET  /memorypets-api/cloud/status` → `{ ok, loggedIn, username?, serverUrl? }` (never includes the token)
- `POST /memorypets-api/cloud/sync` → runs the push→conflict→pull flow above server-side, requires the local vault to be unlocked

Your mobile app does NOT need to go through this host process — it talks
directly to the `packages/cloud-sync` relay using the REST API in section 3,
and does its own local vault encryption using section 2's parameters.
