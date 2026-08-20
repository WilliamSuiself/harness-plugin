import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/cloud_sync_api.dart';
import '../models/entry.dart';
import '../models/sync_outcome.dart';
import '../session/vault_session.dart';
import '../storage/app_prefs.dart';
import '../storage/vault_blob_store.dart';
import '../sync/sync_orchestrator.dart';

class HomeScreen extends StatefulWidget {
  final VoidCallback onAdd;
  final void Function(String entryId) onEdit;
  final VoidCallback onSettings;
  final VoidCallback onLock;

  const HomeScreen({
    super.key,
    required this.onAdd,
    required this.onEdit,
    required this.onSettings,
    required this.onLock,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String _search = '';
  String _syncStatus = '';
  bool _syncing = false;

  Future<void> _syncNow() async {
    setState(() {
      _syncing = true;
      _syncStatus = '同步中…';
    });
    final prefs = context.read<AppPrefs>();
    final blobStore = context.read<VaultBlobStore>();
    final session = context.read<VaultSession>();
    final orchestrator = SyncOrchestrator(
      api: CloudSyncApi(prefs),
      blobStore: blobStore,
      prefs: prefs,
    );
    final outcome = await orchestrator.syncNow(
      masterPassword: session.masterPasswordOrNull,
      buildLocalEnvelope: session.buildLocalEnvelopeForSync,
    );
    if (outcome is SyncPulled) {
      await session.reloadFromBlobStore();
    }
    if (!mounted) return;
    setState(() {
      _syncing = false;
      _syncStatus = describeSyncOutcome(outcome);
    });
  }

  List<Entry> _filtered(List<Entry> entries) {
    if (_search.trim().isEmpty) return entries;
    final q = _search.trim().toLowerCase();
    return entries
        .where((e) =>
            e.label.toLowerCase().contains(q) ||
            e.value.toLowerCase().contains(q) ||
            e.tags.any((t) => t.toLowerCase().contains(q)))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<VaultSession>();
    final entries = _filtered(session.entries);

    return Scaffold(
      appBar: AppBar(
        title: const Text('MemoryPets'),
        actions: [
          IconButton(
            onPressed: _syncing ? null : _syncNow,
            icon: _syncing
                ? const SizedBox(
                    width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.sync),
            tooltip: '同步',
          ),
          IconButton(onPressed: widget.onSettings, icon: const Icon(Icons.settings), tooltip: '设置'),
          IconButton(onPressed: widget.onLock, icon: const Icon(Icons.lock), tooltip: '上锁'),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: widget.onAdd,
        tooltip: '新建条目',
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              decoration: const InputDecoration(
                labelText: '搜索 / 暗语直达（例：记一下 买牛奶）',
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),
          if (_syncStatus.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(_syncStatus, style: TextStyle(color: Theme.of(context).colorScheme.primary)),
              ),
            ),
          Expanded(
            child: entries.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.pets, size: 48, color: Theme.of(context).colorScheme.outline),
                        const SizedBox(height: 8),
                        Text('还没有笔记，点右下角 ➕ 新建一条吧',
                            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                      ],
                    ),
                  )
                : ListView.builder(
                    itemCount: entries.length,
                    itemBuilder: (context, i) {
                      final entry = entries[i];
                      return _EntryCard(entry: entry, onTap: () => widget.onEdit(entry.id));
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _EntryCard extends StatelessWidget {
  final Entry entry;
  final VoidCallback onTap;
  const _EntryCard({required this.entry, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Chip(label: Text(entry.kind.displayName)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(entry.label,
                        style: Theme.of(context).textTheme.titleMedium,
                        overflow: TextOverflow.ellipsis),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                entry.kind == EntryKind.credential ? (entry.hint ?? '••••••') : entry.value,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              if (entry.tags.isNotEmpty) ...[
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  children: entry.tags.take(5).map((t) => Chip(label: Text('#$t'))).toList(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
