import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/cloud_sync_api.dart';
import '../session/vault_session.dart';
import '../storage/app_prefs.dart';

class SetupScreen extends StatefulWidget {
  final VoidCallback onSetupDone;
  const SetupScreen({super.key, required this.onSetupDone});

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final _pwCtrl = TextEditingController();
  final _pw2Ctrl = TextEditingController();
  final _wordsCtrl = TextEditingController(text: '记一下, 保存, 查一下, 导出');
  final _serverCtrl = TextEditingController();
  final _userCtrl = TextEditingController();
  final _cloudPwCtrl = TextEditingController();

  bool _loading = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    final prefs = context.read<AppPrefs>();
    _serverCtrl.text = prefs.serverUrl;
  }

  @override
  void dispose() {
    _pwCtrl.dispose();
    _pw2Ctrl.dispose();
    _wordsCtrl.dispose();
    _serverCtrl.dispose();
    _userCtrl.dispose();
    _cloudPwCtrl.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      _pwCtrl.text.length >= 6 && _pwCtrl.text == _pw2Ctrl.text && !_loading;

  Future<void> _submit() async {
    if (!_canSubmit) {
      setState(() => _error = '解锁密码至少 6 位且两次一致');
      return;
    }
    setState(() {
      _loading = true;
      _error = '';
    });
    final prefs = context.read<AppPrefs>();
    final session = context.read<VaultSession>();
    try {
      await prefs.setServerUrl(_serverCtrl.text.trim());
      final words = _wordsCtrl.text
          .split(RegExp('[,，\\s]'))
          .map((e) => e.trim())
          .where((e) => e.isNotEmpty)
          .toList();
      await prefs.setCodewords(words);

      final username = _userCtrl.text.trim();
      final cloudPw = _cloudPwCtrl.text;
      if (username.isNotEmpty && cloudPw.isNotEmpty) {
        // 云同步是可选项：这里的任何失败（网络不可达 / 域名解析失败 / 账号错误）
        // 都只应提示用户，不能阻塞本地 Setup 完成。
        try {
          final api = CloudSyncApi(prefs);
          var resp = await api.login(username, cloudPw);
          if (!resp.ok) {
            resp = await api.register(username, cloudPw);
          }
          if (resp.ok && resp.token != null) {
            await prefs.setCloudAccount(username, resp.token!);
          } else {
            setState(() => _error = '云账号登录/注册失败：${resp.error ?? "未知错误"}（本地 Setup 仍会继续）');
          }
        } catch (t) {
          setState(() => _error = '云同步暂时无法连接：$t（本地 Setup 仍会继续，可稍后在设置里重试）');
        }
      }

      await session.createNew(_pwCtrl.text);
      widget.onSetupDone();
    } catch (t) {
      setState(() => _error = t.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('欢迎使用 MemoryPets')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const SizedBox(height: 24),
            Icon(Icons.pets, size: 72, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 16),
            Text('第一步：设置解锁密码', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            TextField(
              controller: _pwCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: '解锁密码（≥ 6 位）'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _pw2Ctrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: '再输一遍'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _wordsCtrl,
              decoration: const InputDecoration(labelText: '初始暗语（逗号分隔，可改）'),
            ),
            const SizedBox(height: 24),
            Text('可选 — 连接云同步 Relay（浏览器 ↔ 手机实时同步）',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            TextField(
              controller: _serverCtrl,
              decoration: const InputDecoration(labelText: '服务器地址（例如 https://sync.example.com）'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _userCtrl,
              decoration: const InputDecoration(labelText: '云账号用户名'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _cloudPwCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: '云账号密码（与解锁密码互相独立）'),
            ),
            if (_error.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(_error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _canSubmit ? _submit : null,
                child: _loading
                    ? const SizedBox(
                        width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('完成 Setup'),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
