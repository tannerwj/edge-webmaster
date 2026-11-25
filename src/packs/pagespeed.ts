import { getCredential } from "../creds";
import { obj, type ConnectorPack } from "../registry";
import { isRecord, OpError, str } from "../util";

interface PsCred {
  api_key?: string;
}

async function keyParam(env: Parameters<typeof getCredential>[0]): Promise<string> {
  const cred = await getCredential<PsCred>(env as never, "pagespeed");
  return cred?.api_key ? `&key=${encodeURIComponent(cred.api_key)}` : "";
}

async function runOnce(env: Parameters<typeof getCredential>[0], url: string, strategy: string) {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  const res = await fetch(
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}${await keyParam(env)}`,
  );
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as { message?: string } | undefined;
    throw new OpError(`PageSpeed ${res.status}: ${err?.message ?? "request failed"}`);
  }
  const lh = isRecord(data.lighthouseResult) ? data.lighthouseResult : {};
  const categories = isRecord(lh.categories) ? lh.categories : {};
  const audits = isRecord(lh.audits) ? lh.audits : {};
  const pick = (id: string) => {
    const audit = audits[id];
    return isRecord(audit) ? (audit.displayValue ?? audit.numericValue ?? null) : null;
  };
  const perf = categories.performance;
  return {
    strategy,
    score: isRecord(perf) ? perf.score : null,
    lcp: pick("largest-contentful-paint"),
    cls: pick("cumulative-layout-shift"),
    inp: pick("interaction-to-next-paint"),
    ttfb: pick("server-response-time"),
    final_url: data.id ?? url,
  };
}

async function cruxFetch(
  env: Parameters<typeof getCredential>[0],
  method: string,
  body: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`https://chromeuxreport.googleapis.com/v1/records:${method}?${(await keyParam(env)).slice(1)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, data };
}

function cruxError(data: Record<string, unknown>): { message: string; status: string } {
  const err = isRecord(data.error) ? data.error : {};
  return { message: str(err.message), status: str(err.status) };
}

async function crux(env: Parameters<typeof getCredential>[0], method: string, args: Record<string, unknown>) {
  const body: Record<string, unknown> = { url: str(args.url) || undefined, origin: str(args.origin) || undefined };
  if (!body.url && !body.origin) throw new OpError("url or origin is required.");
  if (method === "queryHistoryRecord") {
    body.collectionPeriodCount = 12;
    body.metrics = ["largest_contentful_paint", "cumulative_layout_shift", "interaction_to_next_paint"];
  }
  const { status, ok, data } = await cruxFetch(env, method, body);
  if (!ok) {
    throw new OpError(`CrUX ${status}: ${cruxError(data).message || "request failed (a key may be required)"}`);
  }
  return data.record ?? data;
}

// Probe origin for the health check: google.com's own origin has near-certain
// CrUX coverage (it is among the highest-traffic origins on the web), so a
// missing record there would mean an API problem, not a data gap.
const CRUX_PROBE_ORIGIN = "https://www.google.com";

async function pagespeedHealth(env: Parameters<typeof getCredential>[0]) {
  const cred = await getCredential<PsCred>(env as never, "pagespeed");
  const hasKey = Boolean(cred?.api_key);
  const { status, ok, data } = await cruxFetch(env, "queryRecord", { origin: CRUX_PROBE_ORIGIN });
  // CrUX answers a query for an origin with no field data as 404 NOT_FOUND.
  // Reaching that answer still proves the request was authenticated and the
  // API is enabled, so it counts as the key being accepted.
  const notFound = status === 404 || cruxError(data).status === "NOT_FOUND";
  if (ok || notFound) {
    return {
      ok: true,
      detail: hasKey
        ? "Optional API key verified against CrUX"
        : "Public CrUX API reachable; no API key saved to verify.",
      count: null,
    };
  }
  const message = cruxError(data).message || "request failed";
  return {
    ok: false,
    detail: hasKey
      ? `Optional API key not verified: CrUX ${status}: ${message}`
      : `No API key saved; public CrUX check failed: CrUX ${status}: ${message}`,
    count: null,
  };
}

export const pagespeedPack: ConnectorPack = {
  id: "pagespeed-crux",
  name: "PageSpeed Insights + CrUX",
  namespace: "pagespeed",
  authType: "optional-key",
  blurb: "Lab performance scores and real-user field data. Works without a key; a key raises quotas.",
  provider: "Google",
  connectionId: "pagespeed",
  setupKind: "no-setup-optional-key",
  authLabel: "No setup — optional API key",
  access: "Read-only",
  examples: [
    "Run a PageSpeed score with LCP, CLS and INP for any URL",
    "See real-user CrUX field data for a URL or origin",
    "Compare CrUX history over 12 collection periods",
  ],
  recommendation: "No setup — already available",
  availableWithoutSetup: true,
  setupFields: [
    { key: "api_key", label: "Google API key (optional)", type: "password", help: "Any Google Cloud API key with PageSpeed Insights + Chrome UX Report APIs enabled." },
  ],
  credentialsPresent: async (env) =>
    Boolean((await getCredential<PsCred>(env, "pagespeed"))?.api_key),
  configured: async (env) =>
    Boolean((await getCredential<PsCred>(env, "pagespeed"))?.api_key),
  health: pagespeedHealth,
  tools: [
    {
      name: "pagespeed_run",
      namespace: "pagespeed",
      description: "Run PageSpeed Insights for a URL. strategy: mobile, desktop or both (default both). Returns score plus LCP/CLS/INP/TTFB summaries.",
      inputSchema: obj(
        {
          url: { type: "string" },
          strategy: { type: "string", enum: ["mobile", "desktop", "both"] },
        },
        ["url"],
      ),
      write: false,
      handler: async (ctx, args) => {
        const strategy = str(args.strategy) || "both";
        const url = str(args.url);
        if (!url) throw new OpError("url is required.");
        if (strategy === "both") {
          const [mobile, desktop] = await Promise.all([
            runOnce(ctx.env, url, "mobile"),
            runOnce(ctx.env, url, "desktop"),
          ]);
          return { url, mobile, desktop };
        }
        return { url, result: await runOnce(ctx.env, url, strategy) };
      },
    },
    {
      name: "pagespeed_crux_record",
      namespace: "pagespeed",
      description: "Current Chrome UX Report field data for a url or origin.",
      inputSchema: obj({ url: { type: "string" }, origin: { type: "string" } }),
      write: false,
      handler: async (ctx, args) => crux(ctx.env, "queryRecord", args),
    },
    {
      name: "pagespeed_crux_history",
      namespace: "pagespeed",
      description: "CrUX history (12 collection periods) for LCP, CLS and INP for a url or origin.",
      inputSchema: obj({ url: { type: "string" }, origin: { type: "string" } }),
      write: false,
      handler: async (ctx, args) => crux(ctx.env, "queryHistoryRecord", args),
    },
  ],
};
