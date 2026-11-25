export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
export const nowSec = (): number => Math.floor(Date.now() / 1000);

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? Math.floor(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToB64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b >> 4));
    out += i + 1 < bytes.length ? B64.charAt(((b & 15) << 2) | (c >> 6)) : "=";
    out += i + 2 < bytes.length ? B64.charAt(c & 63) : "=";
  }
  return out;
}

export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i] ?? "A");
    const b = B64.indexOf(clean[i + 1] ?? "A");
    const c = clean[i + 2] === "=" || clean[i + 2] === undefined ? 0 : B64.indexOf(clean[i + 2] ?? "A");
    const d = clean[i + 3] === "=" || clean[i + 3] === undefined ? 0 : B64.indexOf(clean[i + 3] ?? "A");
    out.push((a << 2) | (b >> 4));
    if (clean[i + 2] !== "=" && clean[i + 2] !== undefined) out.push(((b & 15) << 4) | (c >> 2));
    if (clean[i + 3] !== "=" && clean[i + 3] !== undefined) out.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

export const b64url = (bytes: Uint8Array): string =>
  bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function b64urlToBytes(s: string): Uint8Array {
  return b64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/"));
}

export function pemToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return b64ToBytes(body);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}${b64url(bytes)}`;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class OpError extends Error {}
