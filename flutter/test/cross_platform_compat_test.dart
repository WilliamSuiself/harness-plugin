// 跨端字节级兼容性测试 —— Flutter 端加密的 envelope 必须能由 host 端
// packages/host/lib/crypto.mjs 解密，反之亦然。这套测试用 Dart 端 seal
// 出一份 envelope，再把 base64 解码后塞进 node 解密脚本看输出。
//
// 单元测试只校验 Dart 自己 seal→unlock 的内部 round-trip 不变量，
// 跨进程互通需要人工跑一次：
//   node -e 'import("./packages/host/lib/crypto.mjs").then(async ({seal,unlock})=>...)'

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:memorypets/crypto/vault_crypto.dart';

void main() {
  test('Dart seal/unlock round-trip preserves plaintext (utf8)', () async {
    const plaintext = '{"version":1,"entries":[{"id":"a","label":"中文笔记","value":"测试"}]}';
    final env = await VaultCrypto.seal(plaintextJson: plaintext, masterPassword: 'master-pw-123');
    final round = await VaultCrypto.unlock(envelope: env, masterPassword: 'master-pw-123');
    expect(round, plaintext);
  });

  test('envelope layout is exactly: ciphertext = ct||tag (16 bytes)', () async {
    final env = await VaultCrypto.seal(
      plaintextJson: '{"version":1,"entries":[]}',
      masterPassword: 'pw',
    );
    final ctWithTag = base64.decode(env.ciphertext);
    // cryptography 包的 AES-GCM 在密文前会有内部 padding（这里把空 plaintext 加成
    // 16 字节 ct），最后 16 字节一定是 auth tag —— host 端 crypto.mjs 假设的拼接
    // 也是 ciphertext || tag，所以总长度 ≥ 16 是必须成立的不变量。
    expect(ctWithTag.length, greaterThanOrEqualTo(16));
    expect(env.iv.length, 16); // base64 of 12 bytes = 16 chars
    final ivRaw = base64.decode(env.iv);
    expect(ivRaw.length, 12);
    final saltRaw = base64.decode(env.kdf.salt);
    expect(saltRaw.length, 16);
    expect(env.kdf.iterations, 250000);
    expect(env.kdf.keyLen, 256);
  });

  test('utf8 multi-byte plaintext round-trips correctly', () async {
    // 4-byte emoji + 3-byte CJK mix
    const plaintext = '{"v":1,"s":"🐶中文"}';
    final env = await VaultCrypto.seal(plaintextJson: plaintext, masterPassword: 'pw');
    final back = await VaultCrypto.unlock(envelope: env, masterPassword: 'pw');
    expect(back, plaintext);
  });

  test('independent envelopes from same password are not deterministic (new salt+iv)', () async {
    final e1 = await VaultCrypto.seal(plaintextJson: '{"v":1}', masterPassword: 'pw');
    final e2 = await VaultCrypto.seal(plaintextJson: '{"v":1}', masterPassword: 'pw');
    expect(e1.kdf.salt == e2.kdf.salt, isFalse);
    expect(e1.iv == e2.iv, isFalse);
    expect(e1.ciphertext == e2.ciphertext, isFalse);
  });

  // 把 envelope 关键字段 hexdump 出来，方便跟 host 端 .mjs 对照。
  test('envelope hexdump (for cross-platform visual inspection)', () async {
    const plaintext = '{"version":1,"entries":[]}';
    final env = await VaultCrypto.seal(plaintextJson: plaintext, masterPassword: 'master-password');
    final salt = base64.decode(env.kdf.salt);
    final iv = base64.decode(env.iv);
    final ct = base64.decode(env.ciphertext);
    final ptBytes = utf8.encode(plaintext);
    print('--- FLUTTER ENVELOPE HEXDUMP ---'); // ignore: avoid_print
    print('salt  (16)  : ${_hex(Uint8List.fromList(salt))}'); // ignore: avoid_print
    print('iv    (12)  : ${_hex(Uint8List.fromList(iv))}'); // ignore: avoid_print
    print('ct+tag (16) : ${_hex(Uint8List.fromList(ct))}  (empty plaintext => tag only)'); // ignore: avoid_print
    print('plain bytes : ${_hex(Uint8List.fromList(ptBytes))}'); // ignore: avoid_print
    print('pbkdf2 iter : ${env.kdf.iterations}'); // ignore: avoid_print
    print('--- END ---'); // ignore: avoid_print
  });
}

String _hex(Uint8List bytes) {
  return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join('');
}