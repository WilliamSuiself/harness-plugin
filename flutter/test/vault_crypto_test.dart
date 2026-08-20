import 'package:flutter_test/flutter_test.dart';
import 'package:memorypets/crypto/vault_crypto.dart';

void main() {
  test('unlock with wrong master password must throw BadMasterPasswordException', () async {
    final envelope = await VaultCrypto.seal(
      plaintextJson: '{"version":1,"entries":[]}',
      masterPassword: 'correct-password-123',
    );

    expect(
      () => VaultCrypto.unlock(envelope: envelope, masterPassword: 'totally-wrong-password'),
      throwsA(isA<BadMasterPasswordException>()),
    );
  });

  test('unlock with correct master password succeeds and returns original plaintext', () async {
    const plaintext = '{"version":1,"entries":[{"id":"x"}]}';
    final envelope = await VaultCrypto.seal(
      plaintextJson: plaintext,
      masterPassword: 'correct-password-123',
    );

    final decrypted = await VaultCrypto.unlock(
      envelope: envelope,
      masterPassword: 'correct-password-123',
    );

    expect(decrypted, plaintext);
  });
}
