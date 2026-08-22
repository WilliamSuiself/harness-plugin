import 'dart:convert';

import '../api/cloud_sync_api.dart';
import '../api/dto.dart';
import '../crypto/vault_crypto.dart';
import '../models/envelope.dart';
import '../models/sync_outcome.dart';
import '../models/vault.dart';
import '../session/vault_session.dart';
import '../storage/app_prefs.dart';
import '../storage/vault_blob_store.dart';

/// 云同步编排器 —— 与 packages/host/lib/cloud-sync.mjs 的 push / pull / confirmVersion
/// 语义对齐，也与 Android sync 模块的 SyncOrchestrator 一致。
///
/// 协议约定：云端存的是 envelope（PBKDF2+AES-GCM 密文），本应用本地是
/// 明文 vault。同步时用 [AppPrefs.cloudMasterPassword]（用户事先在 Settings
/// 里填好的"云密码"）seal / unseal。本类**不直接持有密码**：密码只在
/// `syncNow()` 调用前后从 prefs 读出、用完即丢。
///
/// 乐观并发流程：
///   1) GET /vault -> remoteVersion + remote envelope
///   2) remoteVersion > 本地 currentVersion -> 用云密码 unseal remote envelope
///      -> 成功则覆盖本地 + blobStore.adopt(vault)；失败则 ConflictNeedManual
///   3) 本地有改动 (dirty flag) 或本地版本 0 -> 用云密码 seal 本地 vault
///      -> PUT /vault (expectedVersion = lastReadVersion)
///        200 -> confirmVersion(v+1)
///        409 -> 读取 current envelope -> 用云密码 unseal -> 再 PUT 一次
///               expectedVersion=current.version
///                 仍 409 -> ConflictNeedManual 交给用户
class SyncOrchestrator {
  final CloudSyncApi api;
  final VaultBlobStore blobStore;
  final VaultSession session;
  final AppPrefs prefs;

  SyncOrchestrator({
    required this.api,
    required this.blobStore,
    required this.session,
    required this.prefs,
  });

  /// 触发一次云同步。返回 [SyncOutcome] 描述本次结果（参见
  /// `models/sync_outcome.dart`）。
  ///
  /// 调用前要求：
  ///   - 用户已经在 Settings 配好 serverUrl / cloud account
  ///     （即 [AppPrefs.sessionToken] 非空）；
  ///   - 用户已经在 Settings 填好 [AppPrefs.cloudMasterPassword]。
  /// 缺任一项会立即返回对应的 [SyncAuthExpired] / [SyncMissingCloudPassword]
  /// 让 UI 给出明确提示。
  Future<SyncOutcome> syncNow() async {
    final token = prefs.sessionToken;
    if (token == null || token.isEmpty) {
      return const SyncAuthExpired('not logged in');
    }
    final cloudPw = prefs.cloudMasterPassword;
    if (cloudPw == null) {
      return const SyncMissingCloudPassword();
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

      // Captured BEFORE any merge/overwrite below, because
      // `blobStore.overwriteWithRemote()` always resets the dirty flag —
      // we still need to know whether the pre-merge local vault had
      // changes worth re-uploading (otherwise a merged-in local edit could
      // silently never make it back to the relay).
      final wasDirtyBeforeMerge = blobStore.isDirty;
      var adoptedRemote = false;

      // 2) 有远程密文 & 更新 -> 拉取并与本地"合并"（按 entry id + updatedAt
      //    取更新的一份，tombstone 优先于旧副本），而不是整本覆盖。
      //
      //    IMPORTANT: this used to call `blobStore.overwriteWithRemote(
      //    decrypted, ...)` directly, which silently discarded any local
      //    edit that hadn't been pushed yet — the exact same class of bug
      //    fixed on the DSH host side in `cloudSyncNow()` (see
      //    packages/host/lib/index.mjs). Always merge, never overwrite.
      if (remoteEnv != null && remoteVersion > blobStore.currentVersion) {
        final decrypted = await _tryUnlock(remoteEnv, cloudPw);
        if (decrypted == null) {
          return const SyncDecryptFailed('remote vault sealed with different master password');
        }
        final merged = session.vault.mergeWith(decrypted);
        await blobStore.overwriteWithRemote(
          merged,
          remoteVersion,
          body.updatedAt ?? DateTime.now().millisecondsSinceEpoch,
        );
        await prefs.markSynced(remoteVersion, DateTime.now().millisecondsSinceEpoch);
        session.adopt(merged);
        adoptedRemote = true;
      }

      // 3) 本地有脏改动 / 从未提交过 -> push
      // 如果刚刚发生了合并，用"合并前"的 dirty 状态判断——overwriteWithRemote
      // 已经把 dirty 标志重置为 false，但合并进来的本地专属条目仍然需要
      // 重新上传，否则会在本地"看得到"但云端/其它设备永远收不到。
      final localDirty = adoptedRemote ? wasDirtyBeforeMerge : blobStore.isDirty;
      final nothingOnRemote = remoteVersion == 0 && remoteEnv == null;
      if (!localDirty && !nothingOnRemote) {
        return adoptedRemote
            ? SyncPulled(remoteVersion, true)
            : SyncPushed(remoteVersion);
      }

      final myEnv = await _sealLocal(cloudPw);
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
      // 409 -> merge with the winner, then retry once (push the MERGED
      // snapshot, not the stale pre-conflict `myEnv` — pushing the old
      // local copy as-is would silently discard whatever the other device
      // just wrote, which is the same class of data-loss bug this whole
      // merge rework is fixing).
      if (firstPut is SyncConflictNeedManual) {
        final theirVersion = firstPut.theirVersion;
        final refetch = await _fetchCurrentEnvAfter409();
        final theirEnvDto = refetch?.envelope;
        if (theirEnvDto == null) {
          return SyncNetworkError('failed to refetch winner after 409');
        }
        final theirVault = await _tryUnlock(theirEnvDto, cloudPw);
        if (theirVault == null) {
          return const SyncDecryptFailed('remote vault sealed with different master password');
        }
        final merged = session.vault.mergeWith(theirVault);
        await blobStore.overwriteWithRemote(
          merged,
          theirVersion,
          DateTime.now().millisecondsSinceEpoch,
        );
        session.adopt(merged);
        final mergedEnv = await _sealLocal(cloudPw);
        if (mergedEnv == null) {
          return SyncPulled(theirVersion, true);
        }
        // retry PUT with the winner version
        final retry = await _putVaultWithRetry(mergedEnv, theirVersion, deviceId);
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

  /// 用 [cloudPw] 试解 envelope；成功返回明文 Vault，失败返回 null。
  Future<Vault?> _tryUnlock(Envelope env, String cloudPw) async {
    try {
      final json = await VaultCrypto.unlock(envelope: env, masterPassword: cloudPw);
      return Vault.fromJson(jsonDecode(json) as Map<String, dynamic>);
    } on BadMasterPasswordException {
      return null;
    }
  }

  /// 把 session 当前内存 vault 封成 envelope。
  Future<Envelope?> _sealLocal(String cloudPw) async {
    final json = jsonEncode(session.vault.toJson());
    return VaultCrypto.seal(plaintextJson: json, masterPassword: cloudPw);
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