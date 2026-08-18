// Register the MemoryPets client bundle into dsh's ClientModuleRegistry.
//
// Why we don't rely on the default scanner:
//   The default `dsh-client-modules` scanner resolves entries via
//   `require.resolve(\`${entryName}/package.json\`)`. Our `memorypets-client`
//   is loaded by absolute path and cannot be resolved by package name. We
//   therefore poke the registry's internal `pkgMeta` + `table` directly,
//   compute the bundle's rev hash, then trigger a graph recomposition so
//   subsequent HTML requests see the new entry.
//
// Failure mode: registry operations may not exist on every dsh version; we
// wrap everything in try/catch and log via the host ctx.logger. The host
// remains useful (vault + tools) even if registration silently no-ops.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function registerClientBundle(registry, {
  clientId,
  clientBundlePath,
  clientIndexPath,
  injectEdges,
  logger,
}) {
  if (!registry) return false;
  try {
    // 1) Pre-populate pkgMeta so flush doesn't try to require.resolve() our
    //    absolute path and crash.
    registry.pkgMeta.set(clientId, {
      clientPath: clientBundlePath,
      inject: injectEdges,
      immediately: true,
    });
    // 2) Hash the bundle to derive a stable rev (also lets HMR detect changes).
    let rev;
    try {
      rev = createHash('sha1')
        .update(readFileSync(clientBundlePath))
        .digest('hex')
        .slice(0, 12);
    } catch {
      rev = 'dev-' + Math.random().toString(36).slice(2, 14);
    }
    // 3) Add the entry to the registry's table.
    registry.table.set(clientId, {
      entry: {
        id: clientId,
        url: `/plugins/${encodeURIComponent(clientId)}/client.js?rev=${rev}`,
        rev,
        inject: injectEdges,
        immediately: true,
      },
      clientPath: clientBundlePath,
    });
    // 4) Same pkgMeta entry keyed by the absolute path Cordis uses internally.
    registry.pkgMeta.set(clientIndexPath, {
      clientPath: clientBundlePath,
      inject: injectEdges,
      immediately: true,
    });
    // 5) Recompose the graph.
    registry.composed = registry.compose();
    // 6) Notify subscribers (HMR / SSE) of the change.
    try { registry.notifyGraphChanged(); } catch { /* non-critical */ }
    // 7) Clear dirty so flush doesn't undo our work.
    try { registry.dirty.delete(clientIndexPath); } catch { /* ignore */ }
    return true;
  } catch (err) {
    try { logger?.warn?.(err); } catch { /* noop */ }
    return false;
  }
}