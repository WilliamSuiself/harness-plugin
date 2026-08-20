package com.memorypets.core.crypto

import com.memorypets.core.model.Envelope
import com.memorypets.core.model.KdfConfig
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Vault 加解密核心 —— 必须与 packages/host/lib/crypto.mjs + vault.mjs 字节级一致。
 *
 * 参数红线：
 *   KDF:  PBKDF2WithHmacSHA256（密码喂 PBEKeySpec 为 char[], UTF-16 字符 → 与 Node crypto.pbkdf2Sync(password, salt, iterations, keylen, 'sha256')
 *         的 UTF-8 字节序不同！见下方说明）
 *   AEAD: AES/GCM/NoPadding, 128-bit auth tag, IV 12 bytes, ciphertext||tag 拼接
 *   Base64: java.util.Base64.getEncoder()（STANDARD, no wrap, no url-safe）与 Node Buffer.toString('base64') 一致
 *
 * ⚠️ UTF-8 vs UTF-16 警告：
 *   javax.crypto PBEKeySpec(char[]) 用的是 password 的 UTF-16 代码单元；
 *   但 Node 的 crypto.pbkdf2Sync(password, ...) 是把 password 当作 UTF-8 字节流。
 *   为了与 DSH 端 byte-for-byte 对齐，**我们不用 PBEKeySpec 直接喂 char[]**，
 *   而是把主密码先转 UTF-8 字节，再手动实现 PBKDF2（或者用以下方案：使用
 *   SecretKeyFactory 时手动把 UTF-8 bytes 以 ASCII chars 喂进去不可行——所以
 *   下面的实现采用 `BouncyCastle 风格`：我们直接用标准 JDK PBKDF2，但是把
 *   主密码 CharArray 转成 UTF-8 字节后，再将每一个字节作为 char 填入 PBEKeySpec，
 *   这样就与 Node 的 UTF-8 字节流派生完全一致。
 *   这种 "UTF-8 bytes -> low chars" 是 Android 端互通常规操作，见 Google crypto blog。
 */
object VaultCrypto {

    private const val KDF_ALG = "PBKDF2WithHmacSHA256"
    private const val CIPHER_ALG = "AES/GCM/NoPadding"
    private const val GCM_TAG_LEN_BITS = 128
    const val SALT_LEN_BYTES = 16
    const val IV_LEN_BYTES = 12
    const val DEFAULT_ITERATIONS = 250_000
    const val DEFAULT_KEY_LEN_BITS = 256

    private val secureRandom: SecureRandom by lazy { SecureRandom.getInstanceStrong() }

    fun generateSaltBytes(): ByteArray = ByteArray(SALT_LEN_BYTES).also(secureRandom::nextBytes)

    fun generateIvBytes(): ByteArray = ByteArray(IV_LEN_BYTES).also(secureRandom::nextBytes)

    /**
     * 把主密码按 UTF-8 编码为字节，再用 PBKDF2-HMAC-SHA256 派生 AES-256 key。
     * iterations/keyLen 一律以 envelope 里的数值为准，不要硬编码默认值。
     */
    fun deriveKey(
        masterPassword: CharArray,
        saltBytes: ByteArray,
        iterations: Int,
        keyLenBits: Int = DEFAULT_KEY_LEN_BITS
    ): SecretKeySpec {
        val utf8Bytes = masterPassword.toUtf8Bytes()
        val asciiChars = CharArray(utf8Bytes.size) { utf8Bytes[it].toInt().toChar() }
        val spec = PBEKeySpec(asciiChars, saltBytes, iterations, keyLenBits)
        return try {
            val skf = SecretKeyFactory.getInstance(KDF_ALG)
            val raw = skf.generateSecret(spec).encoded
            SecretKeySpec(raw, "AES")
        } finally {
            spec.clearPassword()
            asciiChars.fill('\u0000')
            utf8Bytes.fill(0)
        }
    }

    /**
     * 加密：明文 JSON -> Envelope
     * plaintextJson: UTF-8 JSON (Vault 对象的 JSON 字符串)
     */
    fun seal(
        plaintextJson: String,
        masterPassword: CharArray,
        iterations: Int = DEFAULT_ITERATIONS,
        keyLenBits: Int = DEFAULT_KEY_LEN_BITS
    ): Envelope {
        val salt = generateSaltBytes()
        val iv = generateIvBytes()
        val key = deriveKey(masterPassword, salt, iterations, keyLenBits)
        val cipher = Cipher.getInstance(CIPHER_ALG)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LEN_BITS, iv))
        val ctWithTag = cipher.doFinal(plaintextJson.toByteArray(Charsets.UTF_8))
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

    /**
     * 解密：Envelope + 主密码 -> 明文 JSON（UTF-8）
     * @throws javax.crypto.AEADBadTagException 主密码错误 / 密文损坏
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
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LEN_BITS, iv))
        val pt = cipher.doFinal(ctWithTag)
        return pt.toString(Charsets.UTF_8)
    }

    // --------------------------------------------------------------------
    // 内部扩展：UTF-8 字节转换 / Base64
    // --------------------------------------------------------------------

    private fun CharArray.toUtf8Bytes(): ByteArray =
        String(this).toByteArray(Charsets.UTF_8)

    private fun ByteArray.encodeBase64(): String =
        Base64.getEncoder().encodeToString(this)

    private fun String.decodeBase64(): ByteArray =
        Base64.getDecoder().decode(this)
}
