// Entry-level merge tests for Vault.mergeWith — the Dart twin of
// packages/host/test/vault.test.mjs's `mergeSnapshot` tests. Both sides
// must agree on the semantics because they read/write the same encrypted
// envelope during cloud sync.

import 'package:flutter_test/flutter_test.dart';

import 'package:memorypets/models/entry.dart';
import 'package:memorypets/models/vault.dart';

Entry _note(String id, String value, {int updatedAt = 1, List<String> tags = const []}) {
  return Entry(
    id: id,
    kind: EntryKind.note,
    label: id,
    value: value,
    tags: tags,
    createdAt: 1,
    updatedAt: updatedAt,
  );
}

void main() {
  test('mergeWith keeps the newer copy of each entry by updatedAt', () {
    final local = const Vault().copyWith(entries: [
      _note('a', 'local-old', updatedAt: 1),
      _note('b', 'local-only', updatedAt: 1),
    ]);
    final remote = const Vault().copyWith(
      entries: [
        _note('a', 'remote-newer', updatedAt: 100),
        _note('c', 'remote-only', updatedAt: 5),
      ],
      categories: const ['旅行'],
    );

    final merged = local.mergeWith(remote);
    final byId = {for (final e in merged.entries) e.id: e};

    expect(byId['a']!.value, 'remote-newer');
    expect(byId['b']!.value, 'local-only');
    expect(byId['c']!.value, 'remote-only');
    expect(merged.categories, contains('旅行'));
  });

  test('mergeWith honors a tombstone over an older remote copy (no resurrection)', () {
    var local = const Vault().copyWith(entries: [_note('a', 'v1', updatedAt: 1)]);
    // Simulate a local delete: remove the entry and record a tombstone with
    // a deletedAt far larger than the remote's stale updatedAt.
    local = local.copyWith(
      entries: [],
      tombstones: [Tombstone(id: 'a', deletedAt: 10_000)],
    );
    final remote = const Vault().copyWith(entries: [_note('a', 'stale-copy', updatedAt: 1)]);

    final merged = local.mergeWith(remote);
    expect(merged.entries.where((e) => e.id == 'a'), isEmpty);
  });

  test('mergeWith unions categories case-insensitively without duplicates', () {
    final local = const Vault().copyWith(categories: const ['工作', '生活']);
    final remote = const Vault().copyWith(categories: const ['工作', '旅行']);
    final merged = local.mergeWith(remote);
    expect(merged.categories.length, 3);
    expect(merged.categories.map((c) => c.toLowerCase()).toSet(), {'工作', '生活', '旅行'});
  });

  test('Vault.fromJson backfills default categories only when the field is absent', () {
    final noField = Vault.fromJson({'version': 1, 'entries': []});
    expect(noField.categories, kDefaultCategories);

    final explicitEmpty = Vault.fromJson({'version': 1, 'entries': [], 'categories': []});
    expect(explicitEmpty.categories, isEmpty);
  });
}
