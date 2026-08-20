import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/root_screen.dart';
import 'session/vault_session.dart';
import 'storage/app_prefs.dart';
import 'storage/vault_blob_store.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final appPrefs = AppPrefs();
  final blobStore = VaultBlobStore();
  await appPrefs.init();
  await blobStore.init();

  runApp(MemoryPetsApp(appPrefs: appPrefs, blobStore: blobStore));
}

class MemoryPetsApp extends StatelessWidget {
  final AppPrefs appPrefs;
  final VaultBlobStore blobStore;

  const MemoryPetsApp({super.key, required this.appPrefs, required this.blobStore});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AppPrefs>.value(value: appPrefs),
        ChangeNotifierProvider<VaultBlobStore>.value(value: blobStore),
        ChangeNotifierProvider<VaultSession>(create: (_) => VaultSession(blobStore)),
      ],
      child: Consumer<AppPrefs>(
        builder: (context, prefs, _) {
          return MaterialApp(
            title: 'MemoryPets',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light(),
            darkTheme: AppTheme.dark(),
            themeMode: prefs.darkMode ? ThemeMode.dark : ThemeMode.light,
            home: const RootScreen(),
          );
        },
      ),
    );
  }
}
