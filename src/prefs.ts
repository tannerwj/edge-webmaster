import { accessEmail } from "./access";
import type { Env } from "./registry";
import { nowSec, sha256Hex, timingSafeEqual } from "./util";

export type Theme = "light" | "dark" | "system";
export type IdentityKind = "access" | "setup-token";

export interface Identity {
  email: string | null;
  identity: IdentityKind;
  key: string;
}

export function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}

export async function sessionCookieValue(env: Env): Promise<string> {
  return sha256Hex(`session:${env.SETUP_TOKEN ?? ""}`);
}

export function setupSessionCookie(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)ew_setup=([A-Za-z0-9+/=_-]+)/);
  return match?.[1] ?? null;
}

export async function hasSetupSession(req: Request, env: Env): Promise<boolean> {
  const value = setupSessionCookie(req);
  return Boolean(env.SETUP_TOKEN) && value !== null && timingSafeEqual(value, await sessionCookieValue(env));
}

export async function resolveIdentity(req: Request, env: Env): Promise<Identity | null> {
  const email = await accessEmail(req, env, env.ACCESS_ADMIN_AUD);
  if (email) return { email, identity: "access", key: email };
  if (await hasSetupSession(req, env)) return { email: null, identity: "setup-token", key: "setup-token" };
  return null;
}

export async function getTheme(env: Env, identityKey: string): Promise<Theme> {
  try {
    const row = await env.DB.prepare("SELECT theme FROM user_preferences WHERE identity_key = ?1")
      .bind(identityKey)
      .first<{ theme: string }>();
    return isTheme(row?.theme) ? row.theme : "system";
  } catch {
    return "system";
  }
}

export async function setTheme(env: Env, identityKey: string, theme: Theme): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO user_preferences (identity_key, theme, updated_at) VALUES (?1, ?2, ?3) " +
      "ON CONFLICT(identity_key) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at",
  )
    .bind(identityKey, theme, nowSec())
    .run();
}
