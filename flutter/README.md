# MemoryPets — Flutter Client

Flutter rewrite of the MemoryPets mobile client (the previous Kotlin/Compose
attempt lives in `../android`, kept for reference but no longer maintained).

Implements the same contract as `../docs/MOBILE_SYNC_API.md`: on-device
AES-256-GCM + PBKDF2-HMAC-SHA256 vault encryption, byte-for-byte compatible
with `packages/host/lib/crypto.mjs` / `vault.mjs`, and the cloud-sync relay
REST API (`/accounts/register`, `/accounts/login`, `GET|PUT /vault`).

## Project layout

```
lib/
  models/          Entry, Vault, Envelope/KdfConfig, SyncOutcome
  crypto/          VaultCrypto — PBKDF2 + AES-GCM (cryptography package)
  storage/         AppPrefs (SharedPreferences) + VaultBlobStore (local envelope)
  api/             CloudSyncApi REST client + DTOs
  sync/            SyncOrchestrator — push/pull/409-conflict flow
  session/         VaultSession — in-memory decrypted vault + CRUD for the
                   current unlocked session (master password never persisted)
  screens/         setup / unlock / home / editor / settings + root navigation
  theme/           Material 3 light/dark theme
  main.dart        Provider wiring + app entrypoint
```

## Feature parity with the Kotlin prototype

Implemented (and in some cases completed beyond the Kotlin prototype's TODOs):

- Setup screen: create master password, optional cloud login/register, initial codewords.
- Unlock screen: decrypt local envelope with master password.
- Home screen: list/search entries, pull-to-sync, lock.
- Editor screen: create/edit/delete note & credential entries (real CRUD against
  the in-memory `Vault`, persisted as a freshly-sealed envelope on every change).
- Settings screen: server URL, cloud logout, codeword list/gate toggle, dark mode.
- Full sync orchestration: GET → decrypt/adopt remote if newer → PUT with
  `expectedVersion` → retry once on 409 with the winning envelope.

Not yet ported (explicitly out of scope for this first pass):

- Biometric unlock, "secure window" (FLAG_SECURE equivalent), change-master-password flow.
- Home-screen widget (Android widget parity has no direct Flutter equivalent; would
  need `home_widget` package + platform-specific widget code).
- Background periodic sync (WorkManager equivalent — would use `workmanager` package).
- Markdown export.
- Secure storage for the session token (currently `shared_preferences`, same
  security posture as the Kotlin prototype's DataStore — consider
  `flutter_secure_storage` before shipping).

## Getting started

```bash
flutter pub get
flutter run                 # requires a connected device/emulator
flutter build apk --debug   # or --release
```

Run tests / static analysis:

```bash
flutter analyze
flutter test
```
