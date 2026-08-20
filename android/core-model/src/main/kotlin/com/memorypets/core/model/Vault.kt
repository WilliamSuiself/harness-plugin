package com.memorypets.core.model

/**
 * 解密后的 Vault 明文对象（对应用户整本笔记本）。
 * 与 DSH 端 unlock 后得到的 JSON 结构完全一致。
 */
data class Vault(
    val version: Int = 1,
    val entries: List<Entry> = emptyList()
)
