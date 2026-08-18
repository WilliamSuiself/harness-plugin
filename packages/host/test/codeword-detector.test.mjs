// Pure ESM unit tests for the makeCodeWordDetector factory in
// packages/host/lib/intent.mjs. Focused Unit tests for the factory: default
// words, custom word merging, dedup, empty custom -> defaults.
//
// Uses Node.js built-in test runner only — no external dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeCodeWordDetector } from '../lib/intent.mjs';

// ---- Default detector behavior ----

test('codeword: default detector includes "memorypets"', async () => {
  const det = makeCodeWordDetector();
  assert.ok(det.words.includes('memorypets'), 'memorypets should be in default words');
});

test('codeword: default detector includes emoji 🐾', async () => {
  const det = makeCodeWordDetector();
  assert.ok(det.words.includes('🐾'), '🐾 should be in default words');
});

test('codeword: default detector includes 哥们儿', async () => {
  const det = makeCodeWordDetector();
  assert.ok(det.words.includes('哥们儿'), '哥们儿 should be in default words');
});

test('codeword: default detector includes mp>', async () => {
  const det = makeCodeWordDetector();
  assert.ok(det.words.includes('mp>'), 'mp> should be in default words');
});

test('codeword: default detector includes all 10 built-in words', async () => {
  const det = makeCodeWordDetector();
  const expected = [
    '哥们儿', '狗狗', '记忆宠物', '🐾', '🐶', '🐱',
    'memorypets', 'memory pets', 'mpets', 'mp>',
  ];
  assert.equal(det.words.length, expected.length);
  assert.deepEqual(det.words, expected);
});

test('codeword: default detector picks memorypets from input', async () => {
  const det = makeCodeWordDetector();
  assert.equal(det.detectCodeWord('foo memorypets bar'), 'memorypets');
});

test('codeword: default detector returns null when no match', async () => {
  const det = makeCodeWordDetector();
  assert.equal(det.detectCodeWord('hello world'), null);
});

test('codeword: default detector strips memorypets and trims whitespace', async () => {
  const det = makeCodeWordDetector();
  assert.equal(det.stripCodeWord('  memorypets    列出手机号  '), '列出手机号');
});

test('codeword: default detector returns null from detectCodeWord on empty input', async () => {
  const det = makeCodeWordDetector();
  assert.equal(det.detectCodeWord(''), null);
  assert.equal(det.detectCodeWord(null), null);
  assert.equal(det.detectCodeWord(undefined), null);
});

test('codeword: default detector handles non-string inputs defensively', async () => {
  const det = makeCodeWordDetector();
  // Should not throw; treat as empty.
  assert.equal(det.stripCodeWord(null), '');
  assert.equal(det.stripCodeWord(undefined), '');
  assert.equal(det.stripCodeWord(123), '123');
});

// ---- Custom word merging ----

test('codeword: custom word is added on top of defaults', async () => {
  const det = makeCodeWordDetector(['mysecret']);
  assert.ok(det.words.includes('mysecret'), 'custom word should be added');
  assert.ok(det.words.includes('memorypets'), 'default should still be present');
  assert.ok(det.words.includes('哥们儿'));
});

test('codeword: custom word matches case-insensitively', async () => {
  const det = makeCodeWordDetector(['mysecret']);
  assert.equal(det.detectCodeWord('MYSECRET'), 'MYSECRET');
  assert.equal(det.detectCodeWord('mySecret'), 'mySecret');
  assert.equal(det.detectCodeWord('foo MYsecret bar'), 'MYsecret');
});

test('codeword: custom word can be stripped', async () => {
  const det = makeCodeWordDetector(['mysecret']);
  assert.equal(det.stripCodeWord('mysecret 列出手机号'), '列出手机号');
});

test('codeword: empty custom array falls back to defaults', async () => {
  const det = makeCodeWordDetector([]);
  const expected = [
    '哥们儿', '狗狗', '记忆宠物', '🐾', '🐶', '🐱',
    'memorypets', 'memory pets', 'mpets', 'mp>',
  ];
  assert.deepEqual(det.words, expected);
});

test('codeword: undefined custom falls back to defaults', async () => {
  const det = makeCodeWordDetector();
  assert.equal(det.words.length, 10);
  assert.deepEqual(det.words, [
    '哥们儿', '狗狗', '记忆宠物', '🐾', '🐶', '🐱',
    'memorypets', 'memory pets', 'mpets', 'mp>',
  ]);
});

test('codeword: custom words that overlap with defaults get deduped', async () => {
  const det = makeCodeWordDetector(['memorypets', '新词']);
  const mpCount = det.words.filter((w) => w === 'memorypets').length;
  assert.equal(mpCount, 1, 'memorypets should appear only once');
  assert.ok(det.words.includes('新词'));
});

test('codeword: custom words with multiple duplicates get deduped among themselves', async () => {
  const det = makeCodeWordDetector(['α', 'α', 'α', 'β']);
  assert.equal(det.words.filter((w) => w === 'α').length, 1);
  assert.equal(det.words.filter((w) => w === 'β').length, 1);
});

test('codeword: custom detector still matches default words', async () => {
  const det = makeCodeWordDetector(['mysecret']);
  assert.equal(det.detectCodeWord('哥们儿, 你好'), '哥们儿');
  assert.equal(det.detectCodeWord('🐾 mysecret'), '🐾');
  // stripCodeWord only strips the FIRST match (regex has no /g flag),
  // so a single code-word at the start is enough to demonstrate the path.
  assert.equal(det.stripCodeWord('哥们儿 列出凭证'), '列出凭证');
});

test('codeword: custom detector returns null when no match', async () => {
  const det = makeCodeWordDetector(['mysecret']);
  assert.equal(det.detectCodeWord('hello world'), null);
});

test('codeword: custom words with regex special chars are escaped', async () => {
  // Parens and dots in user words must be treated literally, not as regex
  // metachars. A regex injection ("(.)") would otherwise absorb any character.
  const det = makeCodeWordDetector(['a.b', 'c(d)']);
  assert.equal(det.detectCodeWord('xx a.b yy'), 'a.b');
  assert.equal(det.detectCodeWord('xx c(d) yy'), 'c(d)');
  // Without the escape, "(.)" would have matched any single char between "c" and "d".
  assert.equal(det.detectCodeWord('xx cXd yy'), null);
});

test('codeword: falsy entries in custom array are filtered out', async () => {
  const det = makeCodeWordDetector(['', null, undefined, 'realword', 0]);
  assert.ok(det.words.includes('realword'));
  assert.equal(det.words.filter((w) => w === '').length, 0);
  assert.equal(det.words.filter((w) => w === null).length, 0);
  assert.equal(det.words.filter((w) => w === 0).length, 0);
});
