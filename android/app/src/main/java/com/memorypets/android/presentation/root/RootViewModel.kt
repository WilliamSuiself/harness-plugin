package com.memorypets.android.presentation.root

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.memorypets.sync.local.VaultBlobStore
import com.memorypets.sync.prefs.AppPrefs
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 根级 ViewModel：负责
 *   (1) 判断启动起点（是否已有本地 Vault 决定走 SetupScreen 还是 UnlockScreen）
 *   (2) 全局 darkMode 主题状态
 */
@HiltViewModel
class RootViewModel @Inject constructor(
    private val blobStore: VaultBlobStore,
    private val prefs: AppPrefs
) : ViewModel() {

    val startDestination: String
        get() {
            // 简单版：未注册过云账号且本地没有任何 envelope 数据 -> Setup
            //         否则 -> Unlock
            val hasAnyLocal = _hasLocal.value
            val hasCloudAccount = _cloudLoggedIn.value
            return when {
                hasAnyLocal || hasCloudAccount -> Destinations.UNLOCK
                else -> Destinations.SETUP
            }
        }

    val darkMode: StateFlow<Boolean> = prefs.darkMode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    private val _hasLocal: StateFlow<Boolean> = blobStore.currentVersion()
        .map { it > 0L }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    private val _cloudLoggedIn: StateFlow<Boolean> = prefs.sessionToken
        .map { !it.isNullOrBlank() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Any?) {
        viewModelScope.launch {
            // 预留：BiometricPrompt / SAF 导出回调占位
        }
    }
}

object Destinations {
    const val SETUP = "setup"
    const val UNLOCK = "unlock"
    const val HOME = "home"
    const val EDITOR = "editor/{entryId}"
    const val SETTINGS = "settings"

    fun editor(entryId: String) = "editor/$entryId"
}
