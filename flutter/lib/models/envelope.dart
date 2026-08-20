/// 加密信封（与 packages/host/lib/vault.mjs 的 envelope 字段完全对齐）
/// base64 编码规则：标准 Base64（非 URL-safe、无换行），与 Node Buffer.toString('base64') 一致。
class KdfConfig {
  final String salt; // base64, 16 raw bytes
  final int iterations; // default 250_000
  final int keyLen; // default 256 bits

  const KdfConfig({
    required this.salt,
    required this.iterations,
    required this.keyLen,
  });

  factory KdfConfig.fromJson(Map<String, dynamic> json) {
    return KdfConfig(
      salt: json['salt'] as String,
      iterations: (json['iterations'] as num).toInt(),
      keyLen: (json['keyLen'] as num).toInt(),
    );
  }

  Map<String, dynamic> toJson() => {
        'salt': salt,
        'iterations': iterations,
        'keyLen': keyLen,
      };
}

class Envelope {
  final int version;
  final KdfConfig kdf;
  final String ciphertext;
  final String iv;

  const Envelope({
    this.version = 1,
    required this.kdf,
    required this.ciphertext,
    required this.iv,
  });

  factory Envelope.fromJson(Map<String, dynamic> json) {
    return Envelope(
      version: (json['version'] as num?)?.toInt() ?? 1,
      kdf: KdfConfig.fromJson(json['kdf'] as Map<String, dynamic>),
      ciphertext: json['ciphertext'] as String,
      iv: json['iv'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'version': version,
        'kdf': kdf.toJson(),
        'ciphertext': ciphertext,
        'iv': iv,
      };
}
