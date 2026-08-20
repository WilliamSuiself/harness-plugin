// Plaintext entry store — used ONLY when the user has explicitly disabled
// encryption via MemoryPets settings.
//
// Mirrors the public interface of `Vault` (list/get/upsert/remove/lock/
// isUnlocked/unlock/sealWith) so `index.mjs`'s service layer can swap
// between an encrypted `Vault` and this plaintext `PlainStore` without any
// other code changes. `unlock()`/`sealWith()` accept the same call shape as
// `Vault` (envelope-like payload / password) but simply ignore the password
// — there is no key derivation and nothing is ever encrypted.

const isEntry = (v) =>
  v &&
  typeof v === 'object' &&
  typeof v.id === 'string' &&
  (v.kind === 'profile' || v.kind === 'work' || v.kind === 'credential') &&
  typeof v.label === 'string' &&
  typeof v.value === 'string' &&
  typeof v.createdAt === 'number' &&
  typeof v.updatedAt === 'number';

const isSnapshot = (v) =>
  v && typeof v === 'object' && v.version === 1 && Array.isArray(v.entries) && v.entries.every(isEntry);

export class PlainStore {
  constructor() {
    this.snapshot = { version: 1, entries: [] };
    this.unlocked = false;
  }

  isUnlocked() {
    return this.unlocked;
  }

  list() {
    this.assertUnlocked();
    return this.snapshot.entries;
  }

  get(id) {
    this.assertUnlocked();
    return this.snapshot.entries.find((e) => e.id === id);
  }

  upsert(entry) {
    this.assertUnlocked();
    const now = Date.now();
    const idx = this.snapshot.entries.findIndex((e) => e.id === entry.id);
    const next = { ...entry, updatedAt: now };
    const entries = [...this.snapshot.entries];
    if (idx >= 0) entries[idx] = { ...entries[idx], ...next, createdAt: entries[idx].createdAt };
    else entries.push({ ...next, createdAt: now });
    this.snapshot = { version: 1, entries };
  }

  remove(id) {
    this.assertUnlocked();
    this.snapshot = {
      version: 1,
      entries: this.snapshot.entries.filter((e) => e.id !== id),
    };
  }

  lock() {
    this.unlocked = false;
    this.snapshot = { version: 1, entries: [] };
  }

  // Mirrors Vault#unlock(envelope, password): `stored` here is the parsed
  // plaintext notes payload (or null on first use). The `_password` param is
  // accepted-but-ignored so call sites shared with Vault don't need branching.
  async unlock(stored, _password) {
    if (!stored) {
      this.snapshot = { version: 1, entries: [] };
      this.unlocked = true;
      return;
    }
    if (!isSnapshot(stored)) throw new Error('Notes payload corrupted.');
    this.snapshot = stored;
    this.unlocked = true;
  }

  // Mirrors Vault#sealWith(password): returns the plain snapshot to persist.
  // The `_password` param is accepted-but-ignored.
  async sealWith(_password) {
    this.assertUnlocked();
    return { version: 1, entries: this.snapshot.entries };
  }

  assertUnlocked() {
    if (!this.unlocked) throw new Error('Store is locked.');
  }
}
