import 'entry.dart';

/// A tombstone recorded when an entry is deleted — lets [Vault.mergeWith]
/// tell "deleted on this device" apart from "just doesn't exist here yet",
/// so a delete on one device isn't silently resurrected by a stale copy
/// synced from another (see packages/host/lib/vault.mjs `mergeSnapshot` for
/// the JS-side twin of this logic — both must agree on the JSON shape since
/// they read/write the same encrypted envelope).
class Tombstone {
  final String id;
  final int deletedAt;
  const Tombstone({required this.id, required this.deletedAt});

  factory Tombstone.fromJson(Map<String, dynamic> json) => Tombstone(
        id: json['id'] as String,
        deletedAt: (json['deletedAt'] as num?)?.toInt() ?? 0,
      );

  Map<String, dynamic> toJson() => {'id': id, 'deletedAt': deletedAt};
}

/// Seeded once per fresh vault so every client (web/DSH host, Flutter)
/// starts with the same four notebook categories. Purely a starting point —
/// [Vault.addCategory]/[Vault.removeCategory] let the user reshape this
/// freely, and (because it's just a field on the synced Vault JSON) it
/// syncs like any other content.
const List<String> kDefaultCategories = ['工作', '生活', '学习', '个人'];

List<String> _dedupeCaseInsensitive(Iterable<String> input) {
  final seen = <String>{};
  final out = <String>[];
  for (final raw in input) {
    final name = raw.trim();
    if (name.isEmpty) continue;
    final key = name.toLowerCase();
    if (seen.contains(key)) continue;
    seen.add(key);
    out.add(name);
  }
  return out;
}

/// 解密后的 Vault 明文对象（对应用户整本笔记本）。
/// 与 DSH 端 unlock 后得到的 JSON 结构完全一致（version/entries/categories/
/// tombstones）——两端共享同一份加密信封，字段必须保持一致才能互通。
class Vault {
  final int version;
  final List<Entry> entries;
  final List<String> categories;
  final List<Tombstone> tombstones;

  const Vault({
    this.version = 1,
    this.entries = const [],
    this.categories = kDefaultCategories,
    this.tombstones = const [],
  });

  Vault copyWith({
    List<Entry>? entries,
    List<String>? categories,
    List<Tombstone>? tombstones,
  }) {
    return Vault(
      version: version,
      entries: entries ?? this.entries,
      categories: categories ?? this.categories,
      tombstones: tombstones ?? this.tombstones,
    );
  }

  Vault addCategory(String name) =>
      copyWith(categories: _dedupeCaseInsensitive([...categories, name]));

  Vault removeCategory(String name) {
    final key = name.trim().toLowerCase();
    return copyWith(categories: categories.where((c) => c.toLowerCase() != key).toList());
  }

  /// Entry-level merge used by [SyncOrchestrator] conflict resolution.
  /// MUST be used instead of adopting a remote vault wholesale — replacing
  /// the local vault outright silently discards any local edit that hadn't
  /// been pushed yet ("web 端更新后内容被手机端整体覆盖" was exactly this
  /// class of bug on the DSH host side; the same overwrite pattern existed
  /// here too via `blobStore.overwriteWithRemote`).
  Vault mergeWith(Vault remote) {
    final tombById = <String, Tombstone>{};
    for (final t in [...tombstones, ...remote.tombstones]) {
      final prev = tombById[t.id];
      if (prev == null || t.deletedAt > prev.deletedAt) tombById[t.id] = t;
    }
    final byId = <String, Entry>{};
    for (final e in entries) {
      byId[e.id] = e;
    }
    for (final e in remote.entries) {
      final local = byId[e.id];
      if (local == null || e.updatedAt > local.updatedAt) byId[e.id] = e;
    }
    final merged = byId.values.where((e) {
      final tomb = tombById[e.id];
      return tomb == null || tomb.deletedAt < e.updatedAt;
    }).toList();
    final mergedCategories = _dedupeCaseInsensitive([...categories, ...remote.categories]);
    return Vault(
      version: 1,
      entries: merged,
      categories: mergedCategories,
      tombstones: tombById.values.toList(),
    );
  }

  factory Vault.fromJson(Map<String, dynamic> json) {
    final categories = (json['categories'] as List<dynamic>?)?.map((e) => e.toString()).toList();
    return Vault(
      version: (json['version'] as num?)?.toInt() ?? 1,
      entries: (json['entries'] as List<dynamic>? ?? const [])
          .map((e) => Entry.fromJson(e as Map<String, dynamic>))
          .toList(),
      // Backfill the default catalog only when the field is absent (older
      // DSH host / older Flutter build) — an explicit empty list means the
      // user removed every category and must stay respected.
      categories: categories ?? kDefaultCategories,
      tombstones: (json['tombstones'] as List<dynamic>? ?? const [])
          .map((e) => Tombstone.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'version': version,
      'entries': entries.map((e) => e.toJson()).toList(),
      'categories': categories,
      'tombstones': tombstones.map((t) => t.toJson()).toList(),
    };
  }
}
