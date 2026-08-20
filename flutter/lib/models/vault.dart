import 'entry.dart';

/// 解密后的 Vault 明文对象（对应用户整本笔记本）。
/// 与 DSH 端 unlock 后得到的 JSON 结构完全一致。
class Vault {
  final int version;
  final List<Entry> entries;

  const Vault({this.version = 1, this.entries = const []});

  Vault copyWith({List<Entry>? entries}) {
    return Vault(version: version, entries: entries ?? this.entries);
  }

  factory Vault.fromJson(Map<String, dynamic> json) {
    return Vault(
      version: (json['version'] as num?)?.toInt() ?? 1,
      entries: (json['entries'] as List<dynamic>? ?? const [])
          .map((e) => Entry.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'version': version,
      'entries': entries.map((e) => e.toJson()).toList(),
    };
  }
}
