import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import '../models/envelope.dart';

/// Vault 加解密核心 —— 必须与 packages/host/lib/crypto.mjs + vault.mjs 字节级一致，
/// 也与 Android core-crypto 模块（VaultCrypto.kt）参数完全对齐。
///
/// 参数红线：
///   KDF:  PBKDF2WithHmacSHA256，密码按 UTF-8 编码喂入
///   AEAD: AES/GCM/NoPadding, 128-bit auth tag, IV 12 bytes, ciphertext||tag 拼接
///   Base64: 标准 Base64（无换行、非 URL-safe），与 Node Buffer.toString('base64') 一致
class VaultCryptoException implements Exception {
  final String message;
  VaultCryptoException(this.message);
  @override
  String toString() => 'VaultCryptoException: $message';
}

/// 主密码错误 / 密文损坏（对应 Kotlin 端的 AEADBadTagException）
class BadMasterPasswordException extends VaultCryptoException {
  BadMasterPasswordException() : super('AEAD authentication failed (wrong master password or corrupt ciphertext)');
}

class VaultCrypto {
  VaultCrypto._();

  static const int saltLenBytes = 16;
  static const int ivLenBytes = 12;
  static const int defaultIterations = 250000;
  static const int defaultKeyLenBits = 256;

  static final _random = Random.secure();

  static Uint8List generateSaltBytes() => _randomBytes(saltLenBytes);
  static Uint8List generateIvBytes() => _randomBytes(ivLenBytes);

  static Uint8List _randomBytes(int len) {
    final out = Uint8List(len);
    for (var i = 0; i < len; i++) {
      out[i] = _random.nextInt(256);
    }
    return out;
  }

  static Future<SecretKey> _deriveKey({
    required String masterPassword,
    required Uint8List saltBytes,
    required int iterations,
    int keyLenBits = defaultKeyLenBits,
  }) async {
    final pbkdf2 = Pbkdf2(
      macAlgorithm: Hmac.sha256(),
      iterations: iterations,
      bits: keyLenBits,
    );
    final secretKey = await pbkdf2.deriveKey(
      secretKey: SecretKey(utf8.encode(masterPassword)),
      nonce: saltBytes,
    );
    return secretKey;
  }

  /// 加密：明文 JSON -> Envelope
  static Future<Envelope> seal({
    required String plaintextJson,
    required String masterPassword,
    int iterations = defaultIterations,
    int keyLenBits = defaultKeyLenBits,
  }) async {
    final salt = generateSaltBytes();
    final iv = generateIvBytes();
    final key = await _deriveKey(
      masterPassword: masterPassword,
      saltBytes: salt,
      iterations: iterations,
      keyLenBits: keyLenBits,
    );
    final algorithm = AesGcm.with256bits();
    final secretBox = await algorithm.encrypt(
      utf8.encode(plaintextJson),
      secretKey: key,
      nonce: iv,
    );
    // Node/WebCrypto 惯例：ciphertext 后拼接 16 字节 auth tag
    final ctWithTag = Uint8List.fromList(secretBox.cipherText + secretBox.mac.bytes);
    return Envelope(
      version: 1,
      kdf: KdfConfig(
        salt: base64.encode(salt),
        iterations: iterations,
        keyLen: keyLenBits,
      ),
      ciphertext: base64.encode(ctWithTag),
      iv: base64.encode(iv),
    );
  }

  /// 解密：Envelope + 主密码 -> 明文 JSON（UTF-8）
  /// 主密码错误或密文损坏时抛出 [BadMasterPasswordException]
  static Future<String> unlock({
    required Envelope envelope,
    required String masterPassword,
  }) async {
    final salt = base64.decode(envelope.kdf.salt);
    final iv = base64.decode(envelope.iv);
    final ctWithTag = base64.decode(envelope.ciphertext);
    if (ctWithTag.length < 16) {
      throw BadMasterPasswordException();
    }
    final ct = ctWithTag.sublist(0, ctWithTag.length - 16);
    final tag = ctWithTag.sublist(ctWithTag.length - 16);

    final key = await _deriveKey(
      masterPassword: masterPassword,
      saltBytes: salt,
      iterations: envelope.kdf.iterations,
      keyLenBits: envelope.kdf.keyLen,
    );
    final algorithm = AesGcm.with256bits();
    final secretBox = SecretBox(ct, nonce: iv, mac: Mac(tag));
    try {
      final pt = await algorithm.decrypt(secretBox, secretKey: key);
      return utf8.decode(pt);
    } on SecretBoxAuthenticationError {
      throw BadMasterPasswordException();
    }
  }
}
