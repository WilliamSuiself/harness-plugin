package com.memorypets.android.service

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.memorypets.core.model.SyncOutcome
import com.memorypets.sync.SyncOrchestrator
import com.memorypets.sync.prefs.AppPrefs
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/**
 * 后台周期同步 Worker（WorkManager，默认 15 分钟一次，最低频次）
 *   - 网络恢复自动触发 / 应用启动时入队
 *   - 无解锁密码 => 只拉（主密码不在内存时不会自动解密，只 GET /vault 看有没有新版本 ->
 *     有新就先存在 blobStore，等用户下次 unlock 时才真正解密落地。
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val syncOrchestrator: SyncOrchestrator,
    private val prefs: AppPrefs,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val token = prefs.sessionToken.first()
        if (token.isNullOrBlank()) return Result.success() // 未登录，啥也不做
        // 无主密码 => 只做 pull（若有新版本先记下版本号，用户 unlock 时解密）
        val out = syncOrchestrator.syncNow(masterPassword = null, buildLocalEnvelope = { null })
        return when (out) {
            is SyncOutcome.Pushed, is SyncOutcome.Pulled -> Result.success()
            is SyncOutcome.AuthExpired, is SyncOutcome.DecryptFailed,
            is SyncOutcome.ConflictNeedManual, is SyncOutcome.NetworkError -> Result.retry()
        }
    }

    companion object {
        private const val NAME = "memorypets_periodic_sync"

        fun enqueuePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(
                repeatInterval = 15,
                repeatIntervalTimeUnit = TimeUnit.MINUTES
            ).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                req
            )
        }
    }
}
