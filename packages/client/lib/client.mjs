// Client plugin: floating pet UI via shell.overlay slot.
//
// Written in plain JS with React.createElement (no JSX / no TS build step)
// so the Cordis dynamic loader can pull it directly into the browser bundle.
// Host/Client RPC is intentionally left lightweight for this PoC: the UI
// exposes a small panel, and real bridge wiring happens after mounting.

import * as React from 'react';

export const name = 'memorypets-client';
export const inject = ['slots'];

const STATES = {
  standing: {
    label: '站立',
    prefix: '/memorypets-assets/standing/',
    frames: Array.from({ length: 19 }, (_, i) => String(i + 2).padStart(2, '0') + '.png'),
    fps: 10,
  },
  thinking: {
    label: '思考',
    prefix: '/memorypets-assets/thinking/',
    frames: Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0') + '.png'),
    fps: 12,
  },
  waiting: {
    label: '等待',
    prefix: '/memorypets-assets/waiting/',
    frames: Array.from({ length: 17 }, (_, i) => String(i + 4).padStart(2, '0') + '.png'),
    fps: 8,
  },
  sleeping: {
    label: '睡眠',
    prefix: '/memorypets-assets/sleeping/',
    frames: Array.from({ length: 18 }, (_, i) => String(i + 3).padStart(2, '0') + '.png'),
    fps: 6,
  },
};

const h = React.createElement;

const kindNames = { note: '笔记', profile: '个人资料（旧）', work: '工作（旧）', credential: '凭证' };

function useAnimationFrame(stateKey) {
  const state = STATES[stateKey];
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    setIdx(0);
    if (!state || !state.frames.length) return () => {};
    const interval = 1000 / state.fps;
    let timer = setInterval(() => {
      setIdx((i) => (i + 1) % state.frames.length);
    }, interval);
    return () => clearInterval(timer);
  }, [stateKey]);
  if (!state) return '';
  return state.prefix + state.frames[idx % state.frames.length];
}

// Detect code-words by watching the dsh composer textarea in real time.
// When the user types a code-word we briefly switch the floating pet into
// the "thinking" sprite so the UI itself surfaces the activation — the LLM
// then has no reason to fabricate a "进入直连模式" banner itself.
function useCodeWordDetector(codeWords) {
  React.useEffect(() => {
    if (typeof document === 'undefined') return () => {};
    if (!Array.isArray(codeWords) || codeWords.length === 0) return () => {};
    const words = codeWords.filter(Boolean);
    const re = new RegExp('(' + words.map((w) =>
      String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('|') + ')', 'i');

    const onInput = (ev) => {
      const ta = ev.target;
      if (!ta || ta.tagName !== 'TEXTAREA') return;
      const hit = re.test(ta.value || '');
      document.documentElement.dataset.memorypetsGate = hit ? 'open' : 'closed';
    };
    const onBlur = () => {
      document.documentElement.dataset.memorypetsGate = 'closed';
    };
    document.addEventListener('input', onInput, true);
    document.addEventListener('blur', onBlur, true);
    return () => {
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('blur', onBlur, true);
      delete document.documentElement.dataset.memorypetsGate;
    };
  }, [codeWords]);
}

function ShellOverlayComponent() {
  const [stateKey, setStateKey] = React.useState('waiting');
  const [showPanel, setShowPanel] = React.useState(false);
  const [unlocked, setUnlocked] = React.useState(false);
  const [hasEnvelope, setHasEnvelope] = React.useState(true);
  const [password, setPassword] = React.useState('');
  const [setupCodeWord, setSetupCodeWord] = React.useState('');
  const [codeWords, setCodeWords] = React.useState([]);
  const [editCodeWord, setEditCodeWord] = React.useState('');
  const [showEditCodeWords, setShowEditCodeWords] = React.useState(false);
  const [showChangePassword, setShowChangePassword] = React.useState(false);
  const [currentPwd, setCurrentPwd] = React.useState('');
  const [newPwd, setNewPwd] = React.useState('');
  const [confirmPwd, setConfirmPwd] = React.useState('');
  const [error, setError] = React.useState(null);
  const [entries, setEntries] = React.useState([]);
  // Category catalog for the notebook sidebar (工作/生活/学习/个人 + anything
  // the user adds). Synced from the host (which stores it inside the
  // encrypted vault snapshot, see packages/host/lib/vault.mjs), so it stays
  // consistent with the Flutter client and the cloud relay.
  const [categories, setCategories] = React.useState([]);
  const [expanded, setExpanded] = React.useState(false); // 全屏笔记本视图
  const [selectedCategory, setSelectedCategory] = React.useState(null); // null = 全部
  const [notebookSearch, setNotebookSearch] = React.useState('');
  const [newCategoryName, setNewCategoryName] = React.useState('');
  // 左侧"添加条目"折叠区的三态：
  //   collapsed — 只显示 "＋ 添加条目" 按钮 + 所有条目标题列表（默认）
  //   quick     — 只有一个标题输入框，点"创建"后立即变成 edit 态方便手动填内容
  //   edit      — 完整字段（类型/内容/标签/日期），editingId 非空时是"编辑已有条目"
  const [sidebarFormMode, setSidebarFormMode] = React.useState('collapsed');
  const [editingId, setEditingId] = React.useState(null);
  const [formKind, setFormKind] = React.useState('note');
  const [formLabel, setFormLabel] = React.useState('');
  const [formValue, setFormValue] = React.useState('');
  const [formTags, setFormTags] = React.useState('');
  const [formDueDate, setFormDueDate] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [gateOpen, setGateOpen] = React.useState(false);
  const [encryptionEnabled, setEncryptionEnabled] = React.useState(true);
  const [codewordGateEnabled, setCodewordGateEnabled] = React.useState(true);
  const [showEnableEncryption, setShowEnableEncryption] = React.useState(false);
  const [enableEncPwd, setEnableEncPwd] = React.useState('');
  const [enableEncPwd2, setEnableEncPwd2] = React.useState('');
  const [showCloudSync, setShowCloudSync] = React.useState(false);
  const [cloudStatus, setCloudStatus] = React.useState({ loggedIn: false });
  const [cloudServerUrl, setCloudServerUrl] = React.useState('');
  const [cloudUsername, setCloudUsername] = React.useState('');
  const [cloudPassword, setCloudPassword] = React.useState('');
  const [cloudSyncing, setCloudSyncing] = React.useState(false);
  const [cloudMessage, setCloudMessage] = React.useState(null);
  const imgSrc = useAnimationFrame(stateKey);
  useCodeWordDetector(codeWords);

  React.useEffect(() => {
    if (typeof document === 'undefined') return () => {};
    const sync = () => {
      const v = document.documentElement.dataset.memorypetsGate;
      setGateOpen(v === 'open');
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-memorypets-gate'] });
    return () => obs.disconnect();
  }, []);

  React.useEffect(() => {
    fetch('/memorypets-api/status')
      .then((r) => r.json())
      .then((data) => {
        setHasEnvelope(!!data.hasEnvelope);
        setUnlocked(!!data.isUnlocked);
      })
      .catch(() => {});
    fetch('/memorypets-api/codeword')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data.codeWords)) setCodeWords(data.codeWords); })
      .catch(() => {});
    fetch('/memorypets-api/entries')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.entries)) setEntries(data.entries);
        if (Array.isArray(data.categories)) setCategories(data.categories);
      })
      .catch(() => {});
    fetch('/memorypets-api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.encryptionEnabled === 'boolean') setEncryptionEnabled(data.encryptionEnabled);
        if (typeof data.codewordGateEnabled === 'boolean') setCodewordGateEnabled(data.codewordGateEnabled);
      })
      .catch(() => {});
    fetch('/memorypets-api/cloud/status')
      .then((r) => r.json())
      .then((data) => { if (data.ok) setCloudStatus(data); })
      .catch(() => {});
  }, []);

  const handleSetup = () => {
    setError(null);
    if (!password || password.length < 6) { setError('主密码至少需要6个字符'); return; }
    const list = setupCodeWord.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    fetch('/memorypets-api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, codeWords: list }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || '保险柜创建失败');
        setUnlocked(true);
        setHasEnvelope(true);
        setPassword('');
        setSetupCodeWord('');
        if (Array.isArray(data.codeWords)) setCodeWords(data.codeWords);
        setEntries(data.entries || []);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
      })
      .catch((e) => setError(e.message));
  };

  const handleUnlock = () => {
    setError(null);
    if (!password) { setError('请输入主密码'); return; }
    fetch('/memorypets-api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error || '解锁失败'); })))
      .then((data) => {
        setUnlocked(true);
        setPassword('');
        setEntries(data.entries || []);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
      })
      .catch((e) => setError(e.message));
  };

  const handleSaveCodeWord = () => {
    setError(null);
    const list = editCodeWord.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    fetch('/memorypets-api/codeword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codeWords: list }),
    })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error || '保存失败'); })))
      .then((data) => {
        if (Array.isArray(data.codeWords)) setCodeWords(data.codeWords);
        setEditCodeWord('');
        setShowEditCodeWords(false);
      })
      .catch((e) => setError(e.message));
  };

  const handleChangePassword = () => {
    setError(null);
    if (!currentPwd) { setError('请输入当前主密码'); return; }
    if (!newPwd || newPwd.length < 6) { setError('新主密码至少需要6个字符'); return; }
    if (newPwd !== confirmPwd) { setError('两次输入的新密码不一致'); return; }
    fetch('/memorypets-api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
    })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error || '密码修改失败'); })))
      .then(() => {
        setCurrentPwd('');
        setNewPwd('');
        setConfirmPwd('');
        setShowChangePassword(false);
        setError('主密码已更新');
      })
      .catch((e) => setError(e.message));
  };

  const handleLock = () => {
    fetch('/memorypets-api/lock', { method: 'POST' })
      .then(() => {
        setUnlocked(false);
        setEntries([]);
        setExpanded(false);
        setEditingId(null);
        setSidebarFormMode('collapsed');
      })
      .catch(() => {});
  };

  const handleToggleCodewordGate = () => {
    setError(null);
    const next = !codewordGateEnabled;
    fetch('/memorypets-api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codewordGateEnabled: next }),
    })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error || '设置更新失败'); })))
      .then((data) => {
        if (typeof data.codewordGateEnabled === 'boolean') setCodewordGateEnabled(data.codewordGateEnabled);
      })
      .catch((e) => setError(e.message || '设置更新失败'));
  };

  const handleDisableEncryption = () => {
    setError(null);
    fetch('/memorypets-api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptionEnabled: false }),
    })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error || '设置更新失败'); })))
      .then((data) => {
        if (typeof data.encryptionEnabled === 'boolean') setEncryptionEnabled(data.encryptionEnabled);
      })
      .catch((e) => setError(e.message || '设置更新失败'));
  };

  const handleEnableEncryption = () => {
    setError(null);
    if (!enableEncPwd || enableEncPwd.length < 6) { setError('主密码至少需要6个字符'); return; }
    if (enableEncPwd !== enableEncPwd2) { setError('两次输入的主密码不一致'); return; }
    fetch('/memorypets-api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptionEnabled: true, password: enableEncPwd }),
    })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error || '设置更新失败'); })))
      .then((data) => {
        if (typeof data.encryptionEnabled === 'boolean') setEncryptionEnabled(data.encryptionEnabled);
        setEnableEncPwd('');
        setEnableEncPwd2('');
        setShowEnableEncryption(false);
      })
      .catch((e) => setError(e.message || '设置更新失败'));
  };

  const handleExport = () => {
    setError(null);
    fetch('/memorypets-api/export')
      .then((r) => (r.ok ? r.blob() : r.json().then((d) => { throw new Error(d.error || '导出失败'); })))
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `memorypets-export-${new Date().toISOString().slice(0, 10)}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch((e) => setError(e.message || '导出失败'));
  };

  const handleCloudRegister = () => {
    setCloudMessage(null);
    if (!cloudServerUrl || !cloudUsername || !cloudPassword) { setCloudMessage('请填写服务器地址、账号和密码'); return; }
    fetch('/memorypets-api/cloud/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl: cloudServerUrl, username: cloudUsername, password: cloudPassword }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || '注册失败');
        setCloudStatus({ ok: true, loggedIn: true, username: cloudUsername, serverUrl: cloudServerUrl });
        setCloudPassword('');
        setCloudMessage('注册成功，已登录。');
      })
      .catch((e) => setCloudMessage(e.message || '注册失败'));
  };

  const handleCloudLogin = () => {
    setCloudMessage(null);
    if (!cloudServerUrl || !cloudUsername || !cloudPassword) { setCloudMessage('请填写服务器地址、账号和密码'); return; }
    fetch('/memorypets-api/cloud/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl: cloudServerUrl, username: cloudUsername, password: cloudPassword }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || '登录失败');
        setCloudStatus({ ok: true, loggedIn: true, username: cloudUsername, serverUrl: cloudServerUrl });
        setCloudPassword('');
        setCloudMessage('登录成功。');
      })
      .catch((e) => setCloudMessage(e.message || '登录失败'));
  };

  const handleCloudLogout = () => {
    setCloudMessage(null);
    fetch('/memorypets-api/cloud/logout', { method: 'POST' })
      .then(() => {
        setCloudStatus({ loggedIn: false });
        setCloudMessage('已退出云同步账号。');
      })
      .catch(() => {});
  };

  const handleCloudSync = () => {
    setCloudMessage(null);
    if (cloudSyncing) return;
    setCloudSyncing(true);
    fetch('/memorypets-api/cloud/sync', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || '同步失败');
        if (Array.isArray(data.entries)) setEntries(data.entries);
        if (Array.isArray(data.categories)) setCategories(data.categories);
        const messages = {
          pushed: '已上传到云端。',
          // "merged" replaces the old "pulled" (整体覆盖) behavior: on a
          // version conflict we now merge entry-by-entry with the remote
          // copy instead of discarding local changes — see cloudSyncNow()
          // in packages/host/lib/index.mjs.
          merged: data.uploaded === false
            ? '本地与云端已合并，但重新上传暂时失败，请稍后再次点击"立即同步"。'
            : '已与云端合并（双方新增/修改都保留，不会互相覆盖）。',
        };
        setCloudMessage(messages[data.action] || '同步完成。');
      })
      .catch((e) => setCloudMessage(e.message || '同步失败'))
      .finally(() => setCloudSyncing(false));
  };

  const handleAddCategory = () => {
    setError(null);
    const name = newCategoryName.trim();
    if (!name) return;
    fetch('/memorypets-api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json().then((d) => ({ status: r.status, data: d })))
      .then(({ data }) => {
        if (!data.ok) throw new Error(data.error || '添加类目失败');
        setCategories(data.categories || []);
        setNewCategoryName('');
      })
      .catch((e) => setError(e.message || '添加类目失败'));
  };

  const handleRemoveCategory = (name) => {
    setError(null);
    fetch('/memorypets-api/categories/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json().then((d) => ({ status: r.status, data: d })))
      .then(({ data }) => {
        if (!data.ok) throw new Error(data.error || '删除类目失败');
        setCategories(data.categories || []);
        if (selectedCategory === name) setSelectedCategory(null);
      })
      .catch((e) => setError(e.message || '删除类目失败'));
  };

  // Resets the shared add/edit form fields back to empty.
  const resetForm = () => {
    setFormLabel('');
    setFormValue('');
    setFormTags('');
    setFormDueDate('');
  };

  // "＋ 添加条目": opens the collapsed sidebar section in "quick" mode —
  // title only. Submitting it creates a bare note with empty content, then
  // handleAdd() immediately switches into "edit" mode for that same entry
  // so the user can type the content by hand (per request: 只有标题，点击
  // 添加后手动输入内容).
  const openQuickAdd = () => {
    setError(null);
    setEditingId(null);
    setFormKind('note');
    resetForm();
    setSidebarFormMode('quick');
  };

  // Clicking an existing entry (sidebar title list or the main list) opens
  // it for editing in the same shared form.
  const openEditEntry = (entry) => {
    setError(null);
    setEditingId(entry.id);
    setFormKind(entry.kind === 'profile' || entry.kind === 'work' ? 'note' : entry.kind);
    setFormLabel(entry.label);
    // Credential values are never sent to the client (server always
    // projects them to '<HIDDEN>') — leaving this blank means "keep the
    // current secret unchanged" (see opUpsert's value-omitted semantics).
    setFormValue(entry.kind === 'credential' ? '' : (entry.value || ''));
    setFormTags(Array.isArray(entry.tags) ? entry.tags.join(', ') : '');
    setFormDueDate(entry.dueDate || '');
    setSidebarFormMode('edit');
  };

  const cancelForm = () => {
    setEditingId(null);
    resetForm();
    setSidebarFormMode('collapsed');
  };

  // Also used to fully reset the sidebar add/edit state when the notebook
  // overlay closes or the vault locks, so a half-filled edit never lingers
  // across sessions.
  const closeNotebook = () => {
    setExpanded(false);
    cancelForm();
  };

  const handleAdd = () => {
    setError(null);
    if (!formLabel.trim()) { setError('请填写标题'); return; }
    if (adding) return;
    setAdding(true);
    const tags = formTags.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    const isQuickCreate = sidebarFormMode === 'quick';
    fetch('/memorypets-api/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(editingId ? { id: editingId } : {}),
        kind: isQuickCreate ? 'note' : formKind,
        label: formLabel,
        // Quick-create only asks for a title — content stays unset (kept
        // empty for a new entry, or left as-is for an edit) until the user
        // fills it in manually in the edit form that follows.
        ...(isQuickCreate ? {} : { value: formValue }),
        ...(tags.length ? { tags } : {}),
        ...(formDueDate ? { dueDate: formDueDate } : {}),
      }),
    })
      .then((r) => r.json().then((d) => ({ status: r.status, data: d })))
      .then(({ status, data }) => {
        if (!data.ok) throw new Error(data.error || '保存失败');
        if (Array.isArray(data.entries)) setEntries(data.entries);
        if (Array.isArray(data.categories)) setCategories(data.categories);
        if (isQuickCreate && data.id) {
          setEditingId(data.id);
          setSidebarFormMode('edit');
          setFormValue('');
        } else {
          cancelForm();
        }
      })
      .catch((e) => setError(e.message || '保存失败'))
      .finally(() => setAdding(false));
  };

  const handleRemove = (id) => {
    setError(null);
    fetch('/memorypets-api/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((r) => r.json().then((d) => ({ status: r.status, data: d })))
      .then(({ status, data }) => {
        if (!data.ok) throw new Error(data.error || '删除失败');
        if (Array.isArray(data.entries)) setEntries(data.entries);
        if (Array.isArray(data.categories)) setCategories(data.categories);
      })
      .catch((e) => setError(e.message || '删除失败'));
  };

  const wrapperStyle = {
    position: 'fixed',
    right: 24,
    bottom: 24,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    pointerEvents: 'none',
  };

  const petStyle = {
    width: 120,
    height: 120,
    objectFit: 'contain',
    userSelect: 'none',
    pointerEvents: 'auto',
    cursor: 'pointer',
    filter: gateOpen
      ? 'drop-shadow(0 0 18px rgba(255, 196, 80, 0.95)) drop-shadow(0 4px 12px rgba(0,0,0,0.18))'
      : 'drop-shadow(0 4px 12px rgba(0,0,0,0.18))',
    transition: 'filter 200ms ease-out, transform 150ms ease-out',
  };
  // Drive the pet sprite from the gate state: when the user types a code-
  // word into the dsh composer the pet switches to "thinking" and glows so
  // the UI surfaces the activation. When the user submits, the pet returns
  // to "waiting" automatically (next state change wins).
  const effectiveState = gateOpen ? 'thinking' : stateKey;
  const finalImgSrc = useAnimationFrame(effectiveState) || imgSrc;

  const panelStyle = {
    pointerEvents: 'auto',
    width: 320,
    maxHeight: '70vh',
    overflow: 'auto',
    background: 'rgba(255,255,255,0.97)',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 14,
    boxShadow: '0 12px 32px rgba(0,0,0,0.14)',
    padding: 14,
    color: '#1f2937',
    fontSize: 13,
    lineHeight: 1.5,
  };

  const chipRowStyle = {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 10,
    pointerEvents: 'auto',
  };

  const chipActive = {
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid #6366f1',
    background: '#6366f1',
    color: '#fff',
    fontSize: 12,
    cursor: 'pointer',
  };

  const chipIdle = {
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid rgba(0,0,0,0.12)',
    background: '#fff',
    color: '#374151',
    fontSize: 12,
    cursor: 'pointer',
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 8px',
    borderRadius: 8,
    border: '1px solid rgba(0,0,0,0.15)',
    fontSize: 13,
    outline: 'none',
    marginBottom: 8,
  };

  const btnStyle = {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #6366f1',
    background: '#6366f1',
    color: '#fff',
    fontSize: 12,
    cursor: 'pointer',
  };

  const btnGhost = {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid rgba(0,0,0,0.12)',
    background: '#fff',
    color: '#6b7280',
    fontSize: 11,
    cursor: 'pointer',
  };

  // `wrap: true` (used by the expanded full-screen notebook, which has room
  // to spare) shows the full value instead of clipping it to one line —
  // the narrow floating panel keeps the old single-line ellipsis behavior.
  const entryRow = (e, { wrap = false } = {}) =>
    h(
      'div',
      {
        key: e.id,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          borderRadius: 8,
          background: 'rgba(99,102,241,0.06)',
          marginBottom: 6,
          gap: 8,
      },
    },
    h(
      'div',
      { style: { minWidth: 0, flex: 1, cursor: 'pointer' }, onClick: () => openEditEntry(e), title: '点击编辑' },
      h('div', { style: { fontSize: 12, color: '#6b7280' } }, `[${kindNames[e.kind] || e.kind}] ${e.label}`),
      h(
        'div',
        {
          style: wrap
            ? { fontSize: 13, color: '#111827', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
            : { fontSize: 13, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis' },
        },
        e.kind === 'credential' ? (e.hint ?? '••••••••') : e.value,
      ),
      (Array.isArray(e.tags) && e.tags.length) || e.dueDate
        ? h(
            'div',
            { style: { fontSize: 11, color: '#9ca3af', marginTop: 2 } },
            [
              Array.isArray(e.tags) && e.tags.length ? '🏷️ ' + e.tags.join(', ') : null,
              e.dueDate ? '⏰ ' + e.dueDate : null,
            ].filter(Boolean).join('  '),
          )
        : null,
    ),
    h(
      'button',
      { style: btnGhost, onClick: () => handleRemove(e.id) },
      '删除',
    ),
  );

  // Entries visible in the expanded notebook: filtered by the selected
  // category (matches entry.tags, case-insensitively) and by the free-text
  // search box (matches label or value).
  const notebookEntries = entries.filter((e) => {
    if (selectedCategory) {
      const tags = Array.isArray(e.tags) ? e.tags.map((t) => t.toLowerCase()) : [];
      if (!tags.includes(selectedCategory.toLowerCase())) return false;
    }
    if (notebookSearch.trim()) {
      const q = notebookSearch.trim().toLowerCase();
      const hay = (e.label + ' ' + (e.kind === 'credential' ? '' : e.value)).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Shared "添加/编辑条目" form body — used by the narrow floating panel
  // (always full fields) and the expanded full-screen notebook's sidebar
  // (which can render it in three flavors):
  //   quick=true              — only a title input (＋ 添加条目 flow)
  //   quick=false, editingId  — full fields, editing an existing entry
  //   quick=false, no id      — full fields, plain create (narrow panel)
  const renderAddEntryForm = ({ quick = false } = {}) =>
    h(
      React.Fragment,
      null,
      !quick &&
        h(
          'select',
          { style: inputStyle, value: formKind, onChange: (ev) => setFormKind(ev.target.value) },
          h('option', { value: 'note' }, '笔记'),
          h('option', { value: 'credential' }, '凭证'),
        ),
      h('input', {
        style: inputStyle,
        placeholder: quick ? '标题，例如：Knox Studio 发布记录' : '标题（例如：工作邮箱）',
        value: formLabel,
        onChange: (ev) => setFormLabel(ev.target.value),
        autoFocus: quick,
        onKeyDown: (ev) => { if (quick && ev.key === 'Enter') handleAdd(); },
      }),
      !quick &&
        h('input', {
          style: inputStyle,
          placeholder: formKind === 'credential' && editingId ? '内容（留空 = 不修改原密文）' : '内容',
          value: formValue,
          onChange: (ev) => setFormValue(ev.target.value),
          type: formKind === 'credential' ? 'password' : 'text',
        }),
      // Tags/categories: visible for every kind (previously note-only, which
      // is why they were easy to miss) — clicking a category chip appends
      // it to the tag list; typing a brand-new tag auto-registers it as a
      // new category once saved (handled host-side in Vault#upsert).
      !quick &&
        h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 } },
          categories.map((c) =>
            h(
              'button',
              {
                key: c,
                type: 'button',
                style: { ...chipIdle, padding: '2px 8px', fontSize: 11 },
                onClick: () => {
                  const list = formTags.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
                  if (!list.some((t) => t.toLowerCase() === c.toLowerCase())) {
                    setFormTags([...list, c].join(', '));
                  }
                },
              },
              c,
            ),
          ),
        ),
      !quick &&
        h('input', {
          style: inputStyle,
          placeholder: '类目/标签，用逗号分隔（例如：工作, 计划）',
          value: formTags,
          onChange: (ev) => setFormTags(ev.target.value),
        }),
      !quick && formKind === 'note' &&
        h('input', {
          style: inputStyle,
          type: 'date',
          placeholder: '截止日期（可选）',
          value: formDueDate,
          onChange: (ev) => setFormDueDate(ev.target.value),
        }),
      h(
        'div',
        { style: { display: 'flex', gap: 6 } },
        h(
          'button',
          {
            style: { ...btnStyle, opacity: adding ? 0.6 : 1, cursor: adding ? 'wait' : 'pointer', flex: 1 },
            onClick: handleAdd,
            disabled: adding,
          },
          adding ? '保存中…' : quick ? '创建' : editingId ? '保存' : '添加',
        ),
        (quick || editingId) &&
          h('button', { style: btnGhost, onClick: cancelForm, disabled: adding }, '取消'),
      ),
    );

return h(
  'div',
  { style: wrapperStyle },
  showPanel &&
    h(
      'div',
      { style: panelStyle },
      h('div', { style: { fontWeight: 600, marginBottom: 10, fontSize: 14 } }, '记忆宠物'),
      error
        ? h('div', {
            style: {
              padding: '6px 8px',
              borderRadius: 8,
              background: '#fef2f2',
              color: '#b91c1c',
              fontSize: 12,
              marginBottom: 10,
            },
          }, error)
        : null,
      unlocked
        ? h(
            React.Fragment,
            null,
            h(
              'div',
              { style: { marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' } },
              h(
                'button',
                { style: btnStyle, onClick: () => setExpanded(true) },
                '📓 展开笔记本',
              ),
              h(
                'button',
                { style: btnGhost, onClick: handleLock },
                '上锁',
              ),
              h(
                'div',
                { style: { fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 } },
                h('span', null, '暗语：'),
                codeWords.length
                  ? codeWords.map((w) => h('span', { key: w, style: { ...btnGhost, padding: '2px 6px' } }, w))
                  : h('span', null, '（默认）'),
              ),
            ),
            entries.length
              ? h('div', null, entries.map((e) => entryRow(e)))
              : h('div', { style: { color: '#6b7280', marginBottom: 10 } }, '还没有条目。窄面板放不下整本笔记，点上面的"展开笔记本"按分类浏览全部内容。'),
            h(
              'div',
              { style: { borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 10, marginTop: 6 } },
              h('div', { style: { fontWeight: 600, marginBottom: 6, fontSize: 12 } }, editingId ? '编辑条目' : '添加条目'),
              renderAddEntryForm(),
            ),
            h(
              'div',
              { style: { borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 10, marginTop: 10 } },
              h('div', { style: { fontWeight: 600, marginBottom: 6, fontSize: 12 } }, '安全设置'),
              h('div', { style: { display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
                h('button', { style: btnGhost, onClick: () => setShowEditCodeWords((v) => !v) }, '修改暗语'),
                h('button', { style: btnGhost, onClick: () => setShowChangePassword((v) => !v) }, '修改主密码'),
                h('button', { style: btnGhost, onClick: handleExport }, '导出为 Markdown'),
              ),
              showEditCodeWords &&
                h(React.Fragment, null,
                  h('div', { style: { color: '#6b7280', fontSize: 11, marginBottom: 6 } },
                    '暗语是您私有的"暗号"——多个暗语可用英文逗号、空格或中文逗号分隔。'
                    + ' 保存后会 REPLACE（覆盖）之前的全部暗语；旧的暗语立即失效。'),
                  h('input', {
                    style: inputStyle,
                    placeholder: '例如：小秘密， 芝麻开门',
                    value: editCodeWord,
                    onChange: (ev) => setEditCodeWord(ev.target.value),
                  }),
                  h('button', { style: btnStyle, onClick: handleSaveCodeWord }, '保存暗语'),
                ),
              showChangePassword &&
                h(React.Fragment, null,
                  h('input', {
                    style: inputStyle,
                    type: 'password',
                    placeholder: '当前主密码',
                    value: currentPwd,
                    onChange: (ev) => setCurrentPwd(ev.target.value),
                  }),
                  h('input', {
                    style: inputStyle,
                    type: 'password',
                    placeholder: '新主密码（至少6个字符）',
                    value: newPwd,
                    onChange: (ev) => setNewPwd(ev.target.value),
                  }),
                  h('input', {
                    style: inputStyle,
                    type: 'password',
                    placeholder: '确认新主密码',
                    value: confirmPwd,
                    onChange: (ev) => setConfirmPwd(ev.target.value),
                  }),
                  h('button', { style: btnStyle, onClick: handleChangePassword }, '更新主密码'),
                ),
              h(
                'div',
                { style: { borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 8, marginTop: 8 } },
                h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 6, cursor: 'pointer' } },
                  h('input', {
                    type: 'checkbox',
                    checked: codewordGateEnabled,
                    onChange: handleToggleCodewordGate,
                  }),
                  '启用暗语门槛（关闭后，随时可以让我读写记忆，无需先说暗语）',
                ),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexWrap: 'wrap' } },
                  h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: encryptionEnabled ? 'pointer' : 'default' } },
                    h('input', {
                      type: 'checkbox',
                      checked: encryptionEnabled,
                      onChange: () => {
                        if (encryptionEnabled) handleDisableEncryption();
                        else setShowEnableEncryption((v) => !v);
                      },
                    }),
                    '启用加密存储（关闭后条目以明文保存在本机，适合非私密的工作笔记/计划/家庭事务）',
                  ),
                ),
                showEnableEncryption && !encryptionEnabled &&
                  h(React.Fragment, null,
                    h('input', {
                      style: inputStyle,
                      type: 'password',
                      placeholder: '新主密码（至少6个字符）',
                      value: enableEncPwd,
                      onChange: (ev) => setEnableEncPwd(ev.target.value),
                    }),
                    h('input', {
                      style: inputStyle,
                      type: 'password',
                      placeholder: '确认新主密码',
                      value: enableEncPwd2,
                      onChange: (ev) => setEnableEncPwd2(ev.target.value),
                    }),
                    h('button', { style: btnStyle, onClick: handleEnableEncryption }, '启用加密'),
                  ),
              ),
              h(
                'div',
                { style: { borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 8, marginTop: 8 } },
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 } },
                  h('div', { style: { fontWeight: 600, fontSize: 12 } }, '云同步'),
                  h('button', { style: btnGhost, onClick: () => setShowCloudSync((v) => !v) }, showCloudSync ? '收起' : '展开'),
                ),
                showCloudSync &&
                  h(React.Fragment, null,
                    h('div', { style: { color: '#6b7280', fontSize: 11, marginBottom: 6 } },
                      '云端只存储加密后的密文，绝不接触主密码或明文内容。云账号密码与主密码是两个独立的密钥，可用于在手机 App 上登录同一账号做多端同步。'),
                    cloudStatus.loggedIn
                      ? h(React.Fragment, null,
                          h('div', { style: { fontSize: 12, color: '#111827', marginBottom: 6 } },
                            `已登录：${cloudStatus.username || ''} @ ${cloudStatus.serverUrl || ''}`),
                          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                            h('button', {
                              style: { ...btnStyle, opacity: cloudSyncing ? 0.6 : 1, cursor: cloudSyncing ? 'wait' : 'pointer' },
                              onClick: handleCloudSync,
                              disabled: cloudSyncing,
                            }, cloudSyncing ? '同步中…' : '立即同步'),
                            h('button', { style: btnGhost, onClick: handleCloudLogout }, '退出云账号'),
                          ),
                        )
                      : h(React.Fragment, null,
                          h('input', {
                            style: inputStyle,
                            placeholder: '同步服务器地址，例如 https://sync.example.com',
                            value: cloudServerUrl,
                            onChange: (ev) => setCloudServerUrl(ev.target.value),
                          }),
                          h('input', {
                            style: inputStyle,
                            placeholder: '云账号（3-64位字母/数字/._@-）',
                            value: cloudUsername,
                            onChange: (ev) => setCloudUsername(ev.target.value),
                          }),
                          h('input', {
                            style: inputStyle,
                            type: 'password',
                            placeholder: '云账号密码（至少8个字符，与主密码不同）',
                            value: cloudPassword,
                            onChange: (ev) => setCloudPassword(ev.target.value),
                          }),
                          h('div', { style: { display: 'flex', gap: 6 } },
                            h('button', { style: btnStyle, onClick: handleCloudLogin }, '登录'),
                            h('button', { style: btnGhost, onClick: handleCloudRegister }, '注册新账号'),
                          ),
                        ),
                    cloudMessage && h('div', { style: { fontSize: 11, color: '#6b7280', marginTop: 6 } }, cloudMessage),
                  ),
              ),
            ),
          )
        : hasEnvelope
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { style: { color: '#6b7280', marginBottom: 10 } },
                '保险柜已上锁，请输入主密码解锁。',
              ),
              h('input', {
                style: inputStyle,
                type: 'password',
                placeholder: '主密码',
                value: password,
                onChange: (ev) => setPassword(ev.target.value),
                onKeyDown: (ev) => {
                  if (ev.key === 'Enter') handleUnlock();
                },
              }),
              h('button', { style: btnStyle, onClick: handleUnlock }, '解锁'),
            )
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { style: { color: '#6b7280', marginBottom: 10 } },
                '欢迎使用！请设置主密码，并可选择设置自定义暗语。',
              ),
              h('input', {
                style: inputStyle,
                type: 'password',
                placeholder: '主密码（至少6个字符）',
                value: password,
                onChange: (ev) => setPassword(ev.target.value),
              }),
              h('input', {
                style: inputStyle,
                placeholder: '自定义暗语 — 例如：小秘密， 芝麻开门',
                value: setupCodeWord,
                onChange: (ev) => setSetupCodeWord(ev.target.value),
              }),
              h('button', { style: btnStyle, onClick: handleSetup }, '创建保险柜'),
              h(
                'div',
                { style: { color: '#9ca3af', fontSize: 11, marginTop: 8 } },
                '忘记主密码？请在 harness-plugin 目录下运行 `pnpm reset-vault` 清除本地加密文件并重新创建。',
              ),
            ),
      ),
    h(
      'div',
      { style: chipRowStyle },
      Object.entries(STATES).map(([key, s]) =>
        h(
          'button',
          {
            key,
            style: stateKey === key ? chipActive : chipIdle,
            onClick: () => setStateKey(key),
          },
          s.label,
        ),
      ),
    ),
    h('img', {
      style: petStyle,
      src: finalImgSrc,
      alt: '记忆宠物',
      onClick: () => setShowPanel((v) => !v),
      title: '点击打开记忆宠物面板',
    }),
    expanded && unlocked &&
      h(
        'div',
        {
          // Full-viewport backdrop. `position: fixed` here is relative to
          // the viewport (not to wrapperStyle's small bottom-right box), so
          // this covers the whole window regardless of where the pet sits.
          style: {
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'auto',
          },
          onClick: closeNotebook,
        },
        h(
          'div',
          {
            style: {
              width: 'min(1000px, 92vw)',
              height: '86vh',
              background: '#fff',
              borderRadius: 16,
              boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
              display: 'flex',
              overflow: 'hidden',
              color: '#1f2937',
              fontSize: 13,
            },
            onClick: (ev) => ev.stopPropagation(),
          },
          // ── 左侧类目栏 ──────────────────────────────────────────
          h(
            'div',
            {
              style: {
                width: 280,
                flexShrink: 0,
                borderRight: '1px solid rgba(0,0,0,0.08)',
                background: '#f9fafb',
                padding: 14,
                overflowY: 'auto',
              },
            },
            h('div', { style: { fontWeight: 700, fontSize: 15, marginBottom: 12 } }, '📓 我的笔记本'),
            h(
              'div',
              {
                style: {
                  padding: '6px 10px',
                  borderRadius: 8,
                  marginBottom: 4,
                  cursor: 'pointer',
                  fontWeight: selectedCategory === null ? 700 : 400,
                  background: selectedCategory === null ? 'rgba(99,102,241,0.12)' : 'transparent',
                  color: selectedCategory === null ? '#4338ca' : '#374151',
                },
                onClick: () => setSelectedCategory(null),
              },
              `全部（${entries.length}）`,
            ),
            categories.map((c) => {
              const count = entries.filter((e) => Array.isArray(e.tags) && e.tags.some((t) => t.toLowerCase() === c.toLowerCase())).length;
              const active = selectedCategory === c;
              return h(
                'div',
                {
                  key: c,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: 8,
                    marginBottom: 4,
                    cursor: 'pointer',
                    fontWeight: active ? 700 : 400,
                    background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color: active ? '#4338ca' : '#374151',
                  },
                  onClick: () => setSelectedCategory(c),
                },
                h('span', null, `${c}（${count}）`),
                h(
                  'span',
                  {
                    title: '删除该类目（不会删除条目本身）',
                    style: { color: '#9ca3af', fontSize: 11, cursor: 'pointer' },
                    onClick: (ev) => { ev.stopPropagation(); handleRemoveCategory(c); },
                  },
                  '✕',
                ),
              );
            }),
            h(
              'div',
              { style: { marginTop: 10, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 10 } },
              h('input', {
                style: { ...inputStyle, marginBottom: 6 },
                placeholder: '新类目，例如：旅行',
                value: newCategoryName,
                onChange: (ev) => setNewCategoryName(ev.target.value),
                onKeyDown: (ev) => { if (ev.key === 'Enter') handleAddCategory(); },
              }),
              h('button', { style: { ...btnGhost, width: '100%' }, onClick: handleAddCategory }, '＋ 添加类目'),
            ),
            // 添加条目——放在"＋ 添加类目"下面。默认折叠成一个按钮，腾出的
            // 空间用来列出所有条目标题（点标题直接进入编辑）；点按钮后先只填
            // 标题，创建成功立刻转入编辑态，方便手动填内容。
            h(
              'div',
              { style: { marginTop: 10, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 10 } },
              sidebarFormMode === 'collapsed'
                ? h(
                    React.Fragment,
                    null,
                    h('button', { style: { ...btnStyle, width: '100%' }, onClick: openQuickAdd }, '＋ 添加条目'),
                    h(
                      'div',
                      { style: { marginTop: 10, fontWeight: 600, fontSize: 12, color: '#6b7280' } },
                      `所有条目（${entries.length}）`,
                    ),
                    entries.length
                      ? entries.map((e) =>
                          h(
                            'div',
                            {
                              key: e.id,
                              title: e.label,
                              style: {
                                padding: '5px 6px',
                                borderRadius: 6,
                                fontSize: 12,
                                color: '#374151',
                                cursor: 'pointer',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                              onClick: () => openEditEntry(e),
                            },
                            `${e.kind === 'credential' ? '🔒' : '📝'} ${e.label}`,
                          ),
                        )
                      : h('div', { style: { fontSize: 12, color: '#9ca3af', marginTop: 4 } }, '还没有条目'),
                  )
                : h(
                    React.Fragment,
                    null,
                    h('div', { style: { fontWeight: 600, marginBottom: 8, fontSize: 12 } }, editingId ? '编辑条目' : '添加条目'),
                    renderAddEntryForm({ quick: sidebarFormMode === 'quick' }),
                  ),
            ),
          ),
          // ── 右侧内容区 ──────────────────────────────────────────
          h(
            'div',
            { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 } },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(0,0,0,0.08)',
                },
              },
              h('input', {
                style: { ...inputStyle, marginBottom: 0, maxWidth: 320 },
                placeholder: '搜索标题或内容…',
                value: notebookSearch,
                onChange: (ev) => setNotebookSearch(ev.target.value),
              }),
              h('button', { style: btnGhost, onClick: closeNotebook }, '✕ 关闭'),
            ),
            h(
              'div',
              { style: { flex: 1, overflowY: 'auto', padding: 16 } },
              notebookEntries.length
                ? notebookEntries.map((e) => entryRow(e, { wrap: true }))
                : h('div', { style: { color: '#6b7280' } }, selectedCategory || notebookSearch
                    ? '没有符合条件的条目。'
                    : '还没有条目，点左侧"＋ 添加条目"按钮新建第一条笔记吧。'),
            ),
          ),
        ),
      ),
  );
}

export function apply(ctx) {
  try {
    if (!ctx || !ctx.slots) return;
    const ShellOverlay = ShellOverlayComponent;
    if (typeof ctx.slots.inject !== 'function') return;
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'memorypets-floating-pet', order: 9999, label: '记忆宠物' },
        ShellOverlay,
      ),
    );
  } catch {
    // 在非浏览器 fiber（如 Node 侧空扫描）里静默忽略
  }
}

export default { name, inject, apply };
