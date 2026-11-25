import type { Grants } from "./grants";
import type { Env } from "./registry";
import { nowSec, randomToken, sha256Hex } from "./util";

export interface AgentToken {
  grants?: Grants | null;
  id: string;
  name: string;
  scope: "read" | "write";
}

export async function createAgentToken(
  env: Env,
  name: string,
  scope: "read" | "write",
  grants: Grants | null = null,
): Promise<{ token: string; record: AgentToken }> {
  const token = randomToken("ew_");
  const id = randomToken("tok_").slice(0, 16);
  await env.DB.prepare(
    "INSERT INTO agent_tokens (id, name, token_hash, scope, created_at, grants) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind(id, name, await sha256Hex(token), scope, nowSec(), JSON.stringify(grants))
    .run();
  return { token, record: { id, name, scope, grants } };
}

export async function authenticateAgentToken(env: Env, raw: string): Promise<AgentToken | null> {
  if (!raw.startsWith("ew_")) return null;
  return lookupToken(env, "token_hash", await sha256Hex(raw));
}

export function tokenStillActive(env: Env, tokenId: string): Promise<AgentToken | null> {
  return lookupToken(env, "id", tokenId);
}

async function lookupToken(env: Env, column: "id" | "token_hash", value: string): Promise<AgentToken | null> {
  const row = await env.DB.prepare(
    `SELECT id, name, scope, grants FROM agent_tokens WHERE ${column} = ?1 AND (expires_at IS NULL OR expires_at > ?2)`,
  ).bind(value, nowSec()).first<{ id: string; name: string; scope: string; grants: string | null }>();
  if (!row) return null;
  return { id: row.id, name: row.name, scope: row.scope === "write" ? "write" : "read", grants: JSON.parse(row.grants ?? "null") };
}

export async function listAgentTokens(env: Env): Promise<Record<string, unknown>[]> {
  const res = await env.DB.prepare(
    "SELECT id, name, scope, grants, created_at, last_used_at, expires_at FROM agent_tokens ORDER BY created_at DESC",
  ).all<Record<string, unknown>>();
  return res.results.map((row) => ({ ...row, grants: typeof row.grants === "string" ? JSON.parse(row.grants) : null }));
}

export async function revokeAgentToken(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM agent_tokens WHERE id = ?1").bind(id).run();
}

export function trackCall(
  ctx: { waitUntil(p: Promise<unknown>): void },
  env: Env,
  tool: string,
  startedAt: number,
  error: string | null,
  tokenId: string,
): void {
  ctx.waitUntil(
    env.DB.prepare(
      "INSERT INTO mcp_calls (tool_name, started_at, duration_ms, success, error, token_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
      .bind(tool, Math.floor(startedAt / 1000), Date.now() - startedAt, error ? 0 : 1, error, tokenId)
      .run()
      .catch(() => {}),
  );
}

export function audit(
  ctx: { waitUntil(p: Promise<unknown>): void },
  env: Env,
  actor: string,
  action: string,
  detail: string,
): void {
  ctx.waitUntil(
    env.DB.prepare("INSERT INTO audit_log (ts, actor, action, detail) VALUES (?1, ?2, ?3, ?4)")
      .bind(nowSec(), actor, action, detail.slice(0, 500))
      .run()
      .catch(() => {}),
  );
}

export async function touchToken(
  ctx: { waitUntil(p: Promise<unknown>): void },
  env: Env,
  tokenId: string,
): Promise<void> {
  ctx.waitUntil(
    env.DB.prepare("UPDATE agent_tokens SET last_used_at = ?1 WHERE id = ?2")
      .bind(nowSec(), tokenId)
      .run()
      .catch(() => {}),
  );
}
