import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../session/vault_session.dart';

class UnlockScreen extends StatefulWidget {
  final VoidCallback onUnlock;
  final VoidCallback goSetup;
  const UnlockScreen({super.key, required this.onUnlock, required this.goSetup});

  @override
  State<UnlockScreen> createState() => _UnlockScreenState();
}

class _UnlockScreenState extends State<UnlockScreen> {
  final _pwCtrl = TextEditingController();
  bool _loading = false;
  bool _badPassword = false;

  @override
  void dispose() {
    _pwCtrl.dispose();
    super.dispose();
  }

  Future<void> _unlock() async {
    setState(() {
      _loading = true;
      _badPassword = false;
    });
    final ok = await context.read<VaultSession>().unlock(_pwCtrl.text);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _badPassword = !ok;
    });
    if (ok) widget.onUnlock();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('解锁 MemoryPets')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const SizedBox(height: 32),
            Icon(Icons.lock, size: 64, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 16),
            Text('请输入解锁密码', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            TextField(
              controller: _pwCtrl,
              obscureText: true,
              autofocus: true,
              decoration: InputDecoration(
                labelText: '解锁密码',
                errorText: _badPassword ? '密码不正确' : null,
              ),
              onSubmitted: (_) => _unlock(),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _loading ? null : _unlock,
                child: _loading
                    ? const SizedBox(
                        width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('解锁'),
              ),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: widget.goSetup,
              child: const Text('还没有账号？重新 Setup'),
            ),
          ],
        ),
      ),
    );
  }
}
