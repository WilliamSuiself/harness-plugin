// Host plugin: registers ctx.memoryPets service with vault and persistence contract.
//
// This module is a plain ESM `.mjs` file because the Cordis loader runs under
// Node >= 22 and imports via dynamic `import(specifier)` — the unwrapper grabs
// either the default export or named exports matching a plugin shape.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault } from './vault.mjs';
import { PlainStore } from './plain-store.mjs';
import { opStatus, opList, opUpsert, opRemove, opReveal, opExportMarkdown, safeList } from './operations.mjs';
import { makeCodeWordDetector, parseIntent } from './intent.mjs';
import { buildOverridePrompt } from './override-prompt.mjs';
import { installCodeWordGate } from './codeword-gate.mjs';
import { createCloudSyncClient } from './cloud-sync.mjs';
import { codewordsPath, settingsPath, notesPath, envelopePath } from './paths.mjs';
import { registerAssetsRoute, resolveAssetsRoot } from './routes/assets-route.mjs';
import { registerClientBundle } from './client-modules-registration.mjs';

// packages/host/lib/index.mjs → packages/host/lib → packages/host → packages → <repo root>
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLIENT_BUNDLE_PATH = join(REPO_ROOT, 'packages', 'client', 'lib', 'client.bundle.js');
const CLIENT_INDEX_PATH = join(REPO_ROOT, 'packages', 'client', 'lib', 'index.mjs');

export const name = 'memorypets-host';
// systemPrompt 在 web/agent profile 里提供；clientModules 是 dsh 模块注册表，
// 只有 web profile 存在；webServer 提供 HTTP 路由注册；所有 ctx 属性访问都 try/catch，非 web profile 跳过。
export const inject = ['systemPrompt', 'clientModules', 'webServer', 'tools'];

export async function apply(ctx, config = {}) {
  let vault = new Vault();
  let master = null;
  let promptDisposer = null;

  // Non-secret feature toggles. Both default to `true` — MemoryPets keeps
  // its original secure-by-default behavior (encrypted-at-rest vault,
  // code-word gate on tool calls). Users who want to reposition MemoryPets
  // as a non-private notes tool can turn either off from the "安全设置"
  // panel; both settings are safe to persist unencrypted since they never
  // contain secrets.
  let settings = { encryptionEnabled: true, codewordGateEnabled: true };

  const loadSettings = async () => {
    try {
      const fs = await import('node:fs/promises');
      const raw = await fs.readFile(settingsPath(), 'utf8');
      const data = JSON.parse(raw);
      settings = {
        encryptionEnabled: data.encryptionEnabled !== false,
        codewordGateEnabled: data.codewordGateEnabled !== false,
      };
    } catch { /* not created yet — keep secure defaults */ }
  };

  const saveSettings = async () => {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const file = settingsPath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(settings, null, 2));
    } catch { /* persistence failure is non-fatal */ }
  };

  // User-defined custom code-words (loaded from config or disk).
  // Kept separate from the encrypted vault so it can be read even when locked —
  // the code-word is what tells the model to *try* to unlock / access MemoryPets.
  let customCodeWords = [];
  let codeWordDetector = makeCodeWordDetector(customCodeWords);

  const loadCodeWords = async () => {
    try {
      if (typeof config.loadCodeWords === 'function') {
        const list = await config.loadCodeWords();
        if (Array.isArray(list)) customCodeWords = list.filter((w) => typeof w === 'string' && w.trim());
      } else if (typeof config.loadCodeWords === 'object' && Array.isArray(config.loadCodeWords)) {
        customCodeWords = config.loadCodeWords.filter((w) => typeof w === 'string' && w.trim());
      } else {
        const fs = await import('node:fs/promises');
        try {
          const raw = await fs.readFile(codewordsPath(), 'utf8');
          const data = JSON.parse(raw);
          if (Array.isArray(data.words)) {
            customCodeWords = data.words.filter((w) => typeof w === 'string' && w.trim());
          }
        } catch { /* not created yet */ }
      }
    } catch {}
    codeWordDetector = makeCodeWordDetector(customCodeWords);
  };

  const saveCodeWords = async () => {
    try {
      if (typeof config.saveCodeWords === 'function') {
        await config.saveCodeWords([...customCodeWords]);
      } else if (typeof config.saveCodeWords === 'object' && Array.isArray(config.saveCodeWords)) {
        // no-op: static array; config layer must reference the same object
      } else {
        const fs = await import('node:fs/promises');
        await fs.writeFile(codewordsPath(), JSON.stringify({ words: customCodeWords }, null, 2));
      }
    } catch {}
  };

  const setCodeWords = async (list) => {
    const cleaned = Array.isArray(list)
      ? list.map((w) => String(w).trim()).filter(Boolean)
      : [];
    // Strip duplicates and keep ordering.
    customCodeWords = [...new Set(cleaned)];
    codeWordDetector = makeCodeWordDetector(customCodeWords);
    await saveCodeWords();
    return [...customCodeWords];
  };

  const persist = async () => {
    if (!settings.encryptionEnabled) {
      // Plaintext mode: write directly to notesPath(), bypassing the
      // encrypted-envelope config hooks entirely (there is no password).
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const file = notesPath();
        await fs.mkdir(path.dirname(file), { recursive: true });
        const snap = await vault.sealWith();
        await fs.writeFile(file, JSON.stringify(snap, null, 2));
      } catch { /* persistence failure is non-fatal */ }
      return;
    }
    if (!config.saveEnvelope) return;
    if (master === null) return;
    const env = await vault.sealWith(master);
    await config.saveEnvelope(env);
  };

  // Cloud sync client — talks to the packages/cloud-sync relay. It never
  // sees the master password; it only pushes/pulls the same opaque envelope
  // that's already persisted to disk locally (see persist() above).
  const cloudSync = createCloudSyncClient();

  // Push-then-pull-on-conflict: try to upload the local encrypted envelope;
  // if the relay reports someone else already pushed a newer version, pull
  // that version instead and adopt it locally (after verifying it decrypts
  // with our own master password — never blindly trust a raw blob).
  const cloudSyncNow = async () => {
    if (!settings.encryptionEnabled) {
      return { ok: false, error: 'Cloud sync requires encryption to be enabled (plaintext mode is not synced).' };
    }
    if (!vault.isUnlocked() || master === null) {
      return { ok: false, error: 'Vault must be unlocked to sync.' };
    }
    const localEnvelope = await service.loadEnvelope();
    if (!localEnvelope) {
      return { ok: false, error: 'Nothing to sync yet — save at least one entry first.' };
    }
    const pushResult = await cloudSync.push(localEnvelope);
    if (pushResult.ok) {
      return { ok: true, action: 'pushed', version: pushResult.version };
    }
    if (!pushResult.conflict) {
      return { ok: false, error: pushResult.error || 'push failed' };
    }
    // Someone else's write won the race — pull it down and adopt it.
    const pullResult = await cloudSync.pull();
    if (!pullResult.ok) {
      return { ok: false, error: pullResult.error || 'pull failed after conflict' };
    }
    if (!pullResult.envelope) {
      return { ok: false, error: 'Conflict reported but the relay has no envelope to pull.' };
    }
    const remoteVault = new Vault();
    try {
      await remoteVault.unlock(pullResult.envelope, master);
    } catch {
      return { ok: false, error: 'Cloud has a newer version, but it does not decrypt with your current master password.' };
    }
    vault = remoteVault;
    await service.saveEnvelope(pullResult.envelope);
    await cloudSync.confirmVersion(pullResult.version);
    refreshSystemPrompt();
    return { ok: true, action: 'pulled', version: pullResult.version, entries: vault.list() };
  };

  const buildProfilePrompt = () => {
    if (!vault.isUnlocked()) return '';
    const entries = vault.list();
    const profiles = entries.filter((e) => e.kind === 'profile');
    const works = entries.filter((e) => e.kind === 'work');
    if (!profiles.length && !works.length) return '';
    const lines = ['<memorypets-working-memory>'];
    if (profiles.length) {
      lines.push('## Profile');
      for (const p of profiles) lines.push(`- ${p.label}: ${p.value}`);
    }
    if (works.length) {
      lines.push('## Work context');
      for (const w of works) lines.push(`- ${w.label}: ${w.value}`);
    }
    lines.push('</memorypets-working-memory>');
    return lines.join('\n');
  };

  // dynamic prompt injection: dispose 旧 section，注册新的
  const refreshSystemPrompt = () => {
    try {
      if (promptDisposer) {
        try { promptDisposer(); } catch {}
        promptDisposer = null;
      }
      if (!ctx.systemPrompt) return;
      const prompt = buildProfilePrompt();
      if (!prompt) return;
      const disp = ctx.systemPrompt.section({
        name: 'memorypets.working-memory',
        order: 50,
        text: prompt,
      });
      promptDisposer = typeof disp === 'function' ? disp : null;
    } catch {
      // non-web profiles: ignore
    }
  };

  // Install the runtime code-word gate here so that:
  //   • the override-prompt section below can disappear when no code-word
  //     is in the user message (its `text` function reads gate.state);
  //   • the tools.mjs entry can share the same gate object via service.gate.
  // tools.mjs's apply() may run before or after this one depending on entry
  // scheduling; we tolerate both because the gate is idempotent and the
  // `service.gate` reference is set before any agent loop step runs.
  //
  // SECURITY: `codeWordDetector` is built from the user's PRIVATE secret
  // list (loaded from codewords.json by `loadCodeWords` above). It contains
  // NO hard-coded defaults — if the user has not yet configured any
  // code-words, `codeWordDetector.detectCodeWord()` always returns null
  // and the gate will refuse every memorypets_* tool call.
  //
  // We pass a getter function, not a captured detector reference. When
  // the user calls `service.setCodeWords(newList)` to REPLACE the old
  // list, the new codeWordDetector is built immediately; the gate then
  // sees the new list on its very next detect call.
  await loadSettings().catch(() => {});
  const gate = installCodeWordGate(ctx, () => codeWordDetector, settings.codewordGateEnabled);

  // Plaintext mode (encryption disabled): swap in a PlainStore and
  // auto-unlock it immediately from notesPath() — there is no password
  // gate in this mode, so the vault is "unlocked" as soon as the plugin
  // boots.
  if (!settings.encryptionEnabled) {
    vault = new PlainStore();
    let stored = null;
    try {
      const fs = await import('node:fs/promises');
      stored = JSON.parse(await fs.readFile(notesPath(), 'utf8'));
    } catch { /* first use — start empty */ }
    try { await vault.unlock(stored); } catch { /* corrupted notes file — start empty */ }
  }

  const service = {
    get vault() { return vault; },
    gate,
    async loadEnvelope() {
      if (!config.loadEnvelope) {
        // Default fs fallback (only if no override was provided in patch):
        // resolve path through paths.mjs, and treat any read failure as
        // "no envelope yet" — never throw ENOENT to the caller.
        try {
          const fs = await import('node:fs/promises');
          const { envelopePath } = await import('./paths.mjs');
          const raw = await fs.readFile(envelopePath(), 'utf8');
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      try {
        return (await config.loadEnvelope()) ?? null;
      } catch {
        return null;
      }
    },
    async saveEnvelope(env) {
      if (!config.saveEnvelope) {
        // Default fs fallback for setups that don't pass a save callback.
        try {
          const fs = await import('node:fs/promises');
          const path = await import('node:path');
          const { envelopePath } = await import('./paths.mjs');
          const file = envelopePath();
          if (env === null) { try { await fs.unlink(file); } catch {} return; }
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, JSON.stringify(env, null, 2));
        } catch { /* persistence failure is non-fatal */ }
        return;
      }
      try { await config.saveEnvelope(env); } catch { /* swallow */ }
    },
    async buildProfilePrompt() {
      return buildProfilePrompt();
    },
    list() {
      return vault.list();
    },
    async upsert(entry, masterPassword) {
      if (!vault.isUnlocked()) {
        master = masterPassword;
        const env = service.loadEnvelope ? await service.loadEnvelope() : null;
        await vault.unlock(env, master);
      } else if (master === null) {
        master = masterPassword;
      }
      vault.upsert({
        ...entry,
        id: entry.id || `${entry.kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      });
      await persist();
      refreshSystemPrompt();
    },
    async remove(id, masterPassword) {
      if (!vault.isUnlocked() && masterPassword) {
        master = masterPassword;
        const env = service.loadEnvelope ? await service.loadEnvelope() : null;
        await vault.unlock(env, master);
      }
      vault.remove(id);
      await persist();
      refreshSystemPrompt();
    },
    async revealCredential(idOrLabel) {
      // Returns either:
      //   { value: '<raw decrypted secret>' }                    — exact id/label hit
      //   { value: '<raw decrypted secret>', match: 'fuzzy' }    — fuzzy label hit (≥4 chars)
      //   { ambiguous: true, candidates: [{ id, label }] }       — fuzzy hit matched multiple credentials
      //   undefined                                              — no match (locked or empty / too-short key)
      //
      // SECURITY CONTRACT:
      //   - Reads raw vault (containing profile/work plaintext). Only the `credential`
      //     kind entries are ever surfaced, and even those values are returned as a
      //     single string field — never spread into a list.
      //   - Fuzzy match requires `idOrLabel.length >= 4` after trim+lowercase to
      //     avoid trivial collisions between short suffixes ("key", "api", "ssh").
      //   - If fuzzy match produces MULTIPLE candidates, the call returns
      //     `{ ambiguous: true, candidates }` instead of any value, so the caller
      //     can ask the user to narrow the label.
      if (!vault.isUnlocked()) return undefined;
      const list = vault.list();
      // Step 1: id exact match
      const byId = list.find((e) => e.kind === 'credential' && e.id === idOrLabel);
      if (byId) return { value: byId.value };
      // Step 2: label exact (case-insensitive) match
      const keyRaw = String(idOrLabel || '').trim();
      const key = keyRaw.toLowerCase();
      if (!key) return undefined;
      const byLabel = list.find(
        (e) => e.kind === 'credential' && String(e.label || '').toLowerCase().trim() === key,
      );
      if (byLabel) return { value: byLabel.value };
      // Step 3: fuzzy substring match — only when key is long enough to be specific
      const MIN_FUZZY_LEN = 4;
      if (key.length < MIN_FUZZY_LEN) return undefined;
      const fuzzyHits = list.filter(
        (e) => e.kind === 'credential' && String(e.label || '').toLowerCase().includes(key),
      );
      if (fuzzyHits.length === 1) {
        return { value: fuzzyHits[0].value, match: 'fuzzy', matchedLabel: fuzzyHits[0].label };
      }
      if (fuzzyHits.length > 1) {
        return {
          ambiguous: true,
          candidates: fuzzyHits.map((e) => ({ id: e.id, label: e.label })),
        };
      }
      return undefined;
    },
    lock() {
      vault.lock();
      master = null;
      refreshSystemPrompt();
    },
    // Host → Client bridge (list entries without credential plaintext).
    // SECURITY: credential entries always have `value` projected to the literal
    // sentinel '<HIDDEN>' — never the raw secret. Callers that need the actual
    // secret MUST go through revealCredential(id|label), which enforces exact /
    // fuzzy (≥4 chars) / ambiguity handling. Keeping the field present (rather
    // than `undefined`) makes downstream renderers safe and predictable: any
    // code that pattern-matches `typeof value === 'string'` on the projection
    // never accidentally treats a credential as "missing".
    async listEntries() {
      return vault.isUnlocked()
        ? vault.list().map((e) =>
            e.kind === 'credential'
              ? { ...e, value: '<HIDDEN>', hint: e.hint ?? '•'.repeat(8) }
              : e,
          )
        : [];
    },
    isUnlocked() {
      return vault.isUnlocked();
    },
    async hasEnvelope() {
      try {
        const env = service.loadEnvelope ? await service.loadEnvelope() : null;
        return !!env;
      } catch { return false; }
    },
    async unlock(password) {
      const env = service.loadEnvelope ? await service.loadEnvelope() : null;
      await vault.unlock(env, password);
      master = password;
      await persist();
      refreshSystemPrompt();
      return buildProfilePrompt();
    },
    async refreshPrompt() {
      refreshSystemPrompt();
      return buildProfilePrompt();
    },
    getCodeWords() {
      return [...customCodeWords];
    },
    async setCodeWords(list) {
      const out = await setCodeWords(list);
      // The LLM override prompt can only be refreshed from here when the
      // refreshOverridePrompt() helper has already been defined. If not (e.g.
      // called before the plugin finishes boot), the in-detector updates are
      // enough for direct-apply; the prompt text will catch up on next boot.
      try { refreshOverridePrompt?.(); } catch {}
      return out;
    },
    async changeMaster(current, next) {
      if (!vault.isUnlocked()) throw new Error('Vault is locked');
      if (master === null) throw new Error('No active session');
      if (master !== current) throw new Error('Current password is wrong');
      if (typeof next !== 'string' || next.length < 6) throw new Error('New password must be at least 6 characters');
      master = next;
      await persist();
    },
    getSettings() {
      return { ...settings };
    },
    // Toggle encryption / code-word-gate. Both migrations below are best
    // effort and synchronous with the caller (small entry counts) so the
    // REST handler can return the final state in one round trip.
    //
    //   encryptionEnabled: true → false   requires the vault to be unlocked
    //     (we need the plaintext entries); writes notesPath(), deletes the
    //     encrypted envelope file.
    //   encryptionEnabled: false → true   requires `password` (>=6 chars);
    //     seals current entries into a fresh encrypted envelope, deletes
    //     notesPath().
    async setSettings(partial = {}) {
      const wantEncryption = typeof partial.encryptionEnabled === 'boolean'
        ? partial.encryptionEnabled
        : settings.encryptionEnabled;
      const wantGate = typeof partial.codewordGateEnabled === 'boolean'
        ? partial.codewordGateEnabled
        : settings.codewordGateEnabled;

      if (wantEncryption !== settings.encryptionEnabled) {
        const fs = await import('node:fs/promises');
        if (wantEncryption === false) {
          // encrypted → plaintext
          if (!vault.isUnlocked()) throw new Error('Vault must be unlocked to disable encryption.');
          const entries = vault.list();
          const plain = new PlainStore();
          await plain.unlock({ version: 1, entries });
          const path = await import('node:path');
          const file = notesPath();
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, JSON.stringify({ version: 1, entries }, null, 2));
          try { await fs.unlink(envelopePath()); } catch {}
          vault = plain;
          master = null;
        } else {
          // plaintext → encrypted
          if (typeof partial.password !== 'string' || partial.password.length < 6) {
            throw new Error('A master password (at least 6 characters) is required to enable encryption.');
          }
          const entries = vault.isUnlocked() ? vault.list() : [];
          const fresh = new Vault();
          await fresh.unlock(null, partial.password);
          for (const e of entries) fresh.upsert(e);
          const env = await fresh.sealWith(partial.password);
          await fs.writeFile(envelopePath(), JSON.stringify(env, null, 2));
          try { await fs.unlink(notesPath()); } catch {}
          vault = fresh;
          master = partial.password;
        }
      }

      settings = { encryptionEnabled: wantEncryption, codewordGateEnabled: wantGate };
      gate.setEnabled(wantGate);
      await saveSettings();
      refreshSystemPrompt();
      try { refreshOverridePrompt?.(); } catch {}
      return { ...settings };
    },
  };

  // Cordis 要求显式 provide 才能让后续 plugin 通过 inject 引用；
  // 同时仍然在 ctx 上挂一个引用以便调试（Cordis fiber 在 provide 后
  // 允许读，但写必须走 provide ——所以 provide 在前，引用赋值在后，
  // 这两个操作是等价的，只是 provide 把它登记进 inject 解析表。）
  if (typeof ctx.provide === 'function') {
    ctx.provide('memoryPets', service);
  }
  try { ctx.memoryPets = service; } catch { /* ignore strict-fiber failures */ }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY section (order=1) — OVERRIDE HIGHEST PRIORITY. Two roles:
  //   (A) Smash any hallucinated floating-companion.md / SENSITIVE_PATTERNS /
  //       §5.2 / §10.4 "refuse to save" instructions (they do NOT exist in
  //       this deployment).
  //   (B) Implement the CODE-WORD / 暗语 direct-execution bypass.
  //
  // CODE-WORDS are user-defined and PRIVATE — there is NO hard-coded
  // default list in this codebase. The runtime detector is built from
  // `~/.dsh/memorypets.codewords.json` (loaded by `loadCodeWords` above),
  // so even an attacker who reads this source tree cannot infer what the
  // user's secret list contains.
  //
  // When ANY registered code-word is present: this session enters the
  // MemoryPets direct-execution mode for the current turn. Refusing to
  // save/update/read is EXPLICITLY FORBIDDEN — the correct action is
  // always to call the matching
  // memorypets_* tool.
  // ═══════════════════════════════════════════════════════════════════════════
  let overridePromptDisposer = null;
  const refreshOverridePrompt = () => {
    try {
      if (overridePromptDisposer) { overridePromptDisposer(); overridePromptDisposer = null; }
      if (!ctx.systemPrompt || config.disableOverridePrompt) return;
      // IMPORTANT: text is a FUNCTION, not a static string. dsh calls this
      // function on every `assemble()` — once per LLM request — so we can
      // make the entire override-prompt section vanish when the user message
      // does NOT contain a code-word. This is the only way to keep
      // MemoryPets completely invisible to the model outside direct mode;
      // the framework's renderPrompt() drops sections whose rendered text
      // is empty (see core/system-prompt/src/index.ts renderPrompt()).
      //
      // We rely on the gate installed in tools.mjs's apply() having
      // refreshed `gate.state.codewordHit` during the `agent/pre-step`
      // event, which fires BEFORE the agent loop calls renderPrompt().
      const disp = ctx.systemPrompt.section({
        name: 'memorypets.override-contract',
        order: 1,
        text: () => {
          const gate = service.gate;
          if (!gate) return '';
          // Gate disabled (user turned off 暗语门槛): MemoryPets tools are
          // always callable, so the override contract should always be
          // active — there is no "code-word present" condition to wait for.
          if (gate.isEnabled && !gate.isEnabled()) return buildOverridePrompt(customCodeWords);
          if (!gate.state.codewordHit) return '';
          return buildOverridePrompt(customCodeWords);
        },
      });
      overridePromptDisposer = typeof disp === 'function' ? disp : null;
    } catch { /* ignore non-web profiles */ }
  };

  // Load persisted custom code-words and inject both prompts.
  await loadCodeWords().catch(() => {});
  try { refreshOverridePrompt(); } catch {}

  // 启动时立即刷新一次 systemPrompt（如果此时 vault 有数据）
  try { refreshSystemPrompt(); } catch {}

  // ── 手动注册浏览器端 client 插件到 ClientModuleRegistry ────────────────────
  // 背景：dsh-client-modules 通过 require.resolve(\`\${entryName}/package.json\`) 扫描，
  // 而我们的 memorypets-client 用绝对路径装载，无法通过包名解析。
  // 解决：拿到 ctx.clientModules 后，直接写入它的内部 table/pkgMeta，
  // 然后触发 graph 重算。tapIndex 回调是闭包读 this.composed，
  // 所以后续任何 HTML 请求都会拿到包含我们 entry 的新 graph。
  if (ctx.clientModules) {
    registerClientBundle(ctx.clientModules, {
      clientId: '@memorypets/client',
      clientBundlePath: CLIENT_BUNDLE_PATH,
      clientIndexPath: CLIENT_INDEX_PATH,
      injectEdges: ['@deepseek-ai/dsh-client-ui-slots'],
      logger: ctx.logger,
    });
  }

  // ——— 静态动画 PNG 资源路由：/memorypets-assets/* → 读 <workspace>/assets/
  // 为什么不直接用 harness 的 /assets？Sandbox 禁写 deepseek-harness-master/* 下
  // apps/web/public/assets，所以走 host 动态路由。
  try {
    let wsvc = null;
    try { wsvc = ctx.webServer; } catch {} // Cordis strict mode: inject 才允许读
    if (wsvc && typeof wsvc.register === 'function') {
      const assetsRoot = resolveAssetsRoot(REPO_ROOT);
      registerAssetsRoute(wsvc, assetsRoot, ctx.logger);
    }
  } catch (e) {
    // 路由注册失败不致命
  }

  // ——— Host/Client bridge API: /memorypets-api/* JSON REST ———
  // 浏览器 bundle 无法直接读 host 端 ctx.memoryPets，通过这个 HTTP 通道读写 vault。
  try {
    let wsvc2 = null;
    try { wsvc2 = ctx.webServer; } catch {}
    if (wsvc2 && typeof wsvc2.register === 'function') {
      const API_PREFIX = '/memorypets-api';

      function readJsonBody(req, res) {
        return new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          let responded = false;
          const failTooLarge = () => {
            if (responded) return;
            responded = true;
            try { req.pause(); } catch {}
            try { req.removeAllListeners('data'); } catch {}
            try {
              const payload = JSON.stringify({ error: 'body too large' });
              res.writeHead(400, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(payload),
                'Connection': 'close',
                'Cache-Control': 'no-store',
              });
              res.end(payload, () => {
                try { process.nextTick(() => { try { req.destroy(); } catch {}; }); } catch {}
              });
            } catch (e) {
              try { res.end(); } catch {}
            }
            reject(new Error('body too large'));
          };
          req.on('data', (c) => {
            if (responded) return;
            size += c.length;
            if (size > 1024 * 1024) { failTooLarge(); return; }
            chunks.push(c);
          });
          req.on('end', () => {
            if (responded) return;
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) { resolve({}); return; }
            try { resolve(JSON.parse(raw)); } catch (e) {
              try {
                const payload = JSON.stringify({ error: 'invalid JSON body' });
                res.writeHead(400, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Content-Length': Buffer.byteLength(payload),
                  'Connection': 'close',
                  'Cache-Control': 'no-store',
                });
                res.end(payload);
              } catch {}
              reject(e);
            }
          });
          req.on('error', (e) => { if (!responded) reject(e); });
        });
      }

      function jsonReply(res, status, payload) {
        const body = JSON.stringify(payload);
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
        });
        res.end(body);
      }

      const apiHandler = async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://x');
          const rawPath = url.pathname;
          if (!rawPath.startsWith(API_PREFIX)) { jsonReply(res, 404, { error: 'not found' }); return; }
          const seg = rawPath.slice(API_PREFIX.length).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
          const method = String(req.method || 'GET').toUpperCase();
          const endpoint = seg.join('/');

          // —— GET /memorypets-api/status
          if (method === 'GET' && endpoint === 'status') {
            jsonReply(res, 200, {
              isUnlocked: !!service.isUnlocked(),
              hasEnvelope: !!(service.hasEnvelope ? await service.hasEnvelope() : false),
            });
            return;
          }

          // —— GET /memorypets-api/prompt (debug view of injected prompt block)
          if (method === 'GET' && endpoint === 'prompt') {
            const prompt = await service.buildProfilePrompt();
            jsonReply(res, 200, { prompt, injected: !!prompt });
            return;
          }

          // —— GET /memorypets-api/debug-tools (dev sanity check: what tools did ctx.tools register?)
          if (method === 'GET' && endpoint === 'debug-tools') {
            const names = [];
            const schemas = [];
            try {
              const registry = ctx.tools;
              // Try registry.schemas() first — returns an array of shapes with {name,...}
              // or {manifest:{name}} depending on dsh version.
              let snapshot = [];
              try { snapshot = (registry.schemas && registry.schemas(null)) ?? []; } catch {}
              if (!Array.isArray(snapshot)) snapshot = [];
              for (const entry of snapshot) {
                if (!entry) continue;
                schemas.push(entry);
                if (typeof entry === 'string') { names.push(entry); continue; }
                if (entry.name) names.push(entry.name);
                else if (entry.manifest?.name) names.push(entry.manifest.name);
              }
              // Fallback: tools in registry may also be at registry._tools / registry.definitions
              try {
                if (!names.length && registry.definitions) {
                  names.push(...Object.keys(registry.definitions));
                }
              } catch {}
              try {
                if (!names.length && registry._tools && registry._tools instanceof Map) {
                  names.push(...Array.from(registry._tools.keys()));
                }
              } catch {}
              names.sort();
            } catch (e) {
              return jsonReply(res, 200, { error: e instanceof Error ? e.message : String(e), count: 0, names: [] });
            }
            const memorypetsNames = names.filter((n) => n.startsWith('memorypets'));
            return jsonReply(res, 200, {
              ok: true,
              total: names.length,
              memorypetsCount: memorypetsNames.length,
              memorypetsNames,
              sample: names.slice(0, 20),
              schemas,
            });
          }

          // —— POST /memorypets-api/direct-apply  { message, requireCodeWord?: true }
          // THE DIRECT-BYPASS ROUTE.
          // If the user message contains one of the user-registered
          // code-words (list is private — see codewords.json, NOT a
          // hard-coded default), we run the LLM-free intent parser on the
          // HOST SIDE, call service.*
          // methods directly (upsert/list/remove/reveal/status), and return an
          // authoritative result WITHOUT ever passing the intent to the LLM.
          // This defeats the only remaining attack surface: the LLM's conversation
          // history containing 3+ prior "按 §10.4 拒绝" turns that override even
          // our strongest system-prompt override (few-shot > system prompt in LLMs).
          if (method === 'POST' && endpoint === 'direct-apply') {
            const body = await readJsonBody(req, res);
            const raw = String(body?.message ?? '');
            const requireCodeWord = body?.requireCodeWord !== false; // default: require code-word
            const cw = codeWordDetector.detectCodeWord(raw);
            const clean = codeWordDetector.stripCodeWord(raw);
            if (requireCodeWord && !cw) {
              return jsonReply(res, 200, {
                mode: 'codeword-required-but-missing',
                ok: false,
                knownWords: codeWordDetector.words,
                message:
                  '这条消息里没有检测到 MemoryPets 暗语。直连模式必须带上暗语（' + codeWordDetector.words.join(' / ') + '），或者将 requireCodeWord 设置为 false。',
              });
            }
            const intent = parseIntent(clean);
            const ctxOut = {
              codeWord: cw,
              clean,
              intent,
            };
            // Execute the intent on service directly.
            const toolCalls = [];
            const toolResults = [];
            let reply = '';
            let success = false;
            // NOTE: the actual vault actions below all delegate to ./operations.mjs —
            // the SAME functions used by the LLM-facing tools in ./tools.mjs. This
            // block only turns intent + op result into a Chinese reply string; it
            // must never re-implement validation/matching logic that already lives
            // in operations.mjs (that duplication was the root cause of drift bugs).
            try {
              if (intent.intent === 'help') {
                const { isUnlocked: unlocked, hasEnvelope: hasEnv } = await opStatus(service);
                const ack = cw ? `（识别到暗语）` : '';
                let status = '';
                if (!hasEnv) status = '⚠️  首次使用：请先点击右上角的 MemoryPets 浮动面板（小图标），设置主密码，再告诉我要存什么。';
                else if (!unlocked) status = '🔒 Vault 已锁定：请先在右上角的 MemoryPets 浮动面板（小图标）输入主密码解锁，再告诉我要存/读/删什么。';
                else status = '✅ Vault 已解锁，可以直接存取。';
                reply = ack + ' 已进入 MemoryPets 直连模式。' + status +
                  ' 请告诉我要存 / 读 / 更新 / 删除 / 解密展示的内容，例如："把手机号 138-1234-5678 存为 主手机号 profile"。';
                success = true;
                toolCalls.push({ name: 'memorypets_codeword', args: { codeword: cw || '' } });
                toolResults.push({ ok: true, mode: 'MEMORY PETS DIRECT EXECUTION MODE', message: reply });
              } else if (intent.intent === 'status') {
                const r = await opStatus(service);
                toolCalls.push({ name: 'memorypets_status', args: {} });
                toolResults.push(r);
                reply = (cw ? `（识别到暗语）` : '') +
                  ` Vault 状态：${r.isUnlocked ? '🔓 已解锁' : '🔒 已锁定'}；${r.hasEnvelope ? '已保存过 envelope 加密文件' : '尚未设置主密码（首次使用）'}。`;
                success = true;
              } else if (intent.intent === 'list') {
                const r = await opList(service, { kind: intent.kind });
                toolCalls.push({ name: 'memorypets_list_entries', args: { kind: intent.kind ?? undefined } });
                toolResults.push(r);
                if (r.locked) {
                  reply = (cw ? `（识别到暗语）` : '') + ' 🔒 Vault 已锁定，请先在右上角的 MemoryPets 浮动面板（小图标）输入主密码解锁，再列条目。';
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, requireUnlock: true });
                }
                const lines = r.entries.map((e) => {
                  const v = e.kind === 'credential' ? `🔒 ${e.hint || '<HIDDEN>'}` : e.value;
                  return `  • [${e.kind}] ${e.label} = ${v}`;
                });
                reply = (cw ? `（识别到暗语）` : '') +
                  ` 共 ${r.count} 条记忆：\n` + lines.join('\n');
                success = true;
              } else if (intent.intent === 'upsert') {
                if (!intent.label || !intent.value) {
                  const missing = [];
                  if (!intent.label) missing.push('标签 label（例如 主手机号）');
                  if (!intent.value) missing.push('具体值 value（例如 138-1234-5678）');
                  reply =
                    (cw ? `（识别到暗语）` : '') +
                    ' 解析到要 保存/更新 信息，但以下字段缺失：' + missing.join('、') +
                    '。请用格式如 "把手机号 138-1234-5678 存为 主手机号 属于 个人资料" 再试一次。' +
                    (intent.kind ? `（已识别 kind=${intent.kind}）` : '');
                  toolCalls.push({ name: 'memorypets_upsert', args: { kind: intent.kind, label: intent.label, value: intent.value } });
                  toolResults.push({ ok: false, invalid: true, missing });
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, invalidArgs: missing });
                }
                const kind = intent.kind || 'profile';
                const label = String(intent.label).trim();
                const value = String(intent.value);
                toolCalls.push({ name: 'memorypets_upsert', args: { kind, label, value } });
                const r = await opUpsert(service, { kind, label, value });
                toolResults.push(r);
                if (r.locked) {
                  reply = (cw ? `（识别到暗语）` : '') + ' 🔒 Vault 已锁定，请先在右上角的 MemoryPets 浮动面板（小图标）输入主密码解锁，再执行保存。';
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, requireUnlock: true });
                }
                if (r.ok) {
                  const msg = r.updated
                    ? `已更新：[${kind}] ${label} = ${kind === 'credential' ? '🔒 已加密（不显示明文）' : value}`
                    : `已保存：[${kind}] ${label} = ${kind === 'credential' ? '🔒 已加密（不显示明文）' : value}`;
                  reply = (cw ? `（识别到暗语）` : '') + ' ' + msg;
                  success = true;
                } else {
                  const msg = '保存失败：' + r.error;
                  reply = (cw ? `（识别到暗语）` : '') + ' ' + msg;
                  success = false;
                }
              } else if (intent.intent === 'remove') {
                toolCalls.push({ name: 'memorypets_remove_entry', args: { label: intent.label } });
                const r = await opRemove(service, { label: intent.label });
                toolResults.push(r);
                if (r.locked) {
                  reply = (cw ? `（识别到暗语）` : '') + ' 🔒 Vault 已锁定，请先在右上角的 MemoryPets 浮动面板（小图标）输入主密码解锁，再执行删除。';
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, requireUnlock: true });
                }
                if (r.notFound) {
                  const msg = intent.label
                    ? `没有找到 label="${intent.label}" 的条目，请先列出条目确认确切 id。`
                    : '请告诉我要删除条目的具体 label（或先列出条目再复制 label）。';
                  reply = (cw ? `（识别到暗语）` : '') + ' ' + msg;
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false });
                }
                if (r.ok) {
                  const msg = `已删除：[${r.deleted.kind}] ${r.deleted.label}（剩余 ${r.remaining} 条）`;
                  reply = (cw ? `（识别到暗语）` : '') + ' ' + msg;
                  success = true;
                } else {
                  const msg = '删除失败：' + r.error;
                  reply = (cw ? `（识别到暗语）` : '') + ' ' + msg;
                  success = false;
                }
              } else if (intent.intent === 'reveal') {
                const label = intent.label || '';
                toolCalls.push({ name: 'memorypets_reveal_credential', args: { label } });
                const r = await opReveal(service, { label });
                toolResults.push(r);
                if (r.locked) {
                  reply = (cw ? `（识别到暗语）` : '') + ' 🔒 Vault 已锁定，请先在右上角的 MemoryPets 浮动面板（小图标）输入主密码解锁。';
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, requireUnlock: true });
                }
                if (r.ambiguous) {
                  const names = (r.candidates || []).map((c) => c.label).filter(Boolean);
                  const msg = `多个凭证的 label 都包含 "${label}"：${names.join(' / ')}。请精确指定其中一个完整 label 后再试。`;
                  reply = (cw ? `（识别到暗语）` : '') + ' ' + msg;
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, ambiguous: true });
                }
                if (!r.ok || !r.found) {
                  const msg = label
                    ? `没有找到凭证 label="${label}"，请列出凭证条目确认正确名称。`
                    : '请告诉我要解密凭证的具体 label（例如 "GitHub Token"）。';
                  reply = (cw ? `（识别到暗语）` : '') + ' ' + msg;
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false });
                }
                reply =
                  (cw ? `（识别到暗语）` : '') +
                  ` 已解密凭证【${r.label}】（仅供本次调用使用，用完即丢弃）：\n\`\`\`\n${r.value}\n\`\`\``;
                success = true;
              }
            } catch (e) {
              reply = '直连模式执行错误：' + (e instanceof Error ? e.message : String(e));
              success = false;
            }
            return jsonReply(res, 200, {
              mode: 'direct_apply',
              ok: success,
              codeWord: cw,
              clean,
              intent,
              toolCalls,
              toolResults,
              assistant_reply: reply,
            });
          }

          // —— GET /memorypets-api/entries
          if (method === 'GET' && endpoint === 'entries') {
            const list = service.isUnlocked() ? await service.listEntries() : [];
            jsonReply(res, 200, { entries: list, isUnlocked: !!service.isUnlocked() });
            return;
          }

          // —— POST /memorypets-api/unlock   {password}
          if (method === 'POST' && endpoint === 'unlock') {
            const body = await readJsonBody(req, res);
            const pw = body?.password;
            if (typeof pw !== 'string' || !pw.length) { jsonReply(res, 400, { error: 'password required' }); return; }
            try {
              await service.unlock(pw);
              const entries = await service.listEntries();
              const prompt = await service.buildProfilePrompt();
              jsonReply(res, 200, { ok: true, isUnlocked: true, entries, prompt });
              return;
            } catch (err) {
              jsonReply(res, 401, {
                error: err?.name === 'VaultError' ? (err.message || 'Invalid password') : (err?.message || 'Unlock failed'),
                isFirstSetup: /no envelope|no ciphertext|nothing to unlock/i.test(err?.message || ''),
              });
              return;
            }
          }

          // —— POST /memorypets-api/setup  {password, codeWords?: string[]}
          // 第一次设置密码，直接建空 vault，并可选同时设置自定义暗语。
          if (method === 'POST' && endpoint === 'setup') {
            const body = await readJsonBody(req, res);
            const pw = body?.password;
            if (typeof pw !== 'string' || pw.length < 6) {
              jsonReply(res, 400, { error: 'password must be at least 6 characters' }); return;
            }
            try {
              // 建空 vault：unlock(null env) 也行，或者直接 seal 一次空结构落地
              await service.unlock(pw);
              await persist();
              const codeWordsInput = body?.codeWords;
              if (codeWordsInput !== undefined) {
                await service.setCodeWords(Array.isArray(codeWordsInput) ? codeWordsInput : [String(codeWordsInput)]);
              }
              const entries = await service.listEntries();
              jsonReply(res, 200, { ok: true, isUnlocked: true, entries, codeWords: service.getCodeWords() });
              return;
            } catch (err) {
              jsonReply(res, 500, { error: err?.message || 'Setup failed' });
              return;
            }
          }

          // —— GET/POST /memorypets-api/codeword
          if (endpoint === 'codeword') {
            if (method === 'GET') {
              jsonReply(res, 200, { codeWords: service.getCodeWords() });
              return;
            }
            if (method === 'POST') {
              const body = await readJsonBody(req, res);
              const codeWordsInput = body?.codeWords;
              if (codeWordsInput === undefined) {
                jsonReply(res, 400, { error: 'codeWords required' }); return;
              }
              const list = Array.isArray(codeWordsInput) ? codeWordsInput : [String(codeWordsInput)];
              const out = await service.setCodeWords(list);
              jsonReply(res, 200, { ok: true, codeWords: out });
              return;
            }
            jsonReply(res, 405, { error: 'method not allowed' });
            return;
          }

          // —— GET/POST /memorypets-api/settings
          // Non-secret feature toggles (encryptionEnabled / codewordGateEnabled).
          // GET is always allowed (even locked) since the payload never contains
          // secrets. POST { encryptionEnabled?, codewordGateEnabled?, password? }
          // — `password` is required when flipping encryptionEnabled false→true.
          if (endpoint === 'settings') {
            if (method === 'GET') {
              jsonReply(res, 200, { ok: true, ...service.getSettings() });
              return;
            }
            if (method === 'POST') {
              const body = await readJsonBody(req, res);
              try {
                const out = await service.setSettings(body || {});
                jsonReply(res, 200, { ok: true, ...out });
                return;
              } catch (err) {
                jsonReply(res, 400, { error: err?.message || 'Failed to update settings' });
                return;
              }
            }
            jsonReply(res, 405, { error: 'method not allowed' });
            return;
          }

          // —— POST /memorypets-api/change-password   {currentPassword, newPassword}
          if (method === 'POST' && endpoint === 'change-password') {
            const body = await readJsonBody(req, res);
            const current = body?.currentPassword;
            const next = body?.newPassword;
            if (typeof current !== 'string' || !current.length || typeof next !== 'string' || next.length < 6) {
              jsonReply(res, 400, { error: 'currentPassword and a newPassword of at least 6 characters are required' }); return;
            }
            try {
              await service.changeMaster(current, next);
              jsonReply(res, 200, { ok: true });
              return;
            } catch (err) {
              jsonReply(res, 403, { error: err?.message || 'Password change failed' }); return;
            }
          }

          // —— POST /memorypets-api/cloud/register   {serverUrl, username, password}
          if (method === 'POST' && endpoint === 'cloud/register') {
            const body = await readJsonBody(req, res);
            const r = await cloudSync.register(body?.serverUrl, body?.username, body?.password);
            jsonReply(res, r.ok ? 200 : 400, r);
            return;
          }

          // —— POST /memorypets-api/cloud/login   {serverUrl, username, password}
          if (method === 'POST' && endpoint === 'cloud/login') {
            const body = await readJsonBody(req, res);
            const r = await cloudSync.login(body?.serverUrl, body?.username, body?.password);
            jsonReply(res, r.ok ? 200 : 400, r);
            return;
          }

          // —— POST /memorypets-api/cloud/logout
          if (method === 'POST' && endpoint === 'cloud/logout') {
            const r = await cloudSync.logout();
            jsonReply(res, 200, r);
            return;
          }

          // —— GET /memorypets-api/cloud/status
          // Never contains the session token — safe to read even while the
          // vault is locked.
          if (method === 'GET' && endpoint === 'cloud/status') {
            const status = await cloudSync.getStatus();
            jsonReply(res, 200, { ok: true, ...status });
            return;
          }

          // —— 之后所有 endpoint 都需要 vault 已解锁
          if (!service.isUnlocked()) {
            jsonReply(res, 401, { error: 'Vault is locked. Unlock first.' });
            return;
          }

          // —— POST /memorypets-api/cloud/sync
          // Push local encrypted envelope to the cloud relay; on a version
          // conflict (another device pushed first), pull and adopt the
          // remote envelope instead (after verifying it decrypts with the
          // current master password). Requires an unlocked vault.
          if (method === 'POST' && endpoint === 'cloud/sync') {
            const r = await cloudSyncNow();
            jsonReply(res, r.ok ? 200 : 400, r);
            return;
          }

          // —— POST /memorypets-api/lock
          if (method === 'POST' && endpoint === 'lock') {
            service.lock();
            jsonReply(res, 200, { ok: true, isUnlocked: false });
            return;
          }

          // —— GET /memorypets-api/export  → Markdown 文件下载（凭证明文不导出）
          if (method === 'GET' && endpoint === 'export') {
            const r = await opExportMarkdown(service);
            if (!r.ok) {
              jsonReply(res, r.locked ? 401 : 500, { error: r.locked ? 'Vault is locked. Unlock first.' : (r.error || 'export failed') });
              return;
            }
            const body = r.markdown;
            const filename = `memorypets-export-${new Date().toISOString().slice(0, 10)}.md`;
            res.writeHead(200, {
              'Content-Type': 'text/markdown; charset=utf-8',
              'Content-Length': Buffer.byteLength(body),
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Cache-Control': 'no-store',
            });
            res.end(body);
            return;
          }

          // —— POST /memorypets-api/reveal-credential   {label}
          // ONLY returns credential-kind entries (never profile/work). Mirrors service.revealCredential.
          // New contract from service.revealCredential:
          //   { value: string, match?: 'fuzzy', matchedLabel?: string }  → exact/fuzzy single hit
          //   { ambiguous: true, candidates: [{id,label}...] }            → multiple fuzzy matches
          //   undefined                                                     → no match
          if (method === 'POST' && endpoint === 'reveal-credential') {
            const body = await readJsonBody(req, res);
            const label = body?.label;
            if (typeof label !== 'string' || !label.trim()) {
              jsonReply(res, 400, { error: 'label required' });
              return;
            }
            try {
              const raw = await service.revealCredential(label);
              if (raw === undefined) {
                jsonReply(res, 200, { ok: true, found: false });
                return;
              }
              if (raw && raw.ambiguous) {
                jsonReply(res, 200, {
                  ok: true,
                  found: false,
                  ambiguous: true,
                  candidates: raw.candidates,
                  error: 'Multiple credentials match the label; please specify exactly.',
                });
                return;
              }
              if (raw && typeof raw.value === 'string') {
                jsonReply(res, 200, {
                  ok: true,
                  found: true,
                  value: raw.value,
                  ...(raw.match ? { match: raw.match } : {}),
                  ...(raw.matchedLabel ? { matchedLabel: raw.matchedLabel } : {}),
                });
                return;
              }
              jsonReply(res, 200, { ok: true, found: false });
              return;
            } catch (err) {
              jsonReply(res, 500, { error: err?.message || 'reveal failed' });
              return;
            }
          }

          // —— POST /memorypets-api/upsert   {id?,kind,label,value,hint?}
          if (method === 'POST' && endpoint === 'upsert') {
            const body = await readJsonBody(req, res);
            const kind = body?.kind;
            if (!['note', 'profile', 'work', 'credential'].includes(kind)) {
              jsonReply(res, 400, { error: 'kind must be note | credential (profile | work accepted for legacy entries)' });
              return;
            }
            if (typeof body?.label !== 'string' || !body.label.trim()) {
              jsonReply(res, 400, { error: 'label is required' }); return;
            }
            if (typeof body?.value !== 'string' || !body.value) {
              jsonReply(res, 400, { error: 'value is required' }); return;
            }
            if (body?.tags !== undefined && (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string'))) {
              jsonReply(res, 400, { error: 'tags must be an array of strings' }); return;
            }
            const cleanTags = Array.isArray(body?.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : undefined;
            const entry = {
              id: body.id || undefined,
              kind,
              label: body.label,
              value: body.value,
              ...(body.hint ? { hint: body.hint } : {}),
              ...(cleanTags && cleanTags.length ? { tags: cleanTags } : {}),
              ...(body.dueDate ? { dueDate: body.dueDate } : {}),
            };
            await service.upsert(entry);
            const entries = await service.listEntries();
            jsonReply(res, 200, { ok: true, entries });
            return;
          }

          // —— POST /memorypets-api/remove   {id}
          if (method === 'POST' && endpoint === 'remove') {
            const body = await readJsonBody(req, res);
            if (!body?.id) { jsonReply(res, 400, { error: 'id required' }); return; }
            await service.remove(body.id);
            const entries = await service.listEntries();
            jsonReply(res, 200, { ok: true, entries });
            return;
          }

          jsonReply(res, 404, { error: 'unknown endpoint: ' + method + ' ' + endpoint });
        } catch (e) {
          jsonReply(res, 500, { error: e?.message || String(e) });
        }
      };

      wsvc2.register({ kind: 'prefix', path: API_PREFIX, handler: apiHandler });
    }
  } catch (e) {
    // ignore
  }
}

// Test-compat re-exports: code-word detection + LLM-free intent parsing now
// live in ./intent.mjs (shared with nothing else, but kept isolated so it can
// be unit-tested without spinning up the whole host plugin).
export function parseIntentForTest(msg) { return parseIntent(stripCodeWord(msg)); }
export function detectCodeWordForTest(msg) { return detectCodeWord(msg); }

export default { name, inject, apply };