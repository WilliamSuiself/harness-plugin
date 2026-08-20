import {
  decryptString,
  deriveKey,
  encryptString,
  fromBase64,
  randomBytes,
  toBase64,
} from './crypto.mjs';

const PBKDF2_ITERATIONS = 250_000;
const SALT_LEN = 16;
const IV_LEN = 12;

const isEntry = (v) =>
  v &&
  typeof v === 'object' &&
  typeof v.id === 'string' &&
  // 'note' is the current general-purpose kind (work items / plans / family
  // matters / anything non-secret). 'profile' and 'work' are kept ONLY for
  // backward compatibility with entries created before this kind existed —
  // they are read/displayed normally, just no longer offered for new saves.
  (v.kind === 'note' || v.kind === 'profile' || v.kind === 'work' || v.kind === 'credential') &&
  typeof v.label === 'string' &&
  typeof v.value === 'string' &&
  typeof v.createdAt === 'number' &&
  typeof v.updatedAt === 'number' &&
  (v.tags === undefined || (Array.isArray(v.tags) && v.tags.every((t) => typeof t === 'string'))) &&
  (v.dueDate === undefined || typeof v.dueDate === 'string');

const isSnapshot = (v) =>
  v && typeof v === 'object' && v.version === 1 && Array.isArray(v.entries) && v.entries.every(isEntry);

export class Vault {
  constructor() {
    this.snapshot = { version: 1, entries: [] };
    this.key = null;
  }

  isUnlocked() {
    return this.key !== null;
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
    this.key = null;
    this.snapshot = { version: 1, entries: [] };
  }

  async unlock(envelope, password) {
    if (!envelope) {
      // 首次创建：派生一个不会立刻被使用、但用于首次封装的密钥。
      const salt = randomBytes(SALT_LEN);
      const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
      this.key = key;
      this.snapshot = { version: 1, entries: [] };
      return;
    }
    const salt = fromBase64(envelope.kdf.salt);
    const iv = fromBase64(envelope.iv);
    const key = await deriveKey(password, salt, envelope.kdf.iterations);
    let json;
    try {
      json = await decryptString(key, iv, envelope.ciphertext);
    } catch {
      throw new Error('Wrong master password.');
    }
    const parsed = JSON.parse(json);
    if (!isSnapshot(parsed)) throw new Error('Vault payload corrupted.');
    this.key = key;
    this.snapshot = parsed;
  }

  async sealWith(password) {
    this.assertUnlocked();
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
    const ct = await encryptString(key, iv, JSON.stringify(this.snapshot));
    return {
      version: 1,
      kdf: { salt: toBase64(salt), iterations: PBKDF2_ITERATIONS, keyLen: 256 },
      ciphertext: ct,
      iv: toBase64(iv),
    };
  }

  assertUnlocked() {
    if (!this.key) throw new Error('Vault is locked.');
  }
}