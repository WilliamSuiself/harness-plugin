import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../session/vault_session.dart';
import 'editor_screen.dart';
import 'home_screen.dart';
import 'settings_screen.dart';

/// 根级导航：本应用进入时不需要密码 / 暗语，启动后直接进 Home 屏，
/// 在 Home 上完成宠物动画展示 + 笔记列表 + 云同步入口。
///
/// Settings 仅负责云端配置（serverUrl / 云账号 / 云密码 / 主题），不再
/// 出现"锁屏 / 暗语"等入口。
class RootScreen extends StatefulWidget {
  final Widget Function(BuildContext, String assetPath)? petFrameBuilder;
  const RootScreen({super.key, this.petFrameBuilder});

  @override
  State<RootScreen> createState() => _RootScreenState();
}

class _RootScreenState extends State<RootScreen> {
  @override
  Widget build(BuildContext context) {
    return HomeScreen(
      onAdd: () => _pushEditor('new'),
      onEdit: (id) => _pushEditor(id),
      onSettings: () => _pushSettings(),
      petFrameBuilder: widget.petFrameBuilder,
    );
  }

  void _pushEditor(String entryId) {
    Navigator.of(context)
        .push(MaterialPageRoute(
          builder: (_) => EditorScreen(
            entryId: entryId,
            onBack: () => Navigator.of(context).pop(),
          ),
        ))
        .then((_) {
      if (!mounted) return;
      // 编辑完后 vault 可能变了，触发 rebuild 让列表刷新
      context.read<VaultSession>();
      setState(() {});
    });
  }

  void _pushSettings() {
    Navigator.of(context)
        .push(MaterialPageRoute(
          builder: (_) => SettingsScreen(onBack: () => Navigator.of(context).pop()),
        ))
        .then((_) => setState(() {}));
  }
}