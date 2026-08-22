// Basic smoke test: app boots and shows the Home screen on first launch.
// （首启不再走 Setup / Unlock，直接进 Home）

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:memorypets/api/cloud_sync_api.dart';
import 'package:memorypets/main.dart';
import 'package:memorypets/session/vault_session.dart';
import 'package:memorypets/storage/app_prefs.dart';
import 'package:memorypets/storage/vault_blob_store.dart';
import 'package:memorypets/sync/sync_orchestrator.dart';

void main() {
  testWidgets('shows Home screen with pet banner on first launch', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = AppPrefs();
    final blobStore = VaultBlobStore();
    await prefs.init();
    await blobStore.init();

    final session = VaultSession(blobStore);
    await session.bootstrap();
    final api = CloudSyncApi(prefs);
    final sync = SyncOrchestrator(
      api: api,
      blobStore: blobStore,
      session: session,
      prefs: prefs,
    );

    // widget test 里 Image.asset 会去找 PlatformAssetBundle 里的资源，
    // 默认测试环境里没有这些图片（实际资源由 `flutter run` / 真实 device 提供）。
    // 用一个灰色方块代替，让 smoke test 不再依赖具体图片资源。
    Widget mockPetFrame(BuildContext _, String __) =>
        Container(color: Colors.grey);

    await tester.pumpWidget(MemoryPetsApp(
      appPrefs: prefs,
      blobStore: blobStore,
      session: session,
      sync: sync,
      petFrameBuilder: mockPetFrame,
    ));
    // 不用 pumpAndSettle —— 宠物动画是 repeating 的，永远 settle 不下来。
    // 单帧 pump 已经足够让 UI tree 渲染出来。
    await tester.pump();

    // 首页 AppBar 标题 + 宠物 banner 文字
    expect(find.text('MemoryPets · 宠物笔记本'), findsOneWidget);
    // 宠物 banner 的开场文案："今天也要好好记下身边的小事 🐾"
    expect(find.textContaining('今天也要好好记下'), findsOneWidget);
  });
}