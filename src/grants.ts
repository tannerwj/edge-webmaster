import { PACKS } from "./packs";
import { isRecord, OpError, str } from "./util";
import type { ToolDef } from "./registry";

// A missing namespace grants no access. An empty list grants every property in that namespace.
export type Grants = Record<string, string[]>;

export function validGrants(value: unknown): value is Grants {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([ns, sites]) =>
    PACKS.some((p) => p.namespace === ns) && Array.isArray(sites) &&
    sites.every((site) => typeof site === "string" && site.trim() === site && site.length > 0 &&
      (ns !== "ga4" || /^\d+$/.test(site))) && (["gsc", "bing", "ga4"].includes(ns) || sites.length === 0));
}

export function grantTools(tools: ToolDef[], grants?: Grants | null): ToolDef[] {
  if (!grants) return tools;
  return tools.flatMap((tool) => {
    const sites = grants[tool.namespace];
    if (!Array.isArray(sites)) return [];
    if (!sites.length) return [tool];
    const field = tool.namespace === "ga4" ? "property_id" : "site_url";
    const required = tool.inputSchema.required;
    if (!Array.isArray(required) || !required.includes(field)) return [];
    return [{
      ...tool,
      description: tool.description + " Allowed properties: " + sites.join(", "),
      handler: (ctx, args) => {
        const value = str(args[field]);
        const site = field === "property_id" ? value.replace(/^properties\//, "") : value;
        if (!sites.includes(site)) throw new OpError("This agent does not have access to that property.");
        return tool.handler(ctx, args);
      },
    } satisfies ToolDef];
  });
}
