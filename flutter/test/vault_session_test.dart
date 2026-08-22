import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:memorypets/models/entry.dart';
import 'package:memorypets/models/vault.dart';
import 'package:memorypets/session/vault_session.dart';
import 'package:memorypets/storage/vault_blob_store.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('bootstrap() 在没有任何本地数据时给出空 Vault', () async {
    final blobStore = VaultBlobStore();
    await blobStore.init();
    final session = VaultSession(blobStore);

    await session.bootstrap();

    expect(session.entries, isEmpty);
    expect(blobStore.hasLocalVault, isFalse);
  });

  test('bootstrap() 在已有本地 Vault 时正确加载（明文 JSON 往返）', () async {
    final blobStore = VaultBlobStore();
    await blobStore.init();
    final session1 = VaultSession(blobStore);
    await session1.bootstrap();
    final entry = Entry(
      id: 'entry_test',
      kind: EntryKind.note,
      label: '买菜清单',
      value: '苹果 / 香蕉',
      tags: const ['家庭'],
      createdAt: 1,
      updatedAt: 2,
    );
    await session1.upsertEntry(entry);

    // 重新构造一个新 session，模拟 App 重启
    final session2 = VaultSession(blobStore);
    await session2.bootstrap();

    expect(session2.entries.length, 1);
    expect(session2.entries.first.label, '买菜清单');
    expect(session2.entries.first.value, '苹果 / 香蕉');
    expect(blobStore.hasLocalVault, isTrue);
  });

  test('adopt() 用远端明文 vault 整本替换内存 + 落盘', () async {
    final blobStore = VaultBlobStore();
    await blobStore.init();
    final session = VaultSession(blobStore);
    await session.bootstrap();

    // 模拟从云端拉回来的 vault（不带 envelope，只是解出来后的 JSON）
    final remote = const Vault()
        .copyWith(entries: [
      Entry(
        id: 'entry_remote',
        kind: EntryKind.credential,
        label: 'GitHub',
        value: 'ghp_xxx',
        hint: 'starts ghp_',
        createdAt: 10,
        updatedAt: 20,
      ),
    ]);
    await blobStore.overwriteWithRemote(remote, 5, 99999);
    session.adopt(remote);

    expect(session.entries.first.id, 'entry_remote');
    expect(blobStore.currentVersion, 5);
    expect(blobStore.updatedAt, 99999);
    expect(blobStore.isDirty, isFalse);
  });

  test('upsertEntry() / deleteEntry() 会写入明文 JSON 并标 dirty',
      () async {
    final blobStore = VaultBlobStore();
    await blobStore.init();
    final session = VaultSession(blobStore);
    await session.bootstrap();

    final entry = Entry(
      id: 'entry_x',
      kind: EntryKind.note,
      label: 'a',
      value: 'b',
      createdAt: 1,
      updatedAt: 1,
    );
    await session.upsertEntry(entry);
    expect(session.entries.length, 1);
    expect(blobStore.isDirty, isTrue);
    expect(blobStore.hasLocalVault, isTrue);

    await session.deleteEntry('entry_x');
    expect(session.entries, isEmpty);
    expect(blobStore.isDirty, isTrue);
  });
}