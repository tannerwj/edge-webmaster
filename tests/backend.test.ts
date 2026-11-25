import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

import { putCredential } from "../src/creds";
import { UI_HTML } from "../src/frontend.gen";
import worker from "../src/index";
import type { Env } from "../src/registry";
import { nowSec } from "../src/util";

class FakeD1 {
  settings = new Map<string, { value: string; updatedAt: number }>();
  prefs = new Map<string, string>();
  prepare(sql: string) {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => {
        args = a;
        return stmt;
      },
      first: async () => {
        if (sql.includes("FROM settings")) {
          const key = sql.includes("oauth_state") ? "oauth_state" : String(args[0]);
          const row = this.settings.get(key);
          return row === undefined ? null : { value: row.value, updated_at: row.updatedAt };
        }
        if (sql.includes("FROM user_preferences")) {
          const theme = this.prefs.get(String(args[0]));
          return theme === undefined ? null : { theme };
        }
        if (sql.includes("FROM agent_tokens")) return { n: 0 };
        if (sql.includes("FROM mcp_calls")) return { n: 0 };
        return null;
      },
      run: async () => {
        if (sql.includes("INSERT INTO settings")) {
          if (sql.includes("oauth_state")) {
            this.settings.set("oauth_state", { value: String(args[0]), updatedAt: Number(args[1]) });
          } else {
            this.settings.set(String(args[0]), { value: String(args[1]), updatedAt: Number(args[2]) });
          }
        }
        if (sql.includes("DELETE FROM settings")) {
          this.settings.delete(sql.includes("oauth_state") ? "oauth_state" : String(args[0]));
        }
        if (sql.includes("INSERT INTO user_preferences")) this.prefs.set(String(args[0]), String(args[1]));
        return { meta: { last_row_id: 1 } };
      },
      all: async () => ({ results: [] }),
    };
    return stmt;
  }
}

const SETUP_TOKEN = "test-setup-token-value";
const issuer = "https://example.cloudflareaccess.com";
const pair = await generateKeyPair("RS256");
const publicKey = { ...await exportJWK(pair.publicKey), kid: "fixture" };
async function signedHeaders(aud = "dashboard") {
  const assertion = await new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer(issuer)
    .setSubject("owner").setAudience(aud).setExpirationTime("10m").sign(pair.privateKey);
  vi.stubGlobal("fetch", async () => Response.json({ keys: [publicKey] }));
  return { "cf-access-jwt-assertion": assertion };
}

function makeEnv(db: FakeD1, over: Partial<Env> = {}): Env {
  return { DB: db as unknown as D1Database, DEPLOYMENT_SECRET: "backend-test-secret", ACCESS_TEAM_DOMAIN: issuer, ACCESS_ADMIN_AUD: "dashboard", ...over };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://x.test${path}`, init), env, ctx);
}

function jsonInit(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

async function loginCookie(env: Env): Promise<string> {
  const res = await call(env, "/api/login", jsonInit("POST", { token: SETUP_TOKEN }));
  expect(res.status).toBe(200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  expect(cookie.startsWith("ew_setup=")).toBe(true);
  return cookie;
}

afterEach(() => vi.unstubAllGlobals());

describe("SPA fallback routing", () => {
  const env = () => makeEnv(new FakeD1());

  it("serves the app shell for / and deep client routes", async () => {
    for (const path of ["/", "/connections/google-search-console", "/tokens", "/connections/google-search-console?connected=google"]) {
      const res = await call(env(), path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toBe(UI_HTML);
    }
  });

  it("serves the shell for HEAD deep paths and keeps security headers", async () => {
    const res = await call(env(), "/settings/profile", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("keeps unknown /api paths as JSON 404, not the shell", async () => {
    const res = await call(env(), "/api/does-not-exist", { headers: await signedHeaders() });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Not found." });
  });

  it("leaves /health as JSON", async () => {
    const res = await call(env(), "/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe("edge-webmaster");
  });

  it("404s static-looking asset paths and non-GET unknown paths", async () => {
    for (const path of ["/favicon.ico", "/assets/main.js", "/robots.txt", "/styles.css"]) {
      const res = await call(env(), path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).not.toContain("text/html");
    }
    const post = await call(env(), "/connections/anything", { method: "POST" });
    expect(post.status).toBe(404);
  });
});

describe("/api/me, preferences and logout", () => {
  it("separates agent and administrator identities", async () => {
    const env = makeEnv(new FakeD1(), { ACCESS_MCP_AUD: "agents" });
    const headers = await signedHeaders("agents");
    expect((await call(env, "/api/me", { headers })).status).toBe(401);
    const rpc = jsonInit("POST", { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers);
    expect((await call(env, "/mcp", rpc)).status).toBe(200);
    expect((await call(env, "/api/me", { headers: { "cf-access-authenticated-user-email": "owner@example.com" } })).status).toBe(401);
  });

  it("reports the Access identity and defaults theme to system", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN });
    const res = await call(env, "/api/me", { headers: await signedHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: "owner@example.com",
      identity: "access",
      preferences: { theme: "system" },
    });
  });

  it("reports the setup-token identity after login, and locks setup before configuration", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN });
    const cookie = await loginCookie(env);
    const res = await call(env, "/api/me", { headers: { cookie } });
    expect(await res.json()).toEqual({ email: null, identity: "setup-token", preferences: { theme: "system" } });

    const open = await call(makeEnv(new FakeD1()), "/api/me");
    expect(open.status).toBe(401);
  });

  it("gates /api/me when unauthenticated", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN });
    const res = await call(env, "/api/me");
    expect(res.status).toBe(401);
  });

  it("round-trips a theme per identity and rejects invalid themes", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN });
    const put = await call(env, "/api/preferences", jsonInit("PUT", { theme: "dark" }, await signedHeaders()));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true, preferences: { theme: "dark" } });
    const me = await call(env, "/api/me", { headers: await signedHeaders() });
    expect(((await me.json()) as { preferences: { theme: string } }).preferences.theme).toBe("dark");

    const cookie = await loginCookie(env);
    const other = await call(env, "/api/me", { headers: { cookie } });
    expect(((await other.json()) as { preferences: { theme: string } }).preferences.theme).toBe("system");

    const bad = await call(env, "/api/preferences", jsonInit("PUT", { theme: "neon" }, await signedHeaders()));
    expect(bad.status).toBe(400);
    const missing = await call(env, "/api/preferences", jsonInit("PUT", {}, await signedHeaders()));
    expect(missing.status).toBe(400);
  });

  it("logout clears the ew_setup cookie", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN });
    const res = await call(env, "/api/logout", { method: "POST", headers: await signedHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ew_setup=;");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Path=/");
  });
});

describe("/setup-agent.md", () => {
  it("401s as plain text when unauthenticated", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN });
    const res = await call(env, "/setup-agent.md");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("serves a self-config doc with the request origin and no real token", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN });
    const res = await call(env, "/setup-agent.md", { headers: await signedHeaders() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("https://x.test/mcp");
    expect(body).toContain("Authorization: Bearer <YOUR_TOKEN>");
    expect(body).toContain("search_tools");
    expect(body).toContain("execute");
    expect(body).not.toContain(SETUP_TOKEN);
  });

  it("prefers PUBLIC_URL for the instance origin", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN, PUBLIC_URL: "https://webmaster.example.com" });
    const res = await call(env, "/setup-agent.md", { headers: await signedHeaders() });
    expect(await res.text()).toContain("https://webmaster.example.com/mcp");
  });
});

describe("dashboard reports", () => {
  it("returns a mobile score using the configured pack and keeps write tools off the report route", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN });
    const cookie = await loginCookie(env);
    vi.stubGlobal("fetch", async (url: string) => {
      expect(new URL(url).searchParams.get("url")).toBe("https://example.com/");
      return Response.json({ lighthouseResult: { categories: { performance: { score: 0.93 } } } });
    });
    const input = jsonInit("POST", { url: "https://example.com/", strategy: "mobile" }, { cookie });
    const res = await call(env, "/api/reports/pagespeed_run", input);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: { result: { score: 0.93 } } });
    expect((await call(env, "/api/reports/gsc_submit_sitemap", input)).status).toBe(404);
  });
});

describe("google callback redirect", () => {
  it("redirects to the path-routed connections page after a successful exchange", async () => {
    const db = new FakeD1();
    const env = makeEnv(db, { SETUP_TOKEN });
    await putCredential(env, "google_oauth_client", { client_id: "cid", client_secret: "sec" });
    db.settings.set("oauth_state", { value: "st_test", updatedAt: nowSec() });
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ refresh_token: "rt", access_token: "at", expires_in: 3600 }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await call(env, "/auth/google/callback?code=abc&state=st_test");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/connections/google-search-console?connected=google");
  });
});

describe("IndexNow ownership and URL submissions", () => {
  it("verifies the root key before saving and rejects cross-origin batches before notifying IndexNow", async () => {
    const env = makeEnv(new FakeD1(), { SETUP_TOKEN });
    const cookie = await loginCookie(env);
    const key = "abcd1234";
    const site = "https://www.example.com/";
    const request = (action: string, body: unknown) =>
      call(env, "/api/connectors/indexnow/" + action, jsonInit("POST", body, { cookie }));
    const upstream = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === site + "wrongkey.txt") return new Response("incorrect contents");
      if (url === site + key + ".txt") return new Response(key);
      expect(url).toBe("https://api.indexnow.org/indexnow");
      expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toEqual({ host: "www.example.com", key, urlList: [site + "changed"] });
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", upstream);
    expect((await request("configure", { site_url: site, api_key: "wrongkey" })).status).toBe(400);
    expect((await request("configure", { site_url: site, api_key: key })).status).toBe(200);
    upstream.mockClear();
    expect((await request("submit", { site_url: site, urls: [site + "ok", "https://example.org/"] })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    const result = await request("submit", { site_url: site, urls: [site + "changed"] });
    expect(await result.json()).toMatchObject({ status: 202, submitted: 1 });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
