package com.memorypets.sync.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.gson.Gson
import com.memorypets.core.model.Envelope
import com.memorypets.core.model.KdfConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.blobDataStore by preferencesDataStore(name = "memorypets_vault_blob")

/**
 * 把整个 envelope JSON（加密后的 blob）+ version + dirty flag 存到 DataStore。
 * DataStore 是事务性的，不会出现半写。
 */
@Singleton
class VaultBlobStoreImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val gson: Gson
) : VaultBlobStore {

    private object Keys {
        val ENV_JSON = stringPreferencesKey("env_json")
        val KDF_SALT = stringPreferencesKey("env_kdf_salt")
        val KDF_ITER = longPreferencesKey("env_kdf_iter")
        val KDF_KEYLEN = longPreferencesKey("env_kdf_keylen")
        val CT = stringPreferencesKey("env_ct")
        val IV = stringPreferencesKey("env_iv")
        val VERSION = longPreferencesKey("env_version")
        val UPDATED_AT = longPreferencesKey("env_updated_at")
        val DIRTY = booleanPreferencesKey("env_dirty")
    }

    private val store: DataStore<Preferences> = context.blobDataStore

    override fun currentEnvelope(): Flow<Envelope?> = store.data.map { prefs ->
        val salt = prefs[Keys.KDF_SALT] ?: return@map null
        val iter = prefs[Keys.KDF_ITER] ?: return@map null
        val keylen = prefs[Keys.KDF_KEYLEN] ?: return@map null
        val ct = prefs[Keys.CT] ?: return@map null
        val iv = prefs[Keys.IV] ?: return@map null
        Envelope(
            version = 1,
            kdf = KdfConfig(salt = salt, iterations = iter.toInt(), keyLen = keylen.toInt()),
            ciphertext = ct,
            iv = iv
        )
    }

    override fun currentVersion(): Flow<Long> =
        store.data.map { it[Keys.VERSION] ?: 0L }

    override suspend fun overwriteWithRemote(
        envelope: Envelope,
        newVersion: Long,
        updatedAtMs: Long
    ) {
        store.edit { p ->
            p[Keys.KDF_SALT] = envelope.kdf.salt
            p[Keys.KDF_ITER] = envelope.kdf.iterations.toLong()
            p[Keys.KDF_KEYLEN] = envelope.kdf.keyLen.toLong()
            p[Keys.CT] = envelope.ciphertext
            p[Keys.IV] = envelope.iv
            p[Keys.VERSION] = newVersion
            p[Keys.UPDATED_AT] = updatedAtMs
            p[Keys.DIRTY] = false
        }
    }

    override suspend fun saveLocal(envelope: Envelope) {
        store.edit { p ->
            p[Keys.KDF_SALT] = envelope.kdf.salt
            p[Keys.KDF_ITER] = envelope.kdf.iterations.toLong()
            p[Keys.KDF_KEYLEN] = envelope.kdf.keyLen.toLong()
            p[Keys.CT] = envelope.ciphertext
            p[Keys.IV] = envelope.iv
            p[Keys.DIRTY] = true
        }
    }

    override suspend fun confirmVersion(newVersion: Long, updatedAtMs: Long) {
        store.edit { p ->
            p[Keys.VERSION] = newVersion
            p[Keys.UPDATED_AT] = updatedAtMs
            p[Keys.DIRTY] = false
        }
    }

    override suspend fun markDirty(dirty: Boolean) {
        store.edit { it[Keys.DIRTY] = dirty }
    }

    override suspend fun isDirty(): Boolean =
        store.data.map { it[Keys.DIRTY] ?: false }.let { flow ->
            var out = false
            flow.collect { out = it }
            out
        }
}
