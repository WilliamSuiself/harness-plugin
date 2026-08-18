# MemoryPets

MemoryPets 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的浮动伴侣插件。它会在浏览器右下角显示一只可交互的宠物，并提供加密保险库（vault），用于保存用户的常用信息（姓名、电话、地址、雇主、GitHub 账号、API key 等）。保存后，插件会把非敏感条目注入到系统上下文中供 LLM 使用；敏感凭证则只有在解锁后才能通过显式工具揭示。

核心能力：

- 浮动宠物 UI：720×720 PNG 帧动画，支持 `standing / thinking / waiting / sleeping` 四种心情。
- 加密保险库：AES-GCM-256，PBKDF2-SHA-256 25 万次迭代派生。
- 自定义暗语：首次设置或运行时随时修改，LLM 与 direct-apply 都会识别。
- 暗语直达模式：消息中出现任意已配置暗语时，绕过 LLM 决策，由本地规则解析意图并立即执行。
- 六条 LLM 工具：握手、查状态、列条目、增改、删除、揭示凭证。

## 目录结构

```
harness-plugin/
├── packages/
│   ├── host/
│   │   ├── lib/                 # 编译后的 ESM 产物
│   │   │   ├── index.mjs        # Cordis 插件：ctx.memoryPets、HTTP 路由、direct-apply
│   │   │   ├── tools.mjs        # LLM 工具注册
│   │   │   ├── operations.mjs   # 公共保险库操作（单点事实源）
│   │   │   ├── intent.mjs       # 暗语检测 + 意图解析（中文关键词常量表）
│   │   │   ├── override-prompt.mjs # 高优先级 systemPrompt 覆盖文本
│   │   │   ├── crypto.mjs       # Web Crypto 原语
│   │   │   └── vault.mjs        # 加锁 / 解锁 / 快照
│   │   └── test/                # node:test 单元测试
│   └── client/
│       └── lib/
│           ├── index.mjs        # host 侧桩（用于 dsh-client-modules 扫描）
│           ├── client.mjs       # 浏览器源码（React.createElement，无 JSX）
│           └── client.bundle.js # ⚠️ 自动生成，不要手改（跑 pnpm build:client 重生）
├── assets/                      # 宠物 PNG 帧序列
├── scripts/
│   ├── build-client.mjs         # client.mjs → client.bundle.js 打包脚本
│   └── reset-vault.mjs          # 本地重置 envelope + codewords
├── CHANGELOG.md
└── README.md
```

## 前置要求

- Node.js >= 22.19.0
- pnpm 11.7.0+
- 一份可运行的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 源码（用于启动 `dsh web`）
- 本仓库路径，例如 `/path/to/harness-plugin`

## 安装步骤

1. 克隆本仓库到本地。
2. （可选）`pnpm install` 安装 dev 依赖（目前仓库零运行时依赖，可跳过）。
3. 把下文 `cordis.patch.yml` 中的 `/path/to/harness-plugin` 替换为你的实际路径。
4. 将以下配置写入 dsh 的 `web` profile patch（通常为 `~/.dsh/profiles/web/cordis.patch.yml`）。同时把端口固定到 3080（避免占用 dsh 默认端口）：

```yaml
# MemoryPets plugin patch layer for the web profile + port override.
#
# 把 /path/to/harness-plugin 替换为你的实际路径。
# webserver 节把端口固定到 3080；想换其它端口改 port 即可。

- name: webserver
  config:
    host: 127.0.0.1
    port: 3080

- insert:

```yaml
# MemoryPets plugin patch layer for the web profile.
#
# 把 /path/to/harness-plugin 替换为你的实际路径。
#
# 注意：以下四个回调里 resolve 出的"DSH home"目录**永远不会被写死在
# 任何绝对路径**。它们只读 `process.env.DSH_HOME`，否则用 `os.homedir() +
# '.dsh'`，以避免在 cwd 是第三方仓库时把该 cwd 的绝对路径泄露到错误
# 信息里。所有读都 try/catch 返回 null，所有写都 try/catch 静默忽略。

- insert:
    - id: memorypets-host
      name: /path/to/harness-plugin/packages/host/lib/index.mjs
      config:
        loadEnvelope: !!js |
          async () => {
            try {
              const fs = await import('node:fs/promises');
              const path = await import('node:path');
              const os  = await import('node:os');
              const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
              const file = path.join(dshHome, 'memorypets.envelope.json');
              return JSON.parse(await fs.readFile(file, 'utf8'));
            } catch { return null; }
          }
        saveEnvelope: !!js |
          async (env) => {
            try {
              const fs = await import('node:fs/promises');
              const path = await import('node:path');
              const os  = await import('node:os');
              const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
              const file = path.join(dshHome, 'memorypets.envelope.json');
              if (env === null) { try { await fs.unlink(file); } catch {} return; }
              await fs.mkdir(path.dirname(file), { recursive: true });
              await fs.writeFile(file, JSON.stringify(env, null, 2));
            } catch { /* persistence failure is non-fatal */ }
          }
        loadCodeWords: !!js |
          async () => {
            try {
              const fs = await import('node:fs/promises');
              const path = await import('node:path');
              const os  = await import('node:os');
              const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
              const file = path.join(dshHome, 'memorypets.codewords.json');
              const data = JSON.parse(await fs.readFile(file, 'utf8'));
              return Array.isArray(data.words) ? data.words : null;
            } catch { return null; }
          }
        saveCodeWords: !!js |
          async (words) => {
            try {
              const fs = await import('node:fs/promises');
              const path = await import('node:path');
              const os  = await import('node:os');
              const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
              const file = path.join(dshHome, 'memorypets.codewords.json');
              await fs.mkdir(path.dirname(file), { recursive: true });
              await fs.writeFile(file, JSON.stringify({ words: words || [] }, null, 2));
            } catch { /* persistence failure is non-fatal */ }
          }

    - id: memorypets-tools
      name: /path/to/harness-plugin/packages/host/lib/tools.mjs
      inject: ['memoryPets', 'tools']

    - id: memorypets-client
      name: /path/to/harness-plugin/packages/client/lib/index.mjs
```

> 上述 `loadEnvelope` / `saveEnvelope` / `loadCodeWords` / `saveCodeWords` 块复刻了 `packages/host/lib/paths.mjs` 中 `resolveDshHome()` 的解析规则（`process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')`）。所有读操作 try/catch 返回 `null`，所有写操作 try/catch 静默忽略，保证**任何文件 I/O 异常都不会被冒泡到 UI / LLM 工具层**。若想替换为 `dsh-settings-file` / SQLite / 远程 KV 等更安全持久化后端，覆盖这四个回调即可，无需修改 host 代码。
```

4. 进入 deepseek-harness 目录，确保 Node / pnpm 版本正确：

```bash
volta install node@22.19.0 pnpm@11.7.0
pnpm install --frozen-lockfile
```

> 启动顺序：先 deepseek-harness 安装依赖，再回到本仓库（如果想跑测试/单测）执行 `pnpm test`。

5. 启动 dsh web：

```bash
node apps/cli/lib/bin.js web
```

终端会输出访问地址（通常是 `http://localhost:3080`，如果你的 `webServer` config 指定了别的端口则跟着变）。打开浏览器访问，右下角即会出现 MemoryPets 宠物。

> 端口由 `webServer` 服务的 `config.port` 决定，默认值在 `apps/cli/config/...` 或 `apps/web/...` profile bundle 里。要改端口（比如改成3080 避开冲突），在 `~/.dsh/profiles/web/cordis.patch.yml` 里插入或覆盖：
>
> ```yaml
> - name: webserver
>   config:
>     host: 127.0.0.1
>     port: 3080
> ```
>
> 写在 patch 文件里是持久化的；命令行 `--port` 不是所有版本都支持。

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

### 重启 dsh web 让改动生效

改完任何 `packages/host/lib/*.mjs` 或 `packages/client/lib/*` 后，最稳的生效方式是**重启 dsh web + 浏览器硬刷新**：

```bash
pnpm restart-dsh            # 杀旧进程 + 在 foreground 启动 dsh web（默认 3080 端口）
# 等终端打出 http://localhost:3080，浏览器打开，硬刷新（Cmd/Ctrl + Shift + R）
```

`scripts/restart-dsh.sh` 通过环境变量支持自定义路径和"要清掉的端口"：

```bash
DSH_REPO=/path/to/deepseek-harness ./scripts/restart-dsh.sh
DSH_PORT=9000 ./scripts/restart-dsh.sh   # 杀进程时盯 9000（覆盖默认 3080）
DSH_PORT=0    ./scripts/restart-dsh.sh   # 跳过端口清理步骤
```

启动命令实际是 `node apps/cli/lib/bin.js web`（不带 `--port`）；真正监听的端口由 `~/.dsh/profiles/web/cordis.patch.yml` 里 `webServer.config.port` 决定（参见上文安装步骤）。

如果你想直接启动而不走 patch，CLI 可能支持 `--port` 但不是所有 dsh 版本都识别——推荐改 patch 文件。

### 重新打包客户端

仓库中的 `packages/client/lib/client.bundle.js` 是打包后的产物，由 `scripts/build-client.mjs` 从 `packages/client/lib/client.mjs` 自动生成。

- 改了 `client.mjs` 后跑 `pnpm build:client`（或 `node scripts/build-client.mjs`）。
- 脚本会做语法检查（`node --check`）并输出导出的名字清单。
- 在 CI 中可以用 `node scripts/build-client.mjs --check`，当 bundle 过期时以非零状态退出。
- **不要**直接手改 `client.bundle.js` —— 它会被下次 build 覆盖。

### 单元测试

```bash
pnpm test
```

跑 `packages/host/test/` 下的 `node --test` 单测。覆盖 `crypto`、`vault`、`operations`、`intent`、`codeword-detector`。零依赖，CI 直接可用。

### 重置保险库

```bash
pnpm reset-vault
```

删除 `<DSH_HOME>/memorypets.envelope.json` 和 `<DSH_HOME>/memorypets.codewords.json`，让下次 `dsh web` 启动时进入首次 setup 流程。不会触碰 dsh 自己的会话/profile/setting 文件。

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
- 暗语检测不区分大小写，按**子串**匹配（包含位置任意）。
- 查看 `~/.dsh/memorypets.codewords.json` 是否存在且 `words` 字段为数组。

## 版本与许可

- 版本：0.1.0
- 许可：见 [LICENSE](./LICENSE)