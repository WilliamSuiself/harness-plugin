import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/cloud_sync_api.dart';
import '../storage/app_prefs.dart';

class SettingsScreen extends StatefulWidget {
  final VoidCallback onBack;
  const SettingsScreen({super.key, required this.onBack});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late TextEditingController _urlCtrl;
  late TextEditingController _userCtrl;
  late TextEditingController _tokenCtrl;
  late TextEditingController _cloudPwCtrl;

  String _cloudMsg = '';
  bool _cloudBusy = false;

  @override
  void initState() {
    super.initState();
    final prefs = context.read<AppPrefs>();
    _urlCtrl = TextEditingController(text: prefs.serverUrl);
    _userCtrl = TextEditingController(text: prefs.username ?? '');
    _tokenCtrl = TextEditingController();
    // 默认也填上 AppPrefs 的云密码兜底值（调试期方便点一次登录就能跑通）。
    _cloudPwCtrl = TextEditingController(text: prefs.cloudMasterPassword ?? '');
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _userCtrl.dispose();
    _tokenCtrl.dispose();
    _cloudPwCtrl.dispose();
    super.dispose();
  }

  Future<void> _loginOrRegister() async {
    final username = _userCtrl.text.trim();
    final password = _cloudPwCtrl.text;
    final newUrl = _urlCtrl.text.trim();
    if (username.isEmpty || password.isEmpty) {
      setState(() => _cloudMsg = '请填用户名 + 云密码');
      return;
    }
    if (newUrl.isEmpty) {
      setState(() => _cloudMsg = '服务器地址不能为空');
      return;
    }
    setState(() {
      _cloudBusy = true;
      _cloudMsg = '连接中…';
    });
    final prefs = context.read<AppPrefs>();
    // 关键：先保存地址！CloudSyncApi 的 _uri() 是从 prefs.serverUrl 动态读，
    // 如果不先 setServerUrl，下面的 login/register 仍会用旧的 URL，导致报错信息里
    // 出现的是默认值 https://sync.example.com。
    await prefs.setServerUrl(newUrl);
    try {
      final api = CloudSyncApi(prefs);
      var resp = await api.login(username, password);
      if (!resp.ok) {
        resp = await api.register(username, password);
      }
      if (resp.ok && resp.token != null) {
        await prefs.setCloudAccount(username, resp.token!);
        await prefs.setCloudMasterPassword(password);
        if (!mounted) return;
        setState(() {
          _cloudMsg = '✅ 已登录 ${resp.token!.substring(0, resp.token!.length.clamp(0, 8))}…（服务器：$newUrl）';
          _cloudPwCtrl.clear();
        });
      } else {
        setState(() => _cloudMsg = '❌ ${resp.error ?? "登录失败"}（已尝试服务器：$newUrl）');
      }
    } catch (t) {
      setState(() => _cloudMsg = '❌ 网络错误：$t（已尝试服务器：$newUrl）');
    } finally {
      if (mounted) setState(() => _cloudBusy = false);
    }
  }

  Future<void> _saveCloudPasswordOnly() async {
    final pw = _cloudPwCtrl.text;
    if (pw.isEmpty) {
      setState(() => _cloudMsg = '云密码不能为空');
      return;
    }
    await context.read<AppPrefs>().setCloudMasterPassword(pw);
    if (!mounted) return;
    setState(() {
      _cloudMsg = '✅ 云密码已保存';
      _cloudPwCtrl.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final prefs = context.watch<AppPrefs>();
    final loggedIn = prefs.sessionToken != null && prefs.sessionToken!.isNotEmpty;
    final lastSyncAt = prefs.lastSyncAt;
    final syncInfo = '当前版本 v${prefs.lastSyncVersion} · 上次同步 '
        '${lastSyncAt > 0 ? DateFormat.yMd().add_Hms().format(DateTime.fromMillisecondsSinceEpoch(lastSyncAt)) : "从未"}';
    final cloudPwSet = prefs.cloudMasterPassword != null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('设置'),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: widget.onBack),
      ),
      body: ListView(
        children: [
          _SectionCard(
            icon: Icons.cloud_sync,
            title: '云同步',
            children: [
              TextField(
                controller: _urlCtrl,
                decoration: const InputDecoration(labelText: '服务器地址'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _userCtrl,
                decoration: InputDecoration(
                  labelText: '云账号用户名',
                  hintText: loggedIn ? '当前：${prefs.username ?? "—"}' : '新账号会一并注册',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _cloudPwCtrl,
                obscureText: true,
                decoration: InputDecoration(
                  labelText: '云密码',
                  hintText: cloudPwSet ? '已保存 · 输入新值可修改' : '用于解开云端 vault envelope',
                ),
              ),
              const SizedBox(height: 8),
              Text('已登录：${loggedIn ? (prefs.username ?? "—") : "未登录"}',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              Text('云密码：${cloudPwSet ? "✅ 已配置" : "⚠️ 未配置（同步时会提示）"}',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              Text(syncInfo, style: TextStyle(color: Theme.of(context).colorScheme.primary)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    onPressed: _cloudBusy ? null : _loginOrRegister,
                    icon: const Icon(Icons.login),
                    label: const Text('登录 / 注册并保存'),
                  ),
                  OutlinedButton(
                    onPressed: _cloudBusy ? null : _saveCloudPasswordOnly,
                    child: const Text('仅保存云密码'),
                  ),
                  OutlinedButton(
                    onPressed: () => prefs.setServerUrl(_urlCtrl.text.trim()),
                    child: const Text('保存地址'),
                  ),
                  if (loggedIn)
                    OutlinedButton(
                      onPressed: () async {
                        await prefs.clearCloudAccount();
                        await prefs.clearCloudMasterPassword();
                        if (mounted) setState(() => _cloudMsg = '已登出并清空云密码');
                      },
                      child: const Text('登出并清空云密码'),
                    ),
                ],
              ),
              if (_cloudMsg.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(_cloudMsg,
                    style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ],
            ],
          ),
          _SectionCard(
            icon: Icons.pets,
            title: '关于',
            children: [
              const Text('宠物管家笔记本 — 进入无密码，同步时根据本设置里的云账号 / 云密码去云端取数据。'),
              const SizedBox(height: 8),
              Text('版本 1.0.0',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant)),
            ],
          ),
          _SectionCard(
            title: '通用',
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('深色主题'),
                value: prefs.darkMode,
                onChanged: (v) => prefs.setDarkMode(v),
              ),
            ],
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final IconData? icon;
  final String title;
  final List<Widget> children;

  const _SectionCard({this.icon, required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 8),
              ],
              Text(title, style: Theme.of(context).textTheme.titleMedium),
            ],
          ),
          const SizedBox(height: 8),
          Card(
            elevation: 1,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
            ),
          ),
        ],
      ),
    );
  }
}