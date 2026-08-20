// Basic smoke test: app boots and shows the Setup screen on first launch
// (no local vault yet, no cloud session).

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:memorypets/main.dart';
import 'package:memorypets/storage/app_prefs.dart';
import 'package:memorypets/storage/vault_blob_store.dart';

void main() {
  testWidgets('shows Setup screen on first launch', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = AppPrefs();
    final blobStore = VaultBlobStore();
    await prefs.init();
    await blobStore.init();

    await tester.pumpWidget(MemoryPetsApp(appPrefs: prefs, blobStore: blobStore));
    await tester.pumpAndSettle();

    expect(find.text('欢迎使用 MemoryPets'), findsOneWidget);
  });
}
