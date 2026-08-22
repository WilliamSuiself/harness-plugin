import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/entry.dart';
import '../models/sync_outcome.dart';
import '../session/vault_session.dart';
import '../storage/app_prefs.dart';
import '../sync/sync_orchestrator.dart';

/// 宠物状态：决定动画使用哪一组帧（`assets/{mood}/`）。
enum PetMood { standing, thinking, waiting, sleeping }

/// Home 屏：宠物管家笔记本的主入口。
///   顶部 = 宠物动画（随状态切帧）
///   中部 = 同步状态 + 搜索框
///   底部 = 笔记列表
class HomeScreen extends StatefulWidget {
  final VoidCallback onAdd;
  final void Function(String entryId) onEdit;
  final VoidCallback onSettings;
  /// 用于注入自定义的宠物帧渲染 widget，便于 widget test 绕过真实 Image.asset
  /// 资源加载。生产代码里默认用 Image.asset。
  final Widget Function(BuildContext, String assetPath)? petFrameBuilder;

  const HomeScreen({
    super.key,
    required this.onAdd,
    required this.onEdit,
    required this.onSettings,
    this.petFrameBuilder,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with SingleTickerProviderStateMixin {
  String _search = '';
  String _syncStatus = '';
  bool _syncing = false;
  PetMood _mood = PetMood.standing;
  // null = 全部；否则只显示 tags 包含该类目的条目。与 DSH 插件的"展开笔记本"
  // 分类侧栏是同一套 categories 数据（存在 Vault 里，随云同步走）。
  String? _selectedCategory;

  late final AnimationController _petAnim;
  int _petFrame = 0;

  /// 各状态对应的帧序列号。standing / thinking / waiting / sleeping 各 17~20
  /// 帧，按 4fps 轮播形成"微微活动 / 思考 / 等待 / 打盹"的观感。
  static const Map<PetMood, List<String>> _frames = {
    PetMood.standing: [
      '02','03','04','05','06','07','08','09','10','11',
      '12','13','14','15','16','17','18','19','20',
    ],
    PetMood.thinking: [
      '01','02','03','04','05','06','07','08','09','10',
      '11','12','13','14','15','16','17','18','19','20',
    ],
    PetMood.waiting: [
      '04','05','06','07','08','09','10','11','12','13',
      '14','15','16','17','18','19','20',
    ],
    PetMood.sleeping: [
      '03','04','05','06','07','08','09','10','11','12',
      '13','14','15','16','17','18','19','20',
    ],
  };

  /// 按 mood 展开所有帧 asset 路径，用于预加载。
  static List<String> _allAssetsForMood(PetMood mood) =>
      _frames[mood]!.map((f) => 'assets/${mood.name}/$f.png').toList();

  @override
  void initState() {
    super.initState();
    _petAnim = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4), // 一个完整 mood 循环 4s
    )
      ..addListener(_onPetTick)
      ..repeat();
    _startIdlePet();
    // 后台预加载 4 组 PNG 帧到 ImageCache，避免开场 2 秒内每帧重新解码抖动。
    WidgetsBinding.instance.addPostFrameCallback((_) => _precacheAllFrames());
  }

  Future<void> _precacheAllFrames() async {
    final futures = <Future<void>>[];
    for (final mood in PetMood.values) {
      for (final path in _allAssetsForMood(mood)) {
        futures.add(precacheImage(AssetImage(path), context));
      }
    }
    // 不阻塞 UI；预加载完就行。
    await Future.wait(futures);
  }

  @override
  void dispose() {
    _petAnim.dispose();
    super.dispose();
  }

  void _onPetTick() {
    setState(() {
      final list = _frames[_mood]!;
      // 5fps 帧切换（每 200ms 切一次）
      _petFrame = (_petAnim.value * list.length).floor() % list.length;
    });
  }

  void _startIdlePet() {
    _setMood(PetMood.standing);
  }

  void _setMood(PetMood mood) {
    if (_mood == mood) return;
    setState(() {
      _mood = mood;
      _petFrame = 0;
      _petAnim.value = 0;
    });
  }

  Future<void> _syncNow() async {
    setState(() {
      _syncing = true;
      _syncStatus = '同步中…';
      _setMood(PetMood.thinking);
    });
    final orchestrator = context.read<SyncOrchestrator>();
    final outcome = await orchestrator.syncNow();
    if (!mounted) return;
    setState(() {
      _syncing = false;
      _syncStatus = describeSyncOutcome(outcome);
    });
    // 同步完成 -> 切回 standing / 等待 1s 后再切 sleeping
    _setMood(outcome is SyncPulled ? PetMood.standing : PetMood.standing);
    Timer(const Duration(seconds: 1), () {
      if (!mounted) return;
      _setMood(_syncing ? PetMood.thinking : PetMood.sleeping);
    });
    if (outcome is SyncMissingCloudPassword || outcome is SyncAuthExpired) {
      _promptCloudSetup(outcome);
    }
  }

  Future<void> _promptCloudSetup(SyncOutcome outcome) async {
    final reason = describeSyncOutcome(outcome);
    final goSettings = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('需要配置云同步'),
        content: Text('$reason\n\n是否前往设置？'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('稍后')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('去设置')),
        ],
      ),
    );
    if (goSettings == true && mounted) widget.onSettings();
  }

  List<Entry> _filtered(List<Entry> entries) {
    var list = entries;
    if (_selectedCategory != null) {
      final cat = _selectedCategory!.toLowerCase();
      list = list.where((e) => e.tags.any((t) => t.toLowerCase() == cat)).toList();
    }
    if (_search.trim().isEmpty) return list;
    final q = _search.trim().toLowerCase();
    return list
        .where((e) =>
            e.label.toLowerCase().contains(q) ||
            e.value.toLowerCase().contains(q) ||
            e.tags.any((t) => t.toLowerCase().contains(q)))
        .toList();
  }

  Future<void> _promptAddCategory() async {
    final ctrl = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('新建类目'),
        content: TextField(controller: ctrl, autofocus: true, decoration: const InputDecoration(hintText: '例如：旅行')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('添加')),
        ],
      ),
    );
    if (name != null && name.isNotEmpty && mounted) {
      await context.read<VaultSession>().addCategory(name);
    }
  }

  String _currentPetAssetPath() {
    final list = _frames[_mood]!;
    final frame = list[_petFrame % list.length];
    final folder = _mood.name;
    return 'assets/$folder/$frame.png';
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<VaultSession>();
    final entries = _filtered(session.entries);
    final prefs = context.watch<AppPrefs>();
    final loggedIn = prefs.sessionToken != null && prefs.sessionToken!.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: const Text('MemoryPets · 宠物笔记本'),
        actions: [
          IconButton(
            onPressed: _syncing ? null : _syncNow,
            icon: _syncing
                ? const SizedBox(
                    width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.sync),
            tooltip: loggedIn ? '云同步' : '连接云同步',
          ),
          IconButton(onPressed: widget.onSettings, icon: const Icon(Icons.settings), tooltip: '设置'),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: widget.onAdd,
        tooltip: '新建条目',
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          _PetBanner(
            assetPath: _currentPetAssetPath(),
            mood: _mood,
            petFrameBuilder: widget.petFrameBuilder,
          ),
          if (!loggedIn)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Theme.of(context).colorScheme.secondaryContainer,
              child: Row(
                children: [
                  const Icon(Icons.cloud_off, size: 18),
                  const SizedBox(width: 8),
                  const Expanded(child: Text('当前为纯本地模式 · 去设置里连接云账号即可多设备同步')),
                  TextButton(onPressed: widget.onSettings, child: const Text('去设置')),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              decoration: const InputDecoration(
                labelText: '搜索（标题 / 正文 / 标签）',
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),
          // 分类侧栏（横向 chip 版）：工作/生活/学习/个人 + 用户自定义类目，
          // 与 DSH 插件"展开笔记本"的左侧栏是同一份 session.categories 数据。
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                ChoiceChip(
                  label: Text('全部（${session.entries.length}）'),
                  selected: _selectedCategory == null,
                  onSelected: (_) => setState(() => _selectedCategory = null),
                ),
                const SizedBox(width: 6),
                ...session.categories.map((c) {
                  final count = session.entries
                      .where((e) => e.tags.any((t) => t.toLowerCase() == c.toLowerCase()))
                      .length;
                  return Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text('$c（$count）'),
                      selected: _selectedCategory == c,
                      onSelected: (_) => setState(() => _selectedCategory = c),
                    ),
                  );
                }),
                ActionChip(
                  avatar: const Icon(Icons.add, size: 16),
                  label: const Text('新类目'),
                  onPressed: _promptAddCategory,
                ),
              ],
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

/// 顶部宠物 banner。背景随 [mood] 切换颜色，宠物帧由父组件传入。
class _PetBanner extends StatelessWidget {
  final String assetPath;
  final PetMood mood;
  final Widget Function(BuildContext, String assetPath)? petFrameBuilder;
  const _PetBanner({
    required this.assetPath,
    required this.mood,
    this.petFrameBuilder,
  });

  static const Map<PetMood, String> _captions = {
    PetMood.standing: '今天也要好好记下身边的小事 🐾',
    PetMood.thinking: '我正在和云端聊一聊… ✨',
    PetMood.waiting: '等你下指令～ ⏳',
    PetMood.sleeping: '（嘘，宠物正在打盹…）💤',
  };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bg = switch (mood) {
      PetMood.thinking => scheme.tertiaryContainer,
      PetMood.waiting => scheme.secondaryContainer,
      PetMood.sleeping => scheme.surfaceContainerHigh,
      PetMood.standing => scheme.primaryContainer,
    };
    return Container(
      width: double.infinity,
      color: bg,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          SizedBox(
            width: 96,
            height: 96,
            child: petFrameBuilder != null
                ? petFrameBuilder!(context, assetPath)
                : Image.asset(
                    assetPath,
                    fit: BoxFit.contain,
                    gaplessPlayback: true, // 切帧时保留前一帧，避免闪白
                    frameBuilder: (context, child, frame, wasSyncLoaded) {
                      if (wasSyncLoaded) return child;
                      // 异步解码时显示前一个稳定帧（child 此时是占位）
                      return AnimatedOpacity(
                        opacity: frame == null ? 0.0 : 1.0,
                        duration: const Duration(milliseconds: 80),
                        child: child,
                      );
                    },
                  ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              _captions[mood]!,
              style: Theme.of(context).textTheme.bodyLarge,
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