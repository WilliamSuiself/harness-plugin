#!/usr/bin/env node
// MemoryPets vault reset: delete the local envelope so the next dsh web boot
// starts fresh (user will be prompted to set up a new master password).
//
// Resolves DSH_HOME the same way the host plugin does:
//   1. process.env.DSH_HOME
//   2. <cwd>/.dsh-home
//
// What we delete:
//   - <DSH_HOME>/memorypets.envelope.json
//   - <DSH_HOME>/memorypets.codewords.json (also local-only, no need to keep)
//
// What we DO NOT touch:
//   - dsh sessions, profiles, settings.yaml — those belong to dsh itself.
//   - The plugin's assets/ folder.

import { existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Mirror packages/host/lib/paths.mjs so the two never drift apart. We inline
// here to keep this script a zero-dependency file (the host package may not
// be installed when the user runs `pnpm reset-vault`).
function resolveDshHome() {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : resolve(process.cwd(), '.dsh-home');
}

const targets = [
  join(resolveDshHome(), 'memorypets.envelope.json'),
  join(resolveDshHome(), 'memorypets.codewords.json'),
];

let deleted = 0;
for (const t of targets) {
  if (existsSync(t)) {
    try {
      unlinkSync(t);
      console.log('[reset-vault] deleted', t);
      deleted++;
    } catch (e) {
      console.error('[reset-vault] failed to delete', t, '->', e.message);
      process.exitCode = 1;
    }
  } else {
    console.log('[reset-vault] not present:', t);
  }
}

if (deleted === 0) {
  console.log('[reset-vault] nothing to delete. Vault is already reset.');
} else {
  console.log(`[reset-vault] removed ${deleted} file(s). Restart dsh web and re-setup the vault.`);
}