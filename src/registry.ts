import type { CredEnv } from "./creds";
import { isRecord } from "./util";

export interface Env extends CredEnv {
  LOADER?: WorkerLoader;
  MCP_MODE?: string;
  PUBLIC_URL?: string;
}

export interface ToolCtx {
  env: Env;
  tokenId: string;
  scope: "read" | "write";
}

export interface ToolDef {
  name: string;
  namespace: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write: boolean;
  handler: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<unknown>;
}

export interface SetupField {
  key: string;
  label: string;
  type: "text" | "password" | "textarea" | "oauth";
  help?: string;
}

export interface PackHealth {
  ok: boolean;
  detail: string;
}

export interface ConnectorPack {
  id: string;
  name: string;
  namespace: string;
  authType: "oauth" | "api-key" | "optional-key";
  blurb: string;
  setupFields: SetupField[];
  configured: (env: Env) => Promise<boolean>;
  health: (env: Env) => Promise<PackHealth>;
  tools: ToolDef[];
}

export const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

export const SITE_URL = {
  type: "string",
  description: "Property exactly as listed, e.g. sc-domain:example.com or https://example.com/",
};

export interface PackStatus {
  pack: ConnectorPack;
  configured: boolean;
  health: PackHealth | null;
}

export async function packStatuses(env: Env, packs: ConnectorPack[]): Promise<PackStatus[]> {
  const out: PackStatus[] = [];
  for (const pack of packs) {
    const configured = await pack.configured(env).catch(() => false);
    out.push({ pack, configured, health: null });
  }
  return out;
}

export function liveTools(statuses: PackStatus[]): ToolDef[] {
  return statuses.filter((s) => s.configured).flatMap((s) => s.pack.tools);
}

export function searchTools(tools: ToolDef[], query: string, limit = 20): ToolDef[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return tools.slice(0, limit);
  const scored = tools.map((tool) => {
    const hay = `${tool.name} ${tool.namespace} ${tool.description}`.toLowerCase();
    const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
    return { tool, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.tool);
}

export function toolForProxy(tools: ToolDef[], namespace: string, method: string): ToolDef | undefined {
  return tools.find((t) => t.name === `${namespace}_${method}`);
}

function schemaToTs(schema: Record<string, unknown>, indent = ""): string {
  const t = schema.type;
  if (t === "string") {
    return Array.isArray(schema.enum)
      ? schema.enum.map((e) => JSON.stringify(e)).join(" | ")
      : "string";
  }
  if (t === "number" || t === "integer") return "number";
  if (t === "boolean") return "boolean";
  if (t === "array") return `(${isRecord(schema.items) ? schemaToTs(schema.items, indent) : "unknown"})[]`;
  if (t === "object" || isRecord(schema.properties)) {
    const props = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const lines = Object.entries(props).map(([k, v]) => {
      const prop = isRecord(v) ? v : {};
      const opt = required.has(k) ? "" : "?";
      return `${indent}  ${k}${opt}: ${schemaToTs(prop, indent + " ")};`;
    });
    return `{\n${lines.join("\n")}\n${indent}}`;
  }
  return "unknown";
}

export function toolDeclarations(tools: ToolDef[]): string {
  const byNs = new Map<string, string[]>();
  for (const tool of tools) {
    const method = tool.name.slice(tool.namespace.length + 1);
    const list = byNs.get(tool.namespace) ?? [];
    list.push(
      `/** ${tool.description}${tool.write ? " (write)" : " (read-only)"} */\n${method}(args: ${schemaToTs(tool.inputSchema)}): Promise<any>;`,
    );
    byNs.set(tool.namespace, list);
  }
  return [...byNs.entries()]
    .map(([ns, decls]) => `declare const ${ns}: {\n${decls.join("\n\n")}\n};`)
    .join("\n\n");
}

