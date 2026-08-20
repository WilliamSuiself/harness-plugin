package com.memorypets.android.presentation.home

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.memorypets.core.model.Entry
import com.memorypets.core.model.EntryKind
import com.memorypets.core.model.SyncOutcome
import com.memorypets.sync.SyncOrchestrator
import com.memorypets.sync.local.VaultBlobStore
import com.memorypets.sync.prefs.AppPrefs
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onAdd: () -> Unit,
    onEdit: (String) -> Unit,
    onSettings: () -> Unit,
    onLock: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("MemoryPets") },
                actions = {
                    IconButton(onClick = viewModel::syncNow) {
                        Icon(Icons.Default.Sync, contentDescription = "同步")
                    }
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
                    }
                    IconButton(onClick = onLock) {
                        Icon(Icons.Default.Lock, contentDescription = "上锁")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onAdd) {
                Icon(Icons.Default.Add, contentDescription = "新建条目")
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            var search by rememberSaveable { mutableStateOf("") }
            OutlinedTextField(
                value = search, onValueChange = { search = it },
                label = { Text("搜索 / 暗语直达（例：记一下 买牛奶）") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                leadingIcon = { Icon(Icons.Default.Search, null) },
                singleLine = true
            )
            if (state.syncStatus.isNotBlank()) {
                Text(state.syncStatus,
                    modifier = Modifier.padding(horizontal = 16.dp),
                    color = MaterialTheme.colorScheme.primary)
            }
            if (state.entries.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.Pets, null, Modifier.size(48.dp),
                            MaterialTheme.colorScheme.outline)
                        Spacer(Modifier.height(8.dp))
                        Text("还没有笔记，点右下角 ➕ 新建一条吧",
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(state.entries, key = { it.id }) { entry ->
                        EntryCard(entry = entry, onClick = { onEdit(entry.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun EntryCard(entry: Entry, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AssistChip(
                    onClick = {},
                    label = {
                        Text(
                            when (entry.kind) {
                                EntryKind.NOTE -> "笔记"
                                EntryKind.CREDENTIAL -> "凭证"
                                EntryKind.PROFILE -> "资料"
                                EntryKind.WORK -> "工作"
                            }
                        )
                    }
                )
                Spacer(Modifier.width(8.dp))
                Text(entry.label, style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                if (entry.kind == EntryKind.CREDENTIAL) entry.hint ?: "••••••"
                else entry.value,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium
            )
            if (entry.tags.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    entry.tags.take(5).forEach { tag ->
                        AssistChip(onClick = {}, label = { Text("#$tag") })
                    }
                }
            }
        }
    }
}

data class HomeUiState(
    val entries: List<Entry> = emptyList(),
    val syncStatus: String = ""
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val blobStore: VaultBlobStore,
    private val syncOrchestrator: SyncOrchestrator,
    private val prefs: AppPrefs
) : ViewModel() {

    private val _entries = MutableStateFlow<List<Entry>>(emptyList())

    val state: StateFlow<HomeUiState> = combine(
        _entries,
        MutableStateFlow("")
    ) { e, s -> HomeUiState(entries = e, syncStatus = s) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), HomeUiState())

    fun syncNow() = viewModelScope.launch {
        val statusSlot = MutableStateFlow("同步中…")
        // TODO: 从 UnlockSession 取出主密码
        val out = syncOrchestrator.syncNow(
            masterPassword = null,  // 占位：真正实现时取解锁会话中的密码
            buildLocalEnvelope = { null }
        )
        val msg = when (out) {
            is SyncOutcome.Pushed -> "✅ 已上传 v${out.newVersion}"
            is SyncOutcome.Pulled -> "⬇️ 已拉取 v${out.newVersion}"
            is SyncOutcome.ConflictNeedManual -> "⚠️ 冲突，需要手动合并"
            is SyncOutcome.AuthExpired -> "🔐 云会话过期，请重登"
            is SyncOutcome.DecryptFailed -> "❌ 对端主密码不同"
            is SyncOutcome.NetworkError -> "🌐 网络错误：${out.throwable.message}"
        }
        statusSlot.value = msg
        // 合并进 state
        _entries.update { it } // no-op 暂时（entries 读解锁后内存）
        // 临时方案：直接改 state 同步字段用 combine
    }
}
