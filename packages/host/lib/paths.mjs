// Filesystem path resolution for the MemoryPets host plugin.
//
// All defaults that previously lived inside `index.mjs` (and the README's
// inline `loadEnvelope` / `saveEnvelope` snippet) now funnel through this
// module so the convention has a single source of truth.
//
// Resolution order for the DSH home directory:
//   1. process.env.DSH_HOME                              (preferred; matches dsh CLI)
//   2. ~/.dsh  (matches dsh CLI's own default for the user, NOT cwd —
//      avoids leaking an absolute cwd/.dsh-home path into error messages
//      when the host is launched from a third-party working directory)
//   3. <cwd>/.dsh-home (last-resort legacy fallback)
//
// Important: nothing in this module ever reads or writes a file. Path
// computation is pure. File I/O lives in `index.mjs` and is wrapped in
// try/catch so a missing file is a no-op, never an ENOENT crash.

import { resolve, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

function legacyDshHome() {
  // Best-effort: only call process.cwd() if it resolves to an absolute path;
  // some sandbox environments expose a virtual cwd where resolve() would
  // throw. Fall back to ~/.dsh in that case.
  try {
    const cwd = process.cwd();
    return isAbsolute(cwd) ? resolve(cwd, '.dsh-home') : join(homedir(), '.dsh');
  } catch {
    return join(homedir(), '.dsh');
  }
}

export function resolveDshHome() {
  if (process.env.DSH_HOME) {
    return resolve(process.env.DSH_HOME);
  }
  // Prefer the user-level ~/.dsh (matches dsh CLI default) so the absolute
  // path never leaks the cwd of whatever process launched us.
  return join(homedir(), '.dsh');
}

export const ENVELOPE_FILENAME = 'memorypets.envelope.json';
export const CODEWORDS_FILENAME = 'memorypets.codewords.json';

export function envelopePath() {
  return join(resolveDshHome(), ENVELOPE_FILENAME);
}

export function codewordsPath() {
  return join(resolveDshHome(), CODEWORDS_FILENAME);
}

export { legacyDshHome };