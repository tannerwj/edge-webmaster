import { afterEach, describe, expect, it, vi } from "vitest";
import { putCredential } from "../src/creds";
import { bingPack } from "../src/packs/bing";
import { gscPack } from "../src/packs/gsc";
import { pagespeedPack } from "../src/packs/pagespeed";
import type { Env, ToolCtx } from "../src/registry";

// Minimal in-memory D1 stand-in covering exactly the statements the code runs:
// settings reads/writes (credentials) and response_cache reads/writes.
class FakeD1 {
  settings = new Map<string, string>();
  prepare(sql: string) {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => {
        args = a;
        return stmt;
      },
      first: async () => {
        if (sql.includes("FROM settings")) {
          const value = this.settings.get(String(args[0]));
          return value === undefined ? null : { value };
        }
        return null; // response_cache miss
      },
      run: async () => {
        if (sql.includes("INSERT INTO settings")) this.settings.set(String(args[0]), String(args[1]));
        return { meta: { last_row_id: 1 } };
      },
      all: async () => ({ results: [] }),
    };
    return stmt;
  }
}

const SECRET = { DEPLOYMENT_SECRET: "pack-test-secret" };
function makeEnv(db: FakeD1): Env {
  return { DB: db as unknown as D1Database, ...SECRET };
}
const ctxFor = (env: Env): ToolCtx => ({ env, tokenId: "tok_test", scope: "read" });

function tool(pack: { tools: { name: string }[] }, name: string) {
  const found = (pack.tools as { name: string; handler: Function }[]).find((t) => t.name === name);
  if (!found) throw new Error(`tool missing: ${name}`);
  return found;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("gsc pack against a mocked Google upstream", () => {
  it("lists sites and queries analytics with the OAuth bearer token", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await putCredential(env, "google_oauth_client", { client_id: "cid", client_secret: "sec" });
    await putCredential(env, "google_oauth_tokens", { refresh_token: "rt" });
    const seen: { url: string; auth: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization") ?? "" });
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "ya29.test", expires_in: 3600 });
      }
      if (String(url).endsWith("/sites")) {
        return jsonResponse({ siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] });
      }
      if (String(url).includes("searchAnalytics/query")) {
        const body = JSON.parse(init.body as string) as { rowLimit: number };
        expect(body.rowLimit).toBeLessThanOrEqual(25_000);
        return jsonResponse({ rows: [{ keys: ["q"], clicks: 3, impressions: 10, ctr: 0.3, position: 4 }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const sites = (await tool(gscPack, "gsc_list_sites").handler(ctxFor(env), {})) as {
      siteEntry: { siteUrl: string }[];
    };
    expect(sites.siteEntry[0]?.siteUrl).toBe("sc-domain:example.com");
    const analytics = (await tool(gscPack, "gsc_query_search_analytics").handler(ctxFor(env), {
      site_url: "sc-domain:example.com",
      dimensions: ["query"],
      row_limit: 10,
    })) as { row_count: number };
    expect(analytics.row_count).toBe(1);
    expect(seen.every((s) => !s.url.includes("oauth2") || s.auth === "")).toBe(true);
    expect(seen.some((s) => s.auth === "Bearer ya29.test")).toBe(true);
  });

  it("is not configured without any Google credential", async () => {
    const env = makeEnv(new FakeD1());
    expect(await gscPack.configured(env)).toBe(false);
  });
});

describe("bing pack against a mocked Bing upstream", () => {
  it("lists sites with the api key and reports health", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await putCredential(env, "bing", { api_key: "bing-key-123" });
    vi.stubGlobal("fetch", async (url: string) => {
      expect(String(url)).toContain("apikey=bing-key-123");
      expect(String(url)).toContain("GetUserSites");
      return jsonResponse({ d: [{ Url: "https://example.com/", IsVerified: true }] });
    });
    const sites = (await tool(bingPack, "bing_list_sites").handler(ctxFor(env), {})) as { Url: string }[];
    expect(sites[0]?.Url).toBe("https://example.com/");
    const health = await bingPack.health(env);
    expect(health.ok).toBe(true);
    expect(health.detail).toContain("1 verified");
  });
});

describe("pagespeed pack against a mocked Google upstream", () => {
  it("summarizes a run for both strategies", async () => {
    const env = makeEnv(new FakeD1());
    vi.stubGlobal("fetch", async (url: string) => {
      expect(String(url)).toContain("runPagespeed");
      return jsonResponse({
        id: "https://example.com/",
        lighthouseResult: {
          categories: { performance: { score: 0.91 } },
          audits: {
            "largest-contentful-paint": { displayValue: "1.2 s" },
            "cumulative-layout-shift": { displayValue: "0.01" },
            "interaction-to-next-paint": { displayValue: "120 ms" },
            "server-response-time": { displayValue: "0.3 s" },
          },
        },
      });
    });
    const out = (await tool(pagespeedPack, "pagespeed_run").handler(ctxFor(env), {
      url: "https://example.com/",
    })) as { mobile: { score: number; lcp: string }; desktop: { score: number } };
    expect(out.mobile.score).toBe(0.91);
    expect(out.mobile.lcp).toBe("1.2 s");
    expect(out.desktop.score).toBe(0.91);
  });

  it("health verifies a saved key against a real CrUX queryRecord call", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await putCredential(env, "pagespeed", { api_key: "ps-key-123" });
    const seen: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      seen.push({ url: String(url), body: String(init.body ?? "") });
      return jsonResponse({ record: { key: { origin: "https://www.google.com" }, metrics: {} } });
    });
    const health = await pagespeedPack.health(env);
    expect(health.ok).toBe(true);
    expect(health.detail).toBe("Optional API key verified against CrUX");
    expect(seen[0]?.url).toContain("records:queryRecord");
    expect(seen[0]?.url).toContain("key=ps-key-123");
    expect(JSON.parse(seen[0]?.body ?? "{}").origin).toBe("https://www.google.com");
  });

  it("health without a saved key reaches CrUX but does not claim a key was verified", async () => {
    const env = makeEnv(new FakeD1());
    vi.stubGlobal("fetch", async () => jsonResponse({ record: { key: {}, metrics: {} } }));
    const health = await pagespeedPack.health(env);
    expect(health.ok).toBe(true);
    expect(health.detail).not.toContain("key verified");
    expect(health.detail).toContain("no API key saved");
  });

  it("health reports a saved key CrUX rejects as not ok", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await putCredential(env, "pagespeed", { api_key: "ps-bad-key" });
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ error: { message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, 400),
    );
    const health = await pagespeedPack.health(env);
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("400");
    expect(health.detail).toContain("API key not valid");
  });
});
