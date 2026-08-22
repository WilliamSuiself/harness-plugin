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

// Seeded once, on first vault creation, so every fresh notebook (web,
// Flutter) starts with the same four top-level categories. Purely a
// starting point — addCategory()/removeCategory() let the user reshape
// this list freely, and it syncs like any other vault content because it
// lives inside the same encrypted snapshot.
export const DEFAULT_CATEGORIES = ['工作', '生活', '学习', '个人'];

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

const isStringArray = (v) => Array.isArray(v) && v.every((t) => typeof t === 'string');

const isTombstone = (v) =>
  v && typeof v === 'object' && typeof v.id === 'string' && typeof v.deletedAt === 'number';

// `categories` and `tombstones` were added after the original `{ version: 1,
// entries: [] }` shape shipped — both are optional so envelopes sealed by an
// older client (or an older Flutter build) still unlock cleanly; callers
// backfill sane defaults (see unlock() below).
const isSnapshot = (v) =>
  v &&
  typeof v === 'object' &&
  v.version === 1 &&
  Array.isArray(v.entries) &&
  v.entries.every(isEntry) &&
  (v.categories === undefined || isStringArray(v.categories)) &&
  (v.tombstones === undefined || (Array.isArray(v.tombstones) && v.tombstones.every(isTombstone)));

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

const emptySnapshot = () => ({ version: 1, entries: [], categories: [...DEFAULT_CATEGORIES], tombstones: [] });

export class Vault {
  constructor() {
    this.snapshot = emptySnapshot();
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

  // The category catalog is what drives the "notebook" sidebar (工作 / 生活 /
  // 学习 / 个人 + anything the user adds) on every client. It lives inside
  // the same encrypted snapshot as `entries`, so it rides along on the
  // existing seal/unlock/sync path for free — no separate plaintext file.
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
    // `value` may be omitted entirely by the caller (see index.mjs's
    // POST /upsert handler): on an EDIT this naturally keeps the old value
    // untouched (the object-spread below simply never overwrites the key),
    // which is what lets the web UI's "title-only quick add, fill content
    // in later" flow and in-place editing of a hidden credential (whose
    // real value never reaches the client) work safely. On a brand-new
    // entry there's nothing to preserve, so default to '' — every entry
    // must have a string `value` or `isEntry()` rejects it on next unlock.
    if (idx >= 0) entries[idx] = { ...entries[idx], ...next, createdAt: entries[idx].createdAt };
    else entries.push({ value: '', ...next, createdAt: now });
    // Auto-register: any tag the user types that isn't already a known
    // category becomes one, so it shows up as a filter chip in the
    // notebook sidebar from now on — "用户也可以自动增加标签".
    const categories = Array.isArray(entry.tags) && entry.tags.length
      ? dedupeCaseInsensitive([...(this.snapshot.categories || []), ...entry.tags])
      : (this.snapshot.categories || []);
    // Deleting then re-creating an entry with the same id should win over an
    // old tombstone (otherwise a stale delete from another device could
    // resurrect-then-immediately-erase it again on the next merge).
    const tombstones = (this.snapshot.tombstones || []).filter((t) => t.id !== next.id);
    this.snapshot = { version: 1, entries, categories, tombstones };
  }

  remove(id) {
    this.assertUnlocked();
    const tombstones = [
      ...(this.snapshot.tombstones || []).filter((t) => t.id !== id),
      { id, deletedAt: Date.now() },
    ];
    this.snapshot = {
      version: 1,
      entries: this.snapshot.entries.filter((e) => e.id !== id),
      categories: this.snapshot.categories || [],
      tombstones,
    };
  }

  // Entry-level merge used by cloud-sync conflict resolution (see
  // packages/host/lib/index.mjs `cloudSyncNow`). MUST be used instead of
  // blindly adopting a remote snapshot — replacing `this.snapshot` wholesale
  // silently discards any local edit that hadn't been pushed yet, which was
  // the root cause of "web 端更新后内容被手机端整体覆盖".
  //
  // Rules:
  //   - Entries are merged by id; whichever side has the newer `updatedAt`
  //     wins. An id present on only one side is kept.
  //   - A tombstone (recorded on `remove()`) wins over an entry with an
  //     older `updatedAt` on the other side, so a delete on one device
  //     isn't silently resurrected by an older copy on another.
  //   - Categories are unioned (case-insensitive) — nobody's custom
  //     category list is ever dropped by a sync.
  mergeSnapshot(remoteSnapshot) {
    this.assertUnlocked();
    const remote = remoteSnapshot && typeof remoteSnapshot === 'object' ? remoteSnapshot : {};
    const tombById = new Map();
    for (const t of [...(this.snapshot.tombstones || []), ...(remote.tombstones || [])]) {
      const prev = tombById.get(t.id);
      if (!prev || t.deletedAt > prev.deletedAt) tombById.set(t.id, t);
    }
    const byId = new Map();
    for (const e of this.snapshot.entries) byId.set(e.id, e);
    for (const e of remote.entries || []) {
      const local = byId.get(e.id);
      if (!local || (e.updatedAt || 0) > (local.updatedAt || 0)) byId.set(e.id, e);
    }
    const entries = [...byId.values()].filter((e) => {
      const tomb = tombById.get(e.id);
      return !tomb || tomb.deletedAt < (e.updatedAt || 0);
    });
    const categories = dedupeCaseInsensitive([
      ...(this.snapshot.categories || []),
      ...(remote.categories || []),
    ]);
    this.snapshot = { version: 1, entries, categories, tombstones: [...tombById.values()] };
  }

  lock() {
    this.key = null;
    this.snapshot = emptySnapshot();
  }

  async unlock(envelope, password) {
    if (!envelope) {
      // 首次创建：派生一个不会立刻被使用、但用于首次封装的密钥。
      const salt = randomBytes(SALT_LEN);
      const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
      this.key = key;
      this.snapshot = emptySnapshot();
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
    // Backfill categories/tombstones for envelopes sealed before those
    // fields existed (older DSH host or older Flutter build).
    this.snapshot = {
      version: 1,
      entries: parsed.entries,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [...DEFAULT_CATEGORIES],
      tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
    };
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