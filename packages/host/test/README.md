# host unit tests

Pure ESM unit tests for `packages/host/lib/`. No external dependencies —
only Node's built-in `node:test` and `node:assert/strict`.

## Files

- `crypto.test.mjs` — `lib/crypto.mjs` (randomBytes, base64, PBKDF2 deriveKey, AES-GCM encrypt/decrypt)
- `vault.test.mjs` — `lib/vault.mjs` (Vault class: lock/unlock, upsert/remove, sealWith, snapshot restore)
- `operations.test.mjs` — `lib/operations.mjs` (opStatus / opList / opUpsert / opRemove / opReveal against a mock service)
- `intent.test.mjs` — `lib/intent.mjs` (parseIntent, detectCodeWord, stripCodeWord, makeCodeWordDetector)
- `codeword-detector.test.mjs` — `makeCodeWordDetector` factory only (default words, custom word merging, regex escaping)

## How to run

From the repo root:

```bash
node --test packages/host/test/*.test.mjs
```

Or from inside `packages/host/`:

```bash
node --test
```

> Note: in Node 22.19, `node --test packages/host/test/` (passing a directory
> as a positional argument) tries to load the directory as a module and
> fails with `MODULE_NOT_FOUND`. Use a glob, or `cd` in and run with no args.
> Earlier Node versions used to recurse into directories automatically.

## Test results

**89 tests total, 87 pass, 2 fail.** The two failures are documented
spec-to-implementation divergences (see below).

## Known failures

Two tests fail because the current `parseIntent` implementation does not
match the spec examples exactly. Both are documented with the expected
(spec) vs. actual (current impl) shape in the test files.

1. **`parseIntent('把手机号 138-1234-5678 存为 主手机号 profile')`**
   - Spec: `{ intent: 'upsert', kind: 'profile', label: '主手机号', value: '13812345678' }`
   - Actual: `{ intent: 'help' }`
   - Cause: `存为` is not in the current `KW.save` (which has `存入/存起/保存/...`) and not in `KW.change` either. The fallback label-extraction regex only triggers on `改成/换成/改为/=:/：` etc., so the label is never captured.
   - A parallel test using `存入` (`"把手机号 138-1234-5678 存入 主手机号 profile"`) succeeds — the implementation does support `存入`, just not `存为`.

2. **`parseIntent('显示 GitHub Token 的值')`**
   - Spec: `{ intent: 'reveal', label: 'GitHub Token' }`
   - Actual: `{ intent: 'reveal', label: '显示 GitHub' }`
   - Cause: the reveal-label regex at the end of `parseIntent` greedily captures the verb itself into the label: `[^,，。，\n\r'"...]{1,50}?(?:[的之]?(?:凭证|...|token|key|secret))` matches `显示 GitHub` because `显示` is followed by a space and `GitHub...token` ends in `token`. The verb is not excluded from the capture group.
