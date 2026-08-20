/// 笔记条目（与 MOBILE_SYNC_API.md §2 明文 JSON 字段完全一致）
/// 所有字段名与默认值必须与 packages/host/lib/intent.mjs / operations.mjs 对齐。
enum EntryKind {
  note('note'),
  credential('credential'),
  profile('profile'), // legacy：与 note 等价展示
  work('work'); // legacy：与 note 等价展示

  final String raw;
  const EntryKind(this.raw);

  static EntryKind fromRaw(String raw) {
    return EntryKind.values.firstWhere(
      (k) => k.raw == raw,
      orElse: () => EntryKind.note,
    );
  }

  String get displayName {
    switch (this) {
      case EntryKind.note:
        return '笔记';
      case EntryKind.credential:
        return '凭证';
      case EntryKind.profile:
        return '资料';
      case EntryKind.work:
        return '工作';
    }
  }
}

class Entry {
  final String id;
  final EntryKind kind;
  final String label;
  final String value;
  final List<String> tags;
  final String? dueDate; // ISO date YYYY-MM-DD，仅对 note 有意义
  final String? hint; // 仅 credential 有：非秘密 hint（如 ends 8a1f）
  final int createdAt; // epoch ms
  final int updatedAt; // epoch ms

  const Entry({
    required this.id,
    required this.kind,
    required this.label,
    required this.value,
    this.tags = const [],
    this.dueDate,
    this.hint,
    required this.createdAt,
    required this.updatedAt,
  });

  Entry copyWith({
    EntryKind? kind,
    String? label,
    String? value,
    List<String>? tags,
    String? dueDate,
    String? hint,
    int? updatedAt,
  }) {
    return Entry(
      id: id,
      kind: kind ?? this.kind,
      label: label ?? this.label,
      value: value ?? this.value,
      tags: tags ?? this.tags,
      dueDate: dueDate ?? this.dueDate,
      hint: hint ?? this.hint,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  factory Entry.fromJson(Map<String, dynamic> json) {
    return Entry(
      id: json['id'] as String,
      kind: EntryKind.fromRaw(json['kind'] as String? ?? 'note'),
      label: json['label'] as String? ?? '',
      value: json['value'] as String? ?? '',
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? const [],
      dueDate: json['dueDate'] as String?,
      hint: json['hint'] as String?,
      createdAt: (json['createdAt'] as num?)?.toInt() ?? 0,
      updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'kind': kind.raw,
      'label': label,
      'value': value,
      'tags': tags,
      if (dueDate != null) 'dueDate': dueDate,
      if (hint != null) 'hint': hint,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }
}
