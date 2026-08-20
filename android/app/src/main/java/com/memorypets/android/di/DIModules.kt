package com.memorypets.android.di

import android.content.Context
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.memorypets.sync.local.VaultBlobStore
import com.memorypets.sync.local.VaultBlobStoreImpl
import com.memorypets.sync.prefs.AppPrefs
import com.memorypets.sync.prefs.AppPrefsImpl
import com.memorypets.sync.remote.AuthInterceptor
import com.memorypets.sync.remote.CloudSyncApi
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides @Singleton
    fun provideGson(): Gson = GsonBuilder().create()

    @Provides @Singleton
    fun provideOkHttpClient(
        authInterceptor: AuthInterceptor
    ): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        return OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .build()
    }

    @Provides @Singleton
    fun provideRetrofit(
        client: OkHttpClient,
        gson: Gson,
        prefs: AppPrefs  // 保证 baseUrl 读取链路
    ): Retrofit {
        // Base URL 在运行时通过 AppPrefs.serverUrl 变化；
        // Retrofit baseUrl 默认仅用于构造；真正的动态 baseUrl 可用 @Url 覆盖，
        // 我们简单方案：在 CloudSyncApi 接口里让 CloudBaseUrlInterceptor 动态改 URL。
        // MVP 阶段先用占位符 baseUrl（要求用户第一次启动 Setup 填好地址）。
        val defaultBaseUrl = runBlockingRead(prefs) { serverUrl }
            .takeIf { it.startsWith("http") }
            ?: AppPrefsImpl.DEFAULT_SERVER_URL
        return Retrofit.Builder()
            .client(client)
            .baseUrl(defaultBaseUrl)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
    }

    @Provides @Singleton
    fun provideCloudSyncApi(retrofit: Retrofit): CloudSyncApi =
        retrofit.create(CloudSyncApi::class.java)

    private fun <T> runBlockingRead(
        prefs: AppPrefs,
        selector: AppPrefs.() -> kotlinx.coroutines.flow.Flow<T>
    ): T {
        var out: T? = null
        runBlocking { prefs.selector().collect { out = it; return@collect } }
        @Suppress("UNCHECKED_CAST")
        return out as T
    }

    private fun runBlocking(block: suspend () -> Unit) {
        kotlinx.coroutines.runBlocking(kotlinx.coroutines.Dispatchers.IO) { block() }
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class BindModule {

    @Binds @Singleton
    abstract fun bindAppPrefs(impl: AppPrefsImpl): AppPrefs

    @Binds @Singleton
    abstract fun bindBlobStore(impl: VaultBlobStoreImpl): VaultBlobStore
}

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides @Singleton
    fun provideAppContext(@ApplicationContext ctx: Context): Context = ctx
}
