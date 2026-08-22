import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api/cloud_sync_api.dart';
import 'screens/root_screen.dart';
import 'session/vault_session.dart';
import 'storage/app_prefs.dart';
import 'storage/vault_blob_store.dart';
import 'sync/sync_orchestrator.dart';
import 'theme/app_theme.dart';

Future<void> main({
  Widget Function(BuildContext, String assetPath)? petFrameBuilder,
}) async {
  WidgetsFlutterBinding.ensureInitialized();

  final appPrefs = AppPrefs();
  final blobStore = VaultBlobStore();
  await appPrefs.init();
  await blobStore.init();

  final session = VaultSession(blobStore);
  await session.bootstrap();

  final api = CloudSyncApi(appPrefs);
  final sync = SyncOrchestrator(
    api: api,
    blobStore: blobStore,
    session: session,
    prefs: appPrefs,
  );

  runApp(MemoryPetsApp(
    appPrefs: appPrefs,
    blobStore: blobStore,
    session: session,
    sync: sync,
    petFrameBuilder: petFrameBuilder,
  ));
}

class MemoryPetsApp extends StatelessWidget {
  final AppPrefs appPrefs;
  final VaultBlobStore blobStore;
  final VaultSession session;
  final SyncOrchestrator sync;
  final Widget Function(BuildContext, String assetPath)? petFrameBuilder;

  const MemoryPetsApp({
    super.key,
    required this.appPrefs,
    required this.blobStore,
    required this.session,
    required this.sync,
    this.petFrameBuilder,
  });

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AppPrefs>.value(value: appPrefs),
        ChangeNotifierProvider<VaultBlobStore>.value(value: blobStore),
        ChangeNotifierProvider<VaultSession>.value(value: session),
        Provider<SyncOrchestrator>.value(value: sync),
      ],
      child: Consumer<AppPrefs>(
        builder: (context, prefs, _) {
          return MaterialApp(
            title: 'MemoryPets',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light(),
            darkTheme: AppTheme.dark(),
            themeMode: prefs.darkMode ? ThemeMode.dark : ThemeMode.light,
            home: RootScreen(petFrameBuilder: petFrameBuilder),
          );
        },
      ),
    );
  }
}