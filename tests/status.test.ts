import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../src/api";
import { putCredential } from "../src/creds";
import { bingPack } from "../src/packs/bing";
import { ga4Pack } from "../src/packs/ga4";
import { gscPack } from "../src/packs/gsc";
import { pagespeedPack } from "../src/packs/pagespeed";
import {
  liveTools,
  packStatus,
  packStatuses,
  type ConnectorPack,
  type Env,
} from "../src/registry";

class FakeD1 {
  settings = new Map<string, string>();
  tokenCount = 0;
  callCount = 0;
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
        if (sql.includes("FROM agent_tokens")) return { n: this.tokenCount };
        if (sql.includes("FROM mcp_calls")) return { n: this.callCount };
        return null;
      },
      run: async () => {
        if (sql.includes("INSERT INTO settings")) this.settings.set(String(args[0]), String(args[1]));
        if (sql.includes("DELETE FROM settings")) this.settings.delete(String(args[0]));
        return { meta: { last_row_id: 1 } };
      },
      all: async () => ({ results: [] }),
    };
    return stmt;
  }
}

function makeEnv(db: FakeD1): Env {
  return { DB: db as unknown as D1Database, DEPLOYMENT_SECRET: "status-test-secret" };
}

function fakePack(over: Partial<ConnectorPack>): ConnectorPack {
  return {
    id: "fake",
    name: "Fake",
    namespace: "fake",
    authType: "api-key",
    blurb: "Fake pack.",
    provider: "Fake",
    connectionId: "bing",
    setupKind: "api-key",
    authLabel: "API key",
    access: "Read-only",
    examples: ["Do a thing"],
    recommendation: "Try it",
    setupFields: [],
    credentialsPresent: async () => false,
    configured: async () => false,
    health: async () => ({ ok: true, detail: "healthy", count: 2 }),
    tools: [],
    ...over,
  };
}

const creds = (present: boolean) => async () => present;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("shared status transitions (fake packs)", () => {
  it("available pack: fresh=available, key unverified=configured, pass=connected, fail=error", async () => {
    const env = makeEnv(new FakeD1());
    const base = fakePack({ availableWithoutSetup: true });
    expect((await packStatus(env, base)).status).toBe("available");
    const withKey = fakePack({ availableWithoutSetup: true, credentialsPresent: creds(true) });
    expect((await packStatus(env, withKey)).status).toBe("configured");
    expect((await packStatus(env, withKey, { checkHealth: true })).status).toBe("connected");
    const failing = fakePack({
      availableWithoutSetup: true,
      credentialsPresent: creds(true),
      health: async () => ({ ok: false, detail: "bad key" }),
    });
    const failed = await packStatus(env, failing, { checkHealth: true });
    expect(failed.status).toBe("error");
    expect(failed.statusDetail).toContain("bad key");
    expect(failed.advertise).toBe(true);
  });

  it("credential pack: no creds=not_connected, creds=configured, pass=connected, throw=error", async () => {
    const env = makeEnv(new FakeD1());
    expect((await packStatus(env, fakePack({}))).status).toBe("not_connected");
    const withCreds = fakePack({ credentialsPresent: creds(true) });
    expect((await packStatus(env, withCreds)).status).toBe("configured");
    expect((await packStatus(env, withCreds, { checkHealth: true })).status).toBe("connected");
    const throwing = fakePack({
      credentialsPresent: creds(true),
      health: async () => {
        throw new Error("upstream 401");
      },
    });
    const failed = await packStatus(env, throwing, { checkHealth: true });
    expect(failed.status).toBe("error");
    expect(failed.health?.detail).toContain("401");
  });

  it("liveTools advertises available and credential packs, not not_connected", async () => {
    const env = makeEnv(new FakeD1());
    const tool = {
      name: "fake_do",
      namespace: "fake",
      description: "Do",
      inputSchema: { type: "object", properties: {} },
      write: false,
      handler: async () => null,
    };
    const statuses = await packStatuses(env, [
      fakePack({ id: "a", availableWithoutSetup: true, tools: [tool] }),
      fakePack({ id: "b", credentialsPresent: creds(true), tools: [{ ...tool, name: "fake_do2" }] }),
      fakePack({ id: "c", tools: [{ ...tool, name: "fake_do3" }] }),
    ]);
    expect(liveTools(statuses).map((t) => t.name)).toEqual(["fake_do", "fake_do2"]);
  });
});

describe("real pack transitions", () => {
  it("pagespeed fresh is available, not connected/configured", async () => {
    const s = await packStatus(makeEnv(new FakeD1()), pagespeedPack, { checkHealth: true });
    expect(s.status).toBe("available");
    expect(s.credentialsPresent).toBe(false);
    expect(s.configured).toBe(true);
    expect(s.advertise).toBe(true);
  });

  it("pagespeed with an unverified key is configured, then connected when CrUX accepts the key", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await putCredential(env, "pagespeed", { api_key: "ps-key" });
    expect((await packStatus(env, pagespeedPack)).status).toBe("configured");
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(String(url));
      return jsonResponse({ record: { key: { origin: "https://www.google.com" }, metrics: {} } });
    });
    const checked = await packStatus(env, pagespeedPack, { checkHealth: true });
    expect(checked.status).toBe("connected");
    expect(checked.health?.detail).toBe("Optional API key verified against CrUX");
    expect(seen.some((u) => u.includes("chromeuxreport.googleapis.com/v1/records:queryRecord"))).toBe(true);
    expect(seen.some((u) => u.includes("key=ps-key"))).toBe(true);
  });

  it("pagespeed with a saved key CrUX rejects (403) resolves to error via packStatuses, not connected", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await putCredential(env, "pagespeed", { api_key: "ps-bad-key" });
    vi.stubGlobal("fetch", async () =>
      jsonResponse(
        {
          error: {
            message: "Chrome UX Report API has not been used in project 123 or it is disabled.",
            status: "PERMISSION_DENIED",
          },
        },
        403,
      ),
    );
    const [checked] = await packStatuses(env, [pagespeedPack], { checkHealth: true });
    expect(checked?.status).toBe("error");
    expect(checked?.status).not.toBe("connected");
    expect(checked?.health?.ok).toBe(false);
    expect(checked?.statusDetail).toContain("403");
  });

  it("pagespeed with a saved key is connected when CrUX answers 404 NOT_FOUND (key accepted, no record)", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await putCredential(env, "pagespeed", { api_key: "ps-key" });
    vi.stubGlobal("fetch", async () =>
      jsonResponse(
        { error: { message: "The Chrome UX Report does not have a record for this origin.", status: "NOT_FOUND" } },
        404,
      ),
    );
    const checked = await packStatus(env, pagespeedPack, { checkHealth: true });
    expect(checked.status).toBe("connected");
    expect(checked.health?.detail).toContain("verified against CrUX");
  });

  it("google and bing without credentials are not_connected", async () => {
    const env = makeEnv(new FakeD1());
    for (const pack of [gscPack, ga4Pack, bingPack]) {
      expect((await packStatus(env, pack, { checkHealth: true })).status).toBe("not_connected");
    }
  });

  it("bing with a key connects on health pass and errors on health failure", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await putCredential(env, "bing", { api_key: "bing-key" });
    vi.stubGlobal("fetch", async () => jsonResponse({ d: [{ Url: "https://example.com/" }] }));
    const ok = await packStatus(env, bingPack, { checkHealth: true });
    expect(ok.status).toBe("connected");
    expect(ok.health?.count).toBe(1);
    vi.stubGlobal("fetch", async () => jsonResponse({ error: "nope" }, 401));
    const bad = await packStatus(env, bingPack, { checkHealth: true });
    expect(bad.status).toBe("error");
    expect(bad.statusDetail).toBeTruthy();
  });

  it("google packs connect on health pass; GA4 counts nested properties", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await putCredential(env, "google_oauth_client", { client_id: "cid", client_secret: "sec" });
    await putCredential(env, "google_oauth_tokens", { refresh_token: "rt" });
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "ya29.test", expires_in: 3600 });
      }
      if (String(url).endsWith("/sites")) return jsonResponse({ siteEntry: [{}, {}] });
      if (String(url).includes("accountSummaries")) {
        return jsonResponse({
          accountSummaries: [{ propertySummaries: [{}, {}] }, { propertySummaries: [{}] }],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const gsc = await packStatus(env, gscPack, { checkHealth: true });
    expect(gsc.status).toBe("connected");
    expect(gsc.health?.count).toBe(2);
    const ga4 = await packStatus(env, ga4Pack, { checkHealth: true });
    expect(ga4.status).toBe("connected");
    expect(ga4.health?.count).toBe(3);
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "ya29.test", expires_in: 3600 });
      }
      return jsonResponse({ error: { message: "denied" } }, 403);
    });
    expect((await packStatus(env, gscPack, { checkHealth: true })).status).toBe("error");
  });
});

describe("/api/status dashboard summary", () => {
  it("reports honest fresh state and the GSC next step", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const res = await handleApi(new Request("https://x.test/api/status"), env, ctx, "/api/status");
    const body = (await res.json()) as {
      summary: Record<string, unknown>;
      connectors: Record<string, unknown>[];
    };
    expect(body.summary.connections_active).toBe(1);
    expect(body.summary.connections_total).toBe(4);
    expect(body.summary.properties_discovered).toBeNull();
    expect(body.summary.active_agent_tokens).toBe(0);
    expect(body.summary.tool_calls_last_7d).toBe(0);
    expect((body.summary.recommended_next_step as { id: string }).id).toBe("connect_gsc");
    const byId = Object.fromEntries(body.connectors.map((c) => [c.id, c]));
    expect(byId["pagespeed-crux"]?.status).toBe("available");
    expect(byId["google-search-console"]?.status).toBe("not_connected");
    expect(byId["google-search-console"]?.recommendation).toContain("Start here");
    expect(byId["pagespeed-crux"]?.recommendation).toContain("No setup");
    expect(Array.isArray(byId["bing-webmaster"]?.examples)).toBe(true);
  });
});
