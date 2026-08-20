package com.memorypets.core.model

/**
 * 笔记条目（与 MOBILE_SYNC_API.md §2 明文 JSON 字段完全一致）
 * 所有字段名与默认值必须与 packages/host/lib/intent.mjs / operations.mjs 对齐。
 */
data class Entry(
    val id: String,
    val kind: EntryKind,
    val label: String,
    val value: String,
    val tags: List<String> = emptyList(),
    val dueDate: String? = null,      // ISO date YYYY-MM-DD，仅对 note 有意义
    val hint: String? = null,         // 仅 credential 有：非秘密 hint（如 ends 8a1f）
    val createdAt: Long,              // epoch ms
    val updatedAt: Long               // epoch ms
)

enum class EntryKind(val raw: String) {
    NOTE("note"),
    CREDENTIAL("credential"),
    PROFILE("profile"),               // legacy：与 NOTE 等价展示
    WORK("work");                     // legacy：与 NOTE 等价展示

    companion object {
        fun fromRaw(raw: String): EntryKind =
            entries.firstOrNull { it.raw == raw } ?: NOTE
    }
}
