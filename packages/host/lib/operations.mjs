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
 * Decrypts and returns a credential value. Delegates entirely to
 * `service.revealCredential`, which is the ONLY authoritative decrypt path
 * and reads the raw vault (matching semantics: id → exact label → fuzzy
 * (≥4 chars) → ambiguity-error).
 *
 * SECURITY:
 *   - We do NOT inspect `safeList` here. The client-safe projection always
 *     projects credential values to the literal sentinel `'<HIDDEN>'`, so
 *     any "exact match" against it would be useless anyway. Reading the raw
 *     vault directly from the service is what guarantees the decrypted
 *     secret never leaks via a safe-list side channel.
 *   - The service enforces an `ambiguous` signal when a fuzzy match produces
 *     multiple candidates. We propagate that as `{ ok: false, ambiguous: true }`
 *     so callers (HTTP / direct-apply / LLM tool) can prompt the user for a
 *     more specific label.
 *
 * Result shape:
 *   - { ok: true, found: true, value, label?, match?, matchedLabel? } on success
 *   - { ok: true, found: false }                                            on no match
 *   - { ok: false, ambiguous: true, candidates, error }                    on multi-match
 *   - { ok: false, locked: true }                                          on locked vault
 *   - { ok: false, error }                                                 on missing/empty label
 */
export async function opReveal(service, { label } = {}) {
  if (typeof label !== 'string' || !label.trim()) {
    return { ok: false, error: 'label (non-empty string) is required' };
  }
  if (!service.isUnlocked?.()) return { ok: false, locked: true };
  if (typeof service.revealCredential !== 'function') {
    // Defensive: should never happen for a real MemoryPets service. Returning
    // a structured "not found" here keeps downstream callers from breaking.
    return { ok: true, found: false, error: 'revealCredential unavailable on this service' };
  }
  const raw = await service.revealCredential(label);
  if (raw === undefined) {
    return { ok: true, found: false };
  }
  if (raw && raw.ambiguous) {
    return {
      ok: false,
      ambiguous: true,
      candidates: raw.candidates,
      error: 'Multiple credentials match the label; please specify exactly.',
    };
  }
  if (raw && typeof raw.value === 'string') {
    return {
      ok: true,
      found: true,
      // Prefer the matchedLabel when the service resolved via fuzzy match —
      // it tells the LLM/user which credential was actually decrypted.
      label: raw.matchedLabel ?? label,
      value: raw.value,
      ...(raw.match ? { match: raw.match } : {}),
    };
  }
  return { ok: true, found: false };
}
