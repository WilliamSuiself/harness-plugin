package com.memorypets.sync.local

import com.memorypets.core.model.Envelope
import kotlinx.coroutines.flow.Flow

/**
 * 本地持久化（方案 A · 推荐）：只保存整个加密 envelope + version/updatedAt，
 * 与 DSH 端模型完全一致。不做条目级 Room 索引（搜索在解锁后的内存 Vault 里做）。
 * 搜索性能不够时再切换到 方案 B（Room + SQLCipher 条目级加密索引）。
 */
interface VaultBlobStore {
    fun currentEnvelope(): Flow<Envelope?>
    fun currentVersion(): Flow<Long>
    suspend fun overwriteWithRemote(envelope: Envelope, newVersion: Long, updatedAtMs: Long)
    suspend fun saveLocal(envelope: Envelope)
    suspend fun confirmVersion(newVersion: Long, updatedAtMs: Long)
    suspend fun markDirty(dirty: Boolean)
    suspend fun isDirty(): Boolean
}
