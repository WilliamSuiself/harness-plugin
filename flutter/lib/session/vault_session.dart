import 'package:flutter/foundation.dart';

import '../models/entry.dart';
import '../models/vault.dart';
import '../storage/vault_blob_store.dart';

List<String> _dedupeCaseInsensitive(Iterable<String> input) {
  final seen = <String>{};
  final out = <String>[];
  for (final raw in input) {
    final name = raw.trim();
    if (name.isEmpty) continue;
    final key = name.toLowerCase();
    if (seen.contains(key)) continue;
    seen.add(key);
    out.add(name);
  }
  return out;
}

/// 解锁会话：内存中保存一份明文 Vault，供 Home/Editor/Settings 共用。
///
/// 本应用定位为"宠物管家"型随手记录工具：
///   - 进入 App 不再要求解锁密码 / 暗语；
///   - 本地 vault 在 SharedPreferences 里直接以明文 JSON 存储（见
///     [VaultBlobStore]）；
///   - 云端 envelope 的加解密改由 [SyncOrchestrator] 使用
///     [AppPrefs.cloudMasterPassword] 完成，与本会话无关。
///
/// 因此本类只保留三个动作：
///   - [bootstrap]    启动时从 blobStore 加载（无则给空 Vault）
///   - [adopt]        把远端明文 vault（已被 sync 流程解开）整本覆盖进来
///   - [upsertEntry] / [deleteEntry]  本地编辑
class VaultSession extends ChangeNotifier {
  final VaultBlobStore blobStore;

  Vault _vault = const Vault();

  VaultSession(this.blobStore);

  Vault get vault => _vault;
  List<Entry> get entries => _vault.entries;
  // 类目目录（工作/生活/学习/个人 + 用户自定义），驱动 Home 屏的分类侧栏，
  // 与 DSH 插件 / cloud-sync 共享同一份 Vault JSON。
  List<String> get categories => _vault.categories;

  /// 启动入口：把 blobStore 里保存的明文 vault 加载到内存。如果本地从未
  /// 保存过 vault（首次启动），给一本空 Vault，让 Home 屏可以正常展示并
  /// 接收编辑。
  Future<void> bootstrap() async {
    final loaded = blobStore.currentVault;
    _vault = loaded ?? const Vault();
    notifyListeners();
  }

  /// 同步流程从云端成功解出明文后，整本覆盖本地 vault（同时把远端的
  /// version / updatedAt 写回 blobStore —— 这一步通常由
  /// [VaultBlobStore.overwriteWithRemote] 完成，本方法只负责把内存同步过来）。
  void adopt(Vault vault) {
    _vault = vault;
    notifyListeners();
  }

  Future<void> upsertEntry(Entry entry) async {
    final list = [..._vault.entries];
    final idx = list.indexWhere((e) => e.id == entry.id);
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.add(entry);
    }
    // Auto-register: any tag the user types that isn't already a known
    // category becomes one, so it shows up in the Home 屏 sidebar right
    // away — mirrors packages/host/lib/vault.mjs `Vault#upsert`.
    final categories = entry.tags.isEmpty
        ? _vault.categories
        : _dedupeCaseInsensitive([..._vault.categories, ...entry.tags]);
    // A re-created entry with the same id should win over a stale
    // tombstone (otherwise a delete synced from another device could
    // erase it again on the next merge).
    final tombstones = _vault.tombstones.where((t) => t.id != entry.id).toList();
    _vault = _vault.copyWith(entries: list, categories: categories, tombstones: tombstones);
    notifyListeners();
    await blobStore.saveLocal(_vault);
  }

  Future<void> deleteEntry(String id) async {
    final list = _vault.entries.where((e) => e.id != id).toList();
    final tombstones = [
      ..._vault.tombstones.where((t) => t.id != id),
      Tombstone(id: id, deletedAt: DateTime.now().millisecondsSinceEpoch),
    ];
    _vault = _vault.copyWith(entries: list, tombstones: tombstones);
    notifyListeners();
    await blobStore.saveLocal(_vault);
  }

  Future<void> addCategory(String name) async {
    _vault = _vault.addCategory(name);
    notifyListeners();
    await blobStore.saveLocal(_vault);
  }

  Future<void> removeCategory(String name) async {
    _vault = _vault.removeCategory(name);
    notifyListeners();
    await blobStore.saveLocal(_vault);
  }

  Entry? findById(String id) {
    for (final e in _vault.entries) {
      if (e.id == id) return e;
    }
    return null;
  }
}