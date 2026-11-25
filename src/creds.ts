import { b64ToBytes, bytesToB64, sha256Hex } from "./util";

// Upstream credentials live in D1 settings, AES-GCM wrapped under a key
// derived from DEPLOYMENT_SECRET (falling back to SETUP_TOKEN). Plaintext
// credentials are never logged, returned by any API, or placed in the sandbox.

async function wrapKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function deploymentSecret(env: { DEPLOYMENT_SECRET?: string; SETUP_TOKEN?: string }): string {
  const secret = env.DEPLOYMENT_SECRET || env.SETUP_TOKEN || "";
  if (!secret) throw new Error("DEPLOYMENT_SECRET (or SETUP_TOKEN) is not configured on this worker.");
  return secret;
}

export async function sealSecret(env: object, plaintext: string): Promise<string> {
  const key = await wrapKey(deploymentSecret(env as { DEPLOYMENT_SECRET?: string }));
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(ct))}`;
}

export async function openSecret(env: object, sealed: string): Promise<string> {
  const [ivPart, ctPart] = sealed.split(".");
  if (!ivPart || !ctPart) throw new Error("Stored credential is malformed.");
  const key = await wrapKey(deploymentSecret(env as { DEPLOYMENT_SECRET?: string }));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(ivPart) },
    key,
    b64ToBytes(ctPart),
  );
  return new TextDecoder().decode(pt);
}

export async function getCredential<T>(env: CredEnv, key: string): Promise<T | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1")
    .bind(`cred:${key}`)
    .first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(await openSecret(env, row.value)) as T;
  } catch {
    return null;
  }
}

export async function putCredential(env: CredEnv, key: string, value: unknown): Promise<void> {
  const sealed = await sealSecret(env, JSON.stringify(value));
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(`cred:${key}`, sealed, Math.floor(Date.now() / 1000))
    .run();
}

export async function deleteCredential(env: CredEnv, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = ?1").bind(`cred:${key}`).run();
}

export interface CredEnv {
  DB: D1Database;
  DEPLOYMENT_SECRET?: string;
  SETUP_TOKEN?: string;
}

export async function cacheGet(env: { DB: D1Database }, key: string): Promise<string | null> {
  const hash = await sha256Hex(key);
  const row = await env.DB.prepare(
    "SELECT body, expires_at FROM response_cache WHERE key_hash = ?1",
  )
    .bind(hash)
    .first<{ body: string; expires_at: number }>();
  if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return row.body;
}

export async function cachePut(
  env: { DB: D1Database },
  key: string,
  body: string,
  ttlSec: number,
): Promise<void> {
  const hash = await sha256Hex(key);
  await env.DB.prepare(
    "INSERT INTO response_cache (key_hash, body, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT(key_hash) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at",
  )
    .bind(hash, body, Math.floor(Date.now() / 1000) + ttlSec)
    .run()
    .catch(() => {});
}
