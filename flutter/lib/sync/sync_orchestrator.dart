import '../api/cloud_sync_api.dart';
import '../api/dto.dart';
import '../crypto/vault_crypto.dart';
import '../models/envelope.dart';
import '../models/sync_outcome.dart';
import '../storage/app_prefs.dart';
import '../storage/vault_blob_store.dart';

/// 云同步编排器 —— 与 packages/host/lib/cloud-sync.mjs 的 push / pull / confirmVersion 语义对齐，
/// 也与 Android sync 模块的 SyncOrchestrator.kt 完全一致。
///
/// 乐观并发流程：
///   1) GET /vault -> remoteVersion
///   2) remoteVersion > 本地 currentVersion -> 解密 remote envelope -> 采用（失败则 ConflictNeedManual）
///   3) 本地有改动 (dirty flag) 或本地版本 0 -> PUT /vault (expectedVersion = lastReadVersion)
///        200 -> confirmVersion(v+1)
///        409 -> 读取 current.envelope -> 解密采用 -> 再 PUT 一次 expectedVersion=current.version
///                 仍 409 -> ConflictNeedManual 交给用户
class SyncOrchestrator {
  final CloudSyncApi api;
  final VaultBlobStore blobStore;
  final AppPrefs prefs;

  SyncOrchestrator({required this.api, required this.blobStore, required this.prefs});

  /// @param masterPassword 当前解锁会话中的主密码（仅解密冲突时使用；调用方用完立即清空）
  /// @param buildLocalEnvelope 若本地有脏数据，调用此函数得到最新密封好的 Envelope
  Future<SyncOutcome> syncNow({
    required String? masterPassword,
    required Future<Envelope?> Function() buildLocalEnvelope,
  }) async {
    final token = prefs.sessionToken;
    if (token == null || token.isEmpty) {
      return const SyncAuthExpired('not logged in');
    }
    final deviceId = prefs.deviceId;

    try {
      // 1) GET remote
      final getResult = await api.getVault();
      if (getResult.statusCode != 200 || !getResult.body.ok) {
        if (getResult.statusCode == 401) return const SyncAuthExpired('token rejected');
        return SyncNetworkError('GET /vault failed HTTP ${getResult.statusCode}');
      }
      final body = getResult.body;
      final remoteVersion = body.version;
      final remoteEnv = body.envelope;

      var adoptedRemote = false;

      // 2) 有远程密文 & 更新 -> 拉取 & 解密采用
      if (remoteEnv != null && remoteVersion > blobStore.currentVersion) {
        if (masterPassword == null) {
          return SyncConflictNeedManual(remoteVersion, blobStore.currentVersion);
        }
        try {
          await VaultCrypto.unlock(envelope: remoteEnv, masterPassword: masterPassword); // 先验证能解开再落盘
          await blobStore.overwriteWithRemote(
            remoteEnv,
            remoteVersion,
            body.updatedAt ?? DateTime.now().millisecondsSinceEpoch,
          );
          await prefs.markSynced(remoteVersion, DateTime.now().millisecondsSinceEpoch);
          adoptedRemote = true;
        } on BadMasterPasswordException {
          return const SyncDecryptFailed('remote vault sealed with different master password');
        }
      }

      // 3) 本地有脏改动 / 从未提交过 -> push
      final localDirty = blobStore.isDirty;
      final nothingOnRemote = remoteVersion == 0 && remoteEnv == null;
      if (!localDirty && !nothingOnRemote) {
        return adoptedRemote
            ? SyncPulled(remoteVersion, true)
            : SyncPushed(remoteVersion);
      }

      final myEnv = await buildLocalEnvelope();
      if (myEnv == null) {
        return adoptedRemote ? SyncPulled(remoteVersion, true) : SyncPushed(remoteVersion);
      }

      final expectedVersion = remoteVersion > blobStore.currentVersion
          ? remoteVersion
          : blobStore.currentVersion;
      final firstPut = await _putVaultWithRetry(myEnv, expectedVersion, deviceId);
      if (firstPut is SyncPushed) {
        await blobStore.confirmVersion(firstPut.newVersion, DateTime.now().millisecondsSinceEpoch);
        await prefs.markSynced(firstPut.newVersion, DateTime.now().millisecondsSinceEpoch);
        return firstPut;
      }
      // 409 -> retry once
      if (firstPut is SyncConflictNeedManual) {
        final theirVersion = firstPut.theirVersion;
        final refetch = await _fetchCurrentEnvAfter409();
        final theirEnvDto = refetch?.envelope;
        if (theirEnvDto == null) {
          return SyncNetworkError('failed to refetch winner after 409');
        }
        if (masterPassword != null) {
          try {
            await VaultCrypto.unlock(envelope: theirEnvDto, masterPassword: masterPassword);
            await blobStore.overwriteWithRemote(
              theirEnvDto,
              theirVersion,
              DateTime.now().millisecondsSinceEpoch,
            );
          } on BadMasterPasswordException {
            return const SyncDecryptFailed('different master password on 409 winner');
          }
        }
        // retry PUT with the winner version
        final retry = await _putVaultWithRetry(myEnv, theirVersion, deviceId);
        if (retry is SyncPushed) {
          await blobStore.confirmVersion(retry.newVersion, DateTime.now().millisecondsSinceEpoch);
          await prefs.markSynced(retry.newVersion, DateTime.now().millisecondsSinceEpoch);
          return retry;
        }
        return retry;
      }
      return firstPut;
    } on CloudAuthExpiredException catch (e) {
      return SyncAuthExpired(e.message);
    } catch (t) {
      return SyncNetworkError(t);
    }
  }

  Future<SyncOutcome> _putVaultWithRetry(
    Envelope env,
    int expectedVersion,
    String deviceId,
  ) async {
    final req = PutVaultReq(envelope: env, expectedVersion: expectedVersion, deviceId: deviceId);
    try {
      final resp = await api.putVault(req);
      switch (resp.statusCode) {
        case 200:
          final body = resp.body;
          if (body.ok && body.version != null) return SyncPushed(body.version!);
          return SyncNetworkError(body.error ?? 'put failed');
        case 409:
          final winnerVersion = resp.body.current?.version ??
              (await _fetchCurrentEnvAfter409())?.version;
          if (winnerVersion == null) {
            return SyncNetworkError('409 missing current');
          }
          return SyncConflictNeedManual(winnerVersion, expectedVersion);
        case 401:
          return const SyncAuthExpired('401');
        default:
          return SyncNetworkError('PUT /vault HTTP ${resp.statusCode}');
      }
    } on CloudAuthExpiredException {
      final winner = await _fetchCurrentEnvAfter409();
      if (winner == null) return SyncNetworkError('no winner');
      return SyncConflictNeedManual(winner.version, expectedVersion);
    }
  }

  Future<GetVaultResp?> _fetchCurrentEnvAfter409() async {
    try {
      final result = await api.getVault();
      return result.body;
    } catch (_) {
      return null;
    }
  }
}
