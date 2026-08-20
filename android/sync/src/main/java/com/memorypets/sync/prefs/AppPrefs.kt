package com.memorypets.sync.prefs

import kotlinx.coroutines.flow.Flow

/**
 * App 偏好存储接口（仅存非明文！session token / serverUrl / username / 暗语 / 偏好开关；
 * 绝对不存 解锁密码、不存 云账号密码、不存 任何笔记明文）
 */
interface AppPrefs {
    val serverUrl: Flow<String>
    val username: Flow<String?>
    val sessionToken: Flow<String?>
    val darkMode: Flow<Boolean>
    val codewordGateEnabled: Flow<Boolean>
    val codewords: Flow<List<String>>
    val lastSyncVersion: Flow<Long>
    val lastSyncAt: Flow<Long>
    val deviceId: Flow<String>

    suspend fun setServerUrl(url: String)
    suspend fun setCloudAccount(username: String, token: String)
    suspend fun clearCloudAccount()
    suspend fun setDarkMode(enabled: Boolean)
    suspend fun setCodewordGateEnabled(enabled: Boolean)
    suspend fun setCodewords(words: List<String>)
    suspend fun markSynced(version: Long, atMs: Long)
}
