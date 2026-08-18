// Filesystem path resolution for the MemoryPets host plugin.
//
// All defaults that previously lived inside `index.mjs` (and the README's
// inline `loadEnvelope` / `saveEnvelope` snippet) now funnel through this
// module so the convention has a single source of truth.
//
// Resolution order for the DSH home directory:
//   1. process.env.DSH_HOME
//   2. <cwd>/.dsh-home  (matches the dsh CLI's own default when no DSH_HOME is set)

import { resolve, join } from 'node:path';

export function resolveDshHome() {
  return process.env.DSH_HOME
    ? resolve(process.env.DSH_HOME)
    : resolve(process.cwd(), '.dsh-home');
}

export const ENVELOPE_FILENAME = 'memorypets.envelope.json';
export const CODEWORDS_FILENAME = 'memorypets.codewords.json';

export function envelopePath() {
  return join(resolveDshHome(), ENVELOPE_FILENAME);
}

export function codewordsPath() {
  return join(resolveDshHome(), CODEWORDS_FILENAME);
}