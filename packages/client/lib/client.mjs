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
    label: 'Standing',
    prefix: '/memorypets-assets/standing/',
    frames: Array.from({ length: 19 }, (_, i) => String(i + 2).padStart(2, '0') + '.png'),
    fps: 10,
  },
  thinking: {
    label: 'Thinking',
    prefix: '/memorypets-assets/thinking/',
    frames: Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0') + '.png'),
    fps: 12,
  },
  waitting: {
    label: 'Waiting',
    prefix: '/memorypets-assets/waitting/',
    frames: Array.from({ length: 17 }, (_, i) => String(i + 4).padStart(2, '0') + '.png'),
    fps: 8,
  },
  sleeping: {
    label: 'Sleeping',
    prefix: '/memorypets-assets/sleeping/',
    frames: Array.from({ length: 18 }, (_, i) => String(i + 3).padStart(2, '0') + '.png'),
    fps: 6,
  },
};

const h = React.createElement;

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

function ShellOverlayComponent() {
  const [stateKey, setStateKey] = React.useState('standing');
  const [showPanel, setShowPanel] = React.useState(false);
  const [unlocked, setUnlocked] = React.useState(false);
  const [hasEnvelope, setHasEnvelope] = React.useState(true);
  const [password, setPassword] = React.useState('');
  const [setupCodeWord, setSetupCodeWord] = React.useState('');
  const [codeWords, setCodeWords] = React.useState([]);
  const [editCodeWord, setEditCodeWord] = React.useState('');
  const [error, setError] = React.useState(null);
  const [entries, setEntries] = React.useState([]);
  const [formKind, setFormKind] = React.useState('profile');
  const [formLabel, setFormLabel] = React.useState('');
  const [formValue, setFormValue] = React.useState('');
  const imgSrc = useAnimationFrame(stateKey);

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
  }, []);

  const handleSetup = () => {
    setError(null);
    if (!password || password.length < 6) { setError('Password must be at least 6 characters'); return; }
    const list = setupCodeWord.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    fetch('/memorypets-api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, codeWords: list }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'Setup failed');
        setUnlocked(true);
        setHasEnvelope(true);
        setPassword('');
        setSetupCodeWord('');
        if (Array.isArray(data.codeWords)) setCodeWords(data.codeWords);
        setEntries(data.entries || []);
      })
      .catch((e) => setError(e.message));
  };

  const handleUnlock = () => {
    setError(null);
    if (!password) { setError('Password required'); return; }
    fetch('/memorypets-api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error || 'Unlock failed'); })))
      .then((data) => {
        setUnlocked(true);
        setPassword('');
        setEntries(data.entries || []);
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
      .then((r) => (r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error || 'Save failed'); })))
      .then((data) => {
        if (Array.isArray(data.codeWords)) setCodeWords(data.codeWords);
        setEditCodeWord('');
      })
      .catch((e) => setError(e.message));
  };

  const handleLock = () => {
    fetch('/memorypets-api/lock', { method: 'POST' })
      .then(() => {
        setUnlocked(false);
        setEntries([]);
      })
      .catch(() => {});
  };

  const handleAdd = () => {
    if (!formLabel || !formValue) return;
    const id = `${formKind}_${Date.now().toString(36)}`;
    setEntries((list) => [...list, { id, kind: formKind, label: formLabel, value: formValue }]);
    setFormLabel('');
    setFormValue('');
  };

  const handleRemove = (id) => {
    setEntries((list) => list.filter((e) => e.id !== id));
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
    filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.18))',
    transition: 'transform 150ms ease-out',
  };

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

  const entryRow = (e) =>
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
        { style: { minWidth: 0, flex: 1 } },
        h('div', { style: { fontSize: 12, color: '#6b7280' } }, `[${e.kind}] ${e.label}`),
        h(
          'div',
          { style: { fontSize: 13, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis' } },
          e.kind === 'credential' ? (e.hint ?? '••••••••') : e.value,
        ),
      ),
      h(
        'button',
        { style: btnGhost, onClick: () => handleRemove(e.id) },
        'Remove',
      ),
    );

  return h(
    'div',
    { style: wrapperStyle },
    showPanel &&
      h(
        'div',
        { style: panelStyle },
        h('div', { style: { fontWeight: 600, marginBottom: 10, fontSize: 14 } }, 'MemoryPets'),
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
                  { style: btnGhost, onClick: handleLock },
                  'Lock',
                ),
                h(
                  'div',
                  { style: { fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 } },
                  h('span', null, 'Code words:'),
                  codeWords.length
                    ? codeWords.map((w) => h('span', { key: w, style: { ...btnGhost, padding: '2px 6px' } }, w))
                    : h('span', null, '（默认）'),
                ),
              ),
              entries.length
                ? h('div', null, entries.map(entryRow))
                : h('div', { style: { color: '#6b7280', marginBottom: 10 } }, 'No entries yet.'),
              h(
                'div',
                { style: { borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 10, marginTop: 6 } },
                h('div', { style: { fontWeight: 600, marginBottom: 6, fontSize: 12 } }, 'Add entry'),
                h(
                  'select',
                  {
                    style: inputStyle,
                    value: formKind,
                    onChange: (ev) => setFormKind(ev.target.value),
                  },
                  h('option', { value: 'profile' }, 'Profile'),
                  h('option', { value: 'work' }, 'Work'),
                  h('option', { value: 'credential' }, 'Credential'),
                ),
                h('input', {
                  style: inputStyle,
                  placeholder: 'Label (e.g. Work Email)',
                  value: formLabel,
                  onChange: (ev) => setFormLabel(ev.target.value),
                }),
                h('input', {
                  style: inputStyle,
                  placeholder: 'Value',
                  value: formValue,
                  onChange: (ev) => setFormValue(ev.target.value),
                  type: formKind === 'credential' ? 'password' : 'text',
                }),
                h('button', { style: btnStyle, onClick: handleAdd }, 'Add entry'),
              ),
              h(
                'div',
                { style: { borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 10, marginTop: 10 } },
                h('div', { style: { fontWeight: 600, marginBottom: 6, fontSize: 12 } }, 'Custom code words'),
                h('div', { style: { color: '#6b7280', fontSize: 11, marginBottom: 6 } },
                  'Use comma, space or Chinese comma to separate multiple words. These are added on top of the default code-words (哥们儿 / 狗狗 / memorypets / ...).'),
                h('input', {
                  style: inputStyle,
                  placeholder: 'e.g. myvoice, 芝麻开门',
                  value: editCodeWord,
                  onChange: (ev) => setEditCodeWord(ev.target.value),
                }),
                h('button', { style: btnStyle, onClick: handleSaveCodeWord }, 'Save code words'),
              ),
            )
          : hasEnvelope
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { style: { color: '#6b7280', marginBottom: 10 } },
                  'Vault is sealed. Enter master password to unlock.',
                ),
                h('input', {
                  style: inputStyle,
                  type: 'password',
                  placeholder: 'Master password',
                  value: password,
                  onChange: (ev) => setPassword(ev.target.value),
                  onKeyDown: (ev) => {
                    if (ev.key === 'Enter') handleUnlock();
                  },
                }),
                h('button', { style: btnStyle, onClick: handleUnlock }, 'Unlock'),
              )
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  { style: { color: '#6b7280', marginBottom: 10 } },
                  'Welcome! Create your master password and optionally set a custom code word.',
                ),
                h('input', {
                  style: inputStyle,
                  type: 'password',
                  placeholder: 'Master password (≥6 chars)',
                  value: password,
                  onChange: (ev) => setPassword(ev.target.value),
                }),
                h('input', {
                  style: inputStyle,
                  placeholder: 'Custom code word(s) — e.g. myvoice, 芝麻开门',
                  value: setupCodeWord,
                  onChange: (ev) => setSetupCodeWord(ev.target.value),
                }),
                h('button', { style: btnStyle, onClick: handleSetup }, 'Create vault'),
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
      src: imgSrc,
      alt: 'MemoryPets',
      onClick: () => setShowPanel((v) => !v),
      title: 'Click to open MemoryPets panel',
    }),
  );
}

export function apply(ctx) {
  try {
    if (!ctx || !ctx.slots) return;
    const ShellOverlay = ShellOverlayComponent;
    if (typeof ctx.slots.inject !== 'function') return;
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'memorypets-floating-pet', order: 9999, label: 'MemoryPets' },
        ShellOverlay,
      ),
    );
  } catch {
    // 在非浏览器 fiber（如 Node 侧空扫描）里静默忽略
  }
}

export default { name, inject, apply };
