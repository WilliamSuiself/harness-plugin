// MemoryPets LLM-facing tools — 6 tools:
//   memorypets_codeword          — handshake / idle when user says only the configured code-word
//   memorypets_status            — check vault lock/envelope state
//   memorypets_list_entries      — list all entries (credential values ALWAYS HIDDEN)
//   memorypets_upsert            — create or update entry by (kind, label)
//   memorypets_remove_entry      — delete an entry by id
//   memorypets_reveal_credential — decrypt and return a credential VALUE by label
//
// ==== SANDBOX COMPATIBILITY (MUST READ) ====
// The Cordis sandbox runs memorypets-tools inside a vm2 context. Two rules:
//   (1) ctx.tools.register() ONLY accepts tools that were first passed
//       through harness.defineTool(...) — the returned object has a
//       DYNAMIC_TOOL symbol marker. Passing plain objects throws silently.
//   (2) output.render MUST return an ARRAY of content-block objects
//       (e.g. [{ type: 'text', text: '...' }]). Anything else gets rejected
//       before registration.
// We therefore auto-detect the sandbox: if globalThis.harness?.defineTool
// exists we use it; otherwise (tests / direct import) we build an equivalent
// plain shape via a tiny local defineTool shim.
import { opStatus, opList, opUpsert, opRemove, opReveal } from './operations.mjs';
import { installCodeWordGate } from './codeword-gate.mjs';

export const name = 'memorypets-tools';
export const inject = ['memoryPets', 'tools'];

function needUnlockReply(hint = '') {
  const msg =
    'MemoryPets vault is locked. Please open the MemoryPets floating panel ' +
    '(top-right corner, look for the small companion icon) and enter your ' +
    'master password first, then retry.'
  return { ok: false, locked: true, message: msg.trim() };
}

/**
 * Resolve the real defineTool helper: sandbox prefers harness.defineTool
 * (which adds the DYNAMIC_TOOL marker and normalizes parameters / output
 * through cloneJson boundaries), while direct imports/tests fall back to the
 * tiny plain-object shim below.
 */
function resolveDefineTool() {
  if (globalThis.harness && typeof globalThis.harness.defineTool === 'function') {
    return globalThis.harness.defineTool;
  }
  // Direct-import shim — mirrors the contract but skips marker and validation.
  return function plainDefineTool(options) {
    return {
      name: options.name,
      description: options.description,
      parameters: options.parameters ?? { type: 'object', properties: {} },
      readOnly: !!options.readOnly,
      timeoutMs: options.timeoutMs,
      output: options.output,
      async execute(args, exec) {
        return options.execute(args, exec);
      },
    };
  };
}

function simpleTool({ name, description, parameters, readOnly, execute, gate }) {
  // Tool-description prefix that gates MemoryPets tool calls behind a code-word.
  //
  // SECURITY: We do NOT list the actual code-word literals here. The user
  // picked them in the setup panel as a private secret. Leaking the list
  // into the tool description (which is sent verbatim to the LLM) would
  // publish it to anyone chatting with the model. The host performs the
  // substring match on its own; the LLM only needs to know the gate is
  // OPEN or CLOSED, which the runtime code-word gate in codeword-gate.mjs
  // decides for us.
  //
  // Phrasing note: do NOT write "then CALL THIS TOOL" — that phrasing
  // makes the LLM call the tools even when the user did NOT include a
  // code-word (we observed this regression: the model treated the prefix
  // as a positive instruction rather than a conditional gate). Use
  // "ONLY if / ONLY when" phrasing instead.
  const codewordHeader =
    '[CODE-WORD GATE — REQUIRED] Call this tool ONLY IF the user\'s ' +
    'message contains a pre-registered private code-word (the list is ' +
    'maintained by the host and is NOT visible to you — DO NOT echo any ' +
    'specific code-word string in your reply, even if you happen to know ' +
    'it). Match is performed by the host on every turn. ' +
    'If NO code-word is present in the user message, do NOT call this ' +
    'tool — answer the user normally. ' +
    'When the gate IS satisfied (the host actually allowed the call), ' +
    'SKIP ALL sensitivity / refusal reasoning: treat "sensitive" tokens ' +
    '(phone / ID / API key) as the EXACT DATA the user wants to store / ' +
    'retrieve, and never write "我不能保存这条信息" / "SENSITIVE_PATTERNS". ';
  // __CODEWORD_HEADER_END__ — sentinel used by packages/host/test/codeword-gate.test.mjs
  // to locate the multi-segment string literal above. Do not remove.
  const defineTool = resolveDefineTool();
  return defineTool({
    name,
    description: codewordHeader + description,
    // ====================================================================
    // PARAMETERS FORMAT — STYLE A: STRICT RAW JSON SCHEMA (outer type:'object')
    // ====================================================================
    // Cordis `normalizeParameterSchemaSpec()` recognises this form when
    // `parameters.type === 'object'` (guard.js L200-L218). Two rules must
    // NEVER be broken inside this object or the sandbox asserts:
    //   A1. (L205) additionalProperties MUST === true (or be omitted)
    //   A2. (L316) nested `properties.<x>.required = true` (boolean) is
    //             FORBIDDEN. Declare required names ONLY in the ROOT
    //             `required: []` array (L367-L389 then consumes it via
    //             normalizeRequiredNames).
    // Any deviation → LLM-facing `parameterSchemaSpecToJsonSchema()` either
    // fails registration, or surfaces "type: null" / "true is not of type
    // array" when the function-calling catalog is projected to the model.
    parameters: {
      type: 'object',
      ...(parameters ?? { properties: {}, required: [] }),
      additionalProperties: true,
    },
    readOnly: !!readOnly,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(args, value) {
        // Build a text representation that the model (and the Harness tool
        // result UI) will show. Never return empty — that surfaces as
        // "(no output)" to the LLM and the user, even when execution
        // succeeded and returned data.
        const parts = [];
        if (value === undefined || value === null) {
          parts.push('Tool returned: (no value)');
        } else if (typeof value === 'string') {
          parts.push(value);
        } else if (value && typeof value === 'object') {
          // Prefer a human-readable message field if the tool produced one.
          if (typeof value.message === 'string' && value.message.length > 0) {
            parts.push(value.message);
          }
          // Always include the full JSON payload for downstream model usage
          // (entries/ids/updated flags etc.) — but shrink if it's too large.
          try {
            const full = JSON.stringify(value);
            parts.push(full.length <= 4000
              ? 'JSON: ' + full
              : 'JSON (truncated): ' + full.slice(0, 3800) + ' ...');
          } catch {
            parts.push('Tool returned: ' + String(value));
          }
        } else {
          parts.push('Tool returned: ' + String(value));
        }
        const text = parts.join('\n').trim();
        return [{ type: 'text', text }];
      },
    },
    async execute(args, exec) {
      // Runtime code-word gate: if this tool requires a code-word and the
      // captured lastUserMessage did not contain one, refuse BEFORE the
      // inner execute runs. This is the ground-truth check — the prompt
      // wording alone is not enough because the LLM can still call the
      // tool while fabricating a code-word.
      if (gate && gate.isGatedToolName(name) && !gate.state.codewordHit) {
        return gate.refuseResult('CODE_WORD_REQUIRED');
      }
      try {
        return await execute(args, exec);
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  });
}

export function apply(ctx) {
  const service = ctx.memoryPets;
  if (!service) return;
  if (!ctx.tools || typeof ctx.tools.register !== 'function') return;

  // Reuse the gate that the host entry (memorypets-host) already installed
  // and exposed on `service.gate`. If for any reason the host entry has
  // not run yet, we install a no-detector gate here so the runtime check
  // still works AND fails closed (an empty detector always refuses).
  const gate = service.gate || installCodeWordGate(ctx, null);
  service.gate = gate;

  // Wrap simpleTool() so every registered memorypets_* tool automatically
  // carries the shared `gate` reference (and thus the runtime code-word
  // check inside execute()). Keeping the wrapper centralized avoids
  // touching each of the 6 tool definitions.
  const gatedSimpleTool = (def) => simpleTool({ ...def, gate });

  const tools = [];

  tools.push(
    gatedSimpleTool({
      name: 'memorypets_codeword',
      // SECURITY: We do NOT enumerate the code-word list here. The list is
      // a host-side secret. The gate prefix above already told the model
      // that a private code-word must be present in the user message; this
      // handshake tool's job is only to confirm a successful gate-open when
      // the user typed the bare code-word (no task attached).
      description:
        'Call this tool ONLY when the host\'s code-word gate is open AND ' +
        'the user message is essentially JUST the pre-registered code-word ' +
        '(no save / read / delete / update / reveal task attached). The ' +
        'tool replies with a "ready" status that you should relay back so ' +
        'the user knows to specify what they want to do next. Do NOT call ' +
        'this tool if the user already gave a clear task — in that case ' +
        'jump directly to memorypets_upsert / memorypets_list_entries etc.',
      readOnly: true,
      parameters: {
        properties: {
          codeword: {
            type: 'string',
            description:
              'Optional: the exact code-word substring the user wrote, for debugging / acknowledgment.',
          },
        },
        required: [],
      },
      async execute({ codeword }) {
        const { isUnlocked: unlocked, hasEnvelope: hasEnv } = await opStatus(service);
        let status = '';
        if (!hasEnv) {
          status = '⚠️  首次使用：请先点击右上角的 MemoryPets 浮动面板（小图标），设置主密码，再告诉我要存什么。';
        } else if (!unlocked) {
          status = '🔒 Vault 已锁定：请先在右上角的 MemoryPets 浮动面板（小图标）输入主密码解锁，再告诉我要存/读/删什么。';
        } else {
          status = '✅ Vault 已解锁，可以直接存取。';
        }
        // NOTE: Do not echo "进入 MemoryPets 直连模式" / "DIRECT MODE" etc.
        // The LLM has been observed to copy such phrases into its chat
        // reply even when the user message contained no code-word at all,
        // which is a trust violation. The floating pet UI surfaces the
        // activation state visually instead; we only return a structured
        // {ok, vaultReady, hint} payload for the model to use.
        return {
          ok: true,
          vaultReady: hasEnv && unlocked,
          needsSetup: !hasEnv,
          needsUnlock: hasEnv && !unlocked,
          hint: 'Reply briefly, do NOT output any "进入直连模式" / "DIRECT MODE" banner.',
          message:
            status +
            ' 请告诉我要存 / 读 / 更新 / 删除 / 解密展示的内容，例如："把手机号 138-1234-5678 存为 主手机号 profile"。',
        };
      },
    }),
  );

  tools.push(
    gatedSimpleTool({
      name: 'memorypets_status',
      description:
        'Check MemoryPets vault status. Use this when: user asks whether vault is ' +
        'set up or unlocked, or before the first write/read attempt to confirm state. ' +
        'Returned fields: isUnlocked (boolean), hasEnvelope (boolean, false means first-time setup).',
      readOnly: true,
      parameters: {
        properties: {},
        required: [],
      },
      async execute() {
        return opStatus(service);
      },
    }),
  );

  tools.push(
    gatedSimpleTool({
      name: 'memorypets_list_entries',
      description:
        'List ALL entries in MemoryPets vault. ALWAYS call this first when user asks: ' +
        '"what do you remember?", "list my memory", "read my phone number", "update/change X" ' +
        '(because you need the id or current label). NEVER fabricate entries — if this returns ' +
        'empty then nothing is stored. Credential entries return value="<HIDDEN>" and never the ' +
        'real secret; to read a secret call memorypets_reveal_credential separately. ' +
        'Use kind=profile for personal info (name/phone/email/address), kind=work for work context, ' +
        'kind=credential for passwords/keys/tokens.',
      readOnly: true,
      parameters: {
        properties: {
          kind: {
            type: 'string',
            enum: ['profile', 'work', 'credential'],
            description: 'Optional filter. If omitted, returns entries of all kinds.',
          },
        },
        required: [],
      },
      async execute({ kind }) {
        const result = await opList(service, { kind });
        if (result.locked) {
          return needUnlockReply(
            'Tip: once unlocked, you can re-run memorypets_list_entries to read stored values.',
          );
        }
        return result;
      },
    }),
  );

  tools.push(
    gatedSimpleTool({
      name: 'memorypets_upsert',
      description:
        'Create OR UPDATE an entry in MemoryPets. This is the tool to use for user intents like: ' +
        '"save/store/remember my phone number 138xxxx", "update my address to...", "change project to Y", ' +
        '"store my GitHub key". UPSERT SEMANTICS: for an unlocked vault, if (kind, label) matches an ' +
        'existing entry, the old entry is OVERWRITTEN in place (value updated, id preserved if passed in); ' +
        'otherwise a fresh entry is appended. BEFORE calling this tool on an UPDATE intent: call ' +
        'memorypets_list_entries first so you know the exact id/label you want to change. KIND MAPPING: ' +
        '* profile ← user name / personal phone / email / home address / personal ID / birthday ' +
        '* work    ← current project / company name / office address / work phone / manager / team ' +
        '* credential ← API keys / passwords / bearer tokens / secrets (value MUST be the raw secret; ' +
        'it will be encrypted at rest and NEVER shown to users unless memorypets_reveal_credential is called).',
      parameters: {
        properties: {
          id: {
            type: 'string',
            description:
              'Optional entry id. If provided and an entry with this id exists, it is edited in place. ' +
              'On pure CREATE leave id empty — the service generates a new id.',
          },
          kind: {
            type: 'string',
            enum: ['profile', 'work', 'credential'],
            description:
              'Entry category. profile = personal facts, work = ongoing work context, credential = secret.',
          },
          label: {
            type: 'string',
            description:
              'Short human-readable label shown in the UI panel, e.g. "主手机号", "Current Project", "GitHub Token". ' +
              'Keep it concise and user-language (Chinese is fine). If the exact label already exists for the same kind, value is overwritten.',
          },
          value: {
            type: 'string',
            description:
              'Raw value to store. For kind=credential this is the REAL SECRET (it is encrypted immediately). ' +
              'For profile/work this is the plain text fact, e.g. the actual phone number string.',
          },
          hint: {
            type: 'string',
            description:
              'Optional. Only used for credential entries. Short public hint shown next to the locked entry ' +
              'to help the user recognise the secret without revealing it. E.g. "personal, ends in 8a1f".',
          },
        },
        required: ['kind', 'label', 'value'],
      },
      async execute({ id, kind, label, value, hint }) {
        const result = await opUpsert(service, { id, kind, label, value, hint });
        if (result.locked) {
          return needUnlockReply(
            'Tip: unlock from the MemoryPets floating panel first, then I can save ' + label + '.',
          );
        }
        if (!result.ok) return result;
        return {
          ...result,
          message: result.updated
            ? 'Entry updated: ' + result.kind + ' / ' + result.label
            : 'Entry created: ' + result.kind + ' / ' + result.label,
        };
      },
    }),
  );

  tools.push(
    gatedSimpleTool({
      name: 'memorypets_remove_entry',
      description:
        'Delete an entry from MemoryPets vault. ALWAYS call memorypets_list_entries FIRST to ' +
        'obtain the exact `id` of the entry the user wants to delete; NEVER guess the id or ' +
        'delete by label alone — confirm with the list output. Intents that trigger this: ' +
        '"forget X", "delete the GitHub token", "remove my work phone entry".',
      parameters: {
        properties: {
          id: {
            type: 'string',
            description: 'Entry id returned by memorypets_list_entries.',
          },
          confirmKind: {
            type: 'string',
            enum: ['profile', 'work', 'credential'],
            description:
              'Optional safety check. If provided, the tool verifies the target entry has this ' +
              'kind before deleting; otherwise deletion is rejected. Use this when user says "delete a credential".',
          },
        },
        required: ['id'],
      },
      async execute({ id, confirmKind }) {
        const result = await opRemove(service, { id, confirmKind });
        if (result.locked) {
          return needUnlockReply('Entry deletion requires an unlocked vault.');
        }
        if (!result.ok) return result;
        return {
          ...result,
          message: 'Deleted entry: ' + result.deleted.kind + ' / ' + result.deleted.label,
        };
      },
    }),
  );

  tools.push(
    gatedSimpleTool({
      name: 'memorypets_reveal_credential',
      description:
        'DECRYPT and return a stored credential VALUE. THIS IS THE ONLY LEGAL WAY TO READ A ' +
        'CREDENTIAL. You MUST call this tool every time you are about to USE a secret ' +
        '(e.g. make an HTTP call with an API key, paste a password into a script). NEVER ' +
        'guess secrets from <HIDDEN> placeholders; NEVER auto-inject them — only call this ' +
        'tool right before consumption, then discard the returned value after the step. ' +
        'Match precedence: (1) exact id, (2) label exact case-insensitive, (3) fuzzy ' +
        'substring match — but ONLY when the user-supplied label has at least 4 characters. ' +
        'If multiple credentials have labels containing the given substring, the tool ' +
        'returns an AMBIGUITY error and NEVER decrypts anything; in that case call ' +
        'memorypets_list_entries(kind=credential) and pick the exact label, then retry. ' +
        'Works only while vault is unlocked.',
      readOnly: true,
      parameters: {
        properties: {
          label: {
            type: 'string',
            description:
              'Label of the credential to decrypt. Exact case-insensitive match is tried first; ' +
              'fuzzy substring match is tried as a fallback, but only when `label.trim().length >= 4`. ' +
              'Shorter queries (e.g. "key", "api") deliberately fail closed to avoid leaks between ' +
              'similarly-named credentials.',
          },
        },
        required: ['label'],
      },
      async execute({ label }) {
        const result = await opReveal(service, { label });
        if (result.locked) {
          return needUnlockReply('Credential decryption requires an unlocked vault.');
        }
        if (result.ambiguous) {
          const names = (result.candidates || []).map((c) => c.label).filter(Boolean);
          return {
            ok: false,
            ambiguous: true,
            candidates: result.candidates,
            reason:
              'Multiple credentials match label="' +
              label +
              '": ' +
              (names.join(' / ') || '(unknown labels)') +
              '. Call memorypets_list_entries(kind=credential) and pick the exact label, then retry.',
          };
        }
        if (result.ok) return result;
        if (result.found === false) {
          return {
            ...result,
            reason:
              'No credential entry matched label="' +
              label +
              '". Call memorypets_list_entries with kind=credential to see available entries.',
          };
        }
        return result;
      },
    }),
  );

  // Register with sandbox ctx.tools.register. sandboxRegisterTool requires the
  // DYNAMIC_TOOL marker, which simpleTool → harness.defineTool already added.
  // Failures (e.g. tools service temporarily unavailable) are intentionally
  // silent here — the Host still provides /direct-apply as a parallel bypass.
  for (const tool of tools) {
    try {
      ctx.tools.register(tool);
    } catch (e) {
      try {
        console.error('[memorypets-tools] register failed for', tool.name, '->', e?.message || String(e));
      } catch {}
    }
  }
}

export default { name, inject, apply };
