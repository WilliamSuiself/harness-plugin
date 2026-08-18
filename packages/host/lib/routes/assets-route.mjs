// MemoryPets static asset HTTP route.
//
// Serves `<repo>/assets/<mood>/<frame>.png` (and `<repo>/assets/icon.png`)
// at `/memorypets-assets/...`. We register our own route instead of dumping
// into the dsh web's `/assets` because the sandbox forbids writing into
// `deepseek-harness-master/apps/web/public/assets`.
//
// Security:
//   - Rejects any segment equal to `.` or `..` (literal and URL-decoded).
//   - Refuses to follow symlinks (lstatSync + realpathSync double check).
//   - Final resolved path must stay inside `assetsRoot` after canonicalization.

import { existsSync, lstatSync, readFile, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

const ASSETS_PREFIX = '/memorypets-assets';
const ALLOWED_MOODS = new Set(['standing', 'thinking', 'waiting', 'sleeping']);

function safeJoin(assetsRoot, rel) {
  const fsPath = join(assetsRoot, ...rel);
  // Final double-defense: lstat to detect symlinks, realpath to canonicalize,
  // then compare against the resolved root.
  const st = lstatSync(fsPath);
  if (st.isSymbolicLink()) throw new Error('symlinks forbidden');
  const resolved = realpathSync(fsPath);
  const rootResolved = realpathSync(assetsRoot) + sep;
  if (!(resolved === rootResolved.slice(0, -1) || resolved.startsWith(rootResolved))) {
    throw new Error('path escape');
  }
  if (!st.isFile()) throw new Error('not a file');
  return fsPath;
}

export function makeAssetsHandler(assetsRoot, logger) {
  return function handle(req, res) {
    try {
      const rawPath = new URL(req.url || '/', 'http://x').pathname;
      if (!rawPath.startsWith(ASSETS_PREFIX)) {
        res.writeHead(404); res.end(); return;
      }
      const rest = rawPath.slice(ASSETS_PREFIX.length).replace(/^\/+/, '');
      const rel = rest.split('/').filter(Boolean);
      if (!rel.length) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'invalid path' })); return;
      }
      // Defense #1: literal `.` / `..` and decoded variants in any segment.
      for (const seg of rel) {
        if (seg === '..' || seg === '.') {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'invalid path' })); return;
        }
        let decoded = seg;
        try { decoded = decodeURIComponent(seg); } catch {}
        if (decoded === '..' || decoded === '.' || decoded.includes('\0')) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'invalid path' })); return;
        }
      }
      const kind = rel[0];
      const isIcon = rel.length === 1 && kind === 'icon.png';
      if (!ALLOWED_MOODS.has(kind) && !isIcon) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not found' })); return;
      }
      let fsPath;
      try {
        fsPath = safeJoin(assetsRoot, rel);
      } catch {
        res.writeHead(rel.length === 1 ? 404 : 403, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: 'forbidden or not found' })); return;
      }
      readFile(fsPath, (err, buf) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'not found' })); return;
        }
        const isPng = /\.png$/i.test(rel[rel.length - 1]);
        res.writeHead(200, {
          'Content-Type': isPng ? 'image/png' : 'application/octet-stream',
          'Content-Length': buf.length,
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(buf);
      });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e?.message || String(e) }));
    }
  };
}

export function registerAssetsRoute(wsvc, assetsRoot, logger) {
  if (!wsvc || typeof wsvc.register !== 'function') return false;
  const handler = makeAssetsHandler(assetsRoot, logger);
  try {
    wsvc.register({ kind: 'prefix', path: ASSETS_PREFIX, handler });
    try { logger?.info?.('[memorypets] route registered: ' + ASSETS_PREFIX + ' root=' + assetsRoot); } catch {}
    return true;
  } catch (e) {
    try { logger?.warn?.('[memorypets] route register failed: ' + (e?.message ?? e)); } catch {}
    return false;
  }
}

export function resolveAssetsRoot(repoRoot) {
  try {
    const root = join(repoRoot, 'assets');
    if (existsSync(root)) return root;
  } catch { /* ignore */ }
  return join(process.cwd(), 'assets');
}