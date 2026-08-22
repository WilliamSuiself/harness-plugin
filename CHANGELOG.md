# Changelog

All notable changes to MemoryPets will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`memorypets_upsert`'s `kind` enum could silently swallow a save.** The
  tool's JSON schema only allowed `['note', 'credential']`, narrower than
  what `operations.mjs`'s `VALID_KINDS` actually accepts. A model that
  emitted a legacy value like `kind: 'work'` (still a very natural thing to
  say) got the call rejected by schema validation *before* `opUpsert()` ever
  ran — the entry was never persisted, even though the model could still go
  on to tell the user it succeeded. Widened the enum to
  `['note', 'credential', 'profile', 'work']` to match.
- **Cloud-sync conflict resolution no longer discards unsynced local edits.**
  `cloudSyncNow()` (packages/host/lib/index.mjs) and the Flutter
  `SyncOrchestrator` used to adopt the *entire* remote snapshot on a version
  conflict (`vault = remoteVault` / `blobStore.overwriteWithRemote(decrypted,
  ...)`), silently erasing any local entry/category that hadn't been pushed
  yet — the root cause of "web 端更新后内容被手机端整体覆盖". Both now merge
  entry-by-entry (`Vault#mergeSnapshot` / `Vault.mergeWith`, keyed by id +
  `updatedAt`) and push the merged result back, instead of overwriting.
  Deletes are now tracked with tombstones (`{ id, deletedAt }`) so a stale
  copy synced from another device can't resurrect an entry you just deleted.

### Added

- **Notebook categories.** The vault snapshot now carries a `categories`
  catalog (seeded with 工作/生活/学习/个人 on first creation) alongside
  `entries`. It rides along on the existing seal/unlock/cloud-sync path — no
  separate file — so it's automatically end-to-end encrypted and synced
  across the DSH web plugin and the Flutter app. `Vault#upsert` auto-registers
  any new tag as a category. New host endpoints: `GET /memorypets-api/categories`,
  `POST /memorypets-api/categories` (add), `POST /memorypets-api/categories/remove`.
- **Web: expandable full-screen notebook view.** The floating panel was too
  narrow to browse a whole notebook. A new "📓 展开笔记本" button opens a
  full-screen overlay with a left category sidebar (全部 + catalog chips +
  add-new-category input) and a right entry list/search area. The sidebar's
  add-entry section is collapsed into a "＋ 添加条目" button by default,
  freeing that space for a scrollable list of every entry's title (click a
  title to edit it); clicking "＋ 添加条目" asks for a title only — saving it
  immediately reopens the entry in full edit mode so the content can be
  typed in by hand. Tags are now visible for every entry kind (previously
  note-only, which made them easy to miss) and quick-select chips for
  existing categories are shown
  above the tag input.
- **In-place editing from the web notebook.** Clicking any entry (in the
  sidebar title list or the main list) now opens it in the same add/edit
  form instead of only supporting add/delete. `POST /memorypets-api/upsert`'s
  `value` field is now optional: omitting it on an edit keeps the current
  value unchanged (needed both for the title-only quick-add flow above and
  for editing a credential's label/tags without ever having to resubmit — or
  risk blanking out — its real secret, which the client never receives in
  the first place). `service.upsert()` now returns the resolved entry id.
- **Flutter: category filter chips on Home** and quick-select category chips
  in the entry editor, mirroring the web notebook. `VaultSession` gained
  `categories` / `addCategory()` / `removeCategory()`.

### Security

- **Reveal-credential leakage hardened.** `service.revealCredential` now:
  - Returns `{ value, match?, matchedLabel? }` only for exact (id or label) hits.
  - Fuzzy substring matching is gated behind `MIN_FUZZY_LEN = 4` (prevents trivial collisions on short suffixes like `key`, `api`, `ssh`).
  - When fuzzy match hits more than one credential, returns `{ ambiguous: true, candidates }` so the caller can ask the user to narrow down the label — never silently upgrades to a more sensitive entry.
  - Always reads the raw vault (not `listEntries`), so the client-safe projection can't accidentally mask a credential we then leak by ID.
- `listEntries()` now projects credential values to the literal sentinel `'<HIDDEN>'` instead of `undefined`, so renderers and `typeof === 'string'` checks stay predictable.
- Profile/work kinds still return plaintext from `listEntries()` — they were always meant to be readable by the LLM.

### Fixed

- **Client UI Add/Remove now persists.** `handleAdd` and `handleRemove` in `packages/client/lib/client.mjs` previously only mutated local React state; the entries vanished on reload. They now POST to `/memorypets-api/upsert` and `/memorypets-api/remove` and refresh from the server response. Includes an `adding` async-lock to prevent double-submit.
- `waitting` → `waiting` spelling across host route whitelist, README, client bundle, and on-disk assets directory (`assets/waitting/` → `assets/waiting/`).
- `client.mjs` initialization now also fetches `/memorypets-api/entries` so the panel shows existing entries immediately on mount instead of waiting for setup/unlock.

### Added

- **`scripts/build-client.mjs`** — first-class build script for the browser bundle. Replaces the previous "if missing, write your own" instructions in the README. Idempotent, syntax-checks the output with `node --check`. Run via `pnpm build:client`. Pass `--check` to fail when the bundle is stale.
- **`scripts/reset-vault.mjs`** — delete local envelope + codewords so the next dsh web boot prompts for fresh setup. Run via `pnpm reset-vault`.
- **`pnpm test`** — Node built-in test runner over `packages/host/test/`. Currently covers `crypto`, `vault`, `operations`, `intent`, and `codeword-detector`.
- `*.envelope.json` and `*.codewords.json` added to `.gitignore` to reduce the chance of committing vault data.

### Removed

- `examples/cordis.yml` (out of date, referenced nonexistent `@memorypets/host` workspace).
- `tsconfig.base.json` (no TS source files in the repo; root `scripts` were aspirational).
- `e2e_test_v2.py` (32KB ad-hoc test script with hardcoded localhost paths and user home; not safe as a committed file).

### Changed

- Root `package.json`:
  - `build` now runs the client build script (was a `pnpm -r` no-op).
  - New scripts: `build:client`, `test`, `reset-vault`.
  - Removed: `typecheck` (no TS yet), `test:e2e`.
- `direct-apply` HTTP route still returns `toolCalls/toolResults` for compatibility with debugging clients but they are now `undefined` when not applicable; the field naming is stable.

## [0.1.0] — 2026-08-18

Initial tagged release.

- Floating pet UI with 4 mood animations (standing / thinking / waiting / sleeping).
- AES-GCM-256 encrypted vault, PBKDF2-SHA-256 250k iterations.
- Custom code-word detection + LLM-free direct-apply bypass route.
- 6 LLM tools: `memorypets_codeword`, `memorypets_status`, `memorypets_list_entries`, `memorypets_upsert`, `memorypets_remove_entry`, `memorypets_reveal_credential`.
- System-prompt override section (`order=1`) to defeat "refuse to save sensitive data" LLM hallucinations.