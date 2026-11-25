import { deleteCredential, getCredential, putCredential } from "./creds";
import { googleAuthUrl, googleRedirectUri } from "./google";
import { PACKS } from "./packs";
import { packStatuses, type Env } from "./registry";
import { audit, createAgentToken, listAgentTokens, revokeAgentToken } from "./store";
import { isRecord, nowSec, OpError, randomToken, sha256Hex, str, timingSafeEqual } from "./util";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function sessionCookieValue(env: Env): Promise<string> {
  return sha256Hex(`session:${env.SETUP_TOKEN ?? ""}`);
}

export async function isAdmin(req: Request, env: Env): Promise<boolean> {
  if (req.headers.get("cf-access-authenticated-user-email")) return true;
  if (!env.SETUP_TOKEN) return true; // first-run bootstrap: no Access and no token configured yet
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)ew_setup=([A-Za-z0-9+/=_-]+)/);
  if (match && timingSafeEqual(match[1] ?? "", await sessionCookieValue(env))) return true;
  return false;
}

async function requireAdmin(req: Request, env: Env): Promise<Response | null> {
  if (await isAdmin(req, env)) return null;
  return json({ error: "Setup access required. Sign in through Cloudflare Access or enter the setup token." }, 401);
}

async function statusBody(env: Env) {
  const statuses = await packStatuses(env, PACKS);
  return {
    mode: env.MCP_MODE ?? "code",
    bootstrap_open: !env.SETUP_TOKEN,
    connectors: statuses.map((s) => ({
      id: s.pack.id,
      name: s.pack.name,
      namespace: s.pack.namespace,
      auth_type: s.pack.authType,
      blurb: s.pack.blurb,
      configured: s.configured,
      setup_fields: s.pack.setupFields,
      tools: s.pack.tools.map((t) => t.name),
    })),
  };
}

async function testConnector(env: Env, id: string): Promise<Response> {
  const pack = PACKS.find((p) => p.id === id);
  if (!pack) return json({ error: "Unknown connector." }, 404);
  if (!(await pack.configured(env))) return json({ ok: false, detail: "Not configured yet." });
  try {
    const health = await pack.health(env);
    return json(health);
  } catch (e) {
    return json({ ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}

async function configureConnector(env: Env, id: string, body: Record<string, unknown>): Promise<Response> {
  if (id === "google-search-console" || id === "google-analytics") {
    if (str(body.client_id) || str(body.client_secret)) {
      await putCredential(env, "google_oauth_client", {
        client_id: str(body.client_id),
        client_secret: str(body.client_secret),
      });
      return json({ ok: true, saved: "oauth_client" });
    }
    if (str(body.service_account_json)) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(str(body.service_account_json)) as Record<string, unknown>;
      } catch {
        return json({ error: "Service account JSON did not parse." }, 400);
      }
      if (!str(parsed.client_email) || !str(parsed.private_key)) {
        return json({ error: "Service account JSON needs client_email and private_key." }, 400);
      }
      await putCredential(env, "google_service_account", {
        client_email: str(parsed.client_email),
        private_key: str(parsed.private_key),
      });
      return json({ ok: true, saved: "service_account" });
    }
    return json({ error: "Provide client_id + client_secret, or service_account_json." }, 400);
  }
  if (id === "bing-webmaster") {
    await putCredential(env, "bing", { api_key: str(body.api_key) });
    return json({ ok: true, saved: "api_key" });
  }
  if (id === "pagespeed-crux") {
    await putCredential(env, "pagespeed", { api_key: str(body.api_key) });
    return json({ ok: true, saved: "api_key" });
  }
  return json({ error: "Unknown connector." }, 404);
}

async function disconnectConnector(env: Env, id: string): Promise<Response> {
  if (id === "google-search-console" || id === "google-analytics") {
    await deleteCredential(env, "google_oauth_tokens");
    await deleteCredential(env, "google_service_account");
    await deleteCredential(env, "google_oauth_client");
  } else if (id === "bing-webmaster") {
    await deleteCredential(env, "bing");
  } else if (id === "pagespeed-crux") {
    await deleteCredential(env, "pagespeed");
  } else {
    return json({ error: "Unknown connector." }, 404);
  }
  return json({ ok: true });
}

export async function handleApi(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  const url = new URL(req.url);
  if (path === "/api/login" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!env.SETUP_TOKEN || !timingSafeEqual(str(body.token), env.SETUP_TOKEN)) {
      return json({ error: "That setup token did not match." }, 401);
    }
    const value = await sessionCookieValue(env);
    return json({ ok: true }, 200, {
      "set-cookie": `ew_setup=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    });
  }
  if (path === "/api/feedback" && req.method === "POST") {
    return handleFeedback(req, env);
  }
  const gate = await requireAdmin(req, env);
  if (gate) return gate;
  if (path === "/api/status" && req.method === "GET") return json(await statusBody(env));
  if (path === "/api/google/oauth-url" && req.method === "GET") {
    const state = randomToken("st_");
    await env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('oauth_state', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(state, nowSec())
      .run();
    try {
      return json({ url: await googleAuthUrl(env, url.origin, state), redirect_uri: googleRedirectUri(env, url.origin) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }
  const configureMatch = path.match(/^\/api\/connectors\/([a-z-]+)\/(configure|test)$/);
  if (configureMatch && req.method === "POST") {
    const [, id, action] = configureMatch;
    if (action === "test") return testConnector(env, id ?? "");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const res = await configureConnector(env, id ?? "", body);
    if (res.ok) audit(ctx, env, "setup-ui", "connector.configure", id ?? "");
    return res;
  }
  const disconnectMatch = path.match(/^\/api\/connectors\/([a-z-]+)$/);
  if (disconnectMatch && req.method === "DELETE") {
    const res = await disconnectConnector(env, disconnectMatch[1] ?? "");
    if (res.ok) audit(ctx, env, "setup-ui", "connector.disconnect", disconnectMatch[1] ?? "");
    return res;
  }
  if (path === "/api/tokens" && req.method === "GET") return json({ tokens: await listAgentTokens(env) });
  if (path === "/api/tokens" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = str(body.name) || "agent";
    const scope = str(body.scope) === "write" ? "write" : "read";
    const created = await createAgentToken(env, name, scope);
    audit(ctx, env, "setup-ui", "token.create", `${name}:${scope}`);
    return json({ token: created.token, record: created.record });
  }
  const tokenMatch = path.match(/^\/api\/tokens\/([A-Za-z0-9_-]+)$/);
  if (tokenMatch && req.method === "DELETE") {
    await revokeAgentToken(env, tokenMatch[1] ?? "");
    audit(ctx, env, "setup-ui", "token.revoke", tokenMatch[1] ?? "");
    return json({ ok: true });
  }
  if (path === "/api/metrics" && req.method === "GET") return json(await metrics(env));
  return json({ error: "Not found." }, 404);
}

async function metrics(env: Env): Promise<Record<string, unknown>> {
  const since = nowSec() - 7 * 86_400;
  const byTool = await env.DB.prepare(
    "SELECT tool_name, COUNT(*) AS calls, SUM(success) AS ok FROM mcp_calls WHERE started_at > ?1 GROUP BY tool_name ORDER BY calls DESC",
  )
    .bind(since)
    .all<Record<string, unknown>>();
  const recentAudit = await env.DB.prepare(
    "SELECT ts, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT 20",
  ).all<Record<string, unknown>>();
  return { window_days: 7, tools: byTool.results ?? [], audit: recentAudit.results ?? [] };
}

async function handleFeedback(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const message = str(body.message).slice(0, 4000);
  if (!message) return json({ error: "message is required." }, 400);
  const role = str(body.role) || "user";
  const result = await env.DB.prepare(
    "INSERT INTO feedback (ts, role, message, context) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(nowSec(), role, message, str(body.context).slice(0, 500))
    .run();
  return json({
    receipt: `feedback #${result.meta.last_row_id}`,
    note: "Stored on this deployment. The maintainer reviews feedback from the setup page; for bugs that affect everyone, also open an issue on the project repository.",
  });
}

export async function handleGoogleCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const row = await env.DB.prepare("SELECT value, updated_at FROM settings WHERE key = 'oauth_state'")
    .first<{ value: string; updated_at: number }>();
  if (!row || !timingSafeEqual(row.value, state) || row.updated_at < nowSec() - 900) {
    return new Response("OAuth state mismatch or expired. Return to setup and try again.", { status: 400 });
  }
  const { exchangeGoogleCode } = await import("./google");
  try {
    await exchangeGoogleCode(env, url.origin, code);
  } catch (e) {
    return new Response(`Google sign-in failed: ${e instanceof OpError ? e.message : "unknown error"}`, { status: 400 });
  }
  await env.DB.prepare("DELETE FROM settings WHERE key = 'oauth_state'").run();
  return new Response(null, { status: 302, headers: { location: "/?connected=google" } });
}

export async function googleConnectionPresent(env: Env): Promise<boolean> {
  return Boolean(await getCredential(env, "google_oauth_tokens"));
}
