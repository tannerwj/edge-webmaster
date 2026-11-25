import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "../src/creds";
import { searchTools, toolDeclarations, toolForProxy, type ToolDef } from "../src/registry";
import { planPages } from "../src/packs/gsc";
import { b64url, b64urlToBytes, pemToBytes, sha256Hex, timingSafeEqual } from "../src/util";

const tool = (name: string, namespace: string, description: string): ToolDef => ({
  name,
  namespace,
  description,
  inputSchema: { type: "object", properties: {} },
  write: false,
  handler: async () => null,
});

describe("planPages bounds GSC pagination", () => {
  it("plans 25k pages up to the requested limit", () => {
    expect(planPages(1)).toEqual([0]);
    expect(planPages(25_000)).toEqual([0]);
    expect(planPages(26_000)).toEqual([0, 25_000]);
    expect(planPages(50_000)).toEqual([0, 25_000]);
  });
});

describe("searchTools ranks the live catalog", () => {
  const tools = [
    tool("gsc_list_sitemaps", "gsc", "List submitted sitemaps"),
    tool("pagespeed_run", "pagespeed", "Run PageSpeed Insights for a URL"),
    tool("bing_get_query_stats", "bing", "Top search queries on Bing"),
  ];
  it("finds by keyword across name and description", () => {
    expect(searchTools(tools, "sitemap").map((t) => t.name)).toEqual(["gsc_list_sitemaps"]);
    expect(searchTools(tools, "search queries").map((t) => t.name)).toEqual(["bing_get_query_stats"]);
  });
  it("returns nothing for unrelated terms", () => {
    expect(searchTools(tools, "kubernetes")).toEqual([]);
  });
});

describe("proxy mapping", () => {
  const tools = [tool("gsc_inspect_url", "gsc", "Inspect")];
  it("maps namespace.method to the full tool name", () => {
    expect(toolForProxy(tools, "gsc", "inspect_url")?.name).toBe("gsc_inspect_url");
    expect(toolForProxy(tools, "gsc", "nope")).toBeUndefined();
  });
  it("declares typed namespaces for configured tools only", () => {
    const decls = toolDeclarations(tools);
    expect(decls).toContain("declare const gsc");
    expect(decls).toContain("inspect_url(args:");
    expect(decls).not.toContain("bing");
  });
});

describe("credential sealing", () => {
  it("round-trips and never contains the plaintext", async () => {
    const env = { DEPLOYMENT_SECRET: "test-secret-for-unit-tests" };
    const sealed = await sealSecret(env, JSON.stringify({ api_key: "super-secret-value" }));
    expect(sealed).not.toContain("super-secret-value");
    expect(await openSecret(env, sealed)).toContain("super-secret-value");
  });
  it("fails to open under a different secret", async () => {
    const sealed = await sealSecret({ DEPLOYMENT_SECRET: "one" }, "x");
    await expect(openSecret({ DEPLOYMENT_SECRET: "two" }, sealed)).rejects.toThrow();
  });
});

describe("encoding helpers", () => {
  it("sha256 matches the known vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("base64url and PEM decoding round-trip", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);
    expect(b64urlToBytes(b64url(bytes))).toEqual(bytes);
    const pem = "-----BEGIN KEY-----\nAAEC+vv8\n-----END KEY-----";
    expect(pemToBytes(pem)).toEqual(bytes);
  });
  it("timingSafeEqual distinguishes equal and different strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
