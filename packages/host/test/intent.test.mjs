// Pure ESM unit tests for packages/host/lib/intent.mjs
// Uses Node.js built-in test runner only — no external dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeCodeWordDetector,
  parseIntent,
  detectCodeWord,
  stripCodeWord,
} from '../lib/intent.mjs';

// ---- detectCodeWord ----

test('intent: detectCodeWord finds lowercase memorypets', async () => {
  assert.equal(detectCodeWord('foo memorypets bar'), 'memorypets');
});

test('intent: detectCodeWord returns null when no code-word present', async () => {
  assert.equal(detectCodeWord('hello world'), null);
});

test('intent: detectCodeWord finds emoji 🐾', async () => {
  assert.equal(detectCodeWord('🐾 hi'), '🐾');
});

test('intent: detectCodeWord is case-insensitive', async () => {
  const m = detectCodeWord('MemoryPets');
  assert.ok(m, 'should detect MemoryPets');
  assert.equal(typeof m, 'string');
  // The match preserves the original case from the input.
  assert.equal(m.toLowerCase(), 'memorypets');
});

test('intent: detectCodeWord matches 哥们儿', async () => {
  assert.equal(detectCodeWord('哥们儿，存一下'), '哥们儿');
});

test('intent: detectCodeWord matches mp>', async () => {
  assert.equal(detectCodeWord('mp> list all'), 'mp>');
});

// ---- stripCodeWord ----

test('intent: stripCodeWord removes 哥们儿', async () => {
  assert.equal(stripCodeWord('哥们儿 列出所有'), '列出所有');
});

test('intent: stripCodeWord removes the code-word even with a comma separator', async () => {
  const out = stripCodeWord('哥们儿, 把手机号 138... 存成 主手机号');
  assert.match(out, /把手机号/);
  assert.match(out, /主手机号/);
  assert.doesNotMatch(out, /哥们儿/);
});

test('intent: stripCodeWord collapses whitespace and trims', async () => {
  const out = stripCodeWord('  哥们儿    列出   凭证  ');
  assert.equal(out, '列出 凭证');
});

// ---- makeCodeWordDetector ----

test('intent: makeCodeWordDetector adds custom word on top of defaults', async () => {
  const det = makeCodeWordDetector(['mysecret']);
  assert.ok(det.words.includes('mysecret'), 'custom word should be in detector.words');
  // Default words should still be present.
  assert.ok(det.words.includes('memorypets'));
  assert.ok(det.words.includes('🐾'));
  assert.ok(det.words.includes('哥们儿'));
  assert.ok(det.words.includes('mp>'));
});

test('intent: makeCodeWordDetector custom word matches case-insensitively', async () => {
  const det = makeCodeWordDetector(['mysecret']);
  assert.equal(det.detectCodeWord('hello MYSECRET world'), 'MYSECRET');
  assert.equal(det.detectCodeWord('foo MySecret bar'), 'MySecret');
});

test('intent: makeCodeWordDetector custom word can be stripped', async () => {
  const det = makeCodeWordDetector(['mysecret']);
  assert.equal(det.stripCodeWord('mysecret 列出手机号'), '列出手机号');
});

test('intent: makeCodeWordDetector with empty custom array uses defaults', async () => {
  const det = makeCodeWordDetector([]);
  assert.deepEqual(det.words, [
    '哥们儿', '狗狗', '记忆宠物', '🐾', '🐶', '🐱',
    'memorypets', 'memory pets', 'mpets', 'mp>',
  ]);
});

test('intent: makeCodeWordDetector dedupes custom words that overlap with defaults', async () => {
  const det = makeCodeWordDetector(['memorypets', 'newkey']);
  // memorypets appears once.
  const matches = det.words.filter((w) => w === 'memorypets');
  assert.equal(matches.length, 1);
  assert.ok(det.words.includes('newkey'));
});

// ---- parseIntent ----

test('parseIntent: empty string returns help', async () => {
  assert.deepEqual(parseIntent(''), { intent: 'help' });
});

test('parseIntent: "列出所有条目" returns list with kind=null', async () => {
  assert.deepEqual(parseIntent('列出所有条目'), { intent: 'list', kind: null });
});

test('parseIntent: "列出凭证类" returns list with kind=credential', async () => {
  assert.deepEqual(parseIntent('列出凭证类'), { intent: 'list', kind: 'credential' });
});

test('parseIntent: phone save example returns upsert with label/value/kind', async () => {
  // Use the exact spec input — note that "存为" is not in the current
  // implementation's KW.save list (which has 存入/存起/保存/记住/更新/...
  // and 换成/换为 in KW.change). Asserting the spec behaviour here will
  // surface any divergence in the parser.
  const result = parseIntent('把手机号 138-1234-5678 存为 主手机号 profile');
  assert.equal(result.intent, 'upsert', `expected intent=upsert, got ${JSON.stringify(result)}`);
  assert.equal(result.label, '主手机号', `expected label 主手机号, got ${result.label}`);
  // Value should be the cleaned phone number (no dashes).
  assert.equal(result.value, '13812345678', `expected value 13812345678, got ${result.value}`);
  assert.equal(result.kind, 'profile', `expected kind profile, got ${result.kind}`);
});

test('parseIntent: phone save with 存入 also returns upsert (current implementation supports 存入)', async () => {
  // The implementation supports 存入 (and 换成/换为). This is the practical
  // working shape of the sentence, since 存为 is not in the current KW tables.
  const result = parseIntent('把手机号 138-1234-5678 存入 主手机号 profile');
  assert.equal(result.intent, 'upsert');
  assert.equal(result.value, '13812345678');
  assert.equal(result.kind, 'profile');
});

test('parseIntent: "删除 GitHub Token" returns remove with label', async () => {
  assert.deepEqual(parseIntent('删除 GitHub Token'), { intent: 'remove', label: 'GitHub Token' });
});

test('parseIntent: "显示 GitHub Token 的值" returns reveal with label="GitHub Token"', async () => {
  // Spec: reveal intent with label 'GitHub Token'.
  // The current implementation's reveal-label regex is greedy and matches
  // '显示 GitHub' because 显示 is the reveal verb and the regex grabs the
  // preceding word. This assertion documents the spec expectation; if it
  // fails, the implementation needs to be tightened.
  assert.deepEqual(parseIntent('显示 GitHub Token 的值'), {
    intent: 'reveal',
    label: 'GitHub Token',
  });
});

test('parseIntent: "状态" returns status', async () => {
  assert.deepEqual(parseIntent('状态'), { intent: 'status' });
});

test('parseIntent: passes through null as empty message', async () => {
  // Defensive: null should behave like empty string.
  assert.deepEqual(parseIntent(null), { intent: 'help' });
});

test('parseIntent: status keyword "status" returns status', async () => {
  assert.deepEqual(parseIntent('status'), { intent: 'status' });
});

test('parseIntent: English "list" returns list', async () => {
  assert.deepEqual(parseIntent('list'), { intent: 'list', kind: null });
});

test('parseIntent: "delete GitHub Token" (English) returns remove', async () => {
  const r = parseIntent('delete GitHub Token');
  assert.equal(r.intent, 'remove');
  assert.equal(r.label, 'GitHub Token');
});
