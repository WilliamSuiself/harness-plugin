#!/usr/bin/env node
// Standalone launcher for the MemoryPets cloud-sync relay.
//
// Env vars:
//   CLOUD_SYNC_PORT      listen port (default 8787)
//   CLOUD_SYNC_HOST      listen host (default 127.0.0.1; use 0.0.0.0 to expose)
//   CLOUD_SYNC_DATA_DIR  where accounts.json / vaults/*.json are stored
//                        (default ./data relative to cwd)

import { createServer } from '../lib/server.mjs';
import { resolve } from 'node:path';

const port = Number(process.env.CLOUD_SYNC_PORT || 8787);
const host = process.env.CLOUD_SYNC_HOST || '127.0.0.1';
const dataDir = resolve(process.env.CLOUD_SYNC_DATA_DIR || './data');

const server = createServer({ dataDir });
server.listen(port, host, () => {
  console.log(`[memorypets-cloud-sync] listening on http://${host}:${port}`);
  console.log(`[memorypets-cloud-sync] data dir: ${dataDir}`);
});
