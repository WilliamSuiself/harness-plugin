// Shared MemoryPets vault operations.
//
// Both the LLM-facing tools (./tools.mjs) and the code-word direct-apply
// bypass route (./index.mjs) need to run the exact same five actions
// (status / list / upsert / remove / reveal) against ctx.memoryPets.
// Previously each caller re-implemented its own copy of this logic, which
// meant validation rules and matching semantics could silently drift apart.
// This module is the single source of truth: it only returns plain
// structured results (ok / locked / error / data) and never formats
// human-facing text — presentation (English tool messages vs. Chinese
// direct-apply replies) stays in the respective callers.

/**
 * Safe async list helper. Uses the async service.listEntries() bridge when
 * available (the Host → Client safe projection) and falls back to a sync
 * vault.list() guarded by try/catch. ALWAYS await it — never synchronous.
 */
export async function safeList(service) {
  try {
    if (typeof service.listEntries === 'function') {
      const out = await service.listEntries();
      if (Array.isArray(out)) return out;
    }
    const direct = service.list?.();
    return Array.isArray(direct) ? direct : [];
  } catch {
    return [];
  }
}

export async function opStatus(service) {
  const isUnlocked = !!service.isUnlocked?.();
  let hasEnvelope = false;
  try { hasEnvelope = !!(service.hasEnvelope ? await service.hasEnvelope() : false); } catch {}
  return { ok: true, isUnlocked, hasEnvelope };
}

export async function opList(service, { kind } = {}) {
  if (!service.isUnlocked?.()) return { ok: false, locked: true };
  let list = await safeList(service);
  if (kind) list = list.filter((e) => e.kind === kind);
  const safe = list.map((e) =>
    e.kind === 'credential' ? { ...e, value: '<HIDDEN>', hint: e.hint ?? '\u2022'.repeat(8) } : e,
  );
  return { ok: true, locked: false, count: safe.length, entries: safe };
}

export async function opUpsert(service, { id, kind, label, value, hint } = {}) {
  if (!['profile', 'work', 'credential'].includes(kind)) {
    return { ok: false, error: 'kind must be profile | work | credential' };
  }
  if (typeof label !== 'string' || !label.trim()) {
    return { ok: false, error: 'label (non-empty string) is required' };
  }
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, error: 'value (non-empty string) is required' };
  }
  if (!service.isUnlocked?.()) return { ok: false, locked: true };
  const list = await safeList(service);
  let targetId = id;
  const matched = list.find(
    (e) => e.kind === kind && String(e.label ?? '').trim() === String(label).trim(),
  );
  if (!targetId && matched) targetId = matched.id;
  const entry = {
    id: targetId,
    kind,
    label: label.trim(),
    value,
    ...(kind === 'credential' && hint ? { hint } : {}),
  };
  try {
    await service.upsert(entry);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const after = await safeList(service);
  return {
    ok: true,
    updated: !!(matched || id),
    kind,
    label: entry.label,
    value: entry.value,
    entryCount: after.length,
  };
}

/**
 * Removes an entry, resolved either by exact `id`, or by `label`
 * (exact match first, then case-insensitive substring match).
 */
export async function opRemove(service, { id, label, confirmKind } = {}) {
  if (!service.isUnlocked?.()) return { ok: false, locked: true };
  const list = await safeList(service);
  let target = null;
  if (id) {
    target = list.find((e) => e.id === id) ?? null;
  } else if (label) {
    const key = String(label).trim();
    target = list.find((e) => String(e.label ?? '').trim() === key) ?? null;
    if (!target) {
      const lower = key.toLowerCase();
      target = list.find((e) => String(e.label ?? '').toLowerCase().includes(lower)) ?? null;
    }
  }
  if (!target) {
    return {
      ok: false,
      notFound: true,
      count: list.length,
      error: id
        ? `No entry found with id=${id}. Call list first and pass the exact id.`
        : 'No matching entry found for the given label.',
    };
  }
  if (confirmKind && target.kind !== confirmKind) {
    return {
      ok: false,
      kindMismatch: true,
      error: `Kind mismatch: expected ${confirmKind} but actual entry kind is ${target.kind}.`,
    };
  }
  try {
    await service.remove(target.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const after = await safeList(service);
  return {
    ok: true,
    deleted: { id: target.id, kind: target.kind, label: target.label },
    remaining: after.length,
  };
}

/**
 * Decrypts and returns a credential value. Tries exact label match, then
 * fuzzy substring match, then falls back to service.revealCredential (which
 * reads straight from the raw vault instead of the client-safe projection).
 */
export async function opReveal(service, { label } = {}) {
  if (typeof label !== 'string' || !label.trim()) {
    return { ok: false, error: 'label (non-empty string) is required' };
  }
  if (!service.isUnlocked?.()) return { ok: false, locked: true };
  const list = await safeList(service);
  const key = String(label).trim().toLowerCase();
  const exact = list.find(
    (e) => e.kind === 'credential' && String(e.label ?? '').trim().toLowerCase() === key,
  );
  if (exact && typeof exact.value === 'string') {
    return { ok: true, found: true, label: exact.label, value: exact.value };
  }
  const fuzzy = list.find(
    (e) => e.kind === 'credential' && String(e.label ?? '').toLowerCase().includes(key),
  );
  if (fuzzy && typeof fuzzy.value === 'string') {
    return { ok: true, found: true, label: fuzzy.label, value: fuzzy.value, match: 'fuzzy' };
  }
  if (typeof service.revealCredential === 'function') {
    const raw = await service.revealCredential(label);
    if (typeof raw === 'string' && raw.length > 0) {
      return { ok: true, found: true, label, value: raw, match: 'service-bridge' };
    }
  }
  return { ok: false, found: false };
}
