// Pure ESM unit tests for packages/host/lib/intent.mjs
// Uses Node.js built-in test runner only — no external dependencies.
//
// SECURITY: This file intentionally never asserts that any specific
// string (哥们儿 / 狗狗 / 🐾 / memorypets / mp> / ...) is a code-word,
// because there is no longer any hard-coded default list in intent.mjs.
// The runtime detector receives its word list solely from user-defined
// storage (codewords.json).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeCodeWordDetector,
  parseIntent,
} from '../lib/intent.mjs';

// ─── makeCodeWordDetector (PRIVATE list, no defaults) ────────────────────────

test('intent: makeCodeWordDetector([]) has empty word list and refuses everything', () => {
  const det = makeCodeWordDetector([]);
  assert.deepEqual(det.words, []);
  assert.equal(det.detectCodeWord('hello'), null);
  assert.equal(det.detectCodeWord('哥们儿'), null);
  assert.equal(det.detectCodeWord('🐾'), null);
  assert.equal(det.detectCodeWord('memorypets'), null);
  assert.equal(det.detectCodeWord('mp>'), null);
});

test('intent: makeCodeWordDetector(undefined) behaves like empty', () => {
  const det = makeCodeWordDetector(undefined);
  assert.deepEqual(det.words, []);
  assert.equal(det.detectCodeWord('anything'), null);
});

test('intent: makeCodeWordDetector accepts a private word list', () => {
  const det = makeCodeWordDetector(['MySecret123', '🌶️']);
  assert.deepEqual(det.words, ['MySecret123', '🌶️']);
  assert.equal(det.detectCodeWord('hello MySecret123 world'), 'MySecret123');
  assert.equal(det.detectCodeWord('🌶️ hi'), '🌶️');
});

test('intent: makeCodeWordDetector filters falsy entries', () => {
  const det = makeCodeWordDetector(['', null, undefined, 0, '   ', 'real']);
  assert.deepEqual(det.words, ['real']);
});

test('intent: makeCodeWordDetector matches case-insensitively', () => {
  const det = makeCodeWordDetector(['mysecret']);
  assert.equal(det.detectCodeWord('hello MYSECRET world'), 'MYSECRET');
  assert.equal(det.detectCodeWord('foo MySecret bar'), 'MySecret');
});

test('intent: makeCodeWordDetector escapes regex special chars', () => {
  const det = makeCodeWordDetector(['a+b', '(c)', 'd.e']);
  assert.equal(det.detectCodeWord('a+b please'), 'a+b');
  assert.equal(det.detectCodeWord('safe (c) now'), '(c)');
  assert.equal(det.detectCodeWord('foo d.e bar'), 'd.e');
});

test('intent: makeCodeWordDetector handles non-string input defensively', () => {
  const det = makeCodeWordDetector(['real']);
  assert.equal(det.detectCodeWord(null), null);
  assert.equal(det.detectCodeWord(undefined), null);
  assert.equal(det.detectCodeWord(''), null);
  assert.equal(det.stripCodeWord(''), '');
  assert.equal(det.stripCodeWord(null), '');
});

test('intent: stripCodeWord removes the configured word and trims', () => {
  const det = makeCodeWordDetector(['secret', 'token']);
  assert.equal(det.stripCodeWord('secret list all entries'), 'list all entries');
  assert.equal(det.stripCodeWord('  secret   list 凭证  '), 'list 凭证');
});

test('intent: stripCodeWord on empty detector returns input unchanged', () => {
  const det = makeCodeWordDetector([]);
  assert.equal(det.stripCodeWord('  hello world  '), 'hello world');
});

// ─── parseIntent (LLM-free, code-word-independent) ───────────────────────────

test('parseIntent: empty string returns help', () => {
  assert.deepEqual(parseIntent(''), { intent: 'help' });
});

test('parseIntent: "列出所有条目" returns list with kind=null', () => {
  assert.deepEqual(parseIntent('列出所有条目'), { intent: 'list', kind: null });
});

test('parseIntent: "列出凭证类" returns list with kind=credential', () => {
  assert.deepEqual(parseIntent('列出凭证类'), { intent: 'list', kind: 'credential' });
});

test('parseIntent: phone save example returns upsert with label/value/kind', () => {
  const result = parseIntent('把手机号 138-1234-5678 存入 主手机号 profile');
  assert.equal(result.intent, 'upsert');
  assert.equal(result.label, '主手机号');
  assert.equal(result.value, '13812345678');
  assert.equal(result.kind, 'profile');
});

test('parseIntent: "删除 GitHub Token" returns remove with label', () => {
  assert.deepEqual(parseIntent('删除 GitHub Token'), { intent: 'remove', label: 'GitHub Token' });
});

test('parseIntent: "显示 GitHub Token 的值" returns reveal with label="GitHub Token"', () => {
  assert.deepEqual(parseIntent('显示 GitHub Token 的值'), {
    intent: 'reveal',
    label: 'GitHub Token',
  });
});

test('parseIntent: "状态" returns status', () => {
  assert.deepEqual(parseIntent('状态'), { intent: 'status' });
});

test('parseIntent: passes through null as empty message', () => {
  assert.deepEqual(parseIntent(null), { intent: 'help' });
});

test('parseIntent: status keyword "status" returns status', () => {
  assert.deepEqual(parseIntent('status'), { intent: 'status' });
});

test('parseIntent: English "list" returns list', () => {
  assert.deepEqual(parseIntent('list'), { intent: 'list', kind: null });
});

test('parseIntent: "delete GitHub Token" (English) returns remove', () => {
  const r = parseIntent('delete GitHub Token');
  assert.equal(r.intent, 'remove');
  assert.equal(r.label, 'GitHub Token');
});

// ─── SECURITY: parseIntent must NOT depend on any hard-coded code-word ────────

test('SECURITY: parseIntent of bare "哥们儿" returns help (NOT an upsert)', () => {
  // Without a real task verb, parseIntent must not assume a code-word
  // string is also a save/list/remove request — it should just return
  // help. This guarantees there are NO hard-coded default code-words
  // embedded in the intent parser.
  const r = parseIntent('哥们儿');
  assert.notEqual(r.intent, 'upsert');
  assert.notEqual(r.intent, 'list');
  assert.notEqual(r.intent, 'remove');
  assert.notEqual(r.intent, 'reveal');
});

test('SECURITY: parseIntent of bare "🐾" returns help (no defaults)', () => {
  const r = parseIntent('🐾');
  assert.notEqual(r.intent, 'upsert');
  assert.notEqual(r.intent, 'list');
  assert.notEqual(r.intent, 'remove');
  assert.notEqual(r.intent, 'reveal');
});