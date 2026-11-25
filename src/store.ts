import type { Env } from "./registry";
import { nowSec, randomToken, sha256Hex } from "./util";

export interface AgentToken {
  id: string;
  name: string;
  scope: "read" | "write";
}

export async function createAgentToken(
  env: Env,
  name: string,
  scope: "read" | "write",
): Promise<{ token: string; record: AgentToken }> {
  const token = randomToken("ew_");
  const id = randomToken("tok_").slice(0, 16);
  await env.DB.prepare(
    "INSERT INTO agent_tokens (id, name, token_hash, scope, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(id, name, await sha256Hex(token), scope, nowSec())
    .run();
  return { token, record: { id, name, scope } };
}

export async function authenticateAgentToken(env: Env, raw: string): Promise<AgentToken | null> {
  if (!raw.startsWith("ew_")) return null;
  const row = await env.DB.prepare(
    "SELECT id, name, scope, expires_at FROM agent_tokens WHERE token_hash = ?1",
  )
    .bind(await sha256Hex(raw))
    .first<{ id: string; name: string; scope: string; expires_at: number | null }>();
  if (!row) return null;
  if (row.expires_at && row.expires_at < nowSec()) return null;
  return { id: row.id, name: row.name, scope: row.scope === "write" ? "write" : "read" };
}

export async function tokenStillActive(env: Env, tokenId: string): Promise<AgentToken | null> {
  const row = await env.DB.prepare(
    "SELECT id, name, scope, expires_at FROM agent_tokens WHERE id = ?1",
  )
    .bind(tokenId)
    .first<{ id: string; name: string; scope: string; expires_at: number | null }>();
  if (!row || (row.expires_at && row.expires_at < nowSec())) return null;
  return { id: row.id, name: row.name, scope: row.scope === "write" ? "write" : "read" };
}

export async function listAgentTokens(env: Env): Promise<Record<string, unknown>[]> {
  const res = await env.DB.prepare(
    "SELECT id, name, scope, created_at, last_used_at, expires_at FROM agent_tokens ORDER BY created_at DESC",
  ).all<Record<string, unknown>>();
  return res.results ?? [];
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
