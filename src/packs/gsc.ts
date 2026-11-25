import { cacheGet, cachePut } from "../creds";
import { googleAccessToken, googleConfigured, googleFetch } from "../google";
import { obj, SITE_URL, type ConnectorPack, type ToolCtx } from "../registry";
import { clampInt, isRecord, OpError, str, strList } from "../util";

const API = "https://www.googleapis.com/webmasters/v3";
const PAGE = 25000;
export const MAX_ROWS = 50000;

export function planPages(rowLimit: number): number[] {
  const starts: number[] = [];
  for (let start = 0; start < rowLimit; start += PAGE) starts.push(start);
  return starts;
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function queryAnalytics(ctx: ToolCtx, args: Record<string, unknown>, accessToken?: string) {
  const site = str(args.site_url);
  if (!site) throw new OpError("site_url is required.");
  const rowLimit = clampInt(args.row_limit, 1, MAX_ROWS, 1000);
  const token = accessToken ?? await googleAccessToken(ctx.env);
  const startDate = str(args.start_date) || isoDaysAgo(30);
  const endDate = str(args.end_date) || isoDaysAgo(2);
  const cacheKey = JSON.stringify(["gsc", token, startDate, endDate, args]);
  const cached = await cacheGet(ctx.env, cacheKey);
  if (cached) return { ...JSON.parse(cached), cached: true };
  const rows: unknown[] = [];
  for (const startRow of planPages(rowLimit)) {
    const body: Record<string, unknown> = {
      startDate,
      endDate,
      dimensions: strList(args.dimensions),
      type: str(args.search_type) || "web",
      rowLimit: Math.min(PAGE, rowLimit - startRow),
      startRow,
      dataState: str(args.data_state) || "final",
    };
    if (Array.isArray(args.filters) && args.filters.length) {
      body.dimensionFilterGroups = [{ filters: args.filters }];
    }
    const data = await googleFetch(
      ctx.env,
      `${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
      { method: "POST", body: JSON.stringify(body) },
      token,
    );
    const page = Array.isArray(data.rows) ? data.rows : [];
    rows.push(...page);
    if (page.length < Math.min(PAGE, rowLimit - startRow)) break;
  }
  const result = { site_url: site, rows, row_count: rows.length };
  await cachePut(ctx.env, cacheKey, JSON.stringify(result), 300);
  return result;
}

function totals(rows: unknown[]): { clicks: number; impressions: number; ctr: number; position: number } {
  let clicks = 0;
  let impressions = 0;
  let positionWeight = 0;
  for (const r of rows) {
    if (!isRecord(r)) continue;
    clicks += Number(r.clicks ?? 0);
    impressions += Number(r.impressions ?? 0);
    positionWeight += Number(r.position ?? 0) * Number(r.impressions ?? 0);
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? positionWeight / impressions : 0,
  };
}

async function performanceReview(ctx: ToolCtx, args: Record<string, unknown>) {
  const token = await googleAccessToken(ctx.env);
  const days = clampInt(args.days, 7, 90, 28);
  const base = { site_url: args.site_url, row_limit: 25 };
  const currentRange = { start_date: isoDaysAgo(days + 1), end_date: isoDaysAgo(2) };
  const current = await queryAnalytics(ctx, {
    ...base,
    ...currentRange,
    dimensions: [],
  }, token);
  const previous = await queryAnalytics(ctx, {
    ...base,
    start_date: isoDaysAgo(days * 2 + 1),
    end_date: isoDaysAgo(days + 2),
    dimensions: [],
  }, token);
  const topQueries = await queryAnalytics(ctx, { ...base, ...currentRange, dimensions: ["query"], row_limit: 10 }, token);
  const topPages = await queryAnalytics(ctx, { ...base, ...currentRange, dimensions: ["page"], row_limit: 10 }, token);
  const sitemaps = await googleFetch(
    ctx.env,
    `${API}/sites/${encodeURIComponent(str(args.site_url))}/sitemaps`, {}, token,
  );
  const cur = totals((current as { rows: unknown[] }).rows);
  const prev = totals((previous as { rows: unknown[] }).rows);
  const delta = (a: number, b: number) => (b ? (a - b) / b : 0);
  return {
    site_url: str(args.site_url),
    days,
    current: cur,
    previous: prev,
    change: {
      clicks: delta(cur.clicks, prev.clicks),
      impressions: delta(cur.impressions, prev.impressions),
      ctr: delta(cur.ctr, prev.ctr),
      position: cur.position - prev.position,
    },
    top_queries: (topQueries as { rows: unknown[] }).rows,
    top_pages: (topPages as { rows: unknown[] }).rows,
    sitemaps: sitemaps.sitemap ?? [],
  };
}

async function inspectUrl(ctx: ToolCtx, site: string, url: string) {
  return googleFetch(ctx.env, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    body: JSON.stringify({ inspectionUrl: url, siteUrl: site }),
  });
}

export const gscPack: ConnectorPack = {
  id: "google-search-console",
  name: "Google Search Console",
  namespace: "gsc",
  authType: "oauth",
  blurb: "Search performance, sitemaps and URL inspection for your Google properties.",
  provider: "Google",
  connectionId: "google",
  setupKind: "oauth-or-service-account",
  authLabel: "OAuth or service account",
  access: "Read + write actions",
  examples: [
    "See clicks, impressions and average position for a page or query",
    "Inspect whether a URL is indexed and which canonical Google chose",
    "List and submit sitemaps for a property",
  ],
  recommendation: "Start here — this is the core one",
  setupFields: [],
  credentialsPresent: googleConfigured,
  health: async (env) => {
    const data = await googleFetch(env, `${API}/sites`);
    const entries = Array.isArray(data.siteEntry) ? data.siteEntry : [];
    const items = entries
      .map((e) => (isRecord(e) ? str(e.siteUrl) : ""))
      .filter(Boolean)
      .slice(0, 100);
    return { ok: true, detail: `${entries.length} properties visible`, count: entries.length, items };
  },
  tools: [
    {
      name: "gsc_list_sites",
      namespace: "gsc",
      description: "List every Search Console property the Google connection can access, with permission levels.",
      inputSchema: obj(),
      write: false,
      handler: async (ctx) => googleFetch(ctx.env, `${API}/sites`),
    },
    {
      name: "gsc_get_site",
      namespace: "gsc",
      description: "Get one Search Console property and your permission level on it.",
      inputSchema: obj({ site_url: SITE_URL }, ["site_url"]),
      write: false,
      handler: async (ctx, args) =>
        googleFetch(ctx.env, `${API}/sites/${encodeURIComponent(str(args.site_url))}`),
    },
    {
      name: "gsc_query_search_analytics",
      namespace: "gsc",
      description:
        "Query clicks, impressions, CTR and position. Dimensions: query, page, country, device, date, searchAppearance. Bounded server-side pagination up to 50,000 rows.",
      inputSchema: obj(
        {
          site_url: SITE_URL,
          start_date: { type: "string", description: "YYYY-MM-DD (default 30 days ago)" },
          end_date: { type: "string", description: "YYYY-MM-DD (default 2 days ago)" },
          dimensions: { type: "array", items: { type: "string" } },
          search_type: { type: "string", enum: ["web", "image", "video", "news", "discover", "googleNews"] },
          row_limit: { type: "number", description: "1-50000, default 1000" },
          filters: { type: "array", items: { type: "object" }, description: "dimensionFilterGroups filters" },
          data_state: { type: "string", enum: ["final", "all"] },
        },
        ["site_url"],
      ),
      write: false,
      handler: queryAnalytics,
    },
    {
      name: "gsc_list_sitemaps",
      namespace: "gsc",
      description: "List submitted sitemaps for a property.",
      inputSchema: obj({ site_url: SITE_URL }, ["site_url"]),
      write: false,
      handler: async (ctx, args) =>
        googleFetch(ctx.env, `${API}/sites/${encodeURIComponent(str(args.site_url))}/sitemaps`),
    },
    {
      name: "gsc_get_sitemap",
      namespace: "gsc",
      description: "Get one submitted sitemap's status and errors.",
      inputSchema: obj(
        { site_url: SITE_URL, sitemap_url: { type: "string" } },
        ["site_url", "sitemap_url"],
      ),
      write: false,
      handler: async (ctx, args) =>
        googleFetch(
          ctx.env,
          `${API}/sites/${encodeURIComponent(str(args.site_url))}/sitemaps/${encodeURIComponent(str(args.sitemap_url))}`,
        ),
    },
    {
      name: "gsc_submit_sitemap",
      namespace: "gsc",
      description: "Submit a sitemap URL to Google for a property. Requires a write-scope agent token.",
      inputSchema: obj(
        { site_url: SITE_URL, sitemap_url: { type: "string" } },
        ["site_url", "sitemap_url"],
      ),
      write: true,
      handler: async (ctx, args) => {
        await googleFetch(
          ctx.env,
          `${API}/sites/${encodeURIComponent(str(args.site_url))}/sitemaps/${encodeURIComponent(str(args.sitemap_url))}`,
          { method: "PUT" },
        );
        return { submitted: str(args.sitemap_url), site_url: str(args.site_url) };
      },
    },
    {
      name: "gsc_inspect_url",
      namespace: "gsc",
      description: "Inspect the indexed version of one URL: index status, coverage, canonical, mobile usability.",
      inputSchema: obj(
        { site_url: SITE_URL, url: { type: "string" } },
        ["site_url", "url"],
      ),
      write: false,
      handler: async (ctx, args) => inspectUrl(ctx, str(args.site_url), str(args.url)),
    },
    {
      name: "gsc_batch_inspect",
      namespace: "gsc",
      description: "Inspect up to 10 URLs in one call and return a compact per-URL verdict summary.",
      inputSchema: obj(
        { site_url: SITE_URL, urls: { type: "array", items: { type: "string" } } },
        ["site_url", "urls"],
      ),
      write: false,
      handler: async (ctx, args) => {
        const urls = strList(args.urls).slice(0, 10);
        const out: unknown[] = [];
        for (const url of urls) {
          try {
            const data = await inspectUrl(ctx, str(args.site_url), url);
            const result = isRecord(data.inspectionResult) ? data.inspectionResult : {};
            const index = isRecord(result.indexStatusResult) ? result.indexStatusResult : {};
            out.push({
              url,
              verdict: index.verdict ?? "UNKNOWN",
              coverage: index.coverageState ?? null,
              canonical: index.googleCanonical ?? null,
            });
          } catch (e) {
            out.push({ url, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return { results: out };
      },
    },
    {
      name: "gsc_performance_review",
      namespace: "gsc",
      description:
        "Composite review: current vs previous period totals with deltas, top queries, top pages and sitemap status for one property.",
      inputSchema: obj(
        { site_url: SITE_URL, days: { type: "number", description: "7-90, default 28" } },
        ["site_url"],
      ),
      write: false,
      handler: performanceReview,
    },
  ],
};
