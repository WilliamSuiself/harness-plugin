// Cross-runtime crypto facade: Web Crypto in browsers and Node >= 20.

const subtle = () => {
  const g = globalThis;
  if (!g.crypto || !g.crypto.subtle) {
    throw new Error('Web Crypto API unavailable in this runtime.');
  }
  return g.crypto.subtle;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return Buffer.from(bin, 'binary').toString('base64');
};

const fromB64 = (b64) => {
  return new Uint8Array(Buffer.from(b64, 'base64'));
};

export const deriveKey = async (password, salt, iterations) => {
  const s = subtle();
  const baseKey = await s.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return s.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

export const encryptString = async (key, iv, plaintext) => {
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return toB64(ct);
};

export const decryptString = async (key, iv, ciphertextB64) => {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv }, key, fromB64(ciphertextB64));
  return dec.decode(pt);
};

export const randomBytes = (len) => {
  const out = new Uint8Array(len);
  globalThis.crypto.getRandomValues(out);
  return out;
};

export const toBase64 = toB64;
export const fromBase64 = fromB64;