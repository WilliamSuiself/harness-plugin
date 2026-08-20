package com.memorypets.core.model

sealed interface SyncOutcome {
    data class Pushed(val newVersion: Long) : SyncOutcome
    data class Pulled(val newVersion: Long, val remoteAdopted: Boolean) : SyncOutcome
    data class ConflictNeedManual(
        val theirVersion: Long,
        val myVersion: Long
    ) : SyncOutcome
    data class AuthExpired(val reason: String) : SyncOutcome
    data class DecryptFailed(val reason: String) : SyncOutcome
    data class NetworkError(val throwable: Throwable) : SyncOutcome
}
