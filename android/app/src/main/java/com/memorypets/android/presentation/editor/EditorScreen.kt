package com.memorypets.android.presentation.editor

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.memorypets.core.model.Entry
import com.memorypets.core.model.EntryKind
import com.memorypets.sync.local.VaultBlobStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(
    entryId: String,
    onBack: () -> Unit,
    viewModel: EditorViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(entryId) { viewModel.load(entryId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (entryId == "new") "新建条目" else "编辑条目") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, null)
                    }
                },
                actions = {
                    if (entryId != "new") {
                        IconButton(onClick = { viewModel.delete { onBack() } }) {
                            Icon(Icons.Default.Delete, contentDescription = "删除")
                        }
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Spacer(Modifier.height(8.dp))
            var kind by rememberSaveable(stateSaver = EntryKindSaver) {
                mutableStateOf(state.kind)
            }
            var label by rememberSaveable(state.label) { mutableStateOf(state.label) }
            var value by rememberSaveable(state.value) { mutableStateOf(state.value) }
            var tagsStr by rememberSaveable(state.tagsStr) { mutableStateOf(state.tagsStr) }
            var due by rememberSaveable(state.due) { mutableStateOf(state.due) }
            var hint by rememberSaveable(state.hint) { mutableStateOf(state.hint) }
            var revealValue by rememberSaveable { mutableStateOf(false) }

            Text("类型", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                EntryKind.entries.forEach { k ->
                    FilterChip(
                        selected = kind == k,
                        onClick = { kind = k },
                        label = {
                            Text(when (k) {
                                EntryKind.NOTE -> "笔记"
                                EntryKind.CREDENTIAL -> "凭证"
                                EntryKind.PROFILE -> "资料"
                                EntryKind.WORK -> "工作"
                            })
                        }
                    )
                }
            }
            OutlinedTextField(
                value = label, onValueChange = { label = it },
                label = { Text("标题（Label）") },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = value, onValueChange = { value = it },
                label = {
                    Text(
                        if (kind == EntryKind.CREDENTIAL) "值（真实内容，默认隐藏）"
                        else "正文 / Value"
                    )
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = if (kind == EntryKind.NOTE) 180.dp else 72.dp),
                visualTransformation = if (kind == EntryKind.CREDENTIAL && !revealValue)
                    PasswordVisualTransformation() else VisualTransformation.None,
                trailingIcon = if (kind == EntryKind.CREDENTIAL) {
                    { IconButton(onClick = { revealValue = revealValue.not() }) {
                        Icon(
                            if (revealValue) Icons.Filled.Visibility else Icons.Filled.VisibilityOff,
                            null
                        )
                    }}
                } else null
            )
            if (kind == EntryKind.CREDENTIAL) {
                OutlinedTextField(
                    value = hint, onValueChange = { hint = it },
                    label = { Text("非秘密提示 hint（例：ends 8a1f）") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
            OutlinedTextField(
                value = tagsStr, onValueChange = { tagsStr = it },
                label = { Text("标签（逗号分隔，如：工作, 家庭）") },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = due, onValueChange = { due = it },
                label = { Text("到期日 YYYY-MM-DD（可选，仅笔记）") },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(Modifier.height(12.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (state.saving) CircularProgressIndicator(Modifier.size(20.dp))
                Button(
                    onClick = {
                        viewModel.save(
                            kind = kind, label = label, value = value,
                            tagsStr = tagsStr, due = due, hint = hint,
                            after = onBack
                        )
                    },
                    modifier = Modifier.weight(1f),
                    enabled = state.saving.not() && label.isNotBlank()
                ) { Text("保存") }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

private val EntryKindSaver = androidx.compose.runtime.saveable.Saver<EntryKind, Int>(
    save = { it.ordinal }, restore = { EntryKind.entries[it] }
)

data class EditorUiState(
    val kind: EntryKind = EntryKind.NOTE,
    val label: String = "",
    val value: String = "",
    val tagsStr: String = "",
    val due: String = "",
    val hint: String = "",
    val saving: Boolean = false
)

@HiltViewModel
class EditorViewModel @Inject constructor(
    private val blobStore: VaultBlobStore,
) : ViewModel() {
    private val _state = MutableStateFlow(EditorUiState())
    val state: StateFlow<EditorUiState> = _state

    fun load(entryId: String) = viewModelScope.launch {
        // TODO: 从解锁会话中的 Vault 实例按 id 取出 Entry，回填 state
    }

    fun save(
        kind: EntryKind, label: String, value: String,
        tagsStr: String, due: String, hint: String,
        after: () -> Unit
    ) = viewModelScope.launch {
        _state.value = _state.value.copy(saving = true)
        runCatching {
            // TODO: 调用 operations.mjs 对应的 UpsertEntryUseCase
            // TODO: buildLocalEnvelope -> blobStore.saveLocal(env) -> 标记 dirty = true
        }
        _state.value = _state.value.copy(saving = false)
        after()
    }

    fun delete(after: () -> Unit) = viewModelScope.launch {
        // TODO: remove entry -> saveLocal -> dirty=true; 然后 after()
        after()
    }
}
