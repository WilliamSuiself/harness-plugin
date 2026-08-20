import 'dart:convert';

import 'package:http/http.dart' as http;

import '../storage/app_prefs.dart';
import 'dto.dart';

/// 云同步 Relay REST API（与 MOBILE_SYNC_API.md §3 完全一致）
///   Base URL：由 AppPrefs.serverUrl 提供
///   token：自动加 Authorization: Bearer，401 抛 CloudAuthExpiredException
class CloudAuthExpiredException implements Exception {
  final String message;
  CloudAuthExpiredException([this.message = 'cloud session expired, please re-login']);
  @override
  String toString() => message;
}

/// 服务器返回了非 JSON 内容（例如 HTML 404 / 网关错误页），
/// 通常意味着 serverUrl 配置错误，或者该地址没有部署 cloud-sync relay。
class InvalidServerResponseException implements Exception {
  final int statusCode;
  final String bodyPreview;
  InvalidServerResponseException(this.statusCode, String body)
      : bodyPreview = body.length > 80 ? '${body.substring(0, 80)}…' : body;
  @override
  String toString() =>
      '服务器地址似乎不对（HTTP $statusCode 返回的不是 JSON，可能是网页/网关错误页）：$bodyPreview';
}

class CloudSyncApi {
  final AppPrefs prefs;
  final http.Client _client;

  CloudSyncApi(this.prefs, {http.Client? client}) : _client = client ?? http.Client();

  Uri _uri(String path) => Uri.parse('${prefs.serverUrl}$path');

  Map<String, String> _authHeaders() {
    final token = prefs.sessionToken;
    final headers = {'Content-Type': 'application/json'};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  Future<AuthResp> register(String username, String password) async {
    final resp = await _client.post(
      _uri('/accounts/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(RegisterReq(username, password).toJson()),
    );
    return AuthResp.fromJson(_decodeJson(resp));
  }

  Future<AuthResp> login(String username, String password) async {
    final resp = await _client.post(
      _uri('/accounts/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(LoginReq(username, password).toJson()),
    );
    return AuthResp.fromJson(_decodeJson(resp));
  }

  Future<HttpResult<GetVaultResp>> getVault() async {
    final resp = await _client.get(_uri('/vault'), headers: _authHeaders());
    _checkAuthExpired(resp.statusCode);
    final body = GetVaultResp.fromJson(_decodeJson(resp));
    return HttpResult(resp.statusCode, body);
  }

  Future<HttpResult<PutVaultResp>> putVault(PutVaultReq req) async {
    final resp = await _client.put(
      _uri('/vault'),
      headers: _authHeaders(),
      body: jsonEncode(req.toJson()),
    );
    _checkAuthExpired(resp.statusCode);
    final body = PutVaultResp.fromJson(_decodeJson(resp));
    return HttpResult(resp.statusCode, body);
  }

  void _checkAuthExpired(int statusCode) {
    final token = prefs.sessionToken;
    if (statusCode == 401 && token != null && token.isNotEmpty) {
      throw CloudAuthExpiredException();
    }
  }

  /// 统一的响应体解析：非 JSON 响应（HTML 错误页、网关超时页等）
  /// 转换成 [InvalidServerResponseException]，而不是让原始 FormatException 冒泡到 UI。
  Map<String, dynamic> _decodeJson(http.Response resp) {
    try {
      final decoded = jsonDecode(resp.body);
      if (decoded is Map<String, dynamic>) return decoded;
      throw InvalidServerResponseException(resp.statusCode, resp.body);
    } on FormatException {
      throw InvalidServerResponseException(resp.statusCode, resp.body);
    }
  }
}

class HttpResult<T> {
  final int statusCode;
  final T body;
  HttpResult(this.statusCode, this.body);
}
