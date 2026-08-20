/// 同步操作结果（对应 Android core-model 的 SyncOutcome sealed interface）
sealed class SyncOutcome {
  const SyncOutcome();
}

class SyncPushed extends SyncOutcome {
  final int newVersion;
  const SyncPushed(this.newVersion);
}

class SyncPulled extends SyncOutcome {
  final int newVersion;
  final bool remoteAdopted;
  const SyncPulled(this.newVersion, this.remoteAdopted);
}

class SyncConflictNeedManual extends SyncOutcome {
  final int theirVersion;
  final int myVersion;
  const SyncConflictNeedManual(this.theirVersion, this.myVersion);
}

class SyncAuthExpired extends SyncOutcome {
  final String reason;
  const SyncAuthExpired(this.reason);
}

class SyncDecryptFailed extends SyncOutcome {
  final String reason;
  const SyncDecryptFailed(this.reason);
}

class SyncNetworkError extends SyncOutcome {
  final Object error;
  const SyncNetworkError(this.error);
}

/// 人类可读的同步结果描述（对应 HomeViewModel.syncNow 里的 when 分支）
String describeSyncOutcome(SyncOutcome outcome) {
  switch (outcome) {
    case SyncPushed(newVersion: final v):
      return '✅ 已上传 v$v';
    case SyncPulled(newVersion: final v):
      return '⬇️ 已拉取 v$v';
    case SyncConflictNeedManual():
      return '⚠️ 冲突，需要手动合并';
    case SyncAuthExpired(reason: final reason):
      return reason == 'not logged in'
          ? '� 尚未登录云账号（当前为纯本地模式），可在设置里配置云同步'
          : '�🔐 云会话已过期，请在设置里重新登录';
    case SyncDecryptFailed():
      return '❌ 对端主密码不同';
    case SyncNetworkError(error: final e):
      return '🌐 网络错误：$e';
  }
}
