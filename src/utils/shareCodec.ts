import { CrochetDialect } from '../core/model/types';

export interface SharedAppState {
  p: string; // patternText
  s?: number; // step
  d?: CrochetDialect; // dialect
  m?: 'yarn' | 'diagram'; // render mode
  h?: 'R' | 'L'; // handedness
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function encodeShareHash(state: SharedAppState): Promise<string> {
  const json = JSON.stringify(state);
  const rawBytes = new TextEncoder().encode(json);

  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      void writer.write(rawBytes);
      void writer.close();
      const compressedBuf = await new Response(cs.readable).arrayBuffer();
      return `#z=${bytesToBase64Url(new Uint8Array(compressedBuf))}`;
    } catch {
      // Fall back to uncompressed base64url
    }
  }
  return `#u=${bytesToBase64Url(rawBytes)}`;
}

export async function decodeShareHash(hash: string): Promise<SharedAppState | null> {
  if (!hash || hash.length < 4) return null;
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;

  try {
    if (clean.startsWith('z=') && typeof DecompressionStream !== 'undefined') {
      const bytes = base64UrlToBytes(clean.slice(2));
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      void writer.write(copy);
      void writer.close();
      const decompressedBuf = await new Response(ds.readable).arrayBuffer();
      const text = new TextDecoder().decode(decompressedBuf);
      return JSON.parse(text) as SharedAppState;
    }
    if (clean.startsWith('u=')) {
      const bytes = base64UrlToBytes(clean.slice(2));
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text) as SharedAppState;
    }
  } catch {
    return null;
  }
  return null;
}
