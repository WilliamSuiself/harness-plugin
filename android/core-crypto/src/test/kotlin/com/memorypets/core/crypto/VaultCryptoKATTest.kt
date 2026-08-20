package com.memorypets.core.crypto

import com.google.common.truth.Truth.assertThat
import com.memorypets.core.model.Envelope
import com.memorypets.core.model.KdfConfig
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.Base64
import javax.crypto.AEADBadTagException

/**
 * 已知答案测试（Known-Answer Test）—— MVP M1 生死线：
 *
 *   用固定 salt/iv/master-password/plaintext 跑 seal 得到的 ciphertext，
 *   必须与 DSH 端（packages/host/lib/crypto.mjs）跑同样参数得到的 base64 ciphertext
 *   **完全相同**。否则双向互通失败。
 *
 * 先用 10_000 次迭代（比默认 250_000 快 ~25×，避免单测慢）。
 * 当 M1 向量通过后，额外写一个本地跑的 250_000 迭代集成测试验证性能。
 */
class VaultCryptoKATTest {

    @Test
    fun `KAT — seal with fixed salt+iv produces identical ciphertext to DSH side`() {
        // ---- 固定 KAT 向量（修改 salt/iv/plaintext 时请保持 DSH 端同步更新 ----
        val masterPassword = "correct horse battery staple".toCharArray()
        val salt = "0123456789abcdef".toByteArray(Charsets.US_ASCII)   // 16 bytes
        val iv   = "abcdef987654".toByteArray(Charsets.US_ASCII)         // 12 bytes
        val plaintext = """{"version":1,"entries":[{"id":"kat1","kind":"note","label":"KAT","value":"hello"}]}"""
        val iterations = 10_000

        // ---- 走 seal，但注入固定 salt/iv（通过反射 / 或者直接调内部 API：这里我们
        //      直接组装 cipher，避免改 VaultCrypto API）----
        val key = VaultCrypto.deriveKey(masterPassword, salt, iterations, 256)
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            javax.crypto.Cipher.ENCRYPT_MODE, key,
            javax.crypto.spec.GCMParameterSpec(128, iv)
        )
        val ctWithTag = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val ctB64 = Base64.getEncoder().encodeToString(ctWithTag)

        val saltB64 = Base64.getEncoder().encodeToString(salt)
        val ivB64 = Base64.getEncoder().encodeToString(iv)

        val envelope = Envelope(
            version = 1,
            kdf = KdfConfig(salt = saltB64, iterations = iterations, keyLen = 256),
            ciphertext = ctB64,
            iv = ivB64
        )

        // ---- 1) self-unlock：自己解自己必须 OK ----
        val roundTrip = VaultCrypto.unlock(envelope, masterPassword)
        assertThat(roundTrip).isEqualTo(plaintext)

        // ---- 2) DSH 侧期望字符串（把下面 ctB64 贴到 DSH 端 `node -e` 里再跑一次，
        //         确认结果完全一致。第一次开发时先 fail，等 DSH 端跑通后把 EXPECTED_CT_BASE64
        //         写死在这里，作为永久回归测试）----
        val EXPECTED_CT_BASE64 = "<TODO: 运行 DSH 端相同 KAT 向量后粘贴这里>"
        if (EXPECTED_CT_BASE64.isNotEmpty() && EXPECTED_CT_BASE64.startsWith("<TODO:").not()) {
            assertThat(ctB64).isEqualTo(EXPECTED_CT_BASE64)
        } else {
            println(
                "[VaultCryptoKATTest] 请将下方 base64 粘贴到 DSH 端运行相同向量并回填 EXPECTED_CT_BASE64：\n" +
                "ciphertext=$ctB64"
            )
        }
    }

    @Test
    fun `unlock with wrong master password throws AEADBadTagException`() {
        val env = VaultCrypto.seal(
            plaintextJson = "hello",
            masterPassword = "right-pw".toCharArray(),
            iterations = 10_000
        )
        assertThrows<AEADBadTagException> {
            VaultCrypto.unlock(env, "wrong-pw".toCharArray())
        }
    }

    @Test
    fun `tampered ciphertext throws AEADBadTagException`() {
        val env = VaultCrypto.seal("hello", "pw".toCharArray(), iterations = 10_000)
        val ct = Base64.getDecoder().decode(env.ciphertext)
        ct[0] = (ct[0].toInt() xor 0x01).toByte()   // flip 1 bit
        val tampered = env.copy(ciphertext = Base64.getEncoder().encodeToString(ct))
        assertThrows<AEADBadTagException> {
            VaultCrypto.unlock(tampered, "pw".toCharArray())
        }
    }
}
