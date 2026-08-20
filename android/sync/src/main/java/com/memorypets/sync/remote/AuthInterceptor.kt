package com.memorypets.sync.remote

import com.memorypets.sync.prefs.AppPrefs
import dagger.Lazy
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 自动加 Authorization: Bearer <token>；
 * 收到 401 时抛 CloudAuthExpiredException，UI 层弹 Dialog 让用户重输云账号密码。
 * 安全红线：不持久化云账号密码本身，所以不能静默重登。
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val prefs: Lazy<AppPrefs>
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val token = runBlocking { prefs.get().sessionToken.first() }
        val request = chain.request().newBuilder()
            .apply {
                if (!token.isNullOrBlank()) {
                    header("Authorization", "Bearer $token")
                }
            }
            .build()
        val resp = chain.proceed(request)
        if (resp.code == 401 && !token.isNullOrBlank()) {
            resp.close()
            throw CloudAuthExpiredException()
        }
        return resp
    }
}
