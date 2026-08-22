// Plaintext entry store — used ONLY when the user has explicitly disabled
// encryption via MemoryPets settings.
//
// Mirrors the public interface of `Vault` (list/get/upsert/remove/lock/
// isUnlocked/unlock/sealWith) so `index.mjs`'s service layer can swap
// between an encrypted `Vault` and this plaintext `PlainStore` without any
// other code changes. `unlock()`/`sealWith()` accept the same call shape as
// `Vault` (envelope-like payload / password) but simply ignore the password
// — there is no key derivation and nothing is ever encrypted.

import { DEFAULT_CATEGORIES } from './vault.mjs';

const isEntry = (v) =>
  v &&
  typeof v === 'object' &&
  typeof v.id === 'string' &&
  (v.kind === 'note' || v.kind === 'profile' || v.kind === 'work' || v.kind === 'credential') &&
  typeof v.label === 'string' &&
  typeof v.value === 'string' &&
  typeof v.createdAt === 'number' &&
  typeof v.updatedAt === 'number' &&
  (v.tags === undefined || (Array.isArray(v.tags) && v.tags.every((t) => typeof t === 'string'))) &&
  (v.dueDate === undefined || typeof v.dueDate === 'string');

const isStringArray = (v) => Array.isArray(v) && v.every((t) => typeof t === 'string');

const isSnapshot = (v) =>
  v &&
  typeof v === 'object' &&
  v.version === 1 &&
  Array.isArray(v.entries) &&
  v.entries.every(isEntry) &&
  (v.categories === undefined || isStringArray(v.categories));

const dedupeCaseInsensitive = (list) => {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};

const emptySnapshot = () => ({ version: 1, entries: [], categories: [...DEFAULT_CATEGORIES] });

export class PlainStore {
  constructor() {
    this.snapshot = emptySnapshot();
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

  listCategories() {
    this.assertUnlocked();
    return [...(this.snapshot.categories || [])];
  }

  addCategory(name) {
    this.assertUnlocked();
    const categories = dedupeCaseInsensitive([...(this.snapshot.categories || []), name]);
    this.snapshot = { ...this.snapshot, categories };
    return categories;
  }

  removeCategory(name) {
    this.assertUnlocked();
    const key = String(name ?? '').trim().toLowerCase();
    const categories = (this.snapshot.categories || []).filter((c) => c.toLowerCase() !== key);
    this.snapshot = { ...this.snapshot, categories };
    return categories;
  }

  upsert(entry) {
    this.assertUnlocked();
    const now = Date.now();
    const idx = this.snapshot.entries.findIndex((e) => e.id === entry.id);
    const next = { ...entry, updatedAt: now };
    const entries = [...this.snapshot.entries];
    // See Vault#upsert (vault.mjs) for why omitted `value` is handled this
    // way: preserved on edit via the spread order, defaulted to '' on create.
    if (idx >= 0) entries[idx] = { ...entries[idx], ...next, createdAt: entries[idx].createdAt };
    else entries.push({ value: '', ...next, createdAt: now });
    const categories = Array.isArray(entry.tags) && entry.tags.length
      ? dedupeCaseInsensitive([...(this.snapshot.categories || []), ...entry.tags])
      : (this.snapshot.categories || []);
    this.snapshot = { version: 1, entries, categories };
  }

  remove(id) {
    this.assertUnlocked();
    this.snapshot = {
      version: 1,
      entries: this.snapshot.entries.filter((e) => e.id !== id),
      categories: this.snapshot.categories || [],
    };
  }

  lock() {
    this.unlocked = false;
    this.snapshot = emptySnapshot();
  }

  // Mirrors Vault#unlock(envelope, password): `stored` here is the parsed
  // plaintext notes payload (or null on first use). The `_password` param is
  // accepted-but-ignored so call sites shared with Vault don't need branching.
  async unlock(stored, _password) {
    if (!stored) {
      this.snapshot = emptySnapshot();
      this.unlocked = true;
      return;
    }
    if (!isSnapshot(stored)) throw new Error('Notes payload corrupted.');
    this.snapshot = {
      version: 1,
      entries: stored.entries,
      categories: Array.isArray(stored.categories) ? stored.categories : [...DEFAULT_CATEGORIES],
    };
    this.unlocked = true;
  }

  // Mirrors Vault#sealWith(password): returns the plain snapshot to persist.
  // The `_password` param is accepted-but-ignored.
  async sealWith(_password) {
    this.assertUnlocked();
    return { version: 1, entries: this.snapshot.entries, categories: this.snapshot.categories || [] };
  }

  assertUnlocked() {
    if (!this.unlocked) throw new Error('Store is locked.');
  }
}
