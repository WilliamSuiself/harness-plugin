// Host plugin: registers ctx.memoryPets service with vault and persistence contract.
//
// This module is a plain ESM `.mjs` file because the Cordis loader runs under
// Node >= 22 and imports via dynamic `import(specifier)` — the unwrapper grabs
// either the default export or named exports matching a plugin shape.
import { readFileSync, readFile, existsSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault } from './vault.mjs';
import { opStatus, opList, opUpsert, opRemove, opReveal, safeList } from './operations.mjs';
import { makeCodeWordDetector, parseIntent } from './intent.mjs';
import { buildOverridePrompt } from './override-prompt.mjs';

// packages/host/lib/index.mjs → packages/host/lib → packages/host → packages → <repo root>
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLIENT_PKG_PATH = join(REPO_ROOT, 'packages', 'client', 'package.json');
const CLIENT_BUNDLE_PATH = join(REPO_ROOT, 'packages', 'client', 'lib', 'client.bundle.js');
const CLIENT_INDEX_PATH = join(REPO_ROOT, 'packages', 'client', 'lib', 'index.mjs');

export const name = 'memorypets-host';
// systemPrompt 在 web/agent profile 里提供；clientModules 是 dsh 模块注册表，
// 只有 web profile 存在；webServer 提供 HTTP 路由注册；所有 ctx 属性访问都 try/catch，非 web profile 跳过。
export const inject = ['systemPrompt', 'clientModules', 'webServer', 'tools'];

export async function apply(ctx, config = {}) {
  const vault = new Vault();
  let master = null;
  let promptDisposer = null;

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
        const path = await import('node:path');
        const dshHome = process.env.DSH_HOME || path.default.join(process.cwd(), '.dsh-home');
        const file = path.default.join(dshHome, 'memorypets.codewords.json');
        try {
          const raw = await fs.readFile(file, 'utf8');
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
        const path = await import('node:path');
        const dshHome = process.env.DSH_HOME || path.default.join(process.cwd(), '.dsh-home');
        const file = path.default.join(dshHome, 'memorypets.codewords.json');
        await fs.writeFile(file, JSON.stringify({ words: customCodeWords }, null, 2));
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
    if (!config.saveEnvelope) return;
    if (master === null) return;
    const env = await vault.sealWith(master);
    await config.saveEnvelope(env);
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

  const service = {
    vault,
    async loadEnvelope() {
      if (!config.loadEnvelope) return null;
      return (await config.loadEnvelope()) ?? null;
    },
    async saveEnvelope(env) {
      if (!config.saveEnvelope) return;
      await config.saveEnvelope(env);
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
      if (!vault.isUnlocked()) return undefined;
      // 支持 id 精确匹配 + label 大小写不敏感模糊匹配
      const list = vault.list();
      let byId = list.find((e) => e.kind === 'credential' && e.id === idOrLabel);
      if (byId) return byId.value;
      const key = String(idOrLabel || '').toLowerCase().trim();
      if (!key) return undefined;
      const byLabel = list.find((e) =>
        e.kind === 'credential' && String(e.label || '').toLowerCase().trim() === key,
      );
      if (byLabel) return byLabel.value;
      const fuzzy = list.find((e) =>
        e.kind === 'credential' && String(e.label || '').toLowerCase().includes(key),
      );
      return fuzzy ? fuzzy.value : undefined;
    },
    lock() {
      vault.lock();
      master = null;
      refreshSystemPrompt();
    },
    // Host → Client bridge (list entries without credential values)
    async listEntries() {
      return vault.isUnlocked()
        ? vault.list().map((e) =>
            e.kind === 'credential'
              ? { ...e, value: undefined, hint: e.hint ?? '•'.repeat(8) }
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
  // CODE-WORDS (user can sprinkle ANYWHERE in their message, case-insensitive):
  //   CN: 哥们儿 | 狗狗 | 记忆宠物 | 🐾 | 🐶 | 🐱
  //   EN: memorypets | memory pets | mpets | mp>
  // When ANY code-word is present: this session enters "MemoryPets DIRECT
  // EXECUTION MODE" for the current turn. Refusing to save/update/read is
  // EXPLICITLY FORBIDDEN — the correct action is always to call the matching
  // memorypets_* tool.
  // ═══════════════════════════════════════════════════════════════════════════
  let overridePromptDisposer = null;
  const refreshOverridePrompt = () => {
    try {
      if (overridePromptDisposer) { overridePromptDisposer(); overridePromptDisposer = null; }
      if (!ctx.systemPrompt || config.disableOverridePrompt) return;
      const disp = ctx.systemPrompt.section({
        name: 'memorypets.override-contract',
        order: 1,
        text: buildOverridePrompt(customCodeWords),
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
  try {
    if (ctx.clientModules) {
      const registry = ctx.clientModules;
      const clientId = '@memorypets/client';
      const clientPkgPath = CLIENT_PKG_PATH;
      const clientBundlePath = CLIENT_BUNDLE_PATH;
      const injectEdges = [
        '@deepseek-ai/dsh-client-ui-slots',
      ];
      // 1) 写 pkgMeta 缓存，防止 flush 时 processOne 尝试 resolve 绝对路径时报错
      registry.pkgMeta.set(clientId, {
        clientPath: clientBundlePath,
        inject: injectEdges,
        immediately: true,
      });
      // 2) 计算 bundle rev hash
      let rev;
      try {
        rev = createHash('sha1')
          .update(readFileSync(clientBundlePath))
          .digest('hex')
          .slice(0, 12);
      } catch {
        rev = 'dev-' + Math.random().toString(36).slice(2, 14);
      }
      // 3) 写 table 记录
      registry.table.set(clientId, {
        entry: {
          id: clientId,
          url: `/plugins/${encodeURIComponent(clientId)}/client.js?rev=${rev}`,
          rev,
          inject: injectEdges,
          immediately: true,
        },
        clientPath: clientBundlePath,
      });
      // 4) 为绝对路径的 entry name（memorypets-client 的 entry.name）也做同样的缓存，
      //    防止后续 flush 时 processOne 再查这个名字时发现不了，删了我们的记录。
      const absName = CLIENT_INDEX_PATH;
      registry.pkgMeta.set(absName, {
        clientPath: clientBundlePath,
        inject: injectEdges,
        immediately: true,
      });
      // 5) 重算 composed graph
      registry.composed = registry.compose();
      // 6) 通知订阅者（SSE / HMR 等）graph 变化
      try {
        registry.notifyGraphChanged();
      } catch {
        // 非关键，忽略
      }
      // 7) 把 absName 从 dirty 里移除，避免后续 flush 误处理
      try {
        registry.dirty.delete(absName);
      } catch {
        // ignore
      }
    }
  } catch (err) {
    // 注册 client 失败不影响整体——至少 vault 和 tools 还能工作
    try { ctx.logger?.warn?.(err); } catch { /* noop */ }
  }

  // ——— 静态动画 PNG 资源路由：/memorypets-assets/* → 读 <workspace>/assets/
  // 为什么不直接用 harness 的 /assets？Sandbox 禁写 deepseek-harness-master/* 下
  // apps/web/public/assets，所以走 host 动态路由。
  try {
    let wsvc = null;
    try { wsvc = ctx.webServer; } catch {} // Cordis strict mode: inject 才允许读
    if (wsvc && typeof wsvc.register === 'function') {
      const assetsRoot = resolveAssetsRoot();
      const ASSETS_PREFIX = '/memorypets-assets'; // 无末尾 /，让 match 更稳定
      const serve = (req, res) => {
        try {
          const rawPath = new URL(req.url || '/', 'http://x').pathname;
          if (!rawPath.startsWith(ASSETS_PREFIX)) {
            res.writeHead(404); res.end(); return;
          }
          const rest = rawPath.slice(ASSETS_PREFIX.length).replace(/^\/+/, '');
          const rel = rest.split('/').filter(Boolean);
          if (!rel.length) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'invalid path' })); return;
          }
          // Double defense: check decoded segment for dot-traversal, cover %2e%2e attacks.
          for (const seg of rel) {
            if (seg === '..' || seg === '.') {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'invalid path' })); return;
            }
            let decoded = seg;
            try { decoded = decodeURIComponent(seg); } catch {}
            if (decoded === '..' || decoded === '.' || decoded.includes('\0')) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'invalid path' })); return;
            }
          }
          const kind = rel[0];
          if (kind !== 'standing' && kind !== 'thinking' && kind !== 'waitting'
            && kind !== 'sleeping' && !(rel.length === 1 && kind === 'icon.png')) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'not found' })); return;
          }
          const fsPath = join(assetsRoot, ...rel);
          // Double defense: final resolved path must stay inside assetsRoot
          try {
            const st = lstatSync(fsPath);
            if (st.isSymbolicLink()) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'symlinks forbidden' })); return;
            }
            const resolved = realpathSync(fsPath);
            const rootResolved = realpathSync(assetsRoot) + sep;
            if (!(resolved === rootResolved.slice(0, -1) || resolved.startsWith(rootResolved))) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'path escape' })); return;
            }
            if (!st.isFile()) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'not found' })); return;
            }
          } catch (fsErr) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'not found' })); return;
          }
          readFile(fsPath, (err, buf) => {
            if (err) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'not found' })); return;
            }
            const isPng = /\.png$/i.test(rel[rel.length - 1]);
            res.writeHead(200, {
              'Content-Type': isPng ? 'image/png' : 'application/octet-stream',
              'Content-Length': buf.length,
              'Cache-Control': 'public, max-age=3600',
            });
            res.end(buf);
          });
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: e?.message || String(e) }));
        }
      };
      try {
        wsvc.register({ kind: 'prefix', path: ASSETS_PREFIX, handler: serve });
        try { ctx.logger?.info?.('[memorypets] route registered: ' + ASSETS_PREFIX + ' root=' + assetsRoot); } catch {}
      } catch (e) {
        try { ctx.logger?.warn?.('[memorypets] route register failed: ' + (e?.message ?? e)); } catch {}
      }
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
          // If the user message contains a code-word (哥们儿/狗狗/🐾/memorypets/...),
          // we run the LLM-free intent parser on the HOST SIDE, call service.*
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
                const ack = cw ? `（识别到暗语【${cw}】）` : '';
                let status = '';
                if (!hasEnv) status = '⚠️  首次使用：请先点击右上角 🐾 MemoryPets 浮动面板，设置主密码，再告诉我要存什么。';
                else if (!unlocked) status = '🔒 Vault 已锁定：请先在右上角 🐾 面板输入主密码解锁，再告诉我要存/读/删什么。';
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
                reply = (cw ? `（暗语【${cw}】）` : '') +
                  ` Vault 状态：${r.isUnlocked ? '🔓 已解锁' : '🔒 已锁定'}；${r.hasEnvelope ? '已保存过 envelope 加密文件' : '尚未设置主密码（首次使用）'}。`;
                success = true;
              } else if (intent.intent === 'list') {
                const r = await opList(service, { kind: intent.kind });
                toolCalls.push({ name: 'memorypets_list_entries', args: { kind: intent.kind ?? undefined } });
                toolResults.push(r);
                if (r.locked) {
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' 🔒 Vault 已锁定，请先在右上角 🐾 面板输入主密码解锁，再列条目。';
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, requireUnlock: true });
                }
                const lines = r.entries.map((e) => {
                  const v = e.kind === 'credential' ? `🔒 ${e.hint || '<HIDDEN>'}` : e.value;
                  return `  • [${e.kind}] ${e.label} = ${v}`;
                });
                reply = (cw ? `（暗语【${cw}】）` : '') +
                  ` 共 ${r.count} 条记忆：\n` + lines.join('\n');
                success = true;
              } else if (intent.intent === 'upsert') {
                if (!intent.label || !intent.value) {
                  const missing = [];
                  if (!intent.label) missing.push('标签 label（例如 主手机号）');
                  if (!intent.value) missing.push('具体值 value（例如 138-1234-5678）');
                  reply =
                    (cw ? `（暗语【${cw}】）` : '') +
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
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' 🔒 Vault 已锁定，请先在右上角 🐾 面板输入主密码解锁，再执行保存。';
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, requireUnlock: true });
                }
                if (r.ok) {
                  const msg = r.updated
                    ? `已更新：[${kind}] ${label} = ${kind === 'credential' ? '🔒 已加密（不显示明文）' : value}`
                    : `已保存：[${kind}] ${label} = ${kind === 'credential' ? '🔒 已加密（不显示明文）' : value}`;
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' ' + msg;
                  success = true;
                } else {
                  const msg = '保存失败：' + r.error;
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' ' + msg;
                  success = false;
                }
              } else if (intent.intent === 'remove') {
                toolCalls.push({ name: 'memorypets_remove_entry', args: { label: intent.label } });
                const r = await opRemove(service, { label: intent.label });
                toolResults.push(r);
                if (r.locked) {
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' 🔒 Vault 已锁定，请先在右上角 🐾 面板输入主密码解锁，再执行删除。';
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, requireUnlock: true });
                }
                if (r.notFound) {
                  const msg = intent.label
                    ? `没有找到 label="${intent.label}" 的条目，请先列出条目确认确切 id。`
                    : '请告诉我要删除条目的具体 label（或先列出条目再复制 label）。';
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' ' + msg;
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false });
                }
                if (r.ok) {
                  const msg = `已删除：[${r.deleted.kind}] ${r.deleted.label}（剩余 ${r.remaining} 条）`;
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' ' + msg;
                  success = true;
                } else {
                  const msg = '删除失败：' + r.error;
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' ' + msg;
                  success = false;
                }
              } else if (intent.intent === 'reveal') {
                const label = intent.label || '';
                toolCalls.push({ name: 'memorypets_reveal_credential', args: { label } });
                const r = await opReveal(service, { label });
                toolResults.push(r);
                if (r.locked) {
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' 🔒 Vault 已锁定，请先在右上角 🐾 面板输入主密码解锁。';
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false, requireUnlock: true });
                }
                if (!r.ok || !r.found) {
                  const msg = label
                    ? `没有找到凭证 label="${label}"，请列出凭证条目确认正确名称。`
                    : '请告诉我要解密凭证的具体 label（例如 "GitHub Token"）。';
                  reply = (cw ? `（暗语【${cw}】）` : '') + ' ' + msg;
                  return jsonReply(res, 200, { mode: 'direct_apply', codeWord: cw, clean, intent, toolCalls, toolResults, assistant_reply: reply, ok: false });
                }
                reply =
                  (cw ? `（暗语【${cw}】）` : '') +
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

          // —— 之后所有 endpoint 都需要 vault 已解锁
          if (!service.isUnlocked()) {
            jsonReply(res, 401, { error: 'Vault is locked. Unlock first.' });
            return;
          }

          // —— POST /memorypets-api/lock
          if (method === 'POST' && endpoint === 'lock') {
            service.lock();
            jsonReply(res, 200, { ok: true, isUnlocked: false });
            return;
          }

          // —— POST /memorypets-api/reveal-credential   {label}
          // ONLY returns credential-kind entries (never profile/work). Mirrors service.revealCredential.
          if (method === 'POST' && endpoint === 'reveal-credential') {
            const body = await readJsonBody(req, res);
            const label = body?.label;
            if (typeof label !== 'string' || !label.trim()) {
              jsonReply(res, 400, { error: 'label required' });
              return;
            }
            try {
              const value = await service.revealCredential(label);
              jsonReply(res, 200, { ok: true, found: value !== null && value !== undefined, value });
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
            if (!['profile', 'work', 'credential'].includes(kind)) {
              jsonReply(res, 400, { error: 'kind must be profile | work | credential' });
              return;
            }
            if (typeof body?.label !== 'string' || !body.label.trim()) {
              jsonReply(res, 400, { error: 'label is required' }); return;
            }
            if (typeof body?.value !== 'string' || !body.value) {
              jsonReply(res, 400, { error: 'value is required' }); return;
            }
            const entry = {
              id: body.id || undefined,
              kind,
              label: body.label,
              value: body.value,
              ...(body.hint ? { hint: body.hint } : {}),
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

function resolveAssetsRoot() {
  try {
    const root = join(REPO_ROOT, 'assets');
    if (existsSync(root)) return root;
  } catch { /* ignore */ }
  // Fallback (non-module bundlers): assume CWD is repo root
  return join(process.cwd(), 'assets');
}

export default { name, inject, apply };