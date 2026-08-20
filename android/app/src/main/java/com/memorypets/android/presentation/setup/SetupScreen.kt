package com.memorypets.android.presentation.setup

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pets
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.memorypets.sync.local.VaultBlobStore
import com.memorypets.sync.prefs.AppPrefs
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupScreen(
    onSetupDone: () -> Unit,
    viewModel: SetupViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    Scaffold(topBar = { TopAppBar(title = { Text("欢迎使用 MemoryPets") }) }) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(24.dp))
            Icon(Icons.Default.Pets, contentDescription = null,
                modifier = Modifier.size(72.dp), tint = MaterialTheme.colorScheme.primary)
            Text("第一步：设置解锁密码", style = MaterialTheme.typography.titleLarge)

            var pw by rememberSaveable { mutableStateOf("") }
            var pw2 by rememberSaveable { mutableStateOf("") }
            var words by rememberSaveable { mutableStateOf("记一下, 保存, 查一下, 导出") }
            OutlinedTextField(
                value = pw, onValueChange = { pw = it },
                label = { Text("解锁密码（≥ 6 位）") },
                visualTransformation = PasswordVisualTransformation(),
                isError = pw.length in 1..5,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = pw2, onValueChange = { pw2 = it },
                label = { Text("再输一遍") },
                visualTransformation = PasswordVisualTransformation(),
                isError = pw2.isNotEmpty() && pw2 != pw,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = words, onValueChange = { words = it },
                label = { Text("初始暗语（逗号分隔，可改）") },
                modifier = Modifier.fillMaxWidth()
            )

            Text(
                "可选 — 连接云同步 Relay（浏览器 ↔ 手机实时同步）",
                style = MaterialTheme.typography.titleMedium
            )
            var serverUrl by rememberSaveable { mutableStateOf(state.serverUrl) }
            var username by rememberSaveable { mutableStateOf("") }
            var cloudPw by rememberSaveable { mutableStateOf("") }
            OutlinedTextField(
                value = serverUrl, onValueChange = { serverUrl = it },
                label = { Text("服务器地址（例如 https://sync.example.com）") },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = username, onValueChange = { username = it },
                label = { Text("云账号用户名") },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = cloudPw, onValueChange = { cloudPw = it },
                label = { Text("云账号密码（与解锁密码互相独立）") },
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth()
            )

            if (state.error.isNotBlank()) {
                Text(state.error, color = MaterialTheme.colorScheme.error)
            }

            Button(
                onClick = {
                    viewModel.submit(
                        masterPassword = pw.takeIf { it == pw2 && it.length >= 6 }?.toCharArray(),
                        codewords = words.split(',', '，', ' ').map { it.trim() }.filter(String::isNotBlank),
                        serverUrl = serverUrl,
                        username = username.ifBlank { null },
                        cloudPassword = cloudPw.ifBlank { null }?.toCharArray(),
                        onDone = onSetupDone
                    )
                },
                enabled = pw.length >= 6 && pw == pw2 && state.loading.not(),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
            ) {
                if (state.loading) CircularProgressIndicator(Modifier.size(20.dp))
                else Text("完成 Setup")
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

data class SetupUiState(
    val loading: Boolean = false,
    val error: String = "",
    val serverUrl: String = AppPrefsImpl_DEFAULT_SERVER_URL
)

private const val AppPrefsImpl_DEFAULT_SERVER_URL = "https://sync.example.com"

@HiltViewModel
class SetupViewModel @Inject constructor(
    private val prefs: AppPrefs,
    private val blobStore: VaultBlobStore
) : ViewModel() {
    private val _state = MutableStateFlow(SetupUiState())
    val state: StateFlow<SetupUiState> = _state

    fun submit(
        masterPassword: CharArray?,
        codewords: List<String>,
        serverUrl: String,
        username: String?,
        cloudPassword: CharArray?,
        onDone: () -> Unit
    ) = viewModelScope.launch {
        if (masterPassword == null) {
            _state.value = _state.value.copy(error = "解锁密码至少 6 位且两次一致")
            return@launch
        }
        _state.value = _state.value.copy(loading = true, error = "")
        runCatching {
            prefs.setServerUrl(serverUrl)
            prefs.setCodewords(codewords)
            if (!username.isNullOrBlank() && cloudPassword != null) {
                // TODO: 调用 CloudSyncApi.register 或 login；成功后 setCloudAccount(username, token)
            }
        }.onFailure { t ->
            _state.value = _state.value.copy(error = t.message ?: "setup failed")
        }.onSuccess { onDone() }
        _state.value = _state.value.copy(loading = false)
    }
}
