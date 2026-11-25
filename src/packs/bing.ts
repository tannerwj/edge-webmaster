import { getCredential } from "../creds";
import { obj, SITE_URL, type ConnectorPack } from "../registry";
import { OpError, str } from "../util";

const API = "https://ssl.bing.com/webmaster/api.svc/json";

interface BingCred {
  api_key: string;
}

async function bingCall(env: Parameters<typeof getCredential>[0], method: string, site?: string) {
  const cred = await getCredential<BingCred>(env as never, "bing");
  if (!cred?.api_key) throw new OpError("Bing Webmaster is not connected. Add its API key in setup.");
  const params = new URLSearchParams({ apikey: cred.api_key });
  if (site) params.set("siteUrl", site);
  const res = await fetch(`${API}/${method}?${params.toString()}`);
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) throw new OpError(`Bing API ${res.status}: ${text.slice(0, 200)}`);
  return data.d ?? data;
}

const siteTool = (
  name: string,
  method: string,
  description: string,
): ConnectorPack["tools"][number] => ({
  name,
  namespace: "bing",
  description,
  inputSchema: obj({ site_url: SITE_URL }, ["site_url"]),
  write: false,
  handler: async (ctx, args) => bingCall(ctx.env, method, str(args.site_url)),
});

export const bingPack: ConnectorPack = {
  id: "bing-webmaster",
  name: "Bing Webmaster Tools",
  namespace: "bing",
  authType: "api-key",
  blurb: "Bing search traffic, crawl issues and site stats with a single API key.",
  provider: "Bing",
  connectionId: "bing",
  setupKind: "api-key",
  authLabel: "API key",
  access: "Read-only",
  examples: [
    "See top Bing queries and pages for a site",
    "Check crawl issues Bingbot found on a site",
    "Track Bing rank and traffic over time",
  ],
  recommendation: "Same idea as Search Console, for Bing",
  setupFields: [
    {
      key: "api_key",
      label: "Bing Webmaster API key",
      type: "password",
      help: "Bing Webmaster Tools → Settings → API Access → Generate API Key.",
    },
  ],
  credentialsPresent: async (env) => Boolean((await getCredential<BingCred>(env, "bing"))?.api_key),
  configured: async (env) => Boolean((await getCredential<BingCred>(env, "bing"))?.api_key),
  health: async (env) => {
    const sites = await bingCall(env, "GetUserSites");
    const count = Array.isArray(sites) ? sites.length : 0;
    return { ok: true, detail: `${count} verified sites`, count };
  },
  tools: [
    {
      name: "bing_list_sites",
      namespace: "bing",
      description: "List every site verified in Bing Webmaster Tools for this API key.",
      inputSchema: obj(),
      write: false,
      handler: async (ctx) => bingCall(ctx.env, "GetUserSites"),
    },
    siteTool("bing_get_query_stats", "GetQueryStats", "Top search queries on Bing with clicks, impressions and positions for one site."),
    siteTool("bing_get_page_stats", "GetPageStats", "Top pages on Bing with clicks and impressions for one site."),
    siteTool("bing_get_traffic_stats", "GetRankAndTrafficStats", "Rank and traffic stats over time for one site on Bing."),
    siteTool("bing_get_crawl_issues", "GetCrawlIssues", "Crawl issues Bingbot found on one site: errors, redirects and blocked URLs."),
  ],
};
