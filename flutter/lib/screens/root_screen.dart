import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../session/vault_session.dart';
import '../storage/vault_blob_store.dart';
import 'editor_screen.dart';
import 'home_screen.dart';
import 'settings_screen.dart';
import 'setup_screen.dart';
import 'unlock_screen.dart';

enum _Destination { setup, unlock, home }

/// 根级导航：负责判断启动起点（是否已有本地 Vault 决定走 Setup 还是 Unlock），
/// 并托管 Home/Editor/Settings 之间的简单栈式导航。
/// 对应 Android 的 RootViewModel + MemoryPetsApp（NavHost）。
class RootScreen extends StatefulWidget {
  const RootScreen({super.key});

  @override
  State<RootScreen> createState() => _RootScreenState();
}

class _RootScreenState extends State<RootScreen> {
  _Destination? _dest;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _decideStart());
  }

  void _decideStart() {
    final blobStore = context.read<VaultBlobStore>();
    final hasLocalVault = blobStore.hasLocalVault;
    // 云账号已登录但本机从未创建过 vault 是个边缘情况（比如换新设备），
    // Unlock 页面目前还不支持"仅凭云端 pull 完成解锁"，所以这里仍然要求
    // 本机必须已经有 envelope 才能走 Unlock，否则一律先走 Setup。
    setState(() {
      _dest = hasLocalVault ? _Destination.unlock : _Destination.setup;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_dest == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    switch (_dest!) {
      case _Destination.setup:
        return SetupScreen(onSetupDone: () => setState(() => _dest = _Destination.home));
      case _Destination.unlock:
        return UnlockScreen(
          onUnlock: () => setState(() => _dest = _Destination.home),
          goSetup: () => setState(() => _dest = _Destination.setup),
        );
      case _Destination.home:
        return HomeScreen(
          onAdd: () => _pushEditor('new'),
          onEdit: (id) => _pushEditor(id),
          onSettings: () => _pushSettings(),
          onLock: () {
            context.read<VaultSession>().lock();
            setState(() => _dest = _Destination.unlock);
          },
        );
    }
  }

  void _pushEditor(String entryId) {
    Navigator.of(context)
        .push(MaterialPageRoute(
          builder: (_) => EditorScreen(
            entryId: entryId,
            onBack: () => Navigator.of(context).pop(),
          ),
        ))
        .then((_) => setState(() {}));
  }

  void _pushSettings() {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => SettingsScreen(onBack: () => Navigator.of(context).pop())))
        .then((_) => setState(() {}));
  }
}
