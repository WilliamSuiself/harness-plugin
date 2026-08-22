import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/vault.dart';

/// 本地持久化：直接保存解密后的 Vault 明文 JSON（不做本地加密）。
///
/// 设计前提：本 App 是"宠物管家"型随手记录工具，不在设备本地加密密码本。
/// 远程同步时仍按用户配置把明文上传到云端（参见 SettingsScreen 中的 cloud
/// account / serverUrl）。后续如需本地加密，只要把这里的 toJson/fromJson 切到
/// Envelope 即可，其它层（VaultSession / SyncOrchestrator）保持兼容。
///
/// 与原 DSH / Android 模型的差别：
///   - 不再保存 envelope / salt / iv / ct 字节；
///   - 不再有"加密解锁"状态（unlock/setup 流程已移除）；
///   - 仍记录 version / updatedAt / dirty 三个云端协调字段。
class VaultBlobStore extends ChangeNotifier {
  static const _kVaultJson = 'vault_plain_json';
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

  Vault? get currentVault {
    final raw = _prefs?.getString(_kVaultJson);
    if (raw == null) return null;
    try {
      return Vault.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  int get currentVersion => _prefs?.getInt(_kVersion) ?? 0;
  int get updatedAt => _prefs?.getInt(_kUpdatedAt) ?? 0;
  bool get isDirty => _prefs?.getBool(_kDirty) ?? false;

  /// 本机是否已经存在一份 Vault（无论是否同步过版本号）。
  bool get hasLocalVault => currentVault != null;

  Future<void> overwriteWithRemote(Vault vault, int newVersion, int updatedAtMs) async {
    final sp = await _sp();
    await sp.setString(_kVaultJson, jsonEncode(vault.toJson()));
    await sp.setInt(_kVersion, newVersion);
    await sp.setInt(_kUpdatedAt, updatedAtMs);
    await sp.setBool(_kDirty, false);
    notifyListeners();
  }

  Future<void> saveLocal(Vault vault) async {
    final sp = await _sp();
    await sp.setString(_kVaultJson, jsonEncode(vault.toJson()));
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