import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../storage/app_prefs.dart';

class SettingsScreen extends StatefulWidget {
  final VoidCallback onBack;
  const SettingsScreen({super.key, required this.onBack});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late TextEditingController _urlCtrl;
  late TextEditingController _wordsCtrl;

  @override
  void initState() {
    super.initState();
    final prefs = context.read<AppPrefs>();
    _urlCtrl = TextEditingController(text: prefs.serverUrl);
    _wordsCtrl = TextEditingController(text: prefs.codewords.join(', '));
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _wordsCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final prefs = context.watch<AppPrefs>();
    final loggedIn = prefs.sessionToken != null && prefs.sessionToken!.isNotEmpty;
    final lastSyncAt = prefs.lastSyncAt;
    final syncInfo = '当前版本 v${prefs.lastSyncVersion} · 上次同步 '
        '${lastSyncAt > 0 ? DateFormat.yMd().add_Hms().format(DateTime.fromMillisecondsSinceEpoch(lastSyncAt)) : "从未"}';

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
              const SizedBox(height: 8),
              Text('已登录：${loggedIn ? (prefs.username ?? "—") : "未登录"}',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              Text(syncInfo, style: TextStyle(color: Theme.of(context).colorScheme.primary)),
              const SizedBox(height: 8),
              Row(
                children: [
                  OutlinedButton(
                    onPressed: () => prefs.setServerUrl(_urlCtrl.text.trim()),
                    child: const Text('保存地址'),
                  ),
                  if (loggedIn) ...[
                    const SizedBox(width: 10),
                    OutlinedButton(
                      onPressed: () => prefs.clearCloudAccount(),
                      child: const Text('登出'),
                    ),
                  ],
                ],
              ),
            ],
          ),
          _SectionCard(
            icon: Icons.smart_toy,
            title: '暗语直达',
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('启用暗语门槛'),
                value: prefs.codewordGateEnabled,
                onChanged: (v) => prefs.setCodewordGateEnabled(v),
              ),
              TextField(
                controller: _wordsCtrl,
                decoration: const InputDecoration(labelText: '暗语列表（逗号 / 空格分隔）'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () {
                  final list = _wordsCtrl.text
                      .split(RegExp('[,，\\s]'))
                      .map((e) => e.trim())
                      .where((e) => e.isNotEmpty)
                      .toList();
                  prefs.setCodewords(list);
                },
                child: const Text('保存暗语'),
              ),
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
              const SizedBox(height: 8),
              Text('版本 1.0.0',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant)),
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
