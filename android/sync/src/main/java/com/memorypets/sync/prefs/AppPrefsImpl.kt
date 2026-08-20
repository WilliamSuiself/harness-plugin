package com.memorypets.sync.prefs

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "memorypets_app_prefs")

@Singleton
class AppPrefsImpl @Inject constructor(
    @ApplicationContext private val context: Context
) : AppPrefs {

    private object Keys {
        val SERVER_URL = stringPreferencesKey("server_url")
        val USERNAME = stringPreferencesKey("username")
        val SESSION_TOKEN = stringPreferencesKey("session_token")
        val DARK_MODE = booleanPreferencesKey("dark_mode")
        val CG_ENABLED = booleanPreferencesKey("codeword_gate_enabled")
        val CODEWORDS = stringSetPreferencesKey("codewords")
        val LAST_SYNC_VER = longPreferencesKey("last_sync_version")
        val LAST_SYNC_AT = longPreferencesKey("last_sync_at")
        val DEVICE_ID = stringPreferencesKey("device_id")
    }

    override val serverUrl: Flow<String> =
        context.dataStore.data.map { it[Keys.SERVER_URL] ?: DEFAULT_SERVER_URL }

    override val username: Flow<String?> =
        context.dataStore.data.map { it[Keys.USERNAME] }

    override val sessionToken: Flow<String?> =
        context.dataStore.data.map { it[Keys.SESSION_TOKEN] }

    override val darkMode: Flow<Boolean> =
        context.dataStore.data.map { it[Keys.DARK_MODE] ?: false }

    override val codewordGateEnabled: Flow<Boolean> =
        context.dataStore.data.map { it[Keys.CG_ENABLED] ?: true }

    override val codewords: Flow<List<String>> =
        context.dataStore.data.map { (it[Keys.CODEWORDS] ?: emptySet()).toList() }

    override val lastSyncVersion: Flow<Long> =
        context.dataStore.data.map { it[Keys.LAST_SYNC_VER] ?: 0L }

    override val lastSyncAt: Flow<Long> =
        context.dataStore.data.map { it[Keys.LAST_SYNC_AT] ?: 0L }

    override val deviceId: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[Keys.DEVICE_ID] ?: run {
            val newId = UUID.randomUUID().toString()
            // 异步写入；下一次读取会命中
            kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                context.dataStore.edit { it[Keys.DEVICE_ID] = newId }
            }
            newId
        }
    }

    override suspend fun setServerUrl(url: String) {
        context.dataStore.edit { it[Keys.SERVER_URL] = url }
    }

    override suspend fun setCloudAccount(username: String, token: String) {
        context.dataStore.edit {
            it[Keys.USERNAME] = username
            it[Keys.SESSION_TOKEN] = token
        }
    }

    override suspend fun clearCloudAccount() {
        context.dataStore.edit {
            it.remove(Keys.USERNAME)
            it.remove(Keys.SESSION_TOKEN)
        }
    }

    override suspend fun setDarkMode(enabled: Boolean) {
        context.dataStore.edit { it[Keys.DARK_MODE] = enabled }
    }

    override suspend fun setCodewordGateEnabled(enabled: Boolean) {
        context.dataStore.edit { it[Keys.CG_ENABLED] = enabled }
    }

    override suspend fun setCodewords(words: List<String>) {
        context.dataStore.edit { it[Keys.CODEWORDS] = words.toSet() }
    }

    override suspend fun markSynced(version: Long, atMs: Long) {
        context.dataStore.edit {
            it[Keys.LAST_SYNC_VER] = version
            it[Keys.LAST_SYNC_AT] = atMs
        }
    }

    suspend fun firstRunEnsureDeviceId(): String {
        val current = deviceId.first()
        if (current.isNotBlank()) return current
        val id = UUID.randomUUID().toString()
        context.dataStore.edit { it[Keys.DEVICE_ID] = id }
        return id
    }

    companion object {
        const val DEFAULT_SERVER_URL = "https://sync.example.com"
    }
}
