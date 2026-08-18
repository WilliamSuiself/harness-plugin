// Behavioural tests for the runtime code-word gate + static regression tests
// for the prompt wording (since the LLM still reads those).
//
// SECURITY: There is NO hard-coded default code-word list anywhere in the
// source. Tests below build the detector from a USER-DEFINED private list
// (e.g. ['XiaoMi', '🌶️']) and verify gate behaviour against THAT list.
// Tests do NOT assume any specific token (哥们儿 / 狗狗 / 🐾 / etc.) is a
// code-word — those tokens are user-configurable, never baked in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCodeWordGate } from '../lib/codeword-gate.mjs';
import { makeCodeWordDetector } from '../lib/intent.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const toolsSrc = readFileSync(join(here, '..', 'lib', 'tools.mjs'), 'utf8');
const promptSrc = readFileSync(join(here, '..', 'lib', 'override-prompt.mjs'), 'utf8');
const gateSrc = readFileSync(join(here, '..', 'lib', 'codeword-gate.mjs'), 'utf8');
const intentSrc = readFileSync(join(here, '..', 'lib', 'intent.mjs'), 'utf8');

function msg(role, text) {
  return { role, content: [{ type: 'text', text }] };
}

// A user-defined private list — explicitly NOT the legacy defaults.
const PRIVATE_WORDS = ['XiaoMi', '🌶️'];
function detector() { return makeCodeWordDetector(PRIVATE_WORDS); }

// ─── Behavioural ────────────────────────────────────────────────────────────

test('gate: empty messages → no code-word', () => {
  const gate = createCodeWordGate(detector());
  gate.captureFromMessages([]);
  assert.equal(gate.state.codewordHit, false);
  assert.equal(gate.state.detectedCodeword, null);
  assert.equal(gate.state.lastUserMessage, '');
});

test('gate: user message with no code-word → no hit', () => {
  const gate = createCodeWordGate(detector());
  gate.captureFromMessages([msg('user', '请帮我记忆工作单位：中国移动')]);
  assert.equal(gate.state.codewordHit, false);
  assert.equal(gate.state.detectedCodeword, null);
});

test('gate: user message with the user-configured word → hit', () => {
  const gate = createCodeWordGate(detector());
  gate.captureFromMessages([msg('user', 'XiaoMi 请帮我记忆工作单位：中国移动')]);
  assert.equal(gate.state.codewordHit, true);
  assert.equal(gate.state.detectedCodeword, 'XiaoMi');
});

test('gate: user message with the user-configured emoji → hit', () => {
  const gate = createCodeWordGate(detector());
  gate.captureFromMessages([msg('user', '🌶️ 列出所有记忆')]);
  assert.equal(gate.state.codewordHit, true);
  assert.equal(gate.state.detectedCodeword, '🌶️');
});

test('gate: code-word in earlier <system-reminder> does NOT contaminate a later no-code-word turn', () => {
  const gate = createCodeWordGate(detector());
  // Earlier user-role message contains a code-word (e.g. an agent-
  // instructions context snapshot). The LATEST user message does NOT.
  // The gate must trust the latest, not concatenate.
  const messages = [
    msg('user', '<system-reminder>workspace reminder mentioning XiaoMi</system-reminder>'),
    msg('assistant', 'sure'),
    msg('user', '请帮我记忆工作单位：中国移动'),
  ];
  gate.captureFromMessages(messages);
  assert.equal(gate.state.codewordHit, false);
  assert.equal(gate.state.lastUserMessage.includes('中国移动'), true);
});

test('gate: refuses gated tools when no code-word is present', () => {
  const gate = createCodeWordGate(detector());
  gate.captureFromMessages([msg('user', '请帮我记忆工作单位：中国移动')]);
  assert.equal(gate.isGatedToolName('memorypets_upsert'), true);
  assert.equal(gate.isGatedToolName('memorypets_remove_entry'), true);
  assert.equal(gate.isGatedToolName('memorypets_reveal_credential'), true);
  assert.equal(gate.isGatedToolName('memorypets_list_entries'), true);
  assert.equal(gate.isGatedToolName('memorypets_codeword'), false);
  assert.equal(gate.isGatedToolName('memorypets_status'), false);

  const refusal = gate.refuseResult('CODE_WORD_REQUIRED');
  assert.equal(refusal.ok, false);
  assert.equal(refusal.refused, true);
  assert.equal(refusal.reason, 'CODE_WORD_REQUIRED');
});

test('gate: empty detector refuses EVERY gated tool call (fail-closed)', () => {
  // Without any user-configured code-words, the detector always returns
  // null. The gate must therefore always refuse — this is the safe default
  // before the user has completed setup.
  const emptyDet = makeCodeWordDetector([]);
  const gate = createCodeWordGate(emptyDet);
  gate.captureFromMessages([msg('user', 'XiaoMi list all')]);
  assert.equal(gate.state.codewordHit, false);
  assert.equal(gate.isGatedToolName('memorypets_upsert'), true);
});

test('gate: REPLACE semantics — gate follows the latest detector via getter', () => {
  // Simulate setCodeWords() being called twice: first with ['OldWord'],
  // then with ['NewWord']. The OLD list must no longer match after the
  // replace — the gate must consult the latest detector on every detect
  // call, not a stale closure-captured reference.
  let detector = makeCodeWordDetector(['OldWord']);
  const gate = createCodeWordGate(() => detector);

  gate.captureFromMessages([msg('user', 'OldWord hi')]);
  assert.equal(gate.state.codewordHit, true);
  assert.equal(gate.state.detectedCodeword, 'OldWord');

  // The user runs setup again with a brand-new list. The old list is
  // discarded — "OldWord" is no longer a code-word.
  detector = makeCodeWordDetector(['NewWord']);

  gate.captureFromMessages([msg('user', 'OldWord hi')]);
  assert.equal(gate.state.codewordHit, false,
    'After REPLACE, the OLD code-word must no longer match');

  gate.captureFromMessages([msg('user', 'NewWord hi')]);
  assert.equal(gate.state.codewordHit, true);
  assert.equal(gate.state.detectedCodeword, 'NewWord');
});

test('gate: refusal result has the right shape for the LLM', () => {
  const gate = createCodeWordGate(detector());
  const refusal = gate.refuseResult('CODE_WORD_REQUIRED');
  assert.ok(typeof refusal.message === 'string' && refusal.message.length > 0);
  assert.equal(refusal.ok, false);
  assert.equal(refusal.refused, true);
  // SECURITY: refusal message must NEVER enumerate code-word candidates —
  // the secret list is private to the user.
  const leakage = ['哥们儿', '狗狗', '记忆宠物', 'mpets', 'memory pets'];
  for (const w of leakage) {
    assert.ok(!refusal.message.includes(w),
      `refusal.message must NOT mention "${w}" — the code-word list is private`);
  }
});

// ─── Static (prompt + tools.mjs) ────────────────────────────────────────────

test('tools.mjs: each memorypets_* tool description must carry a code-word gate', () => {
  const start = toolsSrc.indexOf('const codewordHeader');
  const end = toolsSrc.indexOf('__CODEWORD_HEADER_END__');
  assert.notEqual(start, -1, 'simpleTool must declare a codewordHeader');
  assert.notEqual(end, -1, 'tools.mjs must include __CODEWORD_HEADER_END__ sentinel');
  const block = toolsSrc.slice(start, end);
  const segs = [...block.matchAll(/'((?:\\'|[^'])*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
  const header = segs.join(' ').replace(/\s+/g, ' ').trim();
  assert.ok(/ONLY IF the user'?s? message contains a pre-registered private code-word/i.test(header),
    'header must require a pre-registered private code-word in the user message');
  assert.ok(/If NO code-word is present in the user message, do NOT call this tool/i.test(header),
    'header must explicitly forbid calling when no code-word is present');
  assert.ok(!/then CALL THIS TOOL/i.test(header),
    'regression: the codewordHeader literal must not contain "then CALL THIS TOOL"');
});

test('SECURITY: tools.mjs codewordHeader must NOT contain real code-word literals', () => {
  // CRITICAL: the codewordHeader is sent verbatim to the LLM as part of
  // every memorypets_* tool description. Standalone occurrences of any
  // actual code-word string would leak the entire secret list. Match is
  // CASE-SENSITIVE so that brand-name mentions of "MemoryPets" (capital M)
  // do not count as leaks — code-words are stored in CODE_WORDS_DEFAULT in
  // their exact registered form (all lowercase).
  const start = toolsSrc.indexOf('const codewordHeader');
  const end = toolsSrc.indexOf('__CODEWORD_HEADER_END__');
  assert.notEqual(start, -1, 'simpleTool must declare a codewordHeader');
  assert.notEqual(end, -1, 'tools.mjs must include __CODEWORD_HEADER_END__ sentinel');
  const header = toolsSrc.slice(start, end);
  const forbidden = [
    '\u54e5\u4eec\u513f', // 哥们儿
    '\u72d7\u72d7',       // 狗狗
    '\u8bb0\u5fc6\u5ba0\u7269', // 记忆宠物
    '\ud83d\udc3e',       // 🐾
    '\ud83d\udc36',       // 🐶
    '\ud83d\udc31',       // 🐱
    'mpets',
    'memory pets',
  ];
  for (const word of forbidden) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_\\-])${escaped}(?![A-Za-z0-9_\\-])`);
    assert.ok(!re.test(header),
      `SECURITY: codewordHeader contains the standalone code-word "${word}" — the LLM would echo this back to the user.`);
  }
});

test('tools.mjs: simpleTool must enforce runtime code-word gate inside execute()', () => {
  // The runtime gate is the ground-truth check that cannot be bypassed by
  // an LLM that fabricates the code-word. It MUST live inside execute(),
  // not just in the description string.
  assert.ok(/gate && gate\.isGatedToolName\(name\) && !gate\.state\.codewordHit/.test(toolsSrc),
    'simpleTool.execute must short-circuit gated tools when no code-word is captured');
  assert.ok(/gate\.refuseResult\(['"]CODE_WORD_REQUIRED['"]\)/.test(toolsSrc),
    'simpleTool.execute must return gate.refuseResult("CODE_WORD_REQUIRED") on no code-word');
  assert.ok(/service\.gate \|\| installCodeWordGate\(ctx,\s*null\)/.test(toolsSrc),
    'apply() must reuse service.gate when present (host entry installs it)');
});

test('host index.mjs: systemPrompt section.text must be a function returning "" when no code-word', () => {
  // The MemoryPets override-prompt must vanish from the system prompt
  // when the user message does not contain a code-word. This is the only
  // way to keep MemoryPets completely invisible to the LLM outside direct
  // mode. dsh's renderPrompt() drops sections whose rendered text is empty
  // (see core/system-prompt/src/index.ts renderPrompt()).
  const hostSrc = readFileSync(join(here, '..', 'lib', 'index.mjs'), 'utf8');
  assert.ok(/systemPrompt\.section\(\{[\s\S]*?text:\s*\(\)\s*=>/.test(hostSrc),
    'host apply() must register the systemPrompt section with a function `text`');
  assert.ok(/service\.gate/.test(hostSrc),
    'section.text function must read service.gate to decide what to emit');
  assert.ok(/return\s+''/.test(hostSrc) && /gate\.state\.codewordHit/.test(hostSrc),
    'section.text function must return "" when gate.state.codewordHit is false');
  // And must NOT bake a static prompt string as the section's text:
  assert.ok(!/text:\s*buildOverridePrompt\(customCodeWords\)(?!,|\s*\))/.test(hostSrc.replace(/\s+/g, ' ')),
    'text: must NOT be a static buildOverridePrompt(...) string (would always inject)');
});

test('override-prompt.mjs: must declare code-word gate as the single gating rule', () => {
  assert.ok(/CODE-WORD GATE/.test(promptSrc), 'must declare a CODE-WORD GATE section');
  const promptFlat = promptSrc
    .replace(/'\s*\+\s*'/g, ' ')
    .replace(/',\s*'/g, ' ')
    .replace(/\s+/g, ' ');
  assert.ok(/ONLY when the user message contains at least one code-word/i.test(promptFlat),
    'gate section must require at least one code-word');
  assert.ok(!/Even WITHOUT a code-word, you should still prefer calling the memorypets_\* tools/i.test(promptSrc),
    'regression: "Even WITHOUT a code-word ..." sentence must be removed');
});

test('override-prompt.mjs: must forbid LLM from fabricating banner / lock / save acknowledgments', () => {
  assert.ok(/ANTI-FABRICATION RULES/i.test(promptSrc),
    'prompt must include an ANTI-FABRICATION RULES section');
  // The newer prompt uses ✗ bullets instead of the older "NEVER write any
  // line that starts with ..." prose. We accept either phrasing.
  assert.ok(
    /NEVER write any line that starts with "\(通过暗语【/i.test(promptSrc) ||
    /\u2717 a line starting with "\(通过暗语【/i.test(promptSrc),
    'prompt must forbid the LLM from writing "(通过暗语【..." banners',
  );
  assert.ok(/金库目前处于锁定状态.*memorypets_status/.test(promptSrc),
    'prompt must tie the "金库锁定" claim to a real status call');
  assert.ok(/已为您记住/.test(promptSrc) && /without result\.ok=true/i.test(promptSrc),
    'prompt must forbid fabricated "已为您记住" success claims');
  assert.ok(/outputting "\(通过暗语【\.\.\.】进入 \.\.\. 直连模式\)" without a real code-word/i.test(promptSrc),
    'VIOLATION CRITERIA must list fabricated code-word banner as a violation');
});

test('SECURITY: intent.mjs must NOT export a hard-coded default code-word list', () => {
  // CRITICAL: the user's code-word list is a SECRET that lives ONLY in
  // encrypted storage. intent.mjs must NOT export any default list —
  // any default would leak the secret to anyone reading the source.
  assert.ok(!/export const CODE_WORDS\s*=/.test(intentSrc),
    'intent.mjs must NOT export a hard-coded CODE_WORDS constant');
  assert.ok(!/export\s+default\s+CODE_WORDS/.test(intentSrc),
    'intent.mjs must NOT export CODE_WORDS as default');
});

test('SECURITY: override-prompt.mjs must NOT export a hard-coded default code-word list', () => {
  // CRITICAL: buildOverridePrompt() runs in the host process and its
  // output is sent to the LLM. It must NOT bake any default list into
  // its body, and it must NOT export a CODE_WORDS_DEFAULT constant.
  assert.ok(!/export const CODE_WORDS_DEFAULT\s*=/.test(promptSrc),
    'override-prompt.mjs must NOT export a hard-coded CODE_WORDS_DEFAULT');
});

test('SECURITY: codeword-gate.mjs must NOT import a default code-word list', () => {
  // CRITICAL: gate.mjs is the runtime defence; if it imports any
  // hard-coded defaults, those defaults would silently work even when
  // the user has explicitly REPLACED them via setup.
  assert.ok(!/CODE_WORDS/.test(gateSrc),
    'codeword-gate.mjs must NOT reference CODE_WORDS (no defaults)');
});

test('SECURITY: tools.mjs codewordHeader must NOT contain hard-coded defaults', () => {
  // The codewordHeader is sent verbatim to the LLM as part of every
  // memorypets_* tool description. No default code-word string may
  // appear in it. We check for the entire legacy default set.
  const start = toolsSrc.indexOf('const codewordHeader');
  const end = toolsSrc.indexOf('__CODEWORD_HEADER_END__');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const header = toolsSrc.slice(start, end);
  const forbidden = [
    '\u54e5\u4eec\u513f', '\u72d7\u72d7', '\u8bb0\u5fc6\u5ba0\u7269',
    '\ud83d\udc3e', '\ud83d\udc36', '\ud83d\udc31',
    'mpets', 'memory pets',
  ];
  for (const word of forbidden) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_\\-])${escaped}(?![A-Za-z0-9_\\-])`);
    assert.ok(!re.test(header),
      `codewordHeader must NOT contain the standalone code-word "${word}"`);
  }
});

test('SECURITY: override-prompt.mjs body must NOT contain hard-coded defaults', () => {
  // CRITICAL: buildOverridePrompt() output is sent verbatim to the LLM.
  // It must NOT contain any default code-word as a STANDALONE token.
  const returnStart = promptSrc.indexOf('return [');
  const closingTag = promptSrc.indexOf("'</memorypets-contract-override>'", returnStart);
  const joinEnd = promptSrc.indexOf('.join(', closingTag);
  assert.notEqual(returnStart, -1);
  assert.notEqual(closingTag, -1);
  assert.notEqual(joinEnd, -1);
  const body = promptSrc.slice(returnStart, joinEnd);
  const forbidden = [
    '\u54e5\u4eec\u513f', '\u72d7\u72d7', '\u8bb0\u5fc6\u5ba0\u7269',
    '\ud83d\udc3e', '\ud83d\udc36', '\ud83d\udc31',
    'mpets', 'memory pets',
  ];
  for (const word of forbidden) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Case-sensitive identifier boundary so that "MemoryPets" (capital M)
    // brand name in product prose is not mistaken for the code-word.
    const re = new RegExp(`(?<![A-Za-z0-9_\\-])${escaped}(?![A-Za-z0-9_\\-])`);
    assert.ok(!re.test(body),
      `buildOverridePrompt body must NOT contain standalone code-word "${word}"`);
  }
});

test('codeword-gate.mjs: must reuse intent.mjs for the detector factory', () => {
  // The detector factory is the single source of truth for code-word
  // detection. gate.mjs must NOT redefine a default list of its own.
  assert.ok(/from '\.\/intent\.mjs'/.test(gateSrc),
    'gate must import { makeCodeWordDetector } from ./intent.mjs');
});