import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../src/api";
import { deleteCredential, getCredential, putCredential } from "../src/creds";
import {
  googleAccessToken,
  googleConnectionState,
  invalidateGoogleTokenCache,
  maskGoogleClientId,
  type GoogleOAuthClient,
  type GoogleOAuthTokens,
  type GoogleServiceAccount,
} from "../src/google";
import type { Env } from "../src/registry";

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
        if (sql.includes("FROM agent_tokens")) return { n: 0 };
        if (sql.includes("FROM mcp_calls")) return { n: 0 };
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
  return { DB: db as unknown as D1Database, DEPLOYMENT_SECRET: "google-auth-test-secret" };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function api(env: Env, path: string, method: string, body?: unknown): Promise<Response> {
  return handleApi(
    new Request(`https://x.test${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    ctx,
    path,
  );
}

const CLIENT_A: GoogleOAuthClient = {
  client_id: "aaaa1111bbbb.apps.googleusercontent.com",
  client_secret: "secret-a",
};
const CLIENT_B: GoogleOAuthClient = {
  client_id: "zzzz2222yyyy.apps.googleusercontent.com",
  client_secret: "secret-b",
};

async function seedOAuth(env: Env, client: GoogleOAuthClient, refreshToken: string) {
  await putCredential(env, "google_oauth_client", client);
  await putCredential(env, "google_oauth_tokens", { refresh_token: refreshToken });
}

/** Token endpoint that derives the access token from the refresh_token in the request body. */
function derivedTokenFetch(counter: { calls: number }, expiresIn = 3600) {
  return async (url: string, init?: RequestInit) => {
    counter.calls += 1;
    expect(String(url)).toContain("oauth2.googleapis.com/token");
    const params = new URLSearchParams(String(init?.body ?? ""));
    return jsonResponse({ access_token: `tok-for-${params.get("refresh_token")}`, expires_in: expiresIn });
  };
}

beforeEach(() => invalidateGoogleTokenCache());
afterEach(() => {
  vi.unstubAllGlobals();
  invalidateGoogleTokenCache();
});

describe("token cache correctness", () => {
  it("serves the cached token only for the credential that minted it", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await seedOAuth(env, CLIENT_A, "rt-a");
    const counter = { calls: 0 };
    vi.stubGlobal("fetch", derivedTokenFetch(counter));

    expect(await googleAccessToken(env)).toBe("tok-for-rt-a");
    expect(await googleAccessToken(env)).toBe("tok-for-rt-a");
    expect(counter.calls).toBe(1);

    // Credentials replaced directly in storage, bypassing the API: only the
    // fingerprint check can stop A's cached token being served for B.
    await putCredential(env, "google_oauth_client", CLIENT_B);
    await putCredential(env, "google_oauth_tokens", { refresh_token: "rt-b" });
    expect(await googleAccessToken(env)).toBe("tok-for-rt-b");
    expect(counter.calls).toBe(2);
  });

  it("does not cache a token whose real lifetime is within the safety margin", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await seedOAuth(env, CLIENT_A, "rt-a");
    const counter = { calls: 0 };
    vi.stubGlobal("fetch", derivedTokenFetch(counter, 20));
    expect(await googleAccessToken(env)).toBe("tok-for-rt-a");
    expect(await googleAccessToken(env)).toBe("tok-for-rt-a");
    expect(counter.calls).toBe(2);
  });

  it("serves no stale token after the credentials are deleted", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    await seedOAuth(env, CLIENT_A, "rt-a");
    const counter = { calls: 0 };
    vi.stubGlobal("fetch", derivedTokenFetch(counter));
    expect(await googleAccessToken(env)).toBe("tok-for-rt-a");
    await deleteCredential(env, "google_oauth_tokens");
    await deleteCredential(env, "google_oauth_client");
    await expect(googleAccessToken(env)).rejects.toThrow("Google is not connected");
  });
});

describe("google connection state and masking", () => {
  it("maskGoogleClientId never returns the full ID", () => {
    expect(maskGoogleClientId("abcd1234efgh.apps.googleusercontent.com")).toBe(
      "abcd…apps.googleusercontent.com",
    );
    expect(maskGoogleClientId("abcdefghijklmnop")).toBe("abcd…mnop");
    expect(maskGoogleClientId("short")).toBe("sh…");
    expect(maskGoogleClientId("abc")).toBe("…");
  });

  it("client-only state reports needs_sign_in with a masked ID", async () => {
    const env = makeEnv(new FakeD1());
    await putCredential(env, "google_oauth_client", CLIENT_A);
    const state = await googleConnectionState(env);
    expect(state).toEqual({
      oauth_client_saved: true,
      oauth_client_id_masked: "aaaa…apps.googleusercontent.com",
      oauth_signed_in: false,
      oauth_needs_sign_in: true,
      service_account_saved: false,
      service_account_email: null,
      needs_sign_in: true,
      active_method: null,
    });
  });

  it("signed-in OAuth wins active_method; a saved service account suppresses needs_sign_in", async () => {
    const env = makeEnv(new FakeD1());
    await seedOAuth(env, CLIENT_A, "rt-a");
    await putCredential(env, "google_service_account", {
      client_email: "svc@example.iam.gserviceaccount.com",
      private_key: "unused",
    } satisfies GoogleServiceAccount);
    const state = await googleConnectionState(env);
    expect(state.oauth_signed_in).toBe(true);
    expect(state.needs_sign_in).toBe(false);
    expect(state.active_method).toBe("oauth");
    expect(state.service_account_email).toBe("svc@example.iam.gserviceaccount.com");

    const clientOnlyWithSa = makeEnv(new FakeD1());
    await putCredential(clientOnlyWithSa, "google_oauth_client", CLIENT_A);
    await putCredential(clientOnlyWithSa, "google_service_account", {
      client_email: "svc@example.iam.gserviceaccount.com",
      private_key: "unused",
    });
    const fallback = await googleConnectionState(clientOnlyWithSa);
    expect(fallback.oauth_needs_sign_in).toBe(true);
    expect(fallback.needs_sign_in).toBe(false);
    expect(fallback.active_method).toBe("service_account");
  });
});

describe("OAuth client save integrity", () => {
  const configure = (env: Env, body: unknown) =>
    api(env, "/api/connectors/google-search-console/configure", "POST", body);

  it("partial save with nothing stored is a 400 and stores nothing", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    const res = await configure(env, { client_id: CLIENT_A.client_id });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Provide both the Google OAuth client ID and client secret.",
    );
    expect(await getCredential(env, "google_oauth_client")).toBeNull();
  });

  it("full save stores the pair and returns the masked ID + needs_sign_in", async () => {
    const env = makeEnv(new FakeD1());
    const res = await configure(env, { client_id: ` ${CLIENT_A.client_id} `, client_secret: " secret-a " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: true,
      saved: "oauth_client",
      client_id_masked: "aaaa…apps.googleusercontent.com",
      needs_sign_in: true,
    });
    expect(await getCredential<GoogleOAuthClient>(env, "google_oauth_client")).toEqual(CLIENT_A);
  });

  it("secret-only save preserves the stored client ID", async () => {
    const env = makeEnv(new FakeD1());
    await putCredential(env, "google_oauth_client", CLIENT_A);
    const res = await configure(env, { client_secret: "rotated-secret" });
    expect(res.status).toBe(200);
    expect(await getCredential<GoogleOAuthClient>(env, "google_oauth_client")).toEqual({
      client_id: CLIENT_A.client_id,
      client_secret: "rotated-secret",
    });
  });

  it("changing the client ID deletes the stored OAuth tokens", async () => {
    const env = makeEnv(new FakeD1());
    await seedOAuth(env, CLIENT_A, "rt-a");
    const res = await configure(env, { client_id: CLIENT_B.client_id });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { needs_sign_in: boolean }).needs_sign_in).toBe(true);
    expect(await getCredential<GoogleOAuthTokens>(env, "google_oauth_tokens")).toBeNull();
    expect(await getCredential<GoogleOAuthClient>(env, "google_oauth_client")).toEqual({
      client_id: CLIENT_B.client_id,
      client_secret: CLIENT_A.client_secret,
    });
  });

  it("service-account save returns the email and invalidates state", async () => {
    const env = makeEnv(new FakeD1());
    const res = await configure(env, {
      service_account_json: JSON.stringify({
        client_email: "svc@example.iam.gserviceaccount.com",
        private_key: "key",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      saved: "service_account",
      service_account_email: "svc@example.iam.gserviceaccount.com",
    });
  });
});

describe("clear endpoints", () => {
  it("DELETE /api/google/oauth-client removes client and tokens, keeping the service account", async () => {
    const env = makeEnv(new FakeD1());
    await seedOAuth(env, CLIENT_A, "rt-a");
    await putCredential(env, "google_service_account", { client_email: "svc@x", private_key: "k" });
    const res = await api(env, "/api/google/oauth-client", "DELETE");
    expect(res.status).toBe(200);
    expect(await getCredential(env, "google_oauth_client")).toBeNull();
    expect(await getCredential(env, "google_oauth_tokens")).toBeNull();
    expect(await getCredential(env, "google_service_account")).not.toBeNull();
  });

  it("DELETE /api/google/service-account removes only the service account", async () => {
    const env = makeEnv(new FakeD1());
    await seedOAuth(env, CLIENT_A, "rt-a");
    await putCredential(env, "google_service_account", { client_email: "svc@x", private_key: "k" });
    const res = await api(env, "/api/google/service-account", "DELETE");
    expect(res.status).toBe(200);
    expect(await getCredential(env, "google_service_account")).toBeNull();
    expect(await getCredential(env, "google_oauth_tokens")).not.toBeNull();
  });
});

describe("test endpoint gating and human errors", () => {
  const testGsc = (env: Env) => api(env, "/api/connectors/google-search-console/test", "POST", {});

  it("client-only state returns sign-in guidance and never calls Google", async () => {
    const env = makeEnv(new FakeD1());
    await putCredential(env, "google_oauth_client", CLIENT_A);
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      throw new Error("fetch must not be called");
    });
    const res = await testGsc(env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.status).toBe("needs_sign_in");
    expect(body.needs_sign_in).toBe(true);
    expect(body.detail).toBe("Client saved — click Sign in with Google to finish connecting");
    expect(body.status_detail).toBe(body.detail);
    expect(calls).toBe(0);
  });

  it("a Google API 401 clears the stored tokens and returns the human message", async () => {
    const env = makeEnv(new FakeD1());
    await seedOAuth(env, CLIENT_A, "rt-a");
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "ya29.test", expires_in: 3600 });
      }
      return jsonResponse(
        { error: { message: "Request had invalid authentication credentials. Expected OAuth 2 access token." } },
        401,
      );
    });
    const res = await testGsc(env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.status).toBe("needs_sign_in");
    expect(body.detail).toBe("Google rejected the stored sign-in token. Click Sign in with Google again to reconnect.");
    expect(String(body.detail_secondary)).toContain("Google API 401");
    expect((body.health as { secondary: string }).secondary).toContain("Google API 401");
    expect(await getCredential(env, "google_oauth_tokens")).toBeNull();
  });

  it("a refresh invalid_grant clears the stored tokens the same way", async () => {
    const env = makeEnv(new FakeD1());
    await seedOAuth(env, CLIENT_A, "rt-dead");
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400),
    );
    const res = await testGsc(env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("needs_sign_in");
    expect(body.detail).toBe("Google rejected the stored sign-in token. Click Sign in with Google again to reconnect.");
    expect(String(body.detail_secondary)).toContain("invalid_grant");
    expect(await getCredential(env, "google_oauth_tokens")).toBeNull();
  });

  it("a refresh invalid_client keeps the tokens and points at the saved client", async () => {
    const env = makeEnv(new FakeD1());
    await seedOAuth(env, CLIENT_A, "rt-a");
    vi.stubGlobal("fetch", async () => jsonResponse({ error: "invalid_client" }, 401));
    const res = await testGsc(env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("error");
    expect(body.detail).toBe(
      "Google rejected the OAuth client ID or secret. Replace the saved client, then click Sign in with Google again.",
    );
    expect(await getCredential(env, "google_oauth_tokens")).not.toBeNull();
  });
});

describe("/api/status Google state", () => {
  it("client-only Google packs report needs_sign_in with the safe connection state attached", async () => {
    const env = makeEnv(new FakeD1());
    await putCredential(env, "google_oauth_client", CLIENT_A);
    const res = await api(env, "/api/status", "GET");
    const body = (await res.json()) as { connectors: Record<string, unknown>[] };
    const byId = Object.fromEntries(body.connectors.map((c) => [c.id, c]));
    for (const id of ["google-search-console", "google-analytics"]) {
      expect(byId[id]?.status).toBe("needs_sign_in");
      expect(byId[id]?.status_detail).toBe("Client saved — click Sign in with Google to finish connecting");
      expect(byId[id]?.configured).toBe(true);
      expect(byId[id]?.health).toBeNull();
      const conn = byId[id]?.google_connection as Record<string, unknown>;
      expect(conn.oauth_client_id_masked).toBe("aaaa…apps.googleusercontent.com");
      expect(conn.needs_sign_in).toBe(true);
      expect(JSON.stringify(conn)).not.toContain(CLIENT_A.client_id);
      expect(JSON.stringify(conn)).not.toContain(CLIENT_A.client_secret);
    }
    expect(byId["bing-webmaster"]?.google_connection).toBeUndefined();
  });

  it("a health 401 maps status_detail to the human message and keeps the raw text secondary", async () => {
    const env = makeEnv(new FakeD1());
    await seedOAuth(env, CLIENT_A, "rt-a");
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "ya29.test", expires_in: 3600 });
      }
      return jsonResponse({ error: { message: "Request had invalid authentication credentials." } }, 401);
    });
    const res = await api(env, "/api/status", "GET");
    const body = (await res.json()) as { connectors: Record<string, unknown>[] };
    const gsc = body.connectors.find((c) => c.id === "google-search-console");
    expect(gsc?.status).toBe("error");
    expect(gsc?.status_detail).toBe(
      "Google rejected the stored sign-in token. Click Sign in with Google again to reconnect.",
    );
    const health = gsc?.health as { detail: string; secondary: string };
    expect(health.detail).toBe(gsc?.status_detail);
    expect(health.secondary).toContain("Google API 401");
  });
});
