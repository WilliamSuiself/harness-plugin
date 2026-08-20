package com.memorypets.android.presentation.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.memorypets.sync.prefs.AppPrefs
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("设置") },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, null) }
            }
        )
    }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())
        ) {
            SectionCard(icon = Icons.Default.CloudSync, title = "云同步") {
                var url by remember(state.serverUrl) { mutableStateOf(state.serverUrl) }
                OutlinedTextField(
                    value = url, onValueChange = { url = it },
                    label = { Text("服务器地址") },
                    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)
                )
                Text(
                    "已登录：${if (state.loggedIn) state.username ?: "—" else "未登录"}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (state.syncInfo.isNotBlank()) {
                    Text(state.syncInfo, color = MaterialTheme.colorScheme.primary)
                }
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = { viewModel.saveServerUrl(url) }
                    ) { Text("保存地址") }
                    if (state.loggedIn) {
                        OutlinedButton(onClick = viewModel::logout) { Text("登出") }
                    }
                }
            }

            SectionCard(icon = Icons.Default.Lock, title = "安全") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("改解锁密码", Modifier.weight(1f))
                    OutlinedButton(onClick = { /* TODO: 旧密码 -> 重新 seal */ }) {
                        Text("修改")
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("生物识别快捷解锁", Modifier.weight(1f))
                    Switch(checked = state.biometricEnabled, onCheckedChange = {
                        viewModel.setBiometric(it)
                    })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("防止截图 / 录屏", Modifier.weight(1f))
                    Switch(checked = state.secureWindow, onCheckedChange = viewModel::setSecureWindow)
                }
            }

            SectionCard(icon = Icons.Default.SmartToy, title = "暗语直达") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("启用暗语门槛", Modifier.weight(1f))
                    Switch(checked = state.codewordGateEnabled, onCheckedChange = viewModel::setGateEnabled)
                }
                Spacer(Modifier.height(6.dp))
                var words by remember(state.codewordsStr) { mutableStateOf(state.codewordsStr) }
                OutlinedTextField(
                    value = words, onValueChange = { words = it },
                    label = { Text("暗语列表（逗号 / 空格分隔）") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(6.dp))
                OutlinedButton(
                    onClick = {
                        val list = words.split(',', '，', ' ')
                            .map { it.trim() }.filter(String::isNotBlank)
                        viewModel.saveCodewords(list)
                    }
                ) { Text("保存暗语") }
            }

            SectionCard(title = "通用") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("深色主题", Modifier.weight(1f))
                    Switch(checked = state.darkMode, onCheckedChange = viewModel::setDarkMode)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { /* TODO: 导出 Markdown SAF */ }) {
                        Text("导出 Markdown…")
                    }
                    OutlinedButton(onClick = { /* TODO: 同步一下 */ }) {
                        Text("立即同步")
                    }
                }
                Spacer(Modifier.height(16.dp))
                Text(
                    "版本 ${state.versionName}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelSmall
                )
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
private fun SectionCard(
    icon: ImageVector? = null,
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
        if (icon != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Text(title, style = MaterialTheme.typography.titleMedium)
            }
        } else {
            Text(title, style = MaterialTheme.typography.titleMedium)
        }
        Spacer(Modifier.height(8.dp))
        ElevatedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), content = content)
        }
    }
}

data class SettingsUiState(
    val serverUrl: String = "",
    val loggedIn: Boolean = false,
    val username: String? = null,
    val syncInfo: String = "",
    val darkMode: Boolean = false,
    val codewordGateEnabled: Boolean = true,
    val codewordsStr: String = "",
    val biometricEnabled: Boolean = false,
    val secureWindow: Boolean = true,
    val versionName: String = "0.1.0"
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val prefs: AppPrefs
) : ViewModel() {

    val state: StateFlow<SettingsUiState> = combine(
        prefs.serverUrl,
        prefs.username,
        prefs.sessionToken,
        prefs.darkMode,
        prefs.codewordGateEnabled,
        prefs.codewords,
        prefs.lastSyncVersion,
        prefs.lastSyncAt
    ) { array ->
        val url = array[0] as String
        val user = array[1] as? String
        val token = array[2] as? String
        val dark = array[3] as Boolean
        val gate = array[4] as Boolean
        val words = array[5] as? List<*>
        val ver = array[6] as Long
        val at = array[7] as Long
        val date = if (at > 0L) java.text.SimpleDateFormat.getDateTimeInstance()
            .format(java.util.Date(at)) else "从未"
        SettingsUiState(
            serverUrl = url,
            loggedIn = !token.isNullOrBlank(),
            username = user,
            syncInfo = "当前版本 v$ver · 上次同步 $date",
            darkMode = dark,
            codewordGateEnabled = gate,
            codewordsStr = words.orEmpty().filterIsInstance<String>().joinToString(", ")
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SettingsUiState())

    fun saveServerUrl(url: String) = viewModelScope.launch { prefs.setServerUrl(url.trim()) }

    fun logout() = viewModelScope.launch { prefs.clearCloudAccount() }

    fun setBiometric(enabled: Boolean) { /* TODO: 生成 Keystore Key + 包会话密码 */ }

    fun setSecureWindow(enabled: Boolean) { /* TODO: Activity.window.setFlags FLAG_SECURE */ }

    fun setDarkMode(v: Boolean) = viewModelScope.launch { prefs.setDarkMode(v) }

    fun setGateEnabled(v: Boolean) = viewModelScope.launch { prefs.setCodewordGateEnabled(v) }

    fun saveCodewords(list: List<String>) = viewModelScope.launch { prefs.setCodewords(list) }
}
