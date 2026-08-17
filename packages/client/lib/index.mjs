// Host (Node-side) half of the MemoryPets client package.
//
// This file is intentionally lightweight: the real UI lives in `./client.mjs`
// (the `exports["./client"]` entry) and only runs inside the browser's
// Vite-bundled Cordis fiber where React + slot services exist.
//
// Mounting this empty plugin as a host entry lets the dsh-client-modules
// scanner discover our package.json `dsh.client` manifest and include the
// browser half in window.__DSH_BOOT__.

export const name = 'memorypets-client';
export const inject = [];

export function apply(_ctx, _config) {
  // Intentionally empty on the host side. The browser half (client.mjs) is
  // what registers the floating pet component into shell.overlay.
}

export default { name, inject, apply };
