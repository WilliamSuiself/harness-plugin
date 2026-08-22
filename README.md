# MemoryPets · 云端多智能体共享笔记本 & 浮动伴侣

MemoryPets 是一个运行在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 平台之上的**多端、多智能体共享笔记本系统**，同时在浏览器右下角提供一只可交互的浮动宠物伴侣。

你可以像跟宠物说话一样，用**自然语言**或**自定义暗语**快速记下任何灵感、待办、资料；所有接入同一账号的智能体（AI Agent）与设备（浏览器插件 / Flutter 移动客户端，覆盖 Android 与 iOS）都能实时同步同一份笔记本内容，乐观并发控制保证多端同时编辑也不会丢失数据。

---

## 核心能力

- **🌐 云端多端同步**：部署一个 Relay 服务器（自带一键脚本 + Cloudflare/Caddy HTTPS），DSH 浏览器插件与 Flutter 移动客户端（Android / iOS）之间**实时双向同步**；采用乐观并发（expectedVersion + 409 conflict），多端同时编辑不丢。
- **🤝 多智能体共享知识**：所有挂在同一 Harness 实例上的 AI Agent 都能通过 6 个标准工具读写同一本共享笔记本——AI 查资料、贴上下文、写待办全部走同一套 API。
- **🐾 浮动宠物 UI**：720×720 PNG 帧动画，支持 `站立 / 思考 / 等待 / 睡觉` 四种心情；点宠物直接打开笔记本面板，或切换动画心情。
- **⚡ 暗语直达（Codeword Gate）**：消息中出现用户自定义暗语时，**绕过 LLM 决策**，本地规则解析意图并立即执行（例如 "记一下 明天下午3点开会 标签 工作" → 一秒写入）。
- **📝 三种条目类型**：
  - **笔记（note）**：灵感、待办、长段资料，支持标签、到期日
  - **资料（profile / work）**：与 AI 协作时常用的上下文资料，会注入到系统提示里让 Agent 随时可用
  - **凭证（credential）**：默认不注入上下文、不显示真实值，需显式解锁 + 调用 reveal 工具才会返回
- **🔐 端到端加密（底层实现）**：所有笔记在离开设备前就用 AES-GCM-256 + PBKDF2 25 万次迭代打包成加密信封；Relay 是**零知识的纯 blob 存储**——永远看不到主密码、永远看不到明文。
- **📱 Flutter 移动客户端**：`flutter/` 目录下已实现可运行的 Android/iOS/macOS/Web 等多平台客户端（Setup / Unlock / Home / Editor / Settings 五屏 + 云同步全流程），与 DSH 插件字节级兼容同一套加密协议。原 Kotlin/Jetpack Compose 方案（`android/` 目录）已**移除**。

---

## 目录结构

```
harness-plugin/
├── packages/
│   ├── host/                     # DSH Cordis 插件：同步逻辑 + 加密 + 工具注册
│   │   ├── lib/
│   │   │   ├── index.mjs         # 入口：ctx.memoryPets、HTTP 路由、direct-apply 回调
│   │   │   ├── cloud-sync.mjs    # 云同步核心：push / pull / 409 conflict / confirmVersion
│   │   │   ├── tools.mjs         # 6 个 LLM 工具注册
│   │   │   ├── operations.mjs    # 笔记本公共操作（列 / 增改 / 删 / 揭示 / 导出 Markdown）
│   │   │   ├── intent.mjs        # 暗语检测 + 意图解析（中文关键词常量表）
│   │   │   ├── codeword-gate.mjs # 暗语门槛拦截器（fail-closed，无暗语不走本地解析）
│   │   │   ├── override-prompt.mjs # 高优先级 systemPrompt 覆盖（注入资料条目给 LLM）
│   │   │   ├── crypto.mjs        # Web Crypto 原语：PBKDF2 + AES-GCM
│   │   │   ├── vault.mjs         # 笔记本信封：seal / unlock / 快照
│   │   │   ├── plain-store.mjs   # 关闭加密时的明文模式（方便调试）
│   │   │   └── paths.mjs         # 本地持久化路径解析（DSH_HOME 或 ~/.dsh）
│   │   └── test/                 # node:test 单元测试（零依赖，CI 直接跑）
│   ├── client/                   # 浏览器面板 UI（React.createElement，无 JSX）
│   │   └── lib/
│   │       ├── index.mjs         # host 侧桩（给 dsh-client-modules 扫描用）
│   │       ├── client.mjs        # UI 源码：宠物面板 + 笔记 CRUD + 云同步配置
│   │       └── client.bundle.js  # ⚠️ 自动生成，不要手改（pnpm build:client 重生）
│   └── cloud-sync/               # 🚀 Relay 服务器：零知识 blob 存储（已实现并可部署）
│       ├── bin/start.mjs         # systemd 启动入口
│       ├── README.md             # Relay 使用说明 + 协议细节
│       ├── test/                 # node:test 单元测试
│       └── lib/
│           ├── server.mjs        # createServer：/accounts/register|login + GET|PUT /vault
│           ├── auth.mjs          # 云账号 scrypt 散列 + session token 管理
│           └── store.mjs         # 磁盘持久化 vaults/<username>.json + CONFLICT 抛出点
├── flutter/                       # 📱 移动客户端（当前维护版本，Flutter，可编译运行）
│   └── lib/
│       ├── models/               # Entry / Vault / Envelope(KdfConfig) / SyncOutcome
│       ├── crypto/                # VaultCrypto：PBKDF2 + AES-GCM（cryptography 包，字节级对齐 host 端）
│       ├── storage/               # AppPrefs（SharedPreferences）+ VaultBlobStore（本地信封）
│       ├── api/                   # CloudSyncApi REST 客户端 + DTO
│       ├── sync/                  # SyncOrchestrator：push / pull / 409 conflict 重试
│       ├── session/               # VaultSession：内存态已解密 Vault + 当前会话 CRUD
│       ├── screens/               # setup / unlock / home / editor / settings + 根导航
│       ├── theme/                 # Material 3 明暗主题
│       └── main.dart              # Provider 装配 + 入口
├── docs/
│   ├── MOBILE_SYNC_API.md        # 移动端对接协议：加密参数 + REST API（Flutter/iOS 必读）
│   └── Android_Client_Spec.md    # 早期安卓端规格文档（历史参考，已被 flutter/ 实现取代）
├── assets/                       # 宠物 PNG 帧序列（standing / thinking / waiting / sleeping）
├── scripts/
│   ├── build-client.mjs          # client.mjs → client.bundle.js（支持 --check 校验 CI）
│   ├── reset-vault.mjs           # 清空本地笔记本 & 暗语（回到首次 Setup）
│   ├── restart-dsh.sh            # 重启 dsh web（改完 host/client 代码后用）
│   └── deploy-cloud-sync.sh      # 🚀 一键部署 Relay：Caddy + Cloudflare HTTPS + systemd
├── cordis.patch.yml              # DSH profile 安装模板（替换 <INSTALL_DIR> 即可）
├── CHANGELOG.md
└── README.md
```

---

## 前置要求

- Node.js ≥ 22.19.0
- pnpm ≥ 11.7.0
- 一份可运行的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 源码（启动 `dsh web` 用）
- （可选）一台云服务器 + 域名：若要启用**云端多端同步**，参考 §部署云同步 Relay

---

## 安装步骤

1. 克隆本仓库到本地。
2. （可选）`pnpm install` 安装 dev 依赖（运行时零依赖，可跳过）。
3. 把下文示例 patch 中的 `/path/to/harness-plugin` 替换为你的实际路径。
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
# 4 个持久化回调解析规则：优先读 process.env.DSH_HOME，否则 ~/.dsh；
# 所有读 try/catch 返回 null，所有写 try/catch 静默忽略——任何文件 I/O
# 异常都不会冒泡到 UI / LLM 工具层。想换成 dsh-settings-file / SQLite /
# 远程 KV，覆盖这 4 个回调即可，无需修改 host 代码。

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

> 上述 4 个回调解析规则复刻了 `packages/host/lib/paths.mjs` 中 `resolveDshHome()` 的逻辑（`DSH_HOME ?? ~/.dsh`）。

4. 进入 deepseek-harness 目录安装依赖：

```bash
volta install node@22.19.0 pnpm@11.7.0
pnpm install --frozen-lockfile
```

5. 启动 dsh web：

```bash
node apps/cli/lib/bin.js web
```

终端会输出访问地址（默认 `http://localhost:3080`），打开浏览器右下角即出现浮动宠物。

> 想改端口？在 `~/.dsh/profiles/web/cordis.patch.yml` 里持久化修改：
> ```yaml
> - name: webserver
>   config: { host: 127.0.0.1, port: 3080 }
> ```

---

## 首次使用

1. 点击右下角的宠物，打开笔记本面板。
2. 第一次使用：设置**解锁密码**（≥ 6 位）和可选的**初始暗语**，点击 **Setup**。
3. 之后每次打开输入解锁密码并点 **Unlock** 即可进入。
4. 暗语可随时在面板中增删；多个用逗号、空格或中文逗号分隔。

> 解锁密码不会被持久化，只在当前会话期间存在于内存中。刷新页面或点击 **Lock** 后立即清空。
> 若启用**云同步**，会额外要求设置一组**云账号**（用户名 + 密码），仅用于登录 Relay 服务器，与解锁密码**互相独立、不可相互派生**。

---

## 日常使用

### 通过浮动面板管理

- **＋ 新条目**：选择类型（笔记 / 资料 / 凭证），填标题与内容，点 Add；可加标签、设置到期日。
- **🗑 删除**：点已有条目右侧的删除按钮。
- **🔒 上锁**：点 **Lock** 按钮立即上锁。
- **🐾 心情**：点宠物切换动画；默认自动模式随空闲 / 思考 / 等待 / 睡觉 四态切换。
- **☁️ Sync Now**：接入云同步后，点一下立即拉取 & 推送到 Relay；面板底部显示当前版本号与上次同步时间。

### 通过暗语直接执行（Direct Apply）

用户消息中出现任意已配置暗语时，插件**跳过 LLM 工具选择**，由 `packages/host/lib/intent.mjs` 本地解析意图并立即执行：

```
芝麻开门 列一下所有标签 工作 的条目
```

目前支持的意图：

| 中文关键词示例 | 映射动作 | 备注 |
|---|---|---|
| `列出 / 显示 / 看看 / 查一下` | `list` | 支持按标签、按到期日、按关键词筛选 |
| `保存 / 存成 / 添加 / 增加 / 记一下` | `upsert` | 格式：`暗语 标题 内容 标签 xxx 日期 YYYY-MM-DD` |
| `删除 / 移除 / 去掉` | `remove` | 按标题匹配 |
| `揭示 / 告诉我 / 显示…值` | `reveal` | 仅凭证条目可用，且必须已解锁 |
| 其它 / 帮助 | `help` | 显示支持的命令列表 |

### 多智能体工具接口（LLM Tool）

消息中**没有**暗语时，AI Agent 可通过 6 个标准工具访问共享笔记本：

| 工具名 | 作用 |
|---|---|
| `memorypets_codeword` | 握手 / 闲聊 / 确认插件已挂载 |
| `memorypets_status` | 查看上锁状态 / 版本号 / 是否已登录云同步 |
| `memorypets_list_entries` | 列出条目（凭证默认只显示 hint，不显示真实值） |
| `memorypets_upsert` | 创建或更新条目 |
| `memorypets_remove_entry` | 删除指定条目 |
| `memorypets_reveal_credential` | 返回某条凭证的真实值（必须已解锁 + 显式调用）|

---

## 🌐 部署云同步 Relay（多端共享必做）

Relay 是一台零知识的纯 blob 存储服务器，负责同步加密信封，**永远不接触明文，也不要求你信任服务器方**。

### 一键脚本

仓库自带 [`scripts/deploy-cloud-sync.sh`](scripts/deploy-cloud-sync.sh)，在阿里云 ECS / 腾讯云 CVM / Vultr 等任何 Debian/Ubuntu 机器上一行搞定：

```bash
# 方式 A：有 Cloudflare 托管域名（推荐，自带公信任 HTTPS）
MP_DOMAIN=sync.example.com  bash <(curl -sL https://raw.githubusercontent.com/WilliamSuiself/harness-plugin/main/scripts/deploy-cloud-sync.sh)

# 方式 B：只有 IP，没域名（Caddy 自签内网测试用）
bash <(curl -sL https://raw.githubusercontent.com/WilliamSuiself/harness-plugin/main/scripts/deploy-cloud-sync.sh)
```

脚本会自动安装 Node 22 + Caddy + systemd 服务 `memorypets-cloud-sync.service`（监听 `127.0.0.1:8787`），Caddy 反代 80/443。

手动部署的详细 REST API 与移动端对接协议见 [`docs/MOBILE_SYNC_API.md`](docs/MOBILE_SYNC_API.md)。

---

## 📱 移动客户端（Flutter）

`flutter/` 目录下是当前维护的移动客户端，基于 Flutter，可直接编译运行到 Android / iOS，与 DSH 插件遵循同一份 [`docs/MOBILE_SYNC_API.md`](docs/MOBILE_SYNC_API.md) 协议。

已实现：

- 与 DSH 插件 **字节级一致** 的加密协议（PBKDF2-HMAC-SHA256 250k 迭代 + AES-256-GCM，`cryptography` 包实现）
- Setup / Unlock / Home / Editor / Settings 五屏完整导航（Provider 状态管理）
- 云同步全流程：GET → 若远端更新则解密采用 → 带 `expectedVersion` 的 PUT → 409 冲突自动重试一次
- 笔记 / 凭证条目的真实增删改查（内存态 `Vault`，每次改动重新封装成信封持久化）
- 设置页：切换 Relay 服务器地址、云账号登出、暗语列表管理、深色模式

暂未实现（后续规划）：指纹解锁、FLAG_SECURE 等价的安全窗口、修改主密码、桌面 Widget、后台周期同步、Markdown 导出、Session Token 安全存储升级。详见 [`flutter/README.md`](flutter/README.md)。

```bash
cd flutter
flutter pub get
flutter run                 # 需要已连接的设备或模拟器
flutter build apk --debug   # 或 --release
```

> ℹ️ 原 Kotlin + Jetpack Compose 原型（`android/` 目录）已**移除**，其历史规格文档 [`docs/Android_Client_Spec.md`](docs/Android_Client_Spec.md) 仍保留作为加密实现的交叉参考。新功能与修复请一律在 `flutter/` 下进行。

---

## 开发与调试

### 重启 dsh web 让改动生效

改完任何 `packages/host/lib/*.mjs` 或 `packages/client/lib/*` 后，最稳的生效方式是**重启 dsh web + 浏览器硬刷新**：

```bash
pnpm restart-dsh
# 等终端打出 http://localhost:3080，浏览器硬刷新（Cmd/Ctrl + Shift + R）
```

自定义路径 / 端口：

```bash
DSH_REPO=/path/to/deepseek-harness ./scripts/restart-dsh.sh
DSH_PORT=9000 ./scripts/restart-dsh.sh   # 盯 9000 端口清理（默认 3080）
DSH_PORT=0    ./scripts/restart-dsh.sh   # 跳过端口清理
```

### 重新打包客户端 UI

`packages/client/lib/client.bundle.js` 是自动生成产物，改完 `client.mjs` 后：

```bash
pnpm build:client                 # 生成 bundle
node scripts/build-client.mjs --check  # CI 校验是否过期
```

### 单元测试

```bash
pnpm test
```

跑 `packages/host/test/` 下的 `node --test` 单测，覆盖 crypto / vault / operations / intent / codeword-detector。**零依赖，CI 直接可用。**

### 清空本地笔记本回到首次 Setup

```bash
pnpm reset-vault
```

删除 `~/.dsh/memorypets.envelope.json` 和 `memorypets.codewords.json`；不触碰 dsh 自己的会话 / profile / setting。

---

## 底层实现与加密说明（开发者参考）

> 以下是实现层面的细节。**普通用户只需要知道「端到端加密」即可，不需要理解。**

所有笔记本内容在离开当前设备前会被打包成加密信封（envelope）：

```json
{
  "version": 1,
  "kdf": { "salt": "<base64, 16 bytes>", "iterations": 250000, "keyLen": 256 },
  "ciphertext": "<base64>",
  "iv": "<base64, 12 bytes>"
}
```

- **KDF**：PBKDF2-HMAC-SHA-256，迭代次数以 envelope 内的 `kdf.iterations` 为准（默认 250,000），可在未来不破坏旧数据的前提下升级。
- **AEAD**：AES-256-GCM，12 字节随机 IV（**绝对不可复用 IV**），128-bit 认证标签拼在 ciphertext 尾部。
- **解锁密码 vs 云账号密码**：两套完全独立。解锁密码本地派生 AES 密钥；云账号密码仅用于 Relay 登录（服务器端用 scrypt 加盐散列，不存储明文）。
- **乐观并发**：`PUT /vault` 必须带 `expectedVersion`；有其它设备抢先写入时 Relay 返回 409 并附带 `current`（胜者版本），客户端重新拉取 → 解密 → 合并后用新 `expectedVersion` 再试一次。

移动端要 100% 对齐字节序才能互通。详情与已知答案测试向量（KAT）见 [`docs/MOBILE_SYNC_API.md`](docs/MOBILE_SYNC_API.md) 和参考实现：
[packages/host/lib/crypto.mjs](packages/host/lib/crypto.mjs) ·
[packages/host/lib/vault.mjs](packages/host/lib/vault.mjs) ·
[packages/host/lib/cloud-sync.mjs](packages/host/lib/cloud-sync.mjs)

---

## 常见问题

### dsh web 启动报 `Cannot find package '@deepseek-ai/...'`
请在 deepseek-harness 根目录执行 `pnpm install --frozen-lockfile`。

### pnpm 报 `This version of pnpm requires at least Node.js v22.13`
`volta install node@22.19.0`。

### 浏览器里看不到宠物？
- 检查 `~/.dsh/profiles/web/cordis.patch.yml` 是否写入了 3 个 loader 条目，且路径指向本仓库。
- 修改 patch 后需杀掉旧 `dsh web` 进程并重新启动。

### 暗语不生效？
- 确认面板里已保存暗语；检测不区分大小写，按**子串**匹配。
- 查看 `~/.dsh/memorypets.codewords.json` 是否存在且 `words` 字段为数组。

### Cloudflare 525 SSL handshake failed
Relay 走 Caddy `tls internal` 自签 + Cloudflare Full 模式会 cipher 不兼容，把 Cloudflare SSL 切到 **Flexible**，源站 Caddy 只监听 HTTP 80 反代 127.0.0.1:8787（浏览器 → CF 仍是 HTTPS 🔒）。详见脚本注释。

---

## 版本与许可

- 版本：0.1.0
- 许可：见 [LICENSE](./LICENSE)
