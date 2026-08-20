import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:memorypets/session/vault_session.dart';
import 'package:memorypets/storage/vault_blob_store.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('unlock() must reject any password when no local vault exists yet', () async {
    final blobStore = VaultBlobStore();
    await blobStore.init();
    final session = VaultSession(blobStore);

    // 本地从未 createNew() 过 -> 不存在 envelope -> unlock() 对任何密码都必须返回 false，
    // 绝不能像旧 bug 那样把"没有数据"当作"密码正确"直接放行。
    final ok = await session.unlock('any-random-password');

    expect(ok, isFalse);
    expect(session.isUnlocked, isFalse);
  });

  test('unlock() rejects wrong password after createNew(), accepts the correct one', () async {
    final blobStore = VaultBlobStore();
    await blobStore.init();
    final session = VaultSession(blobStore);

    await session.createNew('correct-password');
    session.lock();

    final wrong = await session.unlock('wrong-password');
    expect(wrong, isFalse);
    expect(session.isUnlocked, isFalse);

    final right = await session.unlock('correct-password');
    expect(right, isTrue);
    expect(session.isUnlocked, isTrue);
  });

  test('VaultBlobStore.hasLocalVault reflects envelope existence, not sync version', () async {
    final blobStore = VaultBlobStore();
    await blobStore.init();
    expect(blobStore.hasLocalVault, isFalse);

    final session = VaultSession(blobStore);
    await session.createNew('pw');

    // 关键回归点：saveLocal() 从不推进 version，但 hasLocalVault 必须为 true，
    // 否则 RootScreen 会把已经 Setup 过的用户又送回 Setup 页面。
    expect(blobStore.currentVersion, 0);
    expect(blobStore.hasLocalVault, isTrue);
  });
}
