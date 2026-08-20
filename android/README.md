# MemoryPets Android 客户端工程骨架

> 本文档是本 `android/` 目录的**启动手册**。完整规格文档见仓库根目录下
> [`../docs/Android_Client_Spec.md`](../docs/Android_Client_Spec.md) 和
> [`../docs/MOBILE_SYNC_API.md`](../docs/MOBILE_SYNC_API.md)。

---

## 0. 技术栈（一句话）

**Kotlin 2.0 + Jetpack Compose（M3 Material You 动态色）+ Hilt DI + OkHttp/Retrofit +
Jetpack DataStore + WorkManager + AndroidX Biometric。加密用 JDK 标准 `javax.crypto`
（PBKDF2-HMAC-SHA256 250k 迭代 + AES-256-GCM），字节级对齐 DSH 端 `crypto.mjs`。**

依赖版本总表见 [`gradle/libs.versions.toml`](./gradle/libs.versions.toml)。

---

## 1. 工程模块（4 个 Gradle 模块）

```
android/
├── app/                 # Application 模块：Compose UI（5 屏）+ Hilt 入口 + Widget/Worker
├── core-model/          # 纯 Kotlin（无 Android 依赖）：Entry/Vault/Envelope/SyncOutcome
├── core-crypto/         # 纯 Kotlin：VaultCrypto（deriveKey/seal/unlock） — MVP M1 生死线
└── sync/                # Android Library：网络 + 本地 blob 存储 + 云同步编排
```

### 1.1 核心模块先跑通（MVP M1）

```bash
cd android
./gradlew :core-crypto:test --tests VaultCryptoKATTest
```

KAT 测试会打印 ciphertext base64，请**拿同样的 salt/iv/plaintext/iterations 去 DSH 端跑一遍，
把期望字符串粘回 `VaultCryptoKATTest.EXPECTED_CT_BASE64`**，两边完全一致再往下。

---

## 2. 打开工程

1. **Android Studio Iguana+ / Jellyfish**（AGP 8.4.2 需要）
2. `File > Open` → 选 **本仓库根目录下的 `android/`**（不要选到 harness-plugin 根目录！）
3. 等 Gradle sync 完成
4. AS 会自动建议下载缺失的 SDK / Gradle wrapper（8.9）—— 点确认
5. 连一台真机或模拟器（minSdk 26 = Android 8.0，targetSdk 34），Run app

第一次 Sync 慢（约 5-10 分钟），之后 incremental build < 10 秒。

### 2.1 Gradle Wrapper

仓库未提交 `gradlew`、`gradlew.bat`、`gradle/wrapper/gradle-wrapper.jar`
（因二进制体积 + 每次版本更新要重新提交）。
第一次打开前在 `android/` 目录里：

```bash
# macOS / Linux
gradle wrapper --gradle-version 8.9
# 或若系统没装 gradle，直接打开 Android Studio 它会帮你生成 wrapper
```

然后 AS 里 `File > Sync Project with Gradle Files` 即可。

---

## 3. 目录速查（和规格书一致）

```
app/src/main/java/com/memorypets/android/
├── App.kt                     # Application + @HiltAndroidApp
├── MainActivity.kt            # 入口 Activity + FLAG_SECURE（凭证页开启）
├── di/
│   ├── DIModules.kt           # NetworkModule / BindModule / AppModule（Hilt 单例）
│   └── AppInitializer.kt      # WorkManager 配置 + Timber 日志
├── presentation/
│   ├── root/
│   │   ├── MemoryPetsApp.kt       # NavHost：Setup↔Unlock→Home↔Editor↔Settings
│   │   └── RootViewModel.kt       # 启动起点判断 + 主题
│   ├── setup/SetupScreen.kt       # 首次启动：解锁密码 + 暗语 + （可选）云同步账号
│   ├── unlock/UnlockScreen.kt     # 密码/指纹解锁 + FLAG_SECURE
│   ├── home/HomeScreen.kt         # 笔记列表 + 搜索栏 + 暗语直达 + FAB + 同步按钮
│   ├── editor/EditorScreen.kt     # 新建/编辑：笔记 / 凭证 / 资料 / 工作 + 标签 / 到期日 / hint
│   └── settings/SettingsScreen.kt # 云同步 / 安全 / 暗语 / 通用 4 组设置
├── service/
│   ├── SyncWorker.kt          # WorkManager 15 分钟周期同步 + 网络恢复触发
│   └── PetWidgetProvider.kt   # 桌面宠物 Widget（MVP 占位）
└── ui/theme/
    ├── Theme.kt               # Material3 + 动态取色 + 深色模式
    └── Type.kt                # 字体
```

---

## 4. MVP 施工顺序

| 顺序 | 任务 | 对应里程碑 | 验证方式 |
|---|---|---|---|
| 1 | `core-crypto` 写 KAT 向量并与 DSH 端对齐 | M1 | `:core-crypto:test` 通过；`ciphertext == DSH 端输出` |
| 2 | `sync` 模块 + OkHttp MockWebServer 写 401/GET/PUT/409 单测 | M2 | `:sync:test` 通过；看日志 GET/PUT 与 Relay 完全一致 |
| 3 | `app` 的 NavHost、5 个空 Screen、Hilt 全部绑定跑通 | M3 | 真机点击按钮能在 5 屏间跳转不出 crash |
| 4 | `UnlockSession` 解锁会话单例 + 60s 自动上锁 | M4 | App 切后台 60s 后再打开必须重新输密码 |
| 5 | `HomeScreen` LazyColumn 真实数据（从解密后的 Vault）| M5 | 1000 条搜索 ≤ 200ms（中端机型骁龙 7 系）|
| 6 | `EditorScreen` 保存 → `blobStore.saveLocal` → `dirty=true` | M5 | 设置页显示 dirty，立即同步能推送到云端 v+1 |
| 7 | 设置页导出 Markdown（SAF Storage Access Framework）| M6 | 导出文件能用 Typora 正常打开 |
| 8 | 暗语直达 + ACTION_SEND 系统分享 | M7 | Chrome 分享 → MemoryPets 能创建一条 note |
| 9 | Widget + Biometric + SyncWorker 周期同步 | M8 | 桌面宠物正常；指纹解锁；飞行模式 15 分钟后上线能自动推送 |
| 10 | 真机 + DSH 插件跨端互通双向测试 | M9 | 同云账号 + 同主密码 → 双端条目 100% 一致 |

---

## 5. 安全红线（写代码前必看）

1. **明文绝对不能落地**：绝对不要在 `SharedPreferences / DataStore / Room / 日志 / 崩溃上报` 里写入任何 Entry.value / Entry.label / 解密后的 Vault JSON。`adb shell run-as com.memorypets.android ls -R files databases shared_prefs` 搜不到任何笔记字符串。
2. **两套密码永不互推**：解锁密码（主密码）只在内存里；云账号密码只在 Retrofit 调用栈里持有。绝对不要用其中一个派生另一个，也不要任何形式缓存。
3. **FLAG_SECURE 加在 UnlockScreen、EditorScreen（凭证编辑模式）、凭证详情页**。
4. **`android:allowBackup="false"`** 已在 AndroidManifest 里写死。发布前再检查一遍。
5. **切后台 60s / 锁屏 / 低内存回收** → 立即清空 `UnlockSession` 里的 `CharArray`（fill('\u0000')）；`SecretKey` 调 `destroy()`；VM StateFlow 全部重置为 Locked。

---

## 6. 下一步 TODO 清单（还没写的部分）

以下是骨架中的 `// TODO` 占位符，下一步开发按顺序实现：

- [ ] `UnlockSession.kt` 单例：内存中持有当前解锁的 `CharArray`（主密码）和已解密 `Vault` 对象，60s 自动清空（配合 `LifecycleObserver`）
- [ ] `Operations` UseCase 层（UpsertEntry / ListEntries / RemoveEntry / RevealCredential / ExportMarkdown）与 DSH 端 `operations.mjs` 完全对齐
- [ ] `IntentParser` + `CodewordGate`（与 DSH 端 `intent.mjs` + `codeword-gate.mjs` 语义对齐，含中文关键词表）
- [ ] `CloudSyncApi` 的 `register/login` 在 SetupScreen & SettingsScreen 里 UI 接入（错误码：400 username already registered / 401 invalid / 403 1010 Bot Fight）
- [ ] `VaultBlobStore.isDirty()` 当前实现有 `collect 永不返回` bug，需改成 `first()` 取一次值
- [ ] `EditorScreen` 的 Save 按钮：真正调用 UseCase → `VaultCrypto.seal()` → `blobStore.saveLocal()` → 标 dirty
- [ ] `HomeViewModel.syncNow()` 传真实 `masterPassword + buildLocalEnvelope` 给 SyncOrchestrator
- [ ] `R.drawable.*` / `mipmap` / `xml/pet_widget_info_4x1.xml` / `res/layout/widget_pet_4x1.xml` / `res/values` 资源文件
- [ ] ProGuard 规则（DataStore、Gson @SerializedName、Compose）
- [ ] 发布签名：`signing.properties` + Play App Signing 配置

---

## 7. 常见坑

1. **PBKDF2 字节序**：Node.js crypto.pbkdf2(password) 按 UTF-8 bytes；`javax.crypto PBEKeySpec(char[])` 按 UTF-16 代码单元。本项目 `VaultCrypto.deriveKey()` 先把 CharArray 转 UTF-8 bytes 再喂 ASCII chars 进 PBEKeySpec，保证字节级一致。**不要改这部分代码。**
2. **Cloudflare 403 1010**：命令行 curl / 测试脚本会被 Bot Fight Mode 拦；真机 App（带标准 Chrome/WebView 指纹）一般放行；若遇到直接把 Bot Fight 关了或配置 WAF 规则允许 `User-Agent: MemoryPets/*`。
3. **525 SSL handshake failed**：CF Full 模式 + Caddy `tls internal` 自签 ECDSA 证书可能 cipher 无公共集。解决方案：CF SSL → Flexible + 源站 Caddy 只监听 HTTP 80（浏览器→CF 仍是 HTTPS）。
4. **Retrofit baseUrl 运行时变化**：用户在 SettingsScreen 切服务器地址后必须重建 Retrofit 实例（当前骨架用 `dagger.Lazy<CloudSyncApi>`，再套一层 `ServerUrlHolder` 触发 rebuild）。

---

## 8. 发布前检查清单

- [ ] `core-crypto KAT` / `sync MockWebServer` / `app local unit test` 100% 绿
- [ ] `./gradlew assembleRelease` 成功，R8 无 warning，APK 体积 ≤ 15 MB
- [ ] 真机 → `adb shell run-as com.memorypets.android` 全文搜索所有能拿到的文件，**搜不到任何笔记文本**
- [ ] 跨端互通：真机 ↔ DSH 浏览器插件同云账号同主密码，双向同步 10 次无冲突丢失
- [ ] Autofill 开关默认关（v1.1 可选开启），Data Safety 表单在 Play Console 填完（零 PII + E2EE）

祝编码顺利 🐾
