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

> ⚠️ **🔴 致命坑 1：本仓库必须使用 Gradle 8.9，绝对不能用 Gradle 9.x！**
> Hilt 2.51.1 / AGP 8.5.x / Kotlin 2.0.0 最高只兼容 Gradle 8.x；
> Gradle 9.x 里 `Configuration.fileCollection(Spec)` API 已移除，会报：
> ```
> NoSuchMethodError: 'FileCollection Configuration.fileCollection(Spec)'
> ```
>
> ⚠️ **🟠 致命坑 2：如果你系统里 `brew install gradle` 过 Gradle 9.x，`gradle wrapper …` 这条命令本身就是用 Gradle 9.x 执行的！**
> 所以必须**先卸载系统 Gradle 9.x**，或者在 wrapper 生成时显式跳过系统 gradle，按下面的步骤严格执行。

本仓库的 Gradle 版本**写死在 `gradle/wrapper/gradle-wrapper.properties`** 里（已提交），`distributionUrl=https://services.gradle.org/distributions/gradle-8.9-bin.zip`。

**你需要做的（按顺序，任何一步错都会回到 Gradle 9.3）：**

```bash
# -----------------------------------------------------------------------------
# Step 0. 先清理所有脏缓存（刚才跑 Gradle 9.3 生成的脏东西）
# -----------------------------------------------------------------------------
cd android
rm -rf .gradle build ~/.gradle/caches/build-cache-*  \
        ~/.gradle/daemon/9.3 ~/.gradle/caches/9.3   \
        ~/.gradle/wrapper/dists/gradle-9.3*

# -----------------------------------------------------------------------------
# Step 1. 检查系统 gradle 版本：如果是 9.x，必须先卸载！
# -----------------------------------------------------------------------------
gradle --version 2>&1 | head -n 3
# 👉 如果显示 Gradle 9.x：
#    macOS Homebrew:  brew uninstall gradle
#    macOS MacPorts:  sudo port uninstall gradle
#    SDKMAN:          sdk uninstall gradle 9.3
#    Scoop:           scoop uninstall gradle
# 👉 如果显示 command not found — 这是最佳状态！说明 PATH 里没有 gradle，wrapper 不会被污染。

# -----------------------------------------------------------------------------
# Step 2. 生成 wrapper（只有 3 种方式，选其中任意一种）
# -----------------------------------------------------------------------------
#
# ⚪️ 方式 A（最推荐）：只用 Android Studio 生成 wrapper，完全绕过命令行
#   1. Android Studio → 打开 harness-plugin/android 目录
#   2. 右上角弹出 "Gradle JDK location is invalid" → 让它 Fix → 用 jbr（JDK 17）
#   3. Gradle Sync 失败后会弹出对话框 → 选 "Generate Gradle Wrapper / Upgrade Gradle"
#   4. 版本填 8.9，distribution-type 选 bin → OK
#
# 🟢 方式 B：用 Android Studio 自带的 jbr + 官方 gradle-wrapper.jar（无需系统 gradle）
#   1. 在 Android Studio 里打开本工程，确保 Gradle JDK 是
#      `/Applications/Android Studio.app/Contents/jbr/Contents/Home`
#   2. 顶部菜单 Tools → SDK Manager → SDK Tools → 打勾 "Android SDK Command-line Tools (latest)"
#   3. 新开 Terminal 面板（⚠️ 不是你本机 iTerm！是 Android Studio 底部的 Terminal）
#   4. 执行下面 2 行：
curl -sL -o /tmp/gradle-wrapper.jar \
    'https://raw.githubusercontent.com/gradle/gradle/v8.9.0/gradle/wrapper/gradle-wrapper.jar'
java -cp /tmp/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain --version
#   5. 这一步会自动生成 gradlew + gradlew.bat + gradle/wrapper/gradle-wrapper.jar
#
# 🔵 方式 C：如果你能安装 8.x gradle 覆盖 9.x（SDKMAN 推荐）
#   1. curl -s "https://get.sdkman.io" | bash  # 没装 SDKMAN 的话
#   2. source "$HOME/.sdkman/bin/sdkman-init.sh"
#   3. sdk install gradle 8.9 && sdk use gradle 8.9 && sdk default gradle 8.9
#   4. cd android && gradle wrapper --gradle-version 8.9 --distribution-type bin

# -----------------------------------------------------------------------------
# Step 3. 验证 —— 输出 "Gradle 8.9" 才对，其它数字都是错的
# -----------------------------------------------------------------------------
./gradlew --version 2>&1 | head -n 10
```

**以后任何 Gradle 命令都用 `./gradlew …`（带斜杠！），不要用 `gradle …`**。

---

> 💡 **Kotlin 2.0 Compose Compiler 强制要求**：
> 我们在 `app/build.gradle.kts` 里启用了 Kotlin 官方 **`org.jetbrains.kotlin.plugin.compose`** 插件（别名 `kotlin-compose`），
> 这是 Kotlin 2.0 启用 Compose 的唯一正确方式，老的 `composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }` 已在 Kotlin 2.0 里废弃。
> 如果看到：*"Starting in Kotlin 2.0, the Compose Compiler Gradle plugin is required when compose is enabled"*，
> 就是你用的模板文件太老了，重新 git pull 最新 `app/build.gradle.kts`。

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
