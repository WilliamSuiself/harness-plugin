import '../models/envelope.dart';

/// DTO <-> Envelope 转换（网络层与 core 模型解耦，对应 Android sync/remote/dto/DTOs.kt）

class RegisterReq {
  final String username;
  final String password;
  RegisterReq(this.username, this.password);
  Map<String, dynamic> toJson() => {'username': username, 'password': password};
}

class LoginReq {
  final String username;
  final String password;
  LoginReq(this.username, this.password);
  Map<String, dynamic> toJson() => {'username': username, 'password': password};
}

class AuthResp {
  final bool ok;
  final String? token;
  final String? error;
  AuthResp({required this.ok, this.token, this.error});

  factory AuthResp.fromJson(Map<String, dynamic> json) => AuthResp(
        ok: json['ok'] as bool? ?? false,
        token: json['token'] as String?,
        error: json['error'] as String?,
      );
}

class GetVaultResp {
  final bool ok;
  final Envelope? envelope;
  final int version;
  final int? updatedAt;
  final String? error;
  final bool? conflict;
  final String? deviceId;

  GetVaultResp({
    required this.ok,
    this.envelope,
    required this.version,
    this.updatedAt,
    this.error,
    this.conflict,
    this.deviceId,
  });

  factory GetVaultResp.fromJson(Map<String, dynamic> json) => GetVaultResp(
        ok: json['ok'] as bool? ?? false,
        envelope: json['envelope'] != null
            ? Envelope.fromJson(json['envelope'] as Map<String, dynamic>)
            : null,
        version: (json['version'] as num?)?.toInt() ?? 0,
        updatedAt: (json['updatedAt'] as num?)?.toInt(),
        error: json['error'] as String?,
        conflict: json['conflict'] as bool?,
        deviceId: json['deviceId'] as String?,
      );
}

class PutVaultReq {
  final Envelope envelope;
  final int expectedVersion;
  final String deviceId;

  PutVaultReq({required this.envelope, required this.expectedVersion, required this.deviceId});

  Map<String, dynamic> toJson() => {
        'envelope': envelope.toJson(),
        'expectedVersion': expectedVersion,
        'deviceId': deviceId,
      };
}

class PutVaultResp {
  final bool ok;
  final int? version;
  final int? updatedAt;
  final String? error;
  final bool? conflict;
  final GetVaultResp? current;

  PutVaultResp({
    required this.ok,
    this.version,
    this.updatedAt,
    this.error,
    this.conflict,
    this.current,
  });

  factory PutVaultResp.fromJson(Map<String, dynamic> json) => PutVaultResp(
        ok: json['ok'] as bool? ?? false,
        version: (json['version'] as num?)?.toInt(),
        updatedAt: (json['updatedAt'] as num?)?.toInt(),
        error: json['error'] as String?,
        conflict: json['conflict'] as bool?,
        current: json['current'] != null
            ? GetVaultResp.fromJson(json['current'] as Map<String, dynamic>)
            : null,
      );
}
