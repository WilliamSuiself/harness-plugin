# MemoryPets

MemoryPets 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的浮动伴侣插件。它会在浏览器右下角显示一只可交互的宠物，并提供加密保险库（vault），用于保存用户的常用信息（姓名、电话、地址、雇主、GitHub 账号、API key 等）。保存后，插件会把非敏感条目注入到系统上下文中供 LLM 使用；敏感凭证则只有在解锁后才能通过显式工具揭示。

核心能力：

- 浮动宠物 UI：720×720 PNG 帧动画，支持 `standing / thinking / waitting / sleeping` 四种心情。
- 加密保险库：AES-GCM-256，PBKDF2-SHA-256 25 万次迭代派生。
- 自定义暗语：首次设置或运行时随时修改，LLM 与 direct-apply 都会识别。
- 暗语直达模式：消息中出现任意已配置暗语时，绕过 LLM 决策，由本地规则解析意图并立即执行。
- 五条 LLM 工具：查状态、列条目、增改、删除、揭示凭证。

## 目录结构

```
harness-plugin/
├── packages/
│   ├── host/
│   │   └── lib/
│   │       ├── index.mjs        # Cordis 插件：ctx.memoryPets、HTTP 路由、direct-apply
│   │       ├── tools.mjs        # LLM 工具注册
│   │       ├── operations.mjs   # 公共保险库操作（单点事实源）
│   │       ├── intent.mjs       # 暗语检测 + 意图解析
│   │       ├── override-prompt.mjs # 高优先级 systemPrompt 覆盖文本
│   │       ├── crypto.mjs       # Web Crypto 原语
│   │       └── vault.mjs        # 加锁 / 解锁 / 快照
│   └── client/
│       └── lib/
│           ├── index.mjs        # host 侧桩（用于 dsh-client-modules 扫描）
│           ├── client.mjs       # 浏览器源码（React.createElement，无 JSX）
│           └── client.bundle.js # 浏览器打包产物
├── assets/                      # 宠物 PNG 帧序列
└── examples/
    └── cordis.yml               # 简化示例（仅供参考，本指南使用文件系统持久化）
```

> **Note:** 本仓库目前直接提供 `packages/*/lib/` 下编译好的 `.mjs` 产物，没有独立的 TypeScript `src/` 构建步骤。根目录 `package.json` 的 `build`/`typecheck`/`lint` 目前仍依赖各子包自己补齐 `scripts` 与 TS 源码。

## 前置要求

- Node.js >= 22.19.0
- pnpm 11.7.0+
- 一份可运行的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 源码（用于启动 `dsh web`）
- 本仓库路径，例如 `/path/to/harness-plugin`

## 安装步骤

1. 克隆本仓库到本地。
2. 把下文 `cordis.patch.yml` 中的 `/path/to/harness-plugin` 替换为你的实际路径。
3. 将以下配置写入 dsh 的 `web` profile patch（通常为 `~/.dsh/profiles/web/cordis.patch.yml`）：

```yaml
# MemoryPets plugin patch layer for the web profile.
#
# 把 /path/to/harness-plugin 替换为你的实际路径。

- insert:
    - id: memorypets-host
      name: /path/to/harness-plugin/packages/host/lib/index.mjs
      config:
        loadEnvelope: !!js |
          async () => {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const dshHome = process.env.DSH_HOME
              || path.join(process.cwd(), '.dsh-home');
            const file = path.join(dshHome, 'memorypets.envelope.json');
            try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
          }
        saveEnvelope: !!js |
          async (env) => {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const dshHome = process.env.DSH_HOME
              || path.join(process.cwd(), '.dsh-home');
            const file = path.join(dshHome, 'memorypets.envelope.json');
            if (env === null) return fs.unlink(file).catch(() => {});
            await fs.writeFile(file, JSON.stringify(env, null, 2));
          }
        loadCodeWords: !!js |
          async () => {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const dshHome = process.env.DSH_HOME
              || path.join(process.cwd(), '.dsh-home');
            const file = path.join(dshHome, 'memorypets.codewords.json');
            try {
              const data = JSON.parse(await fs.readFile(file, 'utf8'));
              return Array.isArray(data.words) ? data.words : null;
            } catch { return null; }
          }
        saveCodeWords: !!js |
          async (words) => {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const dshHome = process.env.DSH_HOME
              || path.join(process.cwd(), '.dsh-home');
            const file = path.join(dshHome, 'memorypets.codewords.json');
            await fs.writeFile(file, JSON.stringify({ words: words || [] }, null, 2));
          }

    - id: memorypets-tools
      name: /path/to/harness-plugin/packages/host/lib/tools.mjs
      inject: ['memoryPets', 'tools']

    - id: memorypets-client
      name: /path/to/harness-plugin/packages/client/lib/index.mjs
```

4. 进入 deepseek-harness 目录，确保 Node / pnpm 版本正确：

```bash
volta install node@22.19.0 pnpm@11.7.0
pnpm install --frozen-lockfile
```

5. 启动 dsh web：

```bash
node apps/cli/lib/bin.js web
```

终端会输出访问地址（通常是 `http://localhost:8787`）。打开浏览器访问，右下角即会出现 MemoryPets 宠物。

## 首次使用

1. 点击右下角的宠物，打开面板。
2. 如果是第一次使用，输入**主密码**（>= 6 位）和可选的**初始暗语**，点击 **Setup**。
3. 之后每次打开都输入主密码并点击 **Unlock** 解锁。
4. 暗语可在面板中随时增删；多个暗语用逗号、空格或中文逗号分隔。

> 主密码不会被持久化，只会在当前解锁会话期间存在于内存中。刷新页面上锁或点击 **Lock** 后会丢失。

## 日常使用

### 通过浮动面板管理

- **Add entry**：选择 `kind`（`profile` 普通信息 / `credential` 凭证），填写 `label` 和 `value`，点击 Add。
- **Remove**：点击已有条目右侧的删除按钮。
- **Lock**：点击 **Lock** 按钮立即上锁。
- **Mood**：点击宠物可切换动画；默认自动模式会根据系统空闲 / 思考状态在四种心情间切换。

### 通过暗语直接执行（Direct Apply）

当用户消息中包含任意已配置暗语时，插件会跳过 LLM 工具选择，由 `packages/host/lib/intent.mjs` 本地解析意图并立即执行。例如：

```
芝麻开门 列出所有条目
```

会返回所有保险库条目（凭证值隐藏）。

目前支持的意图词：

- `列出/显示/看看` → `list`
- `保存/存成/添加/增加` → `upsert`（需配合 `"标签" 内容` 格式）
- `删除/移除/去掉` → `remove`（需指定 label 或 quoted label）
- `揭示/显示.*值/告诉我.*` → `reveal`（需指定 label，且已解锁）
- 其它 → `help`

### LLM 工具

当消息中**没有**暗语时，插件通过 6 个工具与 LLM 交互：

- `memorypets_codeword`：握手 / 闲聊
- `memorypets_status`：查看保险库锁定状态
- `memorypets_list_entries`：列出所有条目（凭证值隐藏）
- `memorypets_upsert`：创建或更新条目
- `memorypets_remove_entry`：删除条目
- `memorypets_reveal_credential`：揭示指定凭证的值（必须已解锁）

## 安全模型

- **加密**：AES-GCM-256，PBKDF2-SHA-256 25 万次迭代 + 随机盐。
- **主密码**：不持久化，关闭页面或上锁后消失。
- **普通条目**：`profile` / `work` 等可以进入系统提示，供 LLM 使用。
- **凭证条目**：不会进入系统提示，只有通过 `memorypets_reveal_credential` 工具、在已解锁时才会返回真实值。
- **持久化**：保险库包络为 JSON `{ version, kdf, ciphertext, iv }`，通过 `loadEnvelope` / `saveEnvelope` 回调持久化。默认示例使用文件系统；生产环境可替换为 `dsh-settings-file` 等更安全的后端。

## 开发与调试

### 重新打包客户端

仓库中的 `packages/client/lib/client.bundle.js` 是打包后的产物，通常不需要重新生成。如果你修改了 `packages/client/lib/client.mjs`，需要先打包。打包逻辑是：

1. 移除源码顶部的 `import * as React from 'react';`（dsh 浏览器端会注入 React）。
2. 把所有 `export const / export function / export default` 改成 CommonJS 风格变量。
3. 用 `window.__ModuleLoader__.load({ id: '@memorypets/client', factory: ... })` 包裹。

一个可直接保存并运行的参考脚本见 `scripts/build-client.mjs`（若仓库中不存在，可参考 `/tmp/build_bundle.mjs` 自行创建）。

### 动画不刷新

如果宠物不动，请检查：

- `packages/client/lib/client.mjs` 中 `STATES.*.prefix` 是否为 `/memorypets-assets/...`。
- `packages/client/lib/client.bundle.js` 中是否也保持该前缀。
- 主机已在 `/memorypets-assets/:mood/:frame` 路由提供 `assets/` 目录下的 PNG。

修改后重新打包并硬刷新浏览器。

## 常见问题

### `dsh web` 启动报错 `Cannot find package '@deepseek-ai/...'`

确保已在 deepseek-harness 根目录执行 `pnpm install --frozen-lockfile`。

### `pnpm` 报 `This version of pnpm requires at least Node.js v22.13`

当前 Node 版本过低，执行 `volta install node@22.19.0`。

### 浏览器里看不到插件

- 检查 `~/.dsh/profiles/web/cordis.patch.yml` 是否包含上述 3 个 loader 条目。
- 确认 `name` 路径指向本仓库的实际位置。
- 修改 patch 后需杀掉旧 `dsh web` 进程并重新启动。

### 暗语不生效

- 确认浮动面板里已保存暗语。
- 暗语检测不区分大小写，按词边界匹配。
- 查看 `~/.dsh/memorypets.codewords.json` 是否存在且 `words` 字段为数组。

## 版本与许可

- 版本：0.1.0
- 许可：见 [LICENSE](./LICENSE)