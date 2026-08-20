package com.memorypets.sync

import com.memorypets.core.crypto.VaultCrypto
import com.memorypets.core.model.Envelope
import com.memorypets.core.model.SyncOutcome
import com.memorypets.sync.local.VaultBlobStore
import com.memorypets.sync.prefs.AppPrefs
import com.memorypets.sync.remote.CloudSyncApi
import com.memorypets.sync.remote.CloudAuthExpiredException
import com.memorypets.sync.remote.dto.PutVaultReq
import com.memorypets.sync.remote.dto.toDTO
import com.memorypets.sync.remote.dto.toDomain
import dagger.Lazy
import kotlinx.coroutines.flow.first
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton
import javax.crypto.AEADBadTagException

/**
 * 云同步编排器 —— 与 packages/host/lib/cloud-sync.mjs 的 push / pull / confirmVersion 语义对齐。
 *
 * 乐观并发流程：
 *   1) GET /vault -> remoteVersion
 *   2) remoteVersion > 本地 currentVersion -> 解密 remote envelope -> 采用（失败则 ConflictNeedManual）
 *   3) 本地有改动 (dirty flag) 或本地版本 0 -> PUT /vault (expectedVersion = lastReadVersion)
 *        200 -> confirmVersion(v+1)
 *        409 -> 读取 current.envelope -> 解密采用 -> 再 PUT 一次 expectedVersion=current.version
 *                 仍 409 -> ConflictNeedManual 交给用户
 */
@Singleton
class SyncOrchestrator @Inject constructor(
    private val api: Lazy<CloudSyncApi>,
    private val blobStore: VaultBlobStore,
    private val prefs: AppPrefs,
) {

    /**
     * @param masterPassword 当前解锁会话中的主密码（仅解密冲突时使用；调用方用完立即置 null）
     * @param buildLocalEnvelope 若本地有脏数据，调用此 lambda 得到最新密封好的 Envelope
     */
    suspend fun syncNow(
        masterPassword: CharArray?,
        buildLocalEnvelope: suspend () -> Envelope?
    ): SyncOutcome {
        val token = prefs.sessionToken.first()
            ?: return SyncOutcome.AuthExpired("not logged in")
        val bearer = "Bearer $token"
        val deviceId = prefs.deviceId.first()

        return try {
            // 1) GET remote
            val getResp = api.get().getVault(bearer)
            if (!getResp.isSuccessful || getResp.body()?.ok != true) {
                val code = getResp.code()
                if (code == 401) return SyncOutcome.AuthExpired("token rejected")
                return SyncOutcome.NetworkError(
                    RuntimeException("GET /vault failed HTTP $code")
                )
            }
            val body = getResp.body()!!
            val remoteVersion = body.version
            val remoteEnv = body.envelope

            var adoptedRemote = false

            // 2) 有远程密文 & 更新 -> 拉取 & 解密采用
            if (remoteEnv != null && remoteVersion > blobStore.currentVersion().first()) {
                if (masterPassword == null) {
                    return SyncOutcome.ConflictNeedManual(
                        theirVersion = remoteVersion,
                        myVersion = blobStore.currentVersion().first()
                    )
                }
                try {
                    VaultCrypto.unlock(remoteEnv.toDomain(), masterPassword) // 先验证能解开再落盘
                    blobStore.overwriteWithRemote(
                        envelope = remoteEnv.toDomain(),
                        newVersion = remoteVersion,
                        updatedAtMs = body.updatedAt ?: System.currentTimeMillis()
                    )
                    prefs.markSynced(remoteVersion, System.currentTimeMillis())
                    adoptedRemote = true
                } catch (e: AEADBadTagException) {
                    return SyncOutcome.DecryptFailed(
                        "remote vault sealed with different master password"
                    )
                }
            }

            // 3) 本地有脏改动 / 从未提交过 -> push
            val localDirty = blobStore.isDirty()
            val nothingOnRemote = remoteVersion == 0L && remoteEnv == null
            if (!localDirty && !nothingOnRemote) {
                return if (adoptedRemote)
                    SyncOutcome.Pulled(remoteVersion, remoteAdopted = true)
                else
                    SyncOutcome.Pushed(remoteVersion)
            }

            val myEnv = buildLocalEnvelope()
                ?: run {
                    return if (adoptedRemote) SyncOutcome.Pulled(remoteVersion, true)
                           else SyncOutcome.Pushed(remoteVersion)
                }

            val expectedVersion = maxOf(remoteVersion, blobStore.currentVersion().first())
            val firstPut = putVaultWithRetry(bearer, myEnv, expectedVersion, deviceId)
            if (firstPut is SyncOutcome.Pushed) {
                blobStore.confirmVersion(firstPut.newVersion, System.currentTimeMillis())
                prefs.markSynced(firstPut.newVersion, System.currentTimeMillis())
                return firstPut
            }
            // 409 -> retry once
            if (firstPut is SyncOutcome.ConflictNeedManual) {
                val theirVersion = firstPut.theirVersion
                val theirEnvDto = fetchCurrentEnvAfter409(bearer)?.envelope
                    ?: return SyncOutcome.NetworkError(RuntimeException("failed to refetch winner after 409"))
                if (masterPassword != null) {
                    try {
                        VaultCrypto.unlock(theirEnvDto.toDomain(), masterPassword)
                        blobStore.overwriteWithRemote(
                            theirEnvDto.toDomain(), theirVersion, System.currentTimeMillis()
                        )
                    } catch (_: AEADBadTagException) {
                        return SyncOutcome.DecryptFailed("different master password on 409 winner")
                    }
                }
                // retry PUT with the winner version
                val retry = putVaultWithRetry(bearer, myEnv, theirVersion, deviceId)
                return when (retry) {
                    is SyncOutcome.Pushed -> {
                        blobStore.confirmVersion(retry.newVersion, System.currentTimeMillis())
                        prefs.markSynced(retry.newVersion, System.currentTimeMillis())
                        SyncOutcome.Pushed(retry.newVersion)
                    }
                    else -> retry
                }
            }
            firstPut
        } catch (e: CloudAuthExpiredException) {
            SyncOutcome.AuthExpired(e.message ?: "session expired")
        } catch (e: HttpException) {
            if (e.code() == 401) SyncOutcome.AuthExpired("401")
            else SyncOutcome.NetworkError(e)
        } catch (t: Throwable) {
            SyncOutcome.NetworkError(t)
        }
    }

    private suspend fun putVaultWithRetry(
        bearer: String,
        env: Envelope,
        expectedVersion: Long,
        deviceId: String
    ): SyncOutcome {
        val req = PutVaultReq(
            envelope = env.toDTO(),
            expectedVersion = expectedVersion,
            deviceId = deviceId
        )
        val resp = runCatching { api.get().putVault(bearer, req) }.getOrElse {
            return if (it is HttpException && it.code() == 409) {
                val winner = fetchCurrentEnvAfter409(bearer) ?: return SyncOutcome.NetworkError(RuntimeException("no winner"))
                SyncOutcome.ConflictNeedManual(winner.version, expectedVersion)
            } else SyncOutcome.NetworkError(it)
        }
        return when (resp.code()) {
            200 -> {
                val body = resp.body()!!
                if (body.ok) SyncOutcome.Pushed(body.version!!)
                else SyncOutcome.NetworkError(RuntimeException(body.error ?: "put failed"))
            }
            409 -> {
                val winner = resp.body()?.current?.version
                    ?: fetchCurrentEnvAfter409(bearer)?.version
                    ?: return SyncOutcome.NetworkError(RuntimeException("409 missing current"))
                SyncOutcome.ConflictNeedManual(winner, expectedVersion)
            }
            401 -> SyncOutcome.AuthExpired("401")
            else -> SyncOutcome.NetworkError(
                RuntimeException("PUT /vault HTTP ${resp.code()} ${resp.errorBody()?.string()}")
            )
        }
    }

    private suspend fun fetchCurrentEnvAfter409(bearer: String) =
        runCatching { api.get().getVault(bearer).body() }.getOrNull()
}
