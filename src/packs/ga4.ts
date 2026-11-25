import { googleConfigured, googleFetch } from "../google";
import { obj, type ConnectorPack } from "../registry";
import { clampInt, isRecord, OpError, str, strList } from "../util";

const DATA = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";

function propertyPath(args: Record<string, unknown>): string {
  const id = str(args.property_id).replace(/^properties\//, "");
  if (!id) throw new OpError("property_id is required (numeric GA4 property id).");
  return `properties/${id}`;
}

async function runReport(ctx: { env: Parameters<typeof googleFetch>[0] }, args: Record<string, unknown>, realtime = false) {
  const body: Record<string, unknown> = {
    dimensions: strList(args.dimensions).map((name) => ({ name })),
    metrics: strList(args.metrics).map((name) => ({ name })),
    limit: String(clampInt(args.limit, 1, 10000, 100)),
  };
  if (!realtime) {
    body.dateRanges = [
      {
        startDate: str(args.start_date) || "28daysAgo",
        endDate: str(args.end_date) || "today",
      },
    ];
  }
  const verb = realtime ? "runRealtimeReport" : "runReport";
  return googleFetch(ctx.env, `${DATA}/${propertyPath(args)}:${verb}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export const ga4Pack: ConnectorPack = {
  id: "google-analytics",
  name: "Google Analytics 4",
  namespace: "ga4",
  authType: "oauth",
  blurb: "GA4 reporting over the same Google connection as Search Console.",
  provider: "Google",
  connectionId: "google",
  setupKind: "oauth-or-service-account",
  authLabel: "OAuth or service account",
  access: "Read-only",
  examples: [
    "Report sessions, users and conversions for a GA4 property",
    "Compare traffic between two periods",
    "Check realtime activity for a property",
  ],
  recommendation: "Pairs with Search Console",
  setupFields: [],
  credentialsPresent: googleConfigured,
  configured: googleConfigured,
  health: async (env) => {
    const data = await googleFetch(env, `${ADMIN}/accountSummaries`);
    const accounts = Array.isArray(data.accountSummaries) ? data.accountSummaries : [];
    let count = 0;
    const items: string[] = [];
    for (const acct of accounts) {
      const props = (acct as { propertySummaries?: unknown }).propertySummaries;
      count += Array.isArray(props) ? props.length : 0;
      if (!Array.isArray(props)) continue;
      for (const prop of props) {
        if (!isRecord(prop)) continue;
        const name = str(prop.displayName) || str(prop.property);
        if (name && items.length < 100) items.push(name);
      }
    }
    return { ok: true, detail: `${count} properties visible`, count, items };
  },
  tools: [
    {
      name: "ga4_list_properties",
      namespace: "ga4",
      description: "List GA4 accounts and properties the Google connection can access (account summaries).",
      inputSchema: obj(),
      write: false,
      handler: async (ctx) => googleFetch(ctx.env, `${ADMIN}/accountSummaries?pageSize=200`),
    },
    {
      name: "ga4_get_metadata",
      namespace: "ga4",
      description: "List the dimensions and metrics available for one GA4 property.",
      inputSchema: obj({ property_id: { type: "string" } }, ["property_id"]),
      write: false,
      handler: async (ctx, args) => googleFetch(ctx.env, `${DATA}/${propertyPath(args)}/metadata`),
    },
    {
      name: "ga4_run_report",
      namespace: "ga4",
      description: "Run a GA4 report: dimensions, metrics, date range (e.g. 28daysAgo to today), row limit up to 10,000.",
      inputSchema: obj(
        {
          property_id: { type: "string" },
          dimensions: { type: "array", items: { type: "string" } },
          metrics: { type: "array", items: { type: "string" } },
          start_date: { type: "string" },
          end_date: { type: "string" },
          limit: { type: "number" },
        },
        ["property_id", "metrics"],
      ),
      write: false,
      handler: async (ctx, args) => runReport(ctx, args),
    },
    {
      name: "ga4_run_realtime_report",
      namespace: "ga4",
      description: "Run a GA4 realtime report (last 30 minutes) for one property.",
      inputSchema: obj(
        {
          property_id: { type: "string" },
          dimensions: { type: "array", items: { type: "string" } },
          metrics: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
        },
        ["property_id", "metrics"],
      ),
      write: false,
      handler: async (ctx, args) => runReport(ctx, args, true),
    },
    {
      name: "ga4_compare_periods",
      namespace: "ga4",
      description: "Composite: run the same report for two periods and return both plus per-row metric deltas for the first metric.",
      inputSchema: obj(
        {
          property_id: { type: "string" },
          dimensions: { type: "array", items: { type: "string" } },
          metrics: { type: "array", items: { type: "string" } },
          current_start: { type: "string" },
          current_end: { type: "string" },
          previous_start: { type: "string" },
          previous_end: { type: "string" },
          limit: { type: "number" },
        },
        ["property_id", "metrics", "current_start", "previous_start"],
      ),
      write: false,
      handler: async (ctx, args) => {
        const current = await runReport(ctx, {
          ...args,
          start_date: args.current_start,
          end_date: args.current_end || "today",
        });
        const previous = await runReport(ctx, {
          ...args,
          start_date: args.previous_start,
          end_date: args.previous_end || args.current_start,
        });
        return { current, previous };
      },
    },
  ],
};
