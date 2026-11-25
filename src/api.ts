import { configureIndexNow, disconnectIndexNow, submitIndexNow } from "./packs/indexnow";
import { liveToolsFor } from "./runtime";
import { validGrants } from "./grants";
import { deleteCredential, getCredential, putCredential } from "./creds";
import {
  googleAuthSource,
  googleAuthUrl,
  googleConnectionState,
  googleRedirectUri,
  invalidateGoogleTokenCache,
  maskGoogleClientId,
  type GoogleAuthSource,
  type GoogleOAuthClient,
  type GoogleOAuthTokens,
} from "./google";
import { PACKS } from "./packs";
import { type Identity, getTheme, isTheme, resolveIdentity, sessionCookieValue, setTheme } from "./prefs";
import { isActiveStatus, packStatus, packStatuses, type ConnectionStatus, type Env, type PackStatus } from "./registry";
import { audit, createAgentToken, listAgentTokens, revokeAgentToken } from "./store";
import { json, readObject, isRecord, nowSec, OpError, randomToken, str, timingSafeEqual } from "./util";

function nextStep(statuses: PackStatus[], activeTokens: number) {
  const byId = new Map(statuses.map((s) => [s.pack.id, s.status]));
  const step = (id: string, title: string, body: string, action_target: string) => ({
    id,
    title,
    body,
    action_target,
  });
  if (!isActiveStatus(byId.get("google-search-console") ?? "not_connected"))
    return step("connect_gsc", "Connect Google Search Console", "Connect Google to unlock search performance, sitemaps and URL inspection.", "google-search-console");
  if (!activeTokens)
    return step("mint_token", "Mint an agent token", "Create a token so your AI agent can call the connected tools over MCP.", "tokens");
  if (!isActiveStatus(byId.get("google-analytics") ?? "not_connected"))
    return step("connect_ga4", "Connect Google Analytics 4", "GA4 shares the Google connection and adds traffic and conversion reporting.", "google-analytics");
  if (!isActiveStatus(byId.get("bing-webmaster") ?? "not_connected"))
    return step("connect_bing", "Connect Bing Webmaster Tools", "Add the Bing API key to cover Bing, Copilot and DuckDuckGo search data.", "bing-webmaster");
  return null;
}

async function dashboardSummary(env: Env, statuses: PackStatus[]) {
  const since = nowSec() - 7 * 86_400;
  let activeTokens = 0;
  let toolCalls = 0;
  let latestAudit: unknown = null;
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM agent_tokens WHERE expires_at IS NULL OR expires_at > ?1",
    ).bind(nowSec()).first<{ n: number }>();
    activeTokens = Number(row?.n ?? 0);
  } catch { activeTokens = 0; }
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM mcp_calls WHERE started_at > ?1",
    ).bind(since).first<{ n: number }>();
    toolCalls = Number(row?.n ?? 0);
  } catch { toolCalls = 0; }
  try {
    const res = await env.DB.prepare(
      "SELECT ts, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT 1",
    ).all<Record<string, unknown>>();
    latestAudit = res.results?.[0] ?? null;
  } catch { latestAudit = null; }
  const byConnector: Record<string, number | null> = {};
  let discovered = 0;
  let known = false;
  for (const s of statuses) {
    const count = s.status === "connected" ? (s.health?.count ?? null) : null;
    byConnector[s.pack.id] = count;
    if (count !== null) { discovered += count; known = true; }
  }
  return {
    connections_active: statuses.filter((s) => isActiveStatus(s.status)).length,
    connections_total: statuses.length,
    properties_discovered: known ? discovered : null,
    properties_by_connector: byConnector,
    active_agent_tokens: activeTokens,
    tool_calls_last_7d: toolCalls,
    latest_audit: latestAudit,
    recommended_next_step: nextStep(statuses, activeTokens || (env.ACCESS_MCP_AUD ? 1 : 0)),
  };
}

export const GOOGLE_NEEDS_SIGN_IN_DETAIL = "Client saved — click Sign in with Google to finish connecting";

interface MappedGoogleError {
  human: string;
  status: ConnectionStatus;
  clearTokens: boolean;
}

export function mapGoogleError(raw: string, source: GoogleAuthSource | null): MappedGoogleError {
  const lower = raw.toLowerCase();
  if (source === "oauth" && lower.includes("invalid_client")) {
    return {
      human: "Google rejected the OAuth client ID or secret. Replace the saved client, then click Sign in with Google again.",
      status: "error",
      clearTokens: false,
    };
  }
  if (
    source === "oauth" &&
    (lower.includes("google api 401") ||
      lower.includes("invalid authentication credentials") ||
      lower.includes("invalid_grant"))
  ) {
    return {
      human: "Google rejected the stored sign-in token. Click Sign in with Google again to reconnect.",
      status: "needs_sign_in",
      clearTokens: true,
    };
  }
  if (source === "service_account" && lower.includes("service-account token failed")) {
    return {
      human: "Google rejected the service account key. Re-upload the JSON key and confirm the service account has access to the property.",
      status: "error",
      clearTokens: false,
    };
  }
  if (/quota|permission|forbidden|not been used|access denied/.test(lower)) {
    return { human: raw, status: "error", clearTokens: false };
  }
  return {
    human: "Google couldn't complete the test. Try again, or reconnect Google if it keeps failing.",
    status: "error",
    clearTokens: false,
  };
}

async function statusBody(env: Env) {
  const statuses = await packStatuses(env, PACKS, { checkHealth: true });
  const summary = await dashboardSummary(env, statuses);
  const googleState = await googleConnectionState(env);
  return {
    mode: env.MCP_MODE ?? "code",
    bootstrap_open: false,
    managed_oauth: Boolean(env.ACCESS_MCP_AUD && env.ACCESS_TEAM_DOMAIN),
    summary,
    dashboard: summary,
    connectors: statuses.map((s) => {
      const isGoogle = s.pack.connectionId === "google";
      let status: ConnectionStatus = s.status;
      let statusDetail = s.statusDetail;
      let configured = s.configured;
      let health = s.health;
      if (isGoogle && googleState.needs_sign_in) {
        status = "needs_sign_in";
        statusDetail = GOOGLE_NEEDS_SIGN_IN_DETAIL;
        configured = true;
        health = null;
      } else if (isGoogle && status === "error" && health) {
        const mapped = mapGoogleError(health.detail, googleState.active_method);
        statusDetail = mapped.human;
        health = { ...health, detail: mapped.human, secondary: health.detail };
      }
      return {
        id: s.pack.id,
        name: s.pack.name,
        namespace: s.pack.namespace,
        auth_type: s.pack.authType,
        auth_label: s.pack.authLabel,
        provider: s.pack.provider,
        connection_id: s.pack.connectionId,
        setup_kind: s.pack.setupKind,
        access: s.pack.access,
        description: s.pack.blurb,
        blurb: s.pack.blurb,
        examples: s.pack.examples,
        recommendation: s.pack.recommendation,
        status,
        status_detail: statusDetail,
        credentials_present: s.credentialsPresent,
        configured,
        advertise: s.advertise,
        has_access: s.hasAccess,
        health,
        checked: s.checked,
        setup_fields: s.pack.setupFields,
        tools: s.pack.tools.filter((t) => !t.requiresCredential || s.credentialsPresent).map((t) => t.name),
        ...(isGoogle ? { google_connection: googleState } : {}),
      };
    }),
  };
}

async function googleTestFailure(env: Env, raw: string): Promise<Response> {
  const mapped = mapGoogleError(raw, await googleAuthSource(env));
  if (mapped.clearTokens) {
    await deleteCredential(env, "google_oauth_tokens");
    invalidateGoogleTokenCache();
  }
  const health = { ok: false, detail: mapped.human, secondary: raw };
  return json({
    ok: false,
    detail: mapped.human,
    detail_secondary: raw,
    status: mapped.status,
    status_detail: mapped.human,
    health,
  });
}

async function testConnector(env: Env, id: string): Promise<Response> {
  const pack = PACKS.find((p) => p.id === id);
  if (!pack) return json({ error: "Unknown connector." }, 404);
  const isGoogle = pack.connectionId === "google";
  if (isGoogle && (await googleConnectionState(env)).needs_sign_in) {
    return json({
      ok: false,
      detail: GOOGLE_NEEDS_SIGN_IN_DETAIL,
      status: "needs_sign_in" as ConnectionStatus,
      status_detail: GOOGLE_NEEDS_SIGN_IN_DETAIL,
      needs_sign_in: true,
    });
  }
  const base = await packStatus(env, pack);
  if (base.status === "not_connected")
    return json({ ok: false, detail: "Not configured yet.", status: base.status as ConnectionStatus });
  try {
    const health = await pack.health(env);
    if (isGoogle && !health.ok) return googleTestFailure(env, health.detail);
    const status: ConnectionStatus = !health.ok ? "error" : base.credentialsPresent ? "connected" : "available";
    return json({ ...health, status, status_detail: health.detail, health });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (isGoogle) return googleTestFailure(env, detail);
    return json({ ok: false, detail, status: "error" as ConnectionStatus, status_detail: detail });
  }
}

async function saveGoogleOAuthClient(env: Env, body: Record<string, unknown>): Promise<Response | null> {
  const reqClientId = str(body.client_id).trim();
  const reqClientSecret = str(body.client_secret).trim();
  if (!reqClientId && !reqClientSecret) return null;
  const stored = await getCredential<GoogleOAuthClient>(env, "google_oauth_client");
  const merged: GoogleOAuthClient = {
    client_id: reqClientId || (stored?.client_id ?? "").trim(),
    client_secret: reqClientSecret || stored?.client_secret || "",
  };
  if (!merged.client_id || !merged.client_secret) {
    return json({ error: "Provide both the Google OAuth client ID and client secret." }, 400);
  }
  if (stored?.client_id && stored.client_id !== merged.client_id) {
    await deleteCredential(env, "google_oauth_tokens");
  }
  await putCredential(env, "google_oauth_client", merged);
  invalidateGoogleTokenCache();
  const tokens = await getCredential<GoogleOAuthTokens>(env, "google_oauth_tokens");
  return json({
    ok: true,
    saved: "oauth_client",
    client_id_masked: maskGoogleClientId(merged.client_id),
    needs_sign_in: !tokens?.refresh_token,
  });
}

async function saveGoogleServiceAccount(env: Env, body: Record<string, unknown>): Promise<Response | null> {
  if (!str(body.service_account_json)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(str(body.service_account_json));
  } catch {
    return json({ error: "Service account JSON did not parse." }, 400);
  }
  if (!isRecord(parsed) || !str(parsed.client_email) || !str(parsed.private_key)) {
    return json({ error: "Service account JSON needs client_email and private_key." }, 400);
  }
  await putCredential(env, "google_service_account", {
    client_email: str(parsed.client_email),
    private_key: str(parsed.private_key),
  });
  invalidateGoogleTokenCache();
  return json({ ok: true, saved: "service_account", service_account_email: str(parsed.client_email) });
}

async function configureGoogleConnector(env: Env, body: Record<string, unknown>): Promise<Response> {
  const saved = (await saveGoogleOAuthClient(env, body)) ?? (await saveGoogleServiceAccount(env, body));
  return saved ?? json({ error: "Provide client_id + client_secret, or service_account_json." }, 400);
}

async function configureConnector(env: Env, id: string, body: Record<string, unknown>): Promise<Response> {
  if (id === "google-search-console" || id === "google-analytics") {
    return configureGoogleConnector(env, body);
  }
  const pack = PACKS.find((candidate) => candidate.id === id);
  if (!pack) return json({ error: "Unknown connector." }, 404);
  const key = str(body.api_key).trim();
  if (!key) return json({ error: "Enter an API key before saving." }, 400);
  await putCredential(env, pack.connectionId, { api_key: key });
  return json({ ok: true, saved: "api_key" });
}

async function disconnectConnector(env: Env, id: string): Promise<Response> {
  if (id === "google-search-console" || id === "google-analytics") {
    await deleteCredential(env, "google_oauth_tokens");
    await deleteCredential(env, "google_service_account");
    await deleteCredential(env, "google_oauth_client");
    invalidateGoogleTokenCache();
  } else if (id === "indexnow") {
    await disconnectIndexNow(env);
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
  if (path === "/api/login" && req.method === "POST") return login(req, env);
  if (path === "/api/feedback" && req.method === "POST") return handleFeedback(req, env);
  const identity = await resolveIdentity(req, env);
  if (!identity) return json({ error: "Sign in with Access or your setup token." }, 401);
  if (path === "/api/me" && req.method === "GET") {
    const theme = await getTheme(env, identity.key);
    return json({ email: identity.email, identity: identity.identity, preferences: { theme } });
  }
  if (path === "/api/preferences" && req.method === "PUT") return updatePreferences(req, env, identity);
  return routeAdmin(req, env, ctx, path, url);
}

async function login(req: Request, env: Env): Promise<Response> {
  const body = await readObject(req);
  if (body instanceof Response) return body;
  if (!env.SETUP_TOKEN || !timingSafeEqual(str(body.token), env.SETUP_TOKEN)) {
    return json({ error: "That setup token did not match." }, 401);
  }
  const value = await sessionCookieValue(env);
  return json({ ok: true }, 200, {
    "set-cookie": `ew_setup=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
  });
}

async function routeAdmin(req: Request, env: Env, ctx: ExecutionContext, path: string, url: URL): Promise<Response> {
  if ((path === "/api/status" || path === "/api/dashboard") && req.method === "GET") return json(await statusBody(env));
  if (path === "/api/logout" && req.method === "POST") return logout();
  if (path.startsWith("/api/reports/") && req.method === "POST") return runReport(req, env, path.slice("/api/reports/".length));
  const google = await routeGoogleAdmin(req, env, ctx, path, url);
  if (google) return google;
  if (path === "/api/metrics" && req.method === "GET") return json(await metrics(env));
  const connector = await routeConnectors(req, env, ctx, path);
  if (connector) return connector;
  const tokens = await routeTokens(req, env, ctx, path);
  if (tokens) return tokens;
  return json({ error: "Not found." }, 404);
}

async function runReport(req: Request, env: Env, name: string): Promise<Response> {
  const tools = await liveToolsFor(env);
  const tool = tools.find((t) => t.name === name && !t.write);
  if (!tool) return json({ error: "Connect this provider to run its reports." }, 404);
  const args = await req.json().catch(() => null);
  if (!isRecord(args)) return json({ error: "Report inputs must be an object." }, 400);
  try {
    const result = await tool.handler({ env, tokenId: "dashboard", scope: "read" }, args);
    return json({ result });
  } catch (error) {
    return json({ error: error instanceof OpError ? error.message : "The report could not be completed. Test the connection and try again." }, 400);
  }
}

async function routeGoogleAdmin(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
  url: URL,
): Promise<Response | null> {
  if (path === "/api/google/oauth-url" && req.method === "GET") return url.searchParams.has("preview") ? json({ redirect_uri: googleRedirectUri(env, url.origin) }) : oauthUrl(env, url);
  if (path === "/api/google/oauth-client" && req.method === "DELETE") {
    await deleteCredential(env, "google_oauth_client");
    await deleteCredential(env, "google_oauth_tokens");
    invalidateGoogleTokenCache();
    if (ctx) audit(ctx, env, "setup-ui", "google.oauth_client.clear", "google");
    return json({ ok: true });
  }
  if (path === "/api/google/service-account" && req.method === "DELETE") {
    await deleteCredential(env, "google_service_account");
    invalidateGoogleTokenCache();
    if (ctx) audit(ctx, env, "setup-ui", "google.service_account.clear", "google");
    return json({ ok: true });
  }
  return null;
}

async function updatePreferences(req: Request, env: Env, identity: Identity): Promise<Response> {
  const body = await readObject(req);
  if (body instanceof Response) return body;
  const theme = body.theme;
  if (!isTheme(theme)) return json({ error: "theme must be one of: light, dark, system." }, 400);
  await setTheme(env, identity.key, theme);
  return json({ ok: true, preferences: { theme } });
}

function logout(): Response {
  return json({ ok: true }, 200, {
    "set-cookie": "ew_setup=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  });
}

export async function handleSetupAgentDoc(req: Request, env: Env): Promise<Response> {
  if (!(await resolveIdentity(req, env))) {
    return new Response("Setup access required. Sign in through Cloudflare Access or enter the setup token.", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const origin = (env.PUBLIC_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  return new Response(new URL(req.url).searchParams.get("auth") !== "token" && env.ACCESS_MCP_AUD && env.ACCESS_TEAM_DOMAIN
    ? `# Connect your agent

Add ${origin}/mcp as a remote HTTP MCP server. Sign in with Cloudflare Access when prompted. Use search_tools to discover available operations and execute to run a report. Access sign-ins have read access to all connected properties.
`
    : setupAgentDoc(origin), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

function setupAgentDoc(origin: string): string {
  return `# Edge Webmaster agent setup

Add a remote HTTP MCP server at ${origin}/mcp/token.
Set the Authorization header from the token created in Agent access:

    Authorization: Bearer <YOUR_TOKEN>

Use search_tools to find operations available to your token. Each tool description lists any property restrictions.
Use execute to run a JavaScript report with the available provider proxies.
For example, ask your agent to review search performance for your property over the last 28 days.
A read token can run reports. A write token can also submit a sitemap if the selected property and upstream account permit it.
If sign-in fails, check the token or create a replacement at ${origin}/tokens.
`;
}

async function oauthUrl(env: Env, url: URL): Promise<Response> {
  const state = randomToken("st_");
  try {
    const authorizationUrl = await googleAuthUrl(env, url.origin, state);
    const now = nowSec();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM settings WHERE key GLOB 'oauth_state:*' AND updated_at < ?1").bind(now - 900),
      env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)").bind(`oauth_state:${state}`, state, now),
    ]);
    return json({ url: authorizationUrl, redirect_uri: googleRedirectUri(env, url.origin) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}

async function routeConnectors(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response | null> {
  if (req.method === "POST" && ["/api/connectors/indexnow/configure", "/api/connectors/indexnow/submit"].includes(path)) {
    const body = await readObject(req);
    if (body instanceof Response) return body;
    try {
      const submit = path.endsWith("/submit");
      const result = await (submit ? submitIndexNow : configureIndexNow)(env, body);
      audit(ctx, env, "setup-ui", submit ? "indexnow.submit" : "connector.configure", "indexnow");
      return json(result);
    } catch (error) { return json({ error: error instanceof OpError ? error.message : "IndexNow request failed. Try again." }, 400); }
  }
  const action = path.match(/^\/api\/connectors\/([a-z-]+)\/(configure|test)$/);
  if (action && req.method === "POST") {
    if (action[2] === "test") return testConnector(env, action[1] ?? "");
    const body = await readObject(req);
    if (body instanceof Response) return body;
    const res = await configureConnector(env, action[1] ?? "", body);
    if (res.ok) audit(ctx, env, "setup-ui", "connector.configure", action[1] ?? "");
    return res;
  }
  const disconnect = path.match(/^\/api\/connectors\/([a-z-]+)$/);
  if (disconnect && req.method === "DELETE") {
    const res = await disconnectConnector(env, disconnect[1] ?? "");
    if (res.ok) audit(ctx, env, "setup-ui", "connector.disconnect", disconnect[1] ?? "");
    return res;
  }
  return null;
}

async function routeTokens(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response | null> {
  if (path === "/api/tokens" && req.method === "GET") return json({ tokens: await listAgentTokens(env) });
  if (path === "/api/tokens" && req.method === "POST") {
    const body = await readObject(req);
    if (body instanceof Response) return body;
    const name = str(body.name) || "agent";
    const scope = str(body.scope) === "write" ? "write" : "read";
    const grants = body.grants ?? null;
    if (grants !== null && !validGrants(grants)) return json({ error: "Check the connector selection and property identifiers." }, 400);
    const created = await createAgentToken(env, name, scope, grants);
    audit(ctx, env, "setup-ui", "token.create", `${name}:${scope}`);
    return json({ token: created.token, record: created.record });
  }
  const match = path.match(/^\/api\/tokens\/([A-Za-z0-9_-]+)$/);
  if (match && req.method === "DELETE") {
    await revokeAgentToken(env, match[1] ?? "");
    audit(ctx, env, "setup-ui", "token.revoke", match[1] ?? "");
    return json({ ok: true });
  }
  return null;
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
  const body = await readObject(req);
  if (body instanceof Response) return body;
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
  const claimed = await env.DB.prepare(
    "DELETE FROM settings WHERE key IN (?1, 'oauth_state') AND value = ?2 AND updated_at >= ?3 RETURNING key",
  ).bind(`oauth_state:${state}`, state, nowSec() - 900).first();
  if (!claimed) {
    return new Response("OAuth state mismatch or expired. Return to setup and try again.", { status: 400 });
  }
  const { exchangeGoogleCode } = await import("./google");
  try {
    await exchangeGoogleCode(env, url.origin, code);
  } catch (e) {
    return new Response(`Google sign-in failed: ${e instanceof OpError ? e.message : "unknown error"}`, { status: 400 });
  }
  return new Response(null, {
    status: 302,
    headers: { location: "/connections/google-search-console?connected=google" },
  });
}
