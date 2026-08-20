package com.memorypets.android.presentation.unlock

import android.app.Activity
import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.memorypets.core.crypto.VaultCrypto
import com.memorypets.sync.local.VaultBlobStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UnlockScreen(
    onUnlock: () -> Unit,
    goSetup: () -> Unit,
    viewModel: UnlockViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val ctx = LocalContext.current
    Scaffold(topBar = { TopAppBar(title = { Text("解锁 MemoryPets") }) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(Modifier.height(32.dp))
            Icon(Icons.Default.Lock, null,
                Modifier.size(64.dp), MaterialTheme.colorScheme.primary)
            Text("请输入解锁密码", style = MaterialTheme.typography.titleLarge)

            var pw by rememberSaveable { mutableStateOf("") }
            OutlinedTextField(
                value = pw, onValueChange = { pw = it },
                label = { Text("解锁密码") },
                visualTransformation = PasswordVisualTransformation(),
                isError = state.badPassword,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = {
                    viewModel.unlock(pw.toCharArray(), onUnlock)
                }),
                modifier = Modifier.fillMaxWidth()
            )
            if (state.badPassword) {
                Text("密码错误或密文损坏", color = MaterialTheme.colorScheme.error)
            }
            val canBiometric = remember(ctx) {
                val mgr = BiometricManager.from(ctx)
                mgr.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
                    BiometricManager.BIOMETRIC_SUCCESS
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    onClick = { viewModel.unlock(pw.toCharArray(), onUnlock) },
                    enabled = state.loading.not() && pw.isNotBlank(),
                    modifier = Modifier.weight(1f)
                ) {
                    if (state.loading) CircularProgressIndicator(Modifier.size(20.dp))
                    else Text("解锁")
                }
                if (canBiometric) {
                    OutlinedButton(
                        onClick = {
                            showBiometricPrompt(
                                activity = ctx as? FragmentActivity ?: return@OutlinedButton,
                                onSuccess = { viewModel.onBiometricSuccess(onUnlock) }
                            )
                        }
                    ) { Icon(Icons.Default.Fingerprint, null) }
                }
            }
            TextButton(onClick = goSetup) {
                Text("第一次使用？前往 Setup")
            }
        }
    }
}

private fun showBiometricPrompt(
    activity: FragmentActivity,
    onSuccess: () -> Unit
) {
    val executor = ContextCompat.getMainExecutor(activity as Context)
    val prompt = BiometricPrompt(activity, executor,
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                super.onAuthenticationSucceeded(result)
                onSuccess()
            }
        })
    val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle("用指纹/面部解锁 MemoryPets")
        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL)
        .build()
    prompt.authenticate(info)
}

data class UnlockUiState(
    val loading: Boolean = false,
    val badPassword: Boolean = false
)

@HiltViewModel
class UnlockViewModel @Inject constructor(
    private val blobStore: VaultBlobStore,
) : ViewModel() {
    private val _state = MutableStateFlow(UnlockUiState())
    val state: StateFlow<UnlockUiState> = _state

    fun unlock(password: CharArray, onUnlock: () -> Unit) = viewModelScope.launch {
        _state.value = UnlockUiState(loading = true)
        val env = blobStore.currentEnvelope().first()
        val ok = runCatching {
            if (env != null) VaultCrypto.unlock(env, password)
            else Unit  // 还没任何数据，任何密码都放行（Setup 未完成情形）
        }
        if (ok.isSuccess) {
            _state.value = UnlockUiState()
            // TODO: 保存到解锁会话单例（UnlockSession）供后续 CRUD 与同步使用
            onUnlock()
        } else {
            _state.value = UnlockUiState(badPassword = true)
        }
    }

    fun onBiometricSuccess(onUnlock: () -> Unit) {
        // TODO: 从 Keystore 解密出会话级主密码缓存，然后与 unlock() 同逻辑
        _state.value = UnlockUiState()
        onUnlock()
    }
}
