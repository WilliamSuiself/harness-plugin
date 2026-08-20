import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/envelope.dart';

/// 本地持久化（方案 A）：只保存整个加密 envelope + version/updatedAt + dirty flag，
/// 与 DSH 端模型完全一致。不做条目级索引（搜索在解锁后的内存 Vault 里做）。
///
/// 对应 Android sync 模块的 VaultBlobStore / VaultBlobStoreImpl（DataStore -> SharedPreferences）。
class VaultBlobStore extends ChangeNotifier {
  static const _kEnvJson = 'vault_env_json';
  static const _kVersion = 'vault_version';
  static const _kUpdatedAt = 'vault_updated_at';
  static const _kDirty = 'vault_dirty';

  SharedPreferences? _prefs;

  Future<SharedPreferences> _sp() async {
    return _prefs ??= await SharedPreferences.getInstance();
  }

  Future<void> init() async {
    await _sp();
    notifyListeners();
  }

  Envelope? get currentEnvelope {
    final raw = _prefs?.getString(_kEnvJson);
    if (raw == null) return null;
    try {
      return Envelope.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  int get currentVersion => _prefs?.getInt(_kVersion) ?? 0;
  int get updatedAt => _prefs?.getInt(_kUpdatedAt) ?? 0;
  bool get isDirty => _prefs?.getBool(_kDirty) ?? false;

  /// 本机是否已经存在一份加密 vault（无论是否曾经同步过版本号）。
  /// 注意：不能用 `currentVersion > 0` 判断——纯本地保存（saveLocal）从不推进
  /// version，只有云端确认（confirmVersion / overwriteWithRemote）才会。
  bool get hasLocalVault => currentEnvelope != null;

  Future<void> overwriteWithRemote(Envelope envelope, int newVersion, int updatedAtMs) async {
    final sp = await _sp();
    await sp.setString(_kEnvJson, jsonEncode(envelope.toJson()));
    await sp.setInt(_kVersion, newVersion);
    await sp.setInt(_kUpdatedAt, updatedAtMs);
    await sp.setBool(_kDirty, false);
    notifyListeners();
  }

  Future<void> saveLocal(Envelope envelope) async {
    final sp = await _sp();
    await sp.setString(_kEnvJson, jsonEncode(envelope.toJson()));
    await sp.setBool(_kDirty, true);
    notifyListeners();
  }

  Future<void> confirmVersion(int newVersion, int updatedAtMs) async {
    final sp = await _sp();
    await sp.setInt(_kVersion, newVersion);
    await sp.setInt(_kUpdatedAt, updatedAtMs);
    await sp.setBool(_kDirty, false);
    notifyListeners();
  }

  Future<void> markDirty(bool dirty) async {
    await (await _sp()).setBool(_kDirty, dirty);
    notifyListeners();
  }
}
