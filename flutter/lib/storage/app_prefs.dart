import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

/// App 偏好存储：仅存非明文 vault 数据 + 云端配置。
///
/// 本应用定位为"宠物管家"型随手记录工具，进入 App 不再设主密码 / 暗语，
/// 因此这里**不存解锁密码**。
///
/// 云同步相关的密码（[cloudMasterPassword]）用于解开远端 vault envelope，
/// 与 Android host relay 的 PBKDF2+AES-GCM 协议保持字节级兼容。它只在
/// 用户主动触发同步时被读出（不参与本地 vault 的加解密），用户也可以随时
/// 在 Settings 里修改 / 清空。
///
/// 对应 Android sync 模块的 AppPrefs / AppPrefsImpl（DataStore -> SharedPreferences）。
class AppPrefs extends ChangeNotifier {
  // 默认云服务器地址。生产环境应通过 SettingsScreen 由用户修改并保存到
  // SharedPreferences（key: server_url）。
  //
  // 历史：
  //   - https://sync.example.com        : 占位，已被阿里云 ICP 阻断
  //   - https://sync.citiestripcn.com   : 域名未备案，被 Cloudflare→阿里云拦成白屏
  //   - http://192.168.0.104:8787       : 本机内网，仅同网段设备可达
  //   - http://123.57.81.235:8787       : ECS 阿里云（已绑 EIP，宝塔防火墙+ECS 安全组已
  //                                       放行 8787，relay bind 0.0.0.0，公网 curl 验通）
  static const String defaultServerUrl = 'http://123.57.81.235:8787';

  // 默认云账号（仅用于本机调试；生产环境应让用户自己填）。
  // 注意：云密码丢了 = 远端 vault 永远解不开（AES-GCM + PBKDF2 无回退机制）。
  static const String defaultCloudUsername = 'jiajia';
  static const String defaultCloudPassword = 'Ab1114234!';

  static const _kServerUrl = 'server_url';
  static const _kUsername = 'username';
  static const _kSessionToken = 'session_token';
  static const _kDarkMode = 'dark_mode';
  static const _kCloudMasterPassword = 'cloud_master_password';
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

  String get serverUrl {
    final v = _prefs?.getString(_kServerUrl);
    // 历史脏值兜底：旧 APK/旧调试曾留下这些"明显错误"的地址，强制回退到 default。
    if (v == null || v.isEmpty || _isBadServerUrl(v)) return defaultServerUrl;
    return v;
  }

  /// 用户名兜底为 [defaultCloudUsername]，便于首次启动直接看到填好的字段。
  String? get username {
    final v = _prefs?.getString(_kUsername);
    if (v != null && v.isNotEmpty) return v;
    return defaultCloudUsername.isEmpty ? null : defaultCloudUsername;
  }

  String? get sessionToken => _prefs?.getString(_kSessionToken);
  bool get darkMode => _prefs?.getBool(_kDarkMode) ?? false;

  /// 云端 envelope 的解密密钥。在 Settings 里设置 / 修改；只在 sync 流程被
  /// 读取，不参与本地 vault 读写。空字符串等同于未配置（同步会被提示先填）。
  /// 兜底为 [defaultCloudPassword]（调试期方便直接联调；生产环境请把该常量置空）。
  String? get cloudMasterPassword {
    final v = _prefs?.getString(_kCloudMasterPassword);
    if (v != null && v.isNotEmpty) return v;
    return defaultCloudPassword.isEmpty ? null : defaultCloudPassword;
  }

  /// 已知的"不可达"地址——历史 APK / 调试时被写进 SharedPreferences 的脏值。
  /// 这些值会让 CloudSyncApi 拿到错误的目标，请求失败。这里识别后强制回退到默认。
  static bool _isBadServerUrl(String url) {
    final bad = [
      'http://:8787',                  // 占位空 host
      'https://sync.example.com',      // 占位，已被 ICP 阻断
      'https://sync.citiestripcn.com', // 域名未备案，Cloudflare→阿里云拦
      'http://192.168.0.104:8787',    // 本机内网，APK 上手机后必然不可达
    ];
    return bad.contains(url);
  }

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

  Future<void> setCloudMasterPassword(String password) async {
    await (await _sp()).setString(_kCloudMasterPassword, password);
    notifyListeners();
  }

  Future<void> clearCloudMasterPassword() async {
    await (await _sp()).remove(_kCloudMasterPassword);
    notifyListeners();
  }

  Future<void> markSynced(int version, int atMs) async {
    final sp = await _sp();
    await sp.setInt(_kLastSyncVersion, version);
    await sp.setInt(_kLastSyncAt, atMs);
    notifyListeners();
  }
}