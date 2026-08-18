// Pure ESM unit tests for packages/host/lib/operations.mjs
// Uses Node.js built-in test runner only — no external dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  opStatus,
  opList,
  opUpsert,
  opRemove,
  opReveal,
} from '../lib/operations.mjs';

// ---- Mock service that mirrors the Host service contract ----
function createMockService() {
  const initial = [
    { id: 'p1', kind: 'profile', label: 'Name', value: 'Alice' },
    { id: 'c1', kind: 'credential', label: 'GitHub Token', value: 'ghp_xxx', hint: 'ends xxx' },
    { id: 'c2', kind: 'credential', label: 'GitLab Token', value: 'glpat_xxx' },
  ];
  const entries = [...initial];

  const service = {
    isUnlocked: () => true,
    hasEnvelope: async () => true,
    listEntries: async () => entries.slice(),
    list: () => entries.slice(),
    upsert: async (entry) => {
      const idx = entries.findIndex((e) => e.id === entry.id || (e.kind === entry.kind && e.label === entry.label));
      if (idx >= 0) {
        entries[idx] = { ...entries[idx], ...entry };
      } else {
        if (!entry.id) entry.id = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        entries.push(entry);
      }
      return { ok: true };
    },
    remove: async (id) => {
      const idx = entries.findIndex((e) => e.id === id);
      if (idx >= 0) entries.splice(idx, 1);
      return { ok: true };
    },
    revealCredential: async (idOrLabel) => {
      // Mimic the real service contract shapes:
      //   { value, match?, matchedLabel? } on success
      //   { ambiguous: true, candidates }  on multi-match
      //   undefined                          on no match
      //
      // Per the test spec, fuzzy match uses a threshold such that the
      // short query "Token" (5 chars) is treated as too short to fuzzy-match
      // against "GitHub Token"/"GitLab Token". We pick a fake
      // MIN_FUZZY_LEN = 9 so that "Token" is skipped but "github token"
      // (12 chars) still matches.
      const MIN_FUZZY_LEN = 9;
      const key = String(idOrLabel ?? '').trim();
      if (!key) return undefined;
      const exact = entries.find((e) => e.kind === 'credential' && e.label === key);
      if (exact) return { value: exact.value, matchedLabel: exact.label };
      // Case-insensitive substring match.
      if (key.length < MIN_FUZZY_LEN) return undefined;
      const lower = key.toLowerCase();
      const subs = entries.filter(
        (e) => e.kind === 'credential' && e.label.toLowerCase().includes(lower),
      );
      if (subs.length === 1) return { value: subs[0].value, match: 'fuzzy', matchedLabel: subs[0].label };
      if (subs.length > 1) return { ambiguous: true, candidates: subs.map((e) => e.label) };
      return undefined;
    },
  };

  // expose internal entries for assertion
  service.__entries = entries;
  return service;
}

// ---- opStatus ----

test('opStatus: returns ok:true with isUnlocked=true when vault is unlocked', async () => {
  const svc = { isUnlocked: () => true };
  const r = await opStatus(svc);
  assert.equal(r.ok, true);
  assert.equal(r.isUnlocked, true);
});

test('opStatus: returns isUnlocked=false, hasEnvelope=true', async () => {
  const svc = { isUnlocked: () => false, hasEnvelope: async () => true };
  const r = await opStatus(svc);
  assert.equal(r.ok, true);
  assert.equal(r.isUnlocked, false);
  assert.equal(r.hasEnvelope, true);
});

test('opStatus: tolerates missing hasEnvelope', async () => {
  const svc = { isUnlocked: () => true };
  const r = await opStatus(svc);
  assert.equal(r.ok, true);
  assert.equal(r.isUnlocked, true);
  assert.equal(r.hasEnvelope, false);
});

// ---- opList ----

test('opList: returns all entries when no kind filter', async () => {
  const svc = createMockService();
  const r = await opList(svc);
  assert.equal(r.ok, true);
  assert.equal(r.locked, false);
  assert.equal(r.count, 3);
  assert.equal(r.entries.length, 3);
  // Profile entries should keep their real value.
  const profile = r.entries.find((e) => e.id === 'p1');
  assert.equal(profile.value, 'Alice');
});

test('opList: filters by kind=credential and hides values', async () => {
  const svc = createMockService();
  const r = await opList(svc, { kind: 'credential' });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.entries.length, 2);
  for (const e of r.entries) {
    assert.equal(e.kind, 'credential');
    assert.equal(e.value, '<HIDDEN>');
  }
});

test('opList: returns locked when isUnlocked=false', async () => {
  const svc = { isUnlocked: () => false, listEntries: async () => [] };
  const r = await opList(svc);
  assert.equal(r.ok, false);
  assert.equal(r.locked, true);
});

// ---- opUpsert ----

test('opUpsert: creates a new credential entry', async () => {
  const svc = createMockService();
  const r = await opUpsert(svc, {
    kind: 'credential',
    label: 'GitHub Token',
    value: 'ghp_yyy',
  });
  assert.equal(r.ok, true);
  assert.equal(r.updated, true, 'matches existing label -> update path');
  assert.equal(r.kind, 'credential');
  assert.equal(r.label, 'GitHub Token');
  // Internal storage should reflect the new value.
  const found = svc.__entries.find((e) => e.label === 'GitHub Token');
  assert.equal(found.value, 'ghp_yyy');
});

test('opUpsert: rejects missing label', async () => {
  const svc = createMockService();
  const r = await opUpsert(svc, { kind: 'credential', value: 'x' });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.match(r.error, /label/i);
});

test('opUpsert: rejects invalid kind', async () => {
  const svc = createMockService();
  const r = await opUpsert(svc, { kind: 'bogus', label: 'L', value: 'V' });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.match(r.error, /kind/i);
});

test('opUpsert: rejects empty value', async () => {
  const svc = createMockService();
  const r = await opUpsert(svc, { kind: 'profile', label: 'L', value: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /value/i);
});

test('opUpsert: returns locked when not unlocked', async () => {
  const svc = { isUnlocked: () => false };
  const r = await opUpsert(svc, { kind: 'profile', label: 'L', value: 'V' });
  assert.equal(r.ok, false);
  assert.equal(r.locked, true);
});

test('opUpsert: surfaces underlying upsert error', async () => {
  const svc = {
    isUnlocked: () => true,
    listEntries: async () => [],
    upsert: async () => { throw new Error('disk full'); },
  };
  const r = await opUpsert(svc, { kind: 'profile', label: 'L', value: 'V' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'disk full');
});

// ---- opRemove ----

test('opRemove: deletes by id', async () => {
  const svc = createMockService();
  const r = await opRemove(svc, { id: 'p1' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.deleted, { id: 'p1', kind: 'profile', label: 'Name' });
  assert.equal(svc.__entries.find((e) => e.id === 'p1'), undefined);
});

test('opRemove: deletes by label — finds c1 and removes it', async () => {
  const svc = createMockService();
  const r = await opRemove(svc, { label: 'GitHub Token' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.deleted, { id: 'c1', kind: 'credential', label: 'GitHub Token' });
  assert.equal(svc.__entries.find((e) => e.id === 'c1'), undefined);
  // c2 should still be present.
  assert.ok(svc.__entries.find((e) => e.id === 'c2'), 'c2 should remain');
});

test('opRemove: returns notFound when id is unknown', async () => {
  const svc = createMockService();
  const r = await opRemove(svc, { id: 'nope' });
  assert.equal(r.ok, false);
  assert.equal(r.notFound, true);
  assert.match(r.error, /id=nope/);
});

test('opRemove: returns notFound when label is unknown', async () => {
  const svc = createMockService();
  const r = await opRemove(svc, { label: 'NoSuchLabel' });
  assert.equal(r.ok, false);
  assert.equal(r.notFound, true);
});

test('opRemove: surfaces underlying remove error', async () => {
  const svc = {
    isUnlocked: () => true,
    listEntries: async () => [{ id: 'p1', kind: 'profile', label: 'Name', value: 'A' }],
    remove: async () => { throw new Error('forbidden'); },
  };
  const r = await opRemove(svc, { id: 'p1' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'forbidden');
});

// ---- opReveal ----

test('opReveal: returns value on exact label match', async () => {
  const svc = createMockService();
  const r = await opReveal(svc, { label: 'GitHub Token' });
  assert.equal(r.ok, true);
  assert.equal(r.found, true);
  assert.equal(r.value, 'ghp_xxx');
  assert.equal(r.label, 'GitHub Token');
});

test('opReveal: matches case-insensitively on label', async () => {
  const svc = createMockService();
  const r = await opReveal(svc, { label: 'github token' });
  assert.equal(r.ok, true);
  assert.equal(r.found, true);
  assert.equal(r.value, 'ghp_xxx');
  // matchedLabel should be the stored label 'GitHub Token'.
  assert.equal(r.label, 'GitHub Token');
});

test('opReveal: returns found:false when mock revealCredential misses', async () => {
  const svc = createMockService();
  const r = await opReveal(svc, { label: 'Token' });
  assert.equal(r.ok, true);
  assert.equal(r.found, false);
});

test('opReveal: rejects empty label', async () => {
  const svc = createMockService();
  const r = await opReveal(svc, { label: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /label/);
});

test('opReveal: returns locked when not unlocked', async () => {
  const svc = { isUnlocked: () => false };
  const r = await opReveal(svc, { label: 'GitHub Token' });
  assert.equal(r.ok, false);
  assert.equal(r.locked, true);
});

test('opReveal: surfaces ambiguous result', async () => {
  const svc = {
    isUnlocked: () => true,
    revealCredential: async (label) => {
      if (String(label).toLowerCase() === 'token') {
        return { ambiguous: true, candidates: ['GitHub Token', 'GitLab Token'] };
      }
      return undefined;
    },
  };
  const r = await opReveal(svc, { label: 'Token' });
  assert.equal(r.ok, false);
  assert.equal(r.ambiguous, true);
  assert.deepEqual(r.candidates, ['GitHub Token', 'GitLab Token']);
});

test('opReveal: deformats fuzzy match metadata', async () => {
  const svc = {
    isUnlocked: () => true,
    revealCredential: async () => ({
      value: 'ghp_xxx',
      match: 'fuzzy',
      matchedLabel: 'GitHub Token',
    }),
  };
  const r = await opReveal(svc, { label: 'github' });
  assert.equal(r.ok, true);
  assert.equal(r.found, true);
  assert.equal(r.value, 'ghp_xxx');
  assert.equal(r.match, 'fuzzy');
  assert.equal(r.label, 'GitHub Token');
});
