package com.memorypets.sync.remote.dto

import com.google.gson.annotations.SerializedName

// ------- auth endpoints ---------
data class RegisterReq(
    @SerializedName("username") val username: String,
    @SerializedName("password") val password: String
)
data class RegisterResp(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("token") val token: String?,
    @SerializedName("error") val error: String?
)

data class LoginReq(
    @SerializedName("username") val username: String,
    @SerializedName("password") val password: String
)
data class LoginResp(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("token") val token: String?,
    @SerializedName("error") val error: String?
)

// ------- vault envelope DTO（和 core-model 的 Envelope 结构等价，分开是为了网络层解耦）---------
data class KdfConfigDTO(
    @SerializedName("salt") val salt: String,
    @SerializedName("iterations") val iterations: Int,
    @SerializedName("keyLen") val keyLen: Int
)
data class EnvelopeDTO(
    @SerializedName("version") val version: Int,
    @SerializedName("kdf") val kdf: KdfConfigDTO,
    @SerializedName("ciphertext") val ciphertext: String,
    @SerializedName("iv") val iv: String
)

// ------- GET /vault ---------
data class GetVaultResp(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("envelope") val envelope: EnvelopeDTO?,
    @SerializedName("version") val version: Long,
    @SerializedName("updatedAt") val updatedAt: Long?,
    @SerializedName("error") val error: String?,
    @SerializedName("conflict") val conflict: Boolean?,
    @SerializedName("deviceId") val deviceId: String?
)

// ------- PUT /vault ---------
data class PutVaultReq(
    @SerializedName("envelope") val envelope: EnvelopeDTO,
    @SerializedName("expectedVersion") val expectedVersion: Long,
    @SerializedName("deviceId") val deviceId: String
)
data class PutVaultResp(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("version") val version: Long?,
    @SerializedName("updatedAt") val updatedAt: Long?,
    @SerializedName("error") val error: String?,
    @SerializedName("conflict") val conflict: Boolean?,
    @SerializedName("current") val current: GetVaultResp?
)

// ------- DTO <-> Domain 转换 ---------
fun EnvelopeDTO.toDomain(): com.memorypets.core.model.Envelope =
    com.memorypets.core.model.Envelope(
        version = version,
        kdf = com.memorypets.core.model.KdfConfig(
            salt = kdf.salt,
            iterations = kdf.iterations,
            keyLen = kdf.keyLen
        ),
        ciphertext = ciphertext,
        iv = iv
    )

fun com.memorypets.core.model.Envelope.toDTO(): EnvelopeDTO =
    EnvelopeDTO(
        version = version,
        kdf = KdfConfigDTO(
            salt = kdf.salt,
            iterations = kdf.iterations,
            keyLen = kdf.keyLen
        ),
        ciphertext = ciphertext,
        iv = iv
    )
