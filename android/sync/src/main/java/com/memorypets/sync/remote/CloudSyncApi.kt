package com.memorypets.sync.remote

import com.memorypets.sync.remote.dto.*
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT

/**
 * 云同步 Relay REST API（与 MOBILE_SYNC_API.md §3 完全一致）
 *   Base URL：由 AppPrefs.serverUrl 注入到 Retrofit.Builder 里
 *   token：由 AuthInterceptor 自动加 Authorization: Bearer，401 抛 CloudAuthExpiredException
 */
interface CloudSyncApi {

    @POST("/accounts/register")
    suspend fun register(@Body req: RegisterReq): Response<RegisterResp>

    @POST("/accounts/login")
    suspend fun login(@Body req: LoginReq): Response<LoginResp>

    @GET("/vault")
    suspend fun getVault(@Header("Authorization") bearer: String): Response<GetVaultResp>

    @PUT("/vault")
    suspend fun putVault(
        @Header("Authorization") bearer: String,
        @Body req: PutVaultReq
    ): Response<PutVaultResp>
}

class CloudAuthExpiredException(message: String = "cloud session expired, please re-login") :
    Exception(message)
