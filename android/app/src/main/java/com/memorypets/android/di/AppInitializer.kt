package com.memorypets.android.di

import android.app.Application
import androidx.work.Configuration
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * App 启动时的一次性初始化（WorkManager 自定义配置 + 日志树）。
 */
@Singleton
class AppInitializer @Inject constructor() : Configuration.Provider {

    fun onCreate(app: Application) {
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }
        WorkManager.initialize(app, workManagerConfiguration)
    }

    override fun getWorkManagerConfiguration(): Configuration =
        Configuration.Builder()
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) android.util.Log.DEBUG else android.util.Log.INFO)
            .build()
}
