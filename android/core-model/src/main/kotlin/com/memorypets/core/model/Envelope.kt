package com.memorypets.core.model

/**
 * 加密信封（与 packages/host/lib/vault.mjs 的 envelope 字段完全对齐）
 * base64 编码规则：标准 Base64（非 URL-safe、无换行），与 Node Buffer.toString('base64') 一致。
 */
data class Envelope(
    val version: Int = 1,
    val kdf: KdfConfig,
    val ciphertext: String,
    val iv: String
)

data class KdfConfig(
    val salt: String,          // base64, 16 raw bytes
    val iterations: Int,       // default 250_000
    val keyLen: Int            // default 256 bits
)
