import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../models/entry.dart';
import '../session/vault_session.dart';

class EditorScreen extends StatefulWidget {
  final String entryId; // "new" 表示新建
  final VoidCallback onBack;

  const EditorScreen({super.key, required this.entryId, required this.onBack});

  @override
  State<EditorScreen> createState() => _EditorScreenState();
}

class _EditorScreenState extends State<EditorScreen> {
  late EntryKind _kind;
  final _labelCtrl = TextEditingController();
  final _valueCtrl = TextEditingController();
  final _tagsCtrl = TextEditingController();
  final _dueCtrl = TextEditingController();
  final _hintCtrl = TextEditingController();
  bool _revealValue = false;
  bool _saving = false;

  bool get _isNew => widget.entryId == 'new';

  @override
  void initState() {
    super.initState();
    final session = context.read<VaultSession>();
    final existing = _isNew ? null : session.findById(widget.entryId);
    _kind = existing?.kind ?? EntryKind.note;
    _labelCtrl.text = existing?.label ?? '';
    _valueCtrl.text = existing?.value ?? '';
    _tagsCtrl.text = existing?.tags.join(', ') ?? '';
    _dueCtrl.text = existing?.dueDate ?? '';
    _hintCtrl.text = existing?.hint ?? '';
  }

  @override
  void dispose() {
    _labelCtrl.dispose();
    _valueCtrl.dispose();
    _tagsCtrl.dispose();
    _dueCtrl.dispose();
    _hintCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_labelCtrl.text.trim().isEmpty) return;
    setState(() => _saving = true);
    final session = context.read<VaultSession>();
    final now = DateTime.now().millisecondsSinceEpoch;
    final tags = _tagsCtrl.text
        .split(RegExp('[,，]'))
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
    final existing = _isNew ? null : session.findById(widget.entryId);
    final entry = Entry(
      id: existing?.id ?? 'entry_${const Uuid().v4()}',
      kind: _kind,
      label: _labelCtrl.text.trim(),
      value: _valueCtrl.text,
      tags: tags,
      dueDate: _dueCtrl.text.trim().isEmpty ? null : _dueCtrl.text.trim(),
      hint: _hintCtrl.text.trim().isEmpty ? null : _hintCtrl.text.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    );
    await session.upsertEntry(entry);
    if (!mounted) return;
    setState(() => _saving = false);
    widget.onBack();
  }

  Future<void> _delete() async {
    final session = context.read<VaultSession>();
    await session.deleteEntry(widget.entryId);
    widget.onBack();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isNew ? '新建条目' : '编辑条目'),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: widget.onBack),
        actions: [
          if (!_isNew)
            IconButton(icon: const Icon(Icons.delete), tooltip: '删除', onPressed: _delete),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            Text('类型', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: EntryKind.values.map((k) {
                return FilterChip(
                  label: Text(k.displayName),
                  selected: _kind == k,
                  onSelected: (_) => setState(() => _kind = k),
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _labelCtrl,
              decoration: const InputDecoration(labelText: '标题（Label）'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _valueCtrl,
              obscureText: _kind == EntryKind.credential && !_revealValue,
              maxLines: _kind == EntryKind.note ? 8 : 1,
              decoration: InputDecoration(
                labelText: _kind == EntryKind.credential ? '值（真实内容，默认隐藏）' : '正文 / Value',
                suffixIcon: _kind == EntryKind.credential
                    ? IconButton(
                        icon: Icon(_revealValue ? Icons.visibility : Icons.visibility_off),
                        onPressed: () => setState(() => _revealValue = !_revealValue),
                      )
                    : null,
              ),
            ),
            if (_kind == EntryKind.credential) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _hintCtrl,
                decoration: const InputDecoration(labelText: '非秘密提示 hint（例：ends 8a1f）'),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: _tagsCtrl,
              decoration: const InputDecoration(labelText: '标签（逗号分隔，如：工作, 家庭）'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _dueCtrl,
              decoration: const InputDecoration(labelText: '到期日 YYYY-MM-DD（可选，仅笔记）'),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                if (_saving) const Padding(
                  padding: EdgeInsets.only(right: 12),
                  child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                ),
                Expanded(
                  child: FilledButton(
                    onPressed: _labelCtrl.text.trim().isNotEmpty && !_saving ? _save : null,
                    child: const Text('保存'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
