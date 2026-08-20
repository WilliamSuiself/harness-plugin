import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../crypto/vault_crypto.dart';
import '../models/entry.dart';
import '../models/envelope.dart';
import '../models/vault.dart';
import '../storage/vault_blob_store.dart';

/// 解锁会话：持有内存中解密后的 Vault + 主密码，供 Home/Editor/Settings 共用。
/// 主密码绝不落盘，仅存在于本对象的内存生命周期中（锁定或退出即清空）。
class VaultSession extends ChangeNotifier {
  final VaultBlobStore blobStore;

  String? _masterPassword;
  Vault _vault = const Vault();

  VaultSession(this.blobStore);

  bool get isUnlocked => _masterPassword != null;
  String? get masterPasswordOrNull => _masterPassword;
  Vault get vault => _vault;
  List<Entry> get entries => _vault.entries;

  /// 用给定密码解锁本地 envelope。要求本地必须已经存在一份 envelope
  /// （由 [createNew] 创建），否则一律返回 false —— 绝不能把"本地没有
  /// 数据"当作"密码正确"，那样任何密码都会被接受，这是一个真实的安全 bug。
  /// 返回 true 表示解锁成功（密码正确且解密通过 AEAD 校验）。
  Future<bool> unlock(String password) async {
    final env = blobStore.currentEnvelope;
    if (env == null) return false;
    try {
      final json = await VaultCrypto.unlock(envelope: env, masterPassword: password);
      _vault = Vault.fromJson(jsonDecode(json) as Map<String, dynamic>);
      _masterPassword = password;
      notifyListeners();
      return true;
    } on BadMasterPasswordException {
      return false;
    }
  }

  /// 首次 Setup 专用：把给定密码定为主密码，创建一本空 Vault 并立即落盘。
  /// 只能在本地尚无 envelope 时调用（[VaultBlobStore.hasLocalVault] == false）。
  Future<void> createNew(String password) async {
    _masterPassword = password;
    _vault = const Vault();
    notifyListeners();
    await _persist();
  }

  void lock() {
    _masterPassword = null;
    _vault = const Vault();
    notifyListeners();
  }

  Future<void> _persist() async {
    final pw = _masterPassword;
    if (pw == null) return;
    final json = jsonEncode(_vault.toJson());
    final env = await VaultCrypto.seal(plaintextJson: json, masterPassword: pw);
    await blobStore.saveLocal(env);
  }

  Future<void> upsertEntry(Entry entry) async {
    final list = [..._vault.entries];
    final idx = list.indexWhere((e) => e.id == entry.id);
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.add(entry);
    }
    _vault = _vault.copyWith(entries: list);
    notifyListeners();
    await _persist();
  }

  Future<void> deleteEntry(String id) async {
    final list = _vault.entries.where((e) => e.id != id).toList();
    _vault = _vault.copyWith(entries: list);
    notifyListeners();
    await _persist();
  }

  Entry? findById(String id) {
    for (final e in _vault.entries) {
      if (e.id == id) return e;
    }
    return null;
  }

  /// 供 SyncOrchestrator 在需要推送本地改动时调用。
  Future<Envelope?> buildLocalEnvelopeForSync() async {
    final pw = _masterPassword;
    if (pw == null) return null;
    final json = jsonEncode(_vault.toJson());
    return VaultCrypto.seal(plaintextJson: json, masterPassword: pw);
  }

  /// 同步流程从远端采用了新版本后，重新从 blobStore 解密加载进内存。
  Future<void> reloadFromBlobStore() async {
    final pw = _masterPassword;
    if (pw == null) return;
    final env = blobStore.currentEnvelope;
    if (env == null) return;
    try {
      final json = await VaultCrypto.unlock(envelope: env, masterPassword: pw);
      _vault = Vault.fromJson(jsonDecode(json) as Map<String, dynamic>);
      notifyListeners();
    } on BadMasterPasswordException {
      // 对端主密码不同，保留当前内存状态，交给上层展示 DecryptFailed 提示
    }
  }
}
