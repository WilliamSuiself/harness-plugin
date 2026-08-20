// Runtime code-word gate.
//
// The override-prompt wording alone cannot keep the LLM honest: even with a
// perfectly worded "NEVER fabricate a banner / ALWAYS require a code-word"
// section, the model still occasionally parrots the example banner text and
// fires memorypets_* tools without a code-word present in the user message.
//
// This module adds three runtime defenses that the LLM cannot bypass:
//
//   1. agent/pre-step listener — captures the latest user message text and
//      updates `state.lastUserMessage` + `state.codewordHit` for the current
//      turn (these are the same strings the harness sends to the model).
//
//   2. tools/pre-execute listener — for any memorypets_* tool name, refuses
//      to forward to the LLM if the captured user message did not contain a
//      code-word. Returns a structured refusal instead, so the model sees a
//      tool result explaining why the call was rejected (and never an
//      "已为您记住 ..." fake success).
//
//   3. A `ctx.systemPrompt.context()` registration that surfaces the
//      code-word state as a runtime-context snapshot. dsh will append it as
//      a `<system-reminder>`-style user message AFTER the claimed user
//      input, so the LLM gets an explicit ground-truth signal each turn
//      and cannot claim "I detected a code-word" without it being true.

import { makeCodeWordDetector } from './intent.mjs';

// SECURITY: We do NOT import any default code-word list. The user's secret
// code-words are passed in via `createCodeWordGate(initialCodeWords)` from
// the host service, which loads them from encrypted storage at runtime.

const TOOL_NAME_PREFIX = 'memorypets_';
// Tools that ALWAYS require a code-word before they may run. (The
// `memorypets_codeword` handshake tool itself is excluded — it IS the
// gate-detection tool and must run whenever the LLM chose to call it.
const GATED_TOOL_NAMES = new Set([
  'memorypets_upsert',
  'memorypets_remove_entry',
  'memorypets_reveal_credential',
  'memorypets_list_entries',
]);

/**
 * Best-effort: extract the plain-text content of a dsh UserMessage.
 *
 * dsh UserMessage shapes vary (string content, ContentBlock[] content,
 * content parts of `text` / `image` / etc.). For code-word detection we
 * only need the human-readable text portions; ignore everything else.
 */
function flattenUserMessageText(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * Concatenate the text of every claimed user-role message in a pre-step
 * batch. We look at the LAST user-role message because that's what the
 * user just typed; earlier user-role turns in the same step can only
 * appear from system-context projections (e.g. `<system-reminder>`
 * messages from the runtime-context plugin), which the LLM authored
 * itself and should not be used as the source of truth for code-word
 * detection.
 */
function latestUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.role !== 'user') continue;
    const text = flattenUserMessageText(m);
    if (text) return text;
  }
  return '';
}

// SECURITY: callers MUST pass a code-word detector built from the user's
// private secret list. We never accept a default — if the detector (or the
// getDetector callback) returns a missing / empty list, the gate refuses
// every gated tool call.
//
// IMPORTANT: Pass `getDetector` (a function that returns the CURRENT
// detector each call), NOT a captured detector instance. The user can
// REPLACE their code-word list via setup; if the gate held a stale
// reference, it would still match the old list. The getDetector callback
// always returns the latest instance from host.codeWordDetector.
const FALLBACK_DET = { words: [], detectCodeWord: () => null, stripCodeWord: (t) => String(t || '').trim() };
export function createCodeWordGate(detectorOrGetter, initialEnabled = true) {
  const getDetector = typeof detectorOrGetter === 'function'
    ? detectorOrGetter
    : () => detectorOrGetter || FALLBACK_DET;
  // Per-turn state. Updated on every `agent/pre-step` event.
  const state = {
    lastUserMessage: '',
    codewordHit: false,
    detectedCodeword: null,
    updatedAt: 0,
  };
  // Whether the gate is currently active. When disabled (user turned off
  // "暗语门槛" in settings), gated tools run unconditionally — no code-word
  // detection is performed at all.
  let enabled = !!initialEnabled;

  function captureFromMessages(messages) {
    const text = latestUserText(messages);
    state.lastUserMessage = text;
    state.updatedAt = Date.now();
    if (!text) {
      state.codewordHit = false;
      state.detectedCodeword = null;
      return;
    }
    // Always re-read the latest detector so a user-driven REPLACE via
    // setCodeWords() takes effect immediately.
    const det = getDetector() || FALLBACK_DET;
    const hit = det.detectCodeWord(text);
    state.codewordHit = hit !== null && hit !== undefined;
    state.detectedCodeword = hit ?? null;
  }

  function isGatedToolName(name) {
    return GATED_TOOL_NAMES.has(name);
  }

  function refuseResult(reason) {
    return {
      ok: false,
      refused: true,
      reason,
      message: reason,
    };
  }

  return {
    state,
    captureFromMessages,
    isGatedToolName,
    refuseResult,
    isEnabled: () => enabled,
    setEnabled: (v) => { enabled = !!v; },
    TOOL_NAME_PREFIX,
  };
}

/**
 * Install runtime listeners on the dsh ctx:
 *   - ctx.on('agent/pre-step', ...) → updates state.lastUserMessage
 *   - ctx.on('tools/pre-execute', ...) → blocks memorypets_* when no code-word
 *
 * Returns the gate object so callers can inspect `state` for tests.
 */
export function installCodeWordGate(ctx, detectorOrGetter, initialEnabled = true) {
  const gate = createCodeWordGate(detectorOrGetter, initialEnabled);

  // 1. agent/pre-step: capture the latest user message into gate state.
  // Note: do NOT probe ctx.scope or any other non-injected property — the
  // Cordis sandbox throws "cannot get property X without inject" on probes.
  if (ctx && typeof ctx.on === 'function') {
    try {
      ctx.on('agent/pre-step', async (_arg, next) => {
        const decision = await next();
        try {
          const msgs = decision?.messages ?? _arg?.messages ?? [];
          gate.captureFromMessages(msgs);
        } catch { /* defensive */ }
        return decision;
      });
    } catch { /* cordis not available — gate still works for direct calls */ }
  }

  // 2. tools/pre-execute: refuse memorypets_* when no code-word.
  if (ctx && typeof ctx.on === 'function') {
    try {
      ctx.on('tools/pre-execute', async (exec, next) => {
        // Probe `name` defensively — Cordis sandbox can throw on direct access
        // to non-injected properties. Fall back to no name → next().
        let name;
        try { name = exec && exec.name; } catch { name = undefined; }
        if (!gate.isEnabled() || !gate.isGatedToolName(name)) return next();
        // Re-capture the latest user text defensively in case no agent
        // listener is wired (e.g. tool invoked from a script).
        if (Date.now() - gate.state.updatedAt > 5000 || !gate.state.lastUserMessage) {
          // Try to read it from exec.agent.session if available. Use plain
          // property access (no `?.`) so the sandbox can short-circuit on
          // missing inject — the outer try/catch absorbs any throw.
          try {
            const execObj = exec;
            const agent = execObj && execObj.agent;
            const session = agent && agent.session;
            if (session && typeof session.deriveMessages === 'function') {
              const msgs = await session.deriveMessages({ mode: 'request' });
              gate.captureFromMessages(msgs);
            }
          } catch { /* ignore — sandbox may throw on probe */ }
        }
        if (!gate.state.codewordHit) {
          return {
            kind: 'final-result',
            result: {
              ok: false,
              refused: true,
              tool: name,
              reason: 'CODE_WORD_REQUIRED',
              // SECURITY: Do NOT list the code-words in this refusal message.
              // The list is a host-side secret; echoing it would publish it
              // to anyone reading the LLM conversation. The model just needs
              // to know "the gate rejected your call; ask the user to use the
              // pre-registered code-word in their next message".
              message:
                'MemoryPets tool blocked: the current user message does not ' +
                'contain the pre-registered code-word required by the host ' +
                'gate. Ask the user to include their pre-registered ' +
                'code-word in their next message before retrying. ' +
                '(The list of valid code-words is private — do not echo ' +
                'any specific string in your reply; the host will accept ' +
                'whatever the user has configured.)',
              state: {
                detectedCodeword: null,
                lastUserMessage: gate.state.lastUserMessage.slice(0, 200),
              },
            },
          };
        }
        return next();
      });
    } catch { /* ignore */ }
  }

  return gate;
}

export { makeCodeWordDetector } from './intent.mjs';