import { getCredential, putCredential } from "./creds";
import type { Env } from "./registry";
import { b64url, OpError, pemToBytes } from "./util";

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
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function refreshOAuthToken(env: Env): Promise<string> {
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
    throw new OpError(`Google token refresh failed (${res.status}). Reconnect Google in setup.`);
  }
  return data.access_token;
}

async function serviceAccountToken(env: Env, sa: GoogleServiceAccount): Promise<string> {
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
    throw new OpError(`Google service-account token failed (${res.status}). Check the key and property access.`);
  }
  return data.access_token;
}

export async function googleAccessToken(env: Env): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const tokens = await getCredential<GoogleOAuthTokens>(env, "google_oauth_tokens");
  let token: string;
  if (tokens?.refresh_token) {
    token = await refreshOAuthToken(env);
  } else {
    const sa = await getCredential<GoogleServiceAccount>(env, "google_service_account");
    if (!sa?.client_email) throw new OpError("Google is not connected. Open setup and connect Google first.");
    token = await serviceAccountToken(env, sa);
  }
  tokenCache = { token, expiresAt: Date.now() + 50 * 60_000 };
  return token;
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
