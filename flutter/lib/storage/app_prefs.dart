import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

/// App 偏好存储（仅存非明文！session token / serverUrl / username / 暗语 / 偏好开关；
/// 绝对不存 解锁密码、不存 云账号密码、不存 任何笔记明文）
///
/// 对应 Android sync 模块的 AppPrefs / AppPrefsImpl（DataStore -> SharedPreferences）。
class AppPrefs extends ChangeNotifier {
  static const String defaultServerUrl = 'https://sync.example.com';

  static const _kServerUrl = 'server_url';
  static const _kUsername = 'username';
  static const _kSessionToken = 'session_token';
  static const _kDarkMode = 'dark_mode';
  static const _kCodewordGateEnabled = 'codeword_gate_enabled';
  static const _kCodewords = 'codewords';
  static const _kLastSyncVersion = 'last_sync_version';
  static const _kLastSyncAt = 'last_sync_at';
  static const _kDeviceId = 'device_id';

  SharedPreferences? _prefs;

  Future<SharedPreferences> _sp() async {
    return _prefs ??= await SharedPreferences.getInstance();
  }

  /// 必须在使用前调用一次（main() 里 await 完成）。
  Future<void> init() async {
    await _sp();
    if ((await _sp()).getString(_kDeviceId) == null) {
      await (await _sp()).setString(_kDeviceId, const Uuid().v4());
    }
    notifyListeners();
  }

  String get serverUrl => _prefs?.getString(_kServerUrl) ?? defaultServerUrl;
  String? get username => _prefs?.getString(_kUsername);
  String? get sessionToken => _prefs?.getString(_kSessionToken);
  bool get darkMode => _prefs?.getBool(_kDarkMode) ?? false;
  bool get codewordGateEnabled => _prefs?.getBool(_kCodewordGateEnabled) ?? true;
  List<String> get codewords => _prefs?.getStringList(_kCodewords) ?? const [];
  int get lastSyncVersion => _prefs?.getInt(_kLastSyncVersion) ?? 0;
  int get lastSyncAt => _prefs?.getInt(_kLastSyncAt) ?? 0;
  String get deviceId => _prefs?.getString(_kDeviceId) ?? '';

  Future<void> setServerUrl(String url) async {
    await (await _sp()).setString(_kServerUrl, url);
    notifyListeners();
  }

  Future<void> setCloudAccount(String username, String token) async {
    final sp = await _sp();
    await sp.setString(_kUsername, username);
    await sp.setString(_kSessionToken, token);
    notifyListeners();
  }

  Future<void> clearCloudAccount() async {
    final sp = await _sp();
    await sp.remove(_kUsername);
    await sp.remove(_kSessionToken);
    notifyListeners();
  }

  Future<void> setDarkMode(bool enabled) async {
    await (await _sp()).setBool(_kDarkMode, enabled);
    notifyListeners();
  }

  Future<void> setCodewordGateEnabled(bool enabled) async {
    await (await _sp()).setBool(_kCodewordGateEnabled, enabled);
    notifyListeners();
  }

  Future<void> setCodewords(List<String> words) async {
    await (await _sp()).setStringList(_kCodewords, words);
    notifyListeners();
  }

  Future<void> markSynced(int version, int atMs) async {
    final sp = await _sp();
    await sp.setInt(_kLastSyncVersion, version);
    await sp.setInt(_kLastSyncAt, atMs);
    notifyListeners();
  }
}
