# MemoryPets Android 客户端规格说明书 v1.0

> 本文档定义 MemoryPets 安卓端 App 的功能、架构、加密协议、安全模型、UI、测试计划。
> 所有加密**必须**与 [MOBILE_SYNC_API.md](file:///Users/suiyunhai/CascadeProjects/harness-plugin/docs/MOBILE_SYNC_API.md) 和参考实现
> [crypto.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/crypto.mjs) /
> [vault.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/vault.mjs) **字节级一致**，
> 确保浏览器插件创建的 Vault 可在安卓端解密，反之亦然。

---

## 0. 核心原则（设计边界，不妥协）

- **零信任云同步**：Relay 服务器永远不接触主密码、永远不接触明文；所有加密/解密 **100% 在安卓设备上完成**。
- **两套独立密钥**：主密码（解锁 Vault） ≠ 云账号密码（登录 Relay），**任何情况禁止将两者相互派生**。
- **离线优先（Offline-First）**：没有网络也能查看、新增、编辑、删除、搜索；网络恢复后自动后台同步。
- **永远显示暗语**：和 DSH 插件一致，安卓端也保留暗语系统（消息中出现用户自定义暗语时直接本地解析意图，不经过任何 LLM 调用）。
- **最小权限攻击面**：
  - 不申请 READ_CONTACTS / READ_SMS / ACCESS_FINE_LOCATION / RECORD_AUDIO 等无关权限
  - 明文**永远不写入** SharedPreferences / Room SQLite / 内部存储
  - Vault 解锁后的 plaintext 对象只保留在内存，App 切到后台 60 秒后自动清空

---

## 1. 目标功能列表（MVP → v2 分阶段）

### MVP v1.0（和 DSH 插件功能对齐，必做）

| # | 模块 | 说明 | 依赖 |
|---|------|------|------|
| 1.1 | **Vault 加解密** | PBKDF2-HMAC-SHA256 250k 迭代派生 AES-256-GCM，与 host 端 byte-for-byte 互通 | AndroidX Security + javax.crypto |
| 1.2 | **云同步（REST）** | 登录/登出/GET/PUT/409 冲突处理的 push→pull→retry 流程 | OkHttp + Retrofit + Kotlin Coroutines |
| 1.3 | **本地持久化（密文）** | Room + SQLCipher 存储加密条目；或直接存密文 blob（更简单） | Room 2.x |
| 1.4 | **CRUD + 搜索** | 笔记/凭证/个人资料三种 kind 的新增、编辑、删除、按标签、按全文、按日期筛选 | Jetpack Compose UI + DataStore Preferences |
| 1.5 | **解锁屏幕** | 启动/切回前台必须输入主密码解锁；可选：BiometricPrompt（指纹/面部）作为主密码的快捷解锁封装（主密码仍需首次输入） | Biometric AndroidX |
| 1.6 | **宠物浮动小部件（可选在 Launcher 上加 MemoryPets 小宠物）** | 桌面 Widget，显示 4 心情（站立/思考/等待/睡觉），点击进 App | AppWidgetProvider + Lottie 动画 |
| 1.7 | **暗语直达** | 新建笔记 / 查找 / 导出 / 同步，用用户配置的暗语触发 | Intent Filter + share sheet |
| 1.8 | **导出 Markdown** | 和 host 端导出格式完全一致，便于设备间手动 merge | 自定义 ShareProvider + SAF（存储访问框架）|
| 1.9 | **设置** | 切换加密开关（默认开）、改主密码、改云账号、改暗语门槛、切换服务器 URL | Preference DataStore |
| 1.10 | **系统分享接入** | 在 Chrome / SMS 里"分享→MemoryPets"，直接创建一条笔记并在文本里填被分享的 URL/正文 | Intent.ACTION_SEND |

### v1.1（加购项）

- 🏷️ **标签管理视图**：左侧抽屉式标签树，按标签统计条目数
- 🔔 **到期提醒**：dueDate 到期当天 WorkManager 推送通知（带 FullScreenIntent 可选）
- 🔐 **分条目独立加密 + 独立 reveal**：凭证 kind 单独点「眼睛」才显示 value，和 DSH 插件里 reveal_credential 工具一致
- 🧩 **TextClassifier 智能摘要**：大段笔记自动抽取标签（纯本地，不联网）
- 🔑 **Autofill Framework 接入**：把 credential kind 暴露给 Android Autofill，登录 App 自动填（仅限用户显式开启）

### v2.0（长期路线）

- 🤖 **端上 LLM / on-device Gemini Nano**：接入 AICore，把 System Prompt 注入模型，实现离线聊天 + 暗语意图
- 🧾 **TOTP / 2FA 种子本地加密存储** + 自动生成 6 位验证码
- 🌐 **跨语言暗语模型**：多语言同义暗语检测

---

## 2. 技术选型（推荐 Kotlin 单语言）

| 层 | 技术 | 版本/说明 |
|----|------|-----------|
| 语言 | **Kotlin 2.0** + K2 编译器 | minSdk 26（Android 8.0），targetSdk 34，Java 17 字节码 |
| UI | **Jetpack Compose BOM + Material 3** | 强制 Material You 动态取色；所有列表 LazyColumn |
| 异步 | Kotlin Coroutines 1.9 + Flow | Dispatchers.IO 做加密/IO，Default 做搜索 |
| 架构 | **Clean Architecture**（Data / Domain / Presentation 三层）+ MVVM | UseCase 层处理业务 |
| 网络 | **OkHttp 4.12 + Retrofit 2.11** | 自定义 Interceptor：401 自动 Refresh（→ 静默重新登录） |
| 本地 DB | **Room 2.6 + SQLCipher 4.5**（可选，推荐直接存密文 blob）| 或者更简单：把加密后的 Vault 整个作为字节数组写 DataStore（更符合 DSH 端的单 envelope 模型）|
| 偏好存储 | Jetpack DataStore Preferences（不存明文！只存 session token、serverUrl、username、暗语列表、偏好）| 不存主密码 |
| 加解密 | **javax.crypto (标准库)**：`PBKDF2WithHmacSHA256` + `AES/GCM/NoPadding`，不引入第三方加密库（减小攻击面）| 第 5 节给精确参数 |
| 生物识别 | AndroidX Biometric 1.1 + CryptoObject（把主密码包装到 KeyStore 的加密密钥里）| **不把主密码写 KeyStore**，只包一层会话级解锁 |
| 图片动画 | Lottie Compose（宠物 4 心情动画，直接复用 assets 里的 PNG 序列） | 或 Coil 加载本地资源 |
| 构建 | Gradle 8.9 + Version Catalog（libs.versions.toml）| 发行版：R8 全量混淆、资源压缩、apk v2+v3 签名 |
| 测试 | JUnit 5（Robolectric）+ Truth + MockK + OkHttp MockWebServer | 协议互通测试必须包含 |

---

## 3. 模块架构图（目录结构）

```
app/src/main/java/com/memorypets/android/
├── App.kt                        # Application，初始化 DataStore / WorkManager
├── di/                           # Hilt（推荐）或手动 Koin 依赖注入
├── data/
│   ├── remote/                   # Retrofit + CloudSyncService 接口（云同步 REST）
│   │   ├── CloudSyncApi.kt
│   │   ├── model/
│   │   │   ├── RegisterReq.kt    / RegisterResp.kt
│   │   │   ├── LoginReq.kt       / LoginResp.kt
│   │   │   ├── GetVaultResp.kt
│   │   │   └── PutVaultReq.kt   / PutVaultResp.kt (Conflict 409 字段)
│   │   └── interceptor/
│   │       └── AuthInterceptor.kt         # 自动加 Bearer token；401 静默 re-login
│   ├── local/                    # 本地持久化（两种方案二选一，推荐 方案 A）
│   │   ├── 【方案 A · 推荐】VaultBlobStore.kt  # 只保存整个密文 envelope + version（与 DSH 一致）
│   │   └── 【方案 B · 搜索性能好】Room 数据库 + SQLCipher：entries 每张表单独加密（解密后按列建索引）
│   ├── prefs/
│   │   └── AppPrefs.kt           # DataStore：serverUrl, username, sessionToken, darkMode, 暗语, codewordGateEnabled
│   └── sync/
│       └── SyncOrchestrator.kt   # GET → 解密对比 → PUT (expectedVersion) → 409 pull → 重试
├── domain/
│   ├── model/
│   │   ├── Entry.kt              # kind/label/value/tags/dueDate/hint (与 MOBILE_SYNC_API §2 完全同字段)
│   │   ├── Vault.kt              # version + List<Entry>
│   │   ├── Envelope.kt           # kdf { salt, iterations, keyLen } + ciphertext + iv
│   │   └── SyncResult.kt         # Pushed(v) / Pulled(v) / Conflict(theirs, mine) / AuthExpired
│   ├── crypto/
│   │   ├── VaultCrypto.kt        # deriveKey() + seal() + unlock() —— 核心协议层
│   │   └── HashUtil.kt           # PBKDF2 纯封装，单独写单元测试对比 DSH 端的固定向量
│   ├── codeword/
│   │   ├── CodewordGate.kt       # 和 host 端 intent.mjs + codeword-gate.mjs 语义一致
│   │   └── IntentParser.kt       # 暗语触发 → 生成本地 CRUD 操作
│   └── usecase/
│       ├── UnlockVaultUseCase.kt
│       ├── ListEntriesUseCase.kt (搜索/筛选/标签)
│       ├── UpsertEntryUseCase.kt
│       ├── RemoveEntryUseCase.kt
│       ├── RevealCredentialUseCase.kt  # 仅 credential kind，返回 value 限时 30s
│       ├── ExportMarkdownUseCase.kt
│       └── SyncNowUseCase.kt
├── presentation/
│   ├── MainActivity.kt
│   ├── ui/
│   │   ├── theme/                # Material You 动态颜色 + 深色模式
│   │   ├── unlock/               # UnlockScreen（主密码输入 + 生物识别入口）
│   │   ├── setup/                # 首次启动 Setup：主密码 / 云账号 / 服务器 URL / 暗语
│   │   ├── home/                 # 主列表 + 搜索框 + 宠物头像 + FAB（新建条目）
│   │   ├── editor/               # 条目编辑页，Credential 和 Note 两种表单
│   │   ├── cloud/                # 云同步设置页（登录/登出/服务器地址/立即同步按钮）
│   │   ├── settings/             # 全局设置（加密开关/改主密码/导出/暗语门槛/暗语列表）
│   │   └── widget/               # 桌面小部件（心情宠物）
│   └── viewmodel/
│       └── 每页对应一个 ViewModel，StateFlow 驱动 UI
└── service/
    └── SyncWorker.kt             # WorkManager 周期同步（每 15 分钟）+ 网络恢复自动同步
```

---

## 4. 安全模型（红线）

### 4.1 两类密钥的物理隔离

| 密钥 | 来源 | 内存中存活时间 | 是否可持久化 | 用途 |
|------|------|---------------|-------------|------|
| **主密码（Master Password）** | 用户输入，EditText inputType=textPassword | 仅在解锁后的会话窗口内（`UnlockSession` 对象），App 切后台 60s / 锁屏 / 内存不足时置 null | ❌ 绝对不写入任何持久化存储（SharedPrefs/DataStore/DB/KeyStore 都不行）| 派生 AES-256 密钥，对 Vault 明文加解密 |
| **派生 AES Key** | 由主密码 + envelope.kdf.salt PBKDF2 派生 | 仅在加解密期间保存于 `javax.crypto.SecretKey`（不暴露原始字节），用完立即 `destroy()` | ❌ 禁止 persist | `AES/GCM/NoPadding` 实际加解密 |
| **云账号密码** | 用户注册时输入 | 只在调用 register/login 的 Retrofit 调用栈内持有，请求发出立即被 GC | ❌ 不保存，登录后只存 session token | 在 Relay 端散列成 scrypt 记录，拿 session token |
| **Session Token** | 服务器 `/accounts/login` 返回的 64 hex | 存活至登出 / 服务器重启导致 401 | ✅ 存 AppPrefs（DataStore + EncryptedSharedPreferences 再加密一层） | 调用 `GET/PUT /vault` 时的 `Authorization: Bearer` |
| **Biometric 快捷密钥（可选）** | Android Keystore AES Key，首次解锁主密码后用户可选择生成 | Keystore 内部，用户不可导出 | ✅ KeyStore（由 TEE/StrongBox 保护）| 只用于"把主密码加密后暂时放到内存缓存"，用户指纹校验通过后自动解出主密码，再走正常 Vault unlock 流程 |

### 4.2 进程被回收 / 锁屏 / 切后台的行为

```
Lifecycle.Event.ON_STOP (切后台)
  └── 启动 60 秒倒计时 JobScheduler
      └── 到时：UnlockSession.clear() → 所有 plaintext Entry 对象 = null
                       → 派生 AES SecretKey.destroy()
                       → ViewModel 里的 StateFlow 重置为 Locked 状态
                       → 通知栏弹出 "MemoryPets 已自动上锁"

Lifecycle.Event.ON_DESTROY (系统回收)
  └── UnlockSession 立即 clear，不等待 60 秒

锁屏广播 (ACTION_SCREEN_OFF)
  └── 立即 clear（比 60s 更严格）
```

### 4.3 明文落地的"零容忍"清单（代码审查时必查）

- ❌ 禁止把 `Entry.value` / `Entry.label` / 解密后的 Vault JSON 写入任何 Logcat （Debug 版也要禁用自动 toString() 打印，用 @Keep + 自定义重写）
- ❌ 禁止在 Room / DataStore / SharedPreferences / 任何文件里写入任何 Entry 明文
- ❌ 禁止 `android:allowBackup="true"`（`AndroidManifest.xml` 里强制设为 false，防止 adb backup 把 app 数据拉走）
- ❌ 禁止 `android:exported` 任意未经过 signature 校验的 ContentProvider / Service（分享 Intent 用临时 FLAG_GRANT_READ_URI_PERMISSION）
- ✅ 启用 **FLAG_SECURE**：解锁页、凭证详情页、编辑页窗口禁止系统截图/录屏/最近任务缩略图模糊

### 4.4 其它安全加固

- **网络安全配置**（res/xml/network_security_config.xml）：
  - CLEARTEXT 默认拒绝（如果你切 Flexible 模式，必须在 `domain-config` 对 sync.citiestripcn.com 单独放行 cleartext，且文档标注此行为为"云侧 CF Flexible 模式"）
  - 生产版本固定 pin Cloudflare 证书（certificate pinning），防止中间人
- **ROOT 检测**（可选）：启动时查 `/system/bin/su`、Magisk 管理包、挂载系统分区为 rw，有任一存在则警告用户
- **改主密码流程**：必须用「旧主密码解密 → 重新 generateSalt() + 新主密码派生 key → 重新 seal 整个 Vault」三步，不得在任何地方缓存新旧密钥
- **密文篡改检测**：AES-GCM 自带 AEAD 标签验证，任何 bit-flip 会直接抛出 `AEADBadTagException`，UI 上提示 "密文已损坏，可能是主密码错误或文件被篡改"，**不要自动回滚本地版本**

---

## 5. 加密协议（必须与 DSH 插件字节级一致 ⚠️）

> 本节是 MVP 成败的关键。**如果这一节有任何参数错了**，安卓端解密 DSH 端封的密文就会 AEADBadTagException，两边完全不通。
> 参考实现：[crypto.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/crypto.mjs)
> 的 `deriveKey()` / `seal()` / `unlock()` 和 [vault.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/vault.mjs)。

### 5.1 派生密钥（PBKDF2）

```kotlin
// Kotlin 精确实现（不要引入任何第三方库，就用 javax.crypto + 标准库）
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

object VaultCrypto {
    private const val KDF_ALG = "PBKDF2WithHmacSHA256"
    private const val CIPHER_ALG = "AES/GCM/NoPadding"
    private const val SALT_LEN_BYTES = 16
    private const val IV_LEN_BYTES = 12
    private const val DEFAULT_ITERATIONS = 250_000
    private const val DEFAULT_KEY_LEN_BITS = 256

    // 生成新盐（首次 Setup / 改主密码时调用）
    fun generateSaltBytes(): ByteArray {
        val rand = SecureRandom()
        val b = ByteArray(SALT_LEN_BYTES)
        rand.nextBytes(b)
        return b
    }

    // 生成新 IV（每次 seal 必调！绝对不可复用 IV）
    fun generateIvBytes(): ByteArray {
        val rand = SecureRandom()
        val b = ByteArray(IV_LEN_BYTES)
        rand.nextBytes(b)
        return b
    }

    /**
     * 【核心 1】PBKDF2 派生 AES-256 密钥
     * 必须：密码以 UTF-8 字符（不是字节）喂给 PBEKeySpec，
     *       iterations 和 keyLen 一律以 envelope 里的值为准，不要硬编码默认值。
     */
    fun deriveKey(masterPassword: CharArray,
                   saltBytes: ByteArray,
                   iterations: Int,
                   keyLenBits: Int = DEFAULT_KEY_LEN_BITS): SecretKeySpec {
        val spec = PBEKeySpec(masterPassword, saltBytes, iterations, keyLenBits)
        val skf = SecretKeyFactory.getInstance(KDF_ALG)
        val raw = skf.generateSecret(spec).encoded
        return SecretKeySpec(raw, "AES")
    }
```

### 5.2 加密（Seal = Vault 明文 JSON → Envelope）

```kotlin
    /**
     * 【核心 2】AES-256-GCM 加密
     * plaintextJson: UTF-8 字符串 (Vault 的 JSON)
     * 返回 Envelope 数据类，字段完全对应 DSH 端 envelope JSON
     */
    fun seal(plaintextJson: String,
             masterPassword: CharArray,
             iterations: Int = DEFAULT_ITERATIONS,
             keyLenBits: Int = DEFAULT_KEY_LEN_BITS): Envelope {
        val salt = generateSaltBytes()
        val iv = generateIvBytes()
        val key = deriveKey(masterPassword, salt, iterations, keyLenBits)
        val cipher = Cipher.getInstance(CIPHER_ALG)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv)) // 128-bit tag
        val ctWithTag = cipher.doFinal(plaintextJson.toByteArray(Charsets.UTF_8))
        // GCM spec: auth tag 自动 append 在 ciphertext 尾部（和 Node WebCrypto/DSH 端约定一致）
        return Envelope(
            version = 1,
            kdf = KdfConfig(
                salt = salt.encodeBase64(),
                iterations = iterations,
                keyLen = keyLenBits
            ),
            ciphertext = ctWithTag.encodeBase64(),
            iv = iv.encodeBase64()
        )
    }
```

### 5.3 解密（Unlock = Envelope + 主密码 → Vault 明文 JSON）

```kotlin
    /**
     * 【核心 3】AES-256-GCM 解密
     * @throws AEADBadTagException 主密码错误 / 密文被篡改
     * 调用方必须 catch 这个异常，并提示用户"主密码错误或密文损坏"，不要吞异常
     */
    fun unlock(envelope: Envelope, masterPassword: CharArray): String {
        val salt = envelope.kdf.salt.decodeBase64()
        val iv = envelope.iv.decodeBase64()
        val ctWithTag = envelope.ciphertext.decodeBase64()
        val key = deriveKey(
            masterPassword = masterPassword,
            saltBytes = salt,
            iterations = envelope.kdf.iterations,
            keyLenBits = envelope.kdf.keyLen
        )
        val cipher = Cipher.getInstance(CIPHER_ALG)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        val pt = cipher.doFinal(ctWithTag)
        return pt.toString(Charsets.UTF_8)
    }
}
```

### 5.4 Base64 编码规则（避免又一个互通坑）

DSH 端的 `Buffer.from().toString('base64')` 使用的是 **标准 Base64 + 无换行 / 无 URL-safe**：
```kotlin
// 用 java.util.Base64 的 getEncoder() / getDecoder()，不要用 getUrlEncoder() / mimeEncoder
fun ByteArray.encodeBase64(): String = Base64.getEncoder().encodeToString(this)
fun String.decodeBase64(): ByteArray = Base64.getDecoder().decode(this)
```

### 5.5 协议互通自测向量（单元测试必写）

和 DSH 端出一对硬编码 KAT（Known-Answer-Test）向量，**两边跑同一对 salt/iv/master-password/plaintext，得到完全相同的 ciphertext**，证明互通。这对向量**不要用真实密码**，用固定字符集避免端上 PBKDF2 的 250k 次在测试里太慢（测 10_000 次迭代即可）。

```kotlin
@Test fun `DSH side interoperability KAT — 10k iterations`() {
    val mp = "correct horse battery staple".toCharArray()
    val salt = "0123456789abcdef".toByteArray() // 16 bytes
    val iv   = "abcdef987654".toByteArray()         // 12 bytes
    val pt = """{"version":1,"entries":[{"id":"x","kind":"note","label":"KAT","value":"hello"}]}"""
    // 这里跑 seal，但用预先固定的 salt 和 iv 替代 SecureRandom（测试用 override 接口）
    // 然后对比 DSH 端跑同样参数得到的 Base64 ciphertext，必须完全相同
}
```

---

## 6. 云同步协议（完全复用 relay 接口，不经过 DSH host 进程）

> 参考文档：[MOBILE_SYNC_API.md §3 REST API](file:///Users/suiyunhai/CascadeProjects/harness-plugin/docs/MOBILE_SYNC_API.md)
> 参考实现（push→conflict→pull→retry 流程）：[cloud-sync.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/cloud-sync.mjs)

### 6.1 Retrofit 接口

```kotlin
interface CloudSyncApi {
    @POST("/accounts/register")
    suspend fun register(@Body req: RegisterReq): RegisterResp

    @POST("/accounts/login")
    suspend fun login(@Body req: LoginReq): LoginResp

    @GET("/vault")
    suspend fun getVault(@Header("Authorization") bearer: String): GetVaultResp

    @PUT("/vault")
    suspend fun putVault(
        @Header("Authorization") bearer: String,
        @Body req: PutVaultReq
    ): PutVaultResp
}

// 数据类必须和 relay JSON 字段一致
data class RegisterReq(@SerializedName("username") val username: String,
                       @SerializedName("password") val password: String)
data class RegisterResp(@SerializedName("ok") val ok: Boolean,
                        @SerializedName("token") val token: String?,
                        @SerializedName("error") val error: String?)
// LoginReq / LoginResp 同结构
data class KdfConfigDTO(@SerializedName("salt") val salt: String,
                        @SerializedName("iterations") val iterations: Int,
                        @SerializedName("keyLen") val keyLen: Int)
data class EnvelopeDTO(@SerializedName("version") val version: Int,
                       @SerializedName("kdf") val kdf: KdfConfigDTO,
                       @SerializedName("ciphertext") val ciphertext: String,
                       @SerializedName("iv") val iv: String)
data class GetVaultResp(@SerializedName("ok") val ok: Boolean,
                        @SerializedName("envelope") val envelope: EnvelopeDTO?,
                        @SerializedName("version") val version: Long,
                        @SerializedName("updatedAt") val updatedAt: Long?,
                        @SerializedName("error") val error: String?,
                        @SerializedName("conflict") val conflict: Boolean?)
data class PutVaultReq(@SerializedName("envelope") val envelope: EnvelopeDTO,
                       @SerializedName("expectedVersion") val expectedVersion: Long,
                       @SerializedName("deviceId") val deviceId: String) // deviceId = Settings.Secure.ANDROID_ID，或者首次启动 UUID 存 DataStore
data class PutVaultResp(@SerializedName("ok") val ok: Boolean,
                        @SerializedName("version") val version: Long?,
                        @SerializedName("updatedAt") val updatedAt: Long?,
                        @SerializedName("error") val error: String?,
                        @SerializedName("conflict") val conflict: Boolean?,
                        @SerializedName("current") val current: GetVaultResp?)
```

### 6.2 AuthInterceptor（401 静默重登录）

```kotlin
class AuthInterceptor(
    private val prefs: AppPrefs,
    private val api: dagger.Lazy<CloudSyncApi>, // 避免循环依赖
) : Interceptor {
    override fun intercept(chain: Chain): Response {
        val token = prefs.blockingGetSessionToken()
        val req = chain.request().newBuilder()
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .build()
        val resp = chain.proceed(req)
        if (resp.code == 401 && token != null) {
            // 静默用保存的 username+password（⚠️ 不对！云账号密码不保存 —— 方案：
            //   若 401 → 不静默重登，UI 弹出"云会话过期，请重新输入云账号密码"）
            resp.close()
            throw CloudAuthExpiredException()
        }
        return resp
    }
}
```

> ⚠️ 安全红线：**不要持久化云账号密码**，session 过期就弹 Dialog 让用户重输密码，和 DSH 端 UI 一致。

### 6.3 SyncOrchestrator 流程（和 host 端语义一致）

```kotlin
sealed class SyncOutcome {
    data class Pushed(val newVersion: Long) : SyncOutcome()
    data class Pulled(val newVersion: Long, val remoteEntriesAdopted: Boolean) : SyncOutcome()
    data class ConflictNeedManual(val theirVersion: Long, val mineVersion: Long) : SyncOutcome()
    data class AuthExpired(val reason: String) : SyncOutcome()
}

suspend fun SyncOrchestrator.syncNow(masterPassword: CharArray? // 仅解密对端冲突时需要
): SyncOutcome {
    val bearer = prefs.getSessionToken() ?: return SyncOutcome.AuthExpired("not logged in")

    // 1) GET /vault
    val getResp = api.getVault("Bearer $bearer")
    var remoteVersion = getResp.version

    // 2) 如果云端有新密文
    if (getResp.envelope != null && remoteVersion > localBlobStore.currentVersion) {
        val plain = try {
            // 用用户解锁会话里的主密码 / 或让 ViewModel 再请求一次解锁
            val mp = masterPassword ?: return SyncOutcome.ConflictNeedManual(remoteVersion, localBlobStore.currentVersion)
            VaultCrypto.unlock(getResp.envelope.toDomain(), mp)
        } catch (e: AEADBadTagException) {
            // 云端新版本用了不同主密码 —— 不能覆盖本地，UI 上必须显式警告
            return SyncOutcome.ConflictNeedManual(remoteVersion, localBlobStore.currentVersion)
        }
        // 采用云端版本，落本地
        val vault = vaultJsonAdapter.fromJson(plain)!!
        localBlobStore.overwriteWithRemote(vault, getResp.envelope.toDomain(), remoteVersion)
        return SyncOutcome.Pulled(remoteVersion, remoteEntriesAdopted = true)
    }

    // 3) 本地有变更 -> PUT /vault
    if (localDirtyFlag || localBlobStore.currentVersion == 0L && vault.isNotEmpty()) {
        val myEnvelope = // seal(vault.toJson(), session.masterPassword, ...)
        val putReq = PutVaultReq(myEnvelope, expectedVersion = remoteVersion, deviceId = deviceUuid)
        val putResp = runCatching { api.putVault("Bearer $bearer", putReq) }.getOrElse {
            if (it is HttpException && it.code() == 409) {
                // 409 冲突 -> 拉 current -> 解锁 -> 用新 expectedVersion 再 PUT 一次（没有条目级 merge，直接新信封覆盖）
                val current = it.response()?.errorBody()?.let { b ->
                    vaultAdapter.fromJson(b.charStream())?.current
                } ?: return SyncOutcome.ConflictNeedManual(-1, localBlobStore.currentVersion)
                val adopted = // 和第 2 步一样：解密 current.envelope → 采用为新本地版本（可选择做一次本地条目并集的粗 merge，或直接提醒用户"以对端为准"）
                val retry = PutVaultReq(myEnvelope, expectedVersion = current.version, deviceId = deviceUuid)
                val retryResp = api.putVault("Bearer $bearer", retry) // 仍 409 → 交给用户手工
                return if (retryResp.ok) SyncOutcome.Pushed(retryResp.version!!)
                       else SyncOutcome.ConflictNeedManual(current.version, localBlobStore.currentVersion)
            } else throw it
        }
        if (putResp.ok) {
            localBlobStore.confirmVersion(putResp.version!!)
            return SyncOutcome.Pushed(putResp.version)
        }
    }
    return SyncOutcome.Pushed(remoteVersion)
}
```

---

## 7. UI 设计说明（以 DSH 插件视觉为蓝本）

### 7.1 主题色 / 宠物

- 主色沿用 DSH 插件浏览器右上角浮动宠物的配色（深蓝底 + 浅棕小狗 PNG 动画）。
- 首页顶部右上角放一只**宠物心情 Lottie 动画**（4 种）：
  - `standing`：空闲
  - `thinking`：正在解密 / 搜索 / 同步
  - `waiting`：解锁页、等待输入主密码
  - `sleeping`：长时间后台 / 已锁屏
- 点击宠物 → 弹出快捷面板：「新建笔记 / 新建凭证 / 立即同步 / 设置」

### 7.2 五屏 MVP 导航图（NavHost Compose）

```
StartDestination =
  if (prefs.isVaultInitialized) UnlockScreen else SetupScreen

SetupScreen ─► 设置主密码 → 云账号登录/注册 → 写暗语 → 进入 HomeScreen

UnlockScreen
  └─ 输入主密码 → UnlockUseCase → HomeScreen
  └─ （可选）指纹图标 → BiometricPrompt → 解密 Keystore 里包的主密码 → HomeScreen

HomeScreen (底部 Tab 或抽屉 Nav)
  ├─ Tab "全部笔记" —— LazyColumn，按 updatedAt 倒序
  ├─ Tab "标签" —— 标签分组，点开进标签筛选页
  ├─ Tab "凭证" —— 只显示 credential kind，value 默认 mask（****），点眼睛按钮 Reveal 30s
  └─ FAB ⊕ → 选择「新建笔记 / 新建凭证 / 新建个人资料」 → 进入 EditorScreen

EditorScreen
  ├─ kind：radio (Note / Credential / Profile)
  ├─ Label 单行
  ├─ Value：Note 多行 TextField（带字数统计）；Credential 默认单行密码 mode + 眼睛按钮切换明文显示 30s
  ├─ Tags：ChipGroup + 自定义输入
  ├─ Due Date：DatePicker
  ├─ Hint：仅 credential 有（非秘密提示，例如 "ends 8a1f"）
  └─ 底部：保存 / 删除（删除弹二次确认）

SettingsScreen (4 分组)
  ├─ ☁️ 云同步：服务器地址 / 用户名 / 登录 / 登出 / 立即同步 / 当前版本 / 上次同步时间
  ├─ 🔐 安全：修改主密码 / 启用生物识别 / 启用截图屏蔽 / 改主密码后加密整个 Vault
  ├─ 🧠 暗语：启用暗语门槛 / 暗语列表（Chip 可删 + 添加框）/ 测试暗语输入框
  └─ 🛠️ 通用：导出 Markdown（SAF 选择导出目录） / 主题（动态色/深色/浅色） / 清除缓存 / 关于 / 版本号
```

### 7.3 浮动小部件（MemoryPets Pet Widget 4x1 / 4x2）

- 4x1：只显示一只宠物心情图 + 一条 "今日待办 N 条"
- 4x2：宠物 + 最近 3 条笔记的 label 列表（点击跳转解锁 → 进详情）
- 小部件点刷新按钮 → WorkManager 触发一次立即同步（带 session token，若过期弹通知"请打开 App 重新登录"）

---

## 8. 暗语系统（与 DSH 端 intent.mjs 语义对齐）

### 8.1 本地 IntentParser 支持的操作（MVP 必做 6 条）

```
暗语示例（用户自定义，默认给几个："记一下"/"记住"/"帮我存"/"查一下"/"找"/"导出"）

1. "记一下：明天下午3点和张三开会，标签 工作"
   → kind=note, label="和张三开会", value="明天下午3点和张三开会", tags=["工作"]

2. "存一下 GitHub token，值 ghp_xxxx，hint: ends 8a1f"
   → kind=credential, label="GitHub token", value="ghp_xxxx", hint="ends 8a1f"

3. "查一下标签 工作 且 关键词 张三"
   → 搜索: filter tags contains "工作" AND (label or value contains "张三")

4. "查 due 明天"
   → 搜索: dueDate = 今天+1 天

5. "导出 2026 年全部笔记"
   → 触发 ExportMarkdownUseCase (按时间筛选)

6. "同步一下" / "立即同步"
   → SyncNowUseCase
```

### 8.2 CodewordGate（门槛开关）

和 DSH 端一致：
- `codewordGateEnabled = true` → 所有以上意图解析**必须**消息前缀包含用户配置的任一暗语才触发
- `codewordGateEnabled = false` → 直接解析（适合离线场景下的快捷存笔记，例如锁屏上「通过暗语直接记」的快捷模式）

---

## 9. 发布 / 签名 / 合规

- **签名**：
  - 发布前用独立的 upload keystore（不进仓库，放 1Password/硬件密钥），再用 Google Play App Signing 托管 release key
  - `minSdk 26, targetSdk 34` 符合 Google Play 2024 年政策
- **Data Safety 表单**：
  - 不收集任何个人可识别信息（PII）
  - 所有笔记/凭证**端到端加密**，服务器只有密文
  - 云账号密码**不被开发商保存**，仅由用户自己在 AppPrefs 里控制 session token
- **无障碍 / Autofill / 生物识别**：
  - Autofill 显式开关（默认关），开关入口放在设置 → 安全里
  - 生物识别第一次启用时弹 Google Play 标准提示文案："使用指纹/面部快捷解锁 MemoryPets"
- **无障碍/自动填充 Intent filter**：只在 `AutofillManager` 启用时注册服务，不要 AndroidManifest 里导出不需要的组件

---

## 10. 里程碑 & 工时估计（单人开发参考）

| Milestone | 功能 | 估计工时 |
|-----------|------|---------|
| **M1 加密协议互通** | VaultCrypto 写完 + 对 DSH 端 KAT 向量通过单元测试 | 3 天 |
| **M2 云同步跑通** | Retrofit + AuthInterceptor + SyncOrchestrator (push/409/pull/retry) + MockWebServer 测试 | 4 天 |
| **M3 UI 骨架** | Compose 5 屏 + Hilt DI + Navigation + Theme | 3 天 |
| **M4 本地持久化 + 解锁** | VaultBlobStore (方案 A) + UnlockScreen + FLAG_SECURE + 60s 自动上锁 | 3 天 |
| **M5 CRUD + 搜索** | UseCase 层 + EditorScreen + Home LazyColumn + 搜索 (Flow debounce) | 3 天 |
| **M6 设置 + 导出** | SettingsScreen + DataStore + 导出 Markdown (SAF) | 2 天 |
| **M7 暗语 + 分享** | IntentParser + CodewordGate + ACTION_SEND 分享入口 | 2 天 |
| **M8 小部件 + 生物识别 + WorkManager 周期同步** | 宠物心情 Widget + Biometric + SyncWorker | 3 天 |
| **M9 联调 + 测试 + 混淆 + 签名** | E2E 真机同步（手机 ↔ 浏览器插件双向）+ 性能测试（大 Vault 1000 条搜索 < 200ms）| 3 天 |
| **合计 MVP** | —— | **约 26 个工作日** |

---

## 11. 验收标准（Definition of Done）

每一条都是红线，**不通过不准打 release 包**：

1. ✅ **互通性测试**：
   - 手机 Setup → 主密码 `Test@Pass123` → 存 3 条（2 note + 1 credential）→ 同步 → 立即去 DSH 浏览器插件 → 同一主密码 + 同云账号 → Sync Now → 3 条完全一致（包括 createdAt/updatedAt 时间戳）
   - 反向：DSH 插件加一条 → 手机上 → 立即同步 → 出现在 Home 列表
2. ✅ **冲突 409 正确处理**：
   - 两边同时离线编辑 → 各自做了修改 → 同时上线 → 先 push 的成功（v+1）→ 后 push 的收到 409 → 自动采用对端版本 → 再提示用户"请检查是否有遗漏变更"
3. ✅ **安全红线**：
   - 用 `adb shell run-as com.memorypets.android ls files/ shared_prefs/ databases/` → 翻所有文件 → grep 不到任何明文笔记内容
   - 锁屏 60s 后回 App → 必须重新输入主密码或指纹
   - 凭证详情页截图 → 黑色（FLAG_SECURE 生效）
   - `android:allowBackup="false"` 写对
4. ✅ **大 Vault 性能**：1000 条笔记（每个 1KB） → 搜索关键词返回 ≤ 200ms；PBKDF2 250k 次在中端骁龙 7 系耗时 ≤ 450ms
5. ✅ **断网可用**：关飞行模式 → 新建 → 编辑 → 删除 → 全部可用；开网络 → WorkManager 自动后台同步成功

---

## 12. 与现有代码库的对接清单（参考文件）

| 安卓端要对齐的对象 | 参考文件 |
|-------------------|---------|
| Envelope JSON 形状 / PBKDF2 参数 / AES-GCM 字节序 | [MOBILE_SYNC_API.md §2](file:///Users/suiyunhai/CascadeProjects/harness-plugin/docs/MOBILE_SYNC_API.md) |
| 具体函数实现（deriveKey / seal / unlock）| [crypto.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/crypto.mjs) / [vault.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/vault.mjs) |
| 云同步 push→409→pull 重试流程 | [cloud-sync.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/cloud-sync.mjs) |
| 暗语系统 & 意图解析（parseIntent / makeCodewordDetector）| [intent.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/intent.mjs) / [codeword-gate.mjs](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/codeword-gate.mjs) |
| 导出 Markdown 格式 | [operations.mjs opExportMarkdown](file:///Users/suiyunhai/CascadeProjects/harness-plugin/packages/host/lib/operations.mjs) |
| 宠物 PNG 帧（做 Lottie）| [assets/](file:///Users/suiyunhai/CascadeProjects/harness-plugin/assets) 目录下的 `pet_*.png` 系列 |

---

> 文档结束。下一步可以基于此 spec 直接 `flutter create` / `npx react-native init` 或开一个 Android Studio Kotlin 工程，按第 3 节目录建包并从 M1 加密协议互通先写 KAT 单测启动。
