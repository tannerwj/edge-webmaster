import { getCredential, putCredential } from "./creds";
import type { Env } from "./registry";
import { b64url, OpError, pemToBytes, sha256Hex } from "./util";

export interface GoogleOAuthClient {
  client_id: string;
  client_secret: string;
}
export interface GoogleOAuthTokens {
  refresh_token: string;
  access_token?: string;
  expires_at?: number;
}
export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
}

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/webmasters",
  "https://www.googleapis.com/auth/analytics.readonly",
];

export type GoogleAuthSource = "oauth" | "service_account";

export interface GoogleConnectionState {
  oauth_client_saved: boolean;
  oauth_client_id_masked: string | null;
  oauth_signed_in: boolean;
  oauth_needs_sign_in: boolean;
  service_account_saved: boolean;
  service_account_email: string | null;
  needs_sign_in: boolean;
  active_method: GoogleAuthSource | null;
}

const GOOGLE_CLIENT_SUFFIX = ".apps.googleusercontent.com";

export function maskGoogleClientId(id: string): string {
  if (id.endsWith(GOOGLE_CLIENT_SUFFIX)) {
    const prefix = id.slice(0, -GOOGLE_CLIENT_SUFFIX.length);
    return `${prefix.slice(0, 4)}…apps.googleusercontent.com`;
  }
  if (id.length <= 4) return "…";
  if (id.length <= 8) return `${id.slice(0, 2)}…`;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export async function googleAuthSource(env: Env): Promise<GoogleAuthSource | null> {
  const [tokens, sa] = await Promise.all([
    getCredential<GoogleOAuthTokens>(env, "google_oauth_tokens"),
    getCredential<GoogleServiceAccount>(env, "google_service_account"),
  ]);
  if (tokens?.refresh_token) return "oauth";
  if (sa?.client_email) return "service_account";
  return null;
}

export async function googleConnectionState(env: Env): Promise<GoogleConnectionState> {
  const [client, tokens, sa] = await Promise.all([
    getCredential<GoogleOAuthClient>(env, "google_oauth_client"),
    getCredential<GoogleOAuthTokens>(env, "google_oauth_tokens"),
    getCredential<GoogleServiceAccount>(env, "google_service_account"),
  ]);
  const oauthClientSaved = Boolean(client?.client_id);
  const oauthSignedIn = Boolean(tokens?.refresh_token);
  const oauthNeedsSignIn = oauthClientSaved && !oauthSignedIn;
  const serviceAccountSaved = Boolean(sa?.client_email);
  return {
    oauth_client_saved: oauthClientSaved,
    oauth_client_id_masked: client?.client_id ? maskGoogleClientId(client.client_id) : null,
    oauth_signed_in: oauthSignedIn,
    oauth_needs_sign_in: oauthNeedsSignIn,
    service_account_saved: serviceAccountSaved,
    service_account_email: sa?.client_email ?? null,
    needs_sign_in: oauthNeedsSignIn && !serviceAccountSaved,
    active_method: oauthSignedIn ? "oauth" : serviceAccountSaved ? "service_account" : null,
  };
}

export async function googleConfigured(env: Env): Promise<boolean> {
  const [tokens, sa] = await Promise.all([
    getCredential<GoogleOAuthTokens>(env, "google_oauth_tokens"),
    getCredential<GoogleServiceAccount>(env, "google_service_account"),
  ]);
  return Boolean(tokens?.refresh_token || sa?.client_email);
}

export function googleRedirectUri(env: Env, origin: string): string {
  const base = env.PUBLIC_URL || origin;
  return `${base.replace(/\/$/, "")}/auth/google/callback`;
}

export async function googleAuthUrl(env: Env, origin: string, state: string): Promise<string> {
  const client = await getCredential<GoogleOAuthClient>(env, "google_oauth_client");
  if (!client?.client_id) throw new OpError("Save the Google OAuth client ID and secret first.");
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: googleRedirectUri(env, origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(env: Env, origin: string, code: string): Promise<void> {
  const client = await getCredential<GoogleOAuthClient>(env, "google_oauth_client");
  if (!client) throw new OpError("Google OAuth client is not configured.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: googleRedirectUri(env, origin),
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || typeof data.refresh_token !== "string") {
    throw new OpError(`Google token exchange failed (${res.status}). Re-run consent and allow offline access.`);
  }
  const tokens: GoogleOAuthTokens = {
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in ?? 3600),
  };
  if (typeof data.access_token === "string") tokens.access_token = data.access_token;
  await putCredential(env, "google_oauth_tokens", tokens);
  invalidateGoogleTokenCache();
}

interface MintedToken {
  token: string;
  expiresIn: number;
}

let tokenCache: { token: string; expiresAt: number; fingerprint: string } | null = null;

export function invalidateGoogleTokenCache(): void {
  tokenCache = null;
}

const TOKEN_CACHE_SAFETY_SEC = 30;

function cacheMinted(fingerprint: string, minted: MintedToken): string {
  const adjustedSec = minted.expiresIn - TOKEN_CACHE_SAFETY_SEC;
  tokenCache =
    adjustedSec > 0
      ? { token: minted.token, expiresAt: Date.now() + adjustedSec * 1000, fingerprint }
      : null;
  return minted.token;
}

async function refreshOAuthToken(env: Env): Promise<MintedToken> {
  const [client, tokens] = await Promise.all([
    getCredential<GoogleOAuthClient>(env, "google_oauth_client"),
    getCredential<GoogleOAuthTokens>(env, "google_oauth_tokens"),
  ]);
  if (!client || !tokens?.refresh_token) throw new OpError("Google OAuth is not connected.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    const code = typeof data.error === "string" ? `: ${data.error}` : "";
    throw new OpError(`Google token refresh failed (${res.status})${code}. Reconnect Google in setup.`);
  }
  return { token: data.access_token, expiresIn: Number(data.expires_in ?? 3600) };
}

async function serviceAccountToken(env: Env, sa: GoogleServiceAccount): Promise<MintedToken> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: GOOGLE_SCOPES.join(" "),
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claim}`),
  );
  const assertion = `${header}.${claim}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    const code = typeof data.error === "string" ? `: ${data.error}` : "";
    throw new OpError(
      `Google service-account token failed (${res.status})${code}. Check the key and property access.`,
    );
  }
  return { token: data.access_token, expiresIn: Number(data.expires_in ?? 3600) };
}

export async function googleAccessToken(env: Env): Promise<string> {
  const tokens = await getCredential<GoogleOAuthTokens>(env, "google_oauth_tokens");
  if (tokens?.refresh_token) {
    const client = await getCredential<GoogleOAuthClient>(env, "google_oauth_client");
    if (client?.client_id && client?.client_secret) {
      const fingerprint = await sha256Hex(
        ["oauth", client.client_id, client.client_secret, tokens.refresh_token].join("\n"),
      );
      if (tokenCache && tokenCache.fingerprint === fingerprint && tokenCache.expiresAt > Date.now()) {
        return tokenCache.token;
      }
      return cacheMinted(fingerprint, await refreshOAuthToken(env));
    }
    return (await refreshOAuthToken(env)).token;
  }
  const sa = await getCredential<GoogleServiceAccount>(env, "google_service_account");
  if (!sa?.client_email) throw new OpError("Google is not connected. Open setup and connect Google first.");
  const fingerprint = await sha256Hex(["service_account", sa.client_email, sa.private_key].join("\n"));
  if (tokenCache && tokenCache.fingerprint === fingerprint && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  return cacheMinted(fingerprint, await serviceAccountToken(env, sa));
}

export async function googleFetch(
  env: Env,
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const token = await googleAccessToken(env);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err = data.error as { message?: string } | undefined;
    throw new OpError(`Google API ${res.status}: ${err?.message ?? text.slice(0, 200)}`);
  }
  return data;
}
