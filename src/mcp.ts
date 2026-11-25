import { packStatuses, searchTools, type Env, type ToolDef } from "./registry";
import { PACKS } from "./packs";
import { liveToolsFor } from "./runtime";
import { toolDeclarations } from "./registry";
import { runExecute } from "./sandbox";
import { authenticateAgentToken, touchToken, trackCall, type AgentToken } from "./store";
import { isRecord, OpError, str } from "./util";

export const VERSION = "0.1.0";
const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MODERN_VERSION = "2026-07-28";
const SERVER_INFO = { name: "edge-webmaster", title: "Edge Webmaster", version: VERSION };
const INSTRUCTIONS =
  "Webmaster tools for the sites connected to this self-hosted Edge Webmaster deployment. " +
  "Prefer the execute tool: one JS snippet against the typed gsc / ga4 / bing / pagespeed proxies, chaining calls and filtering in code — only the return value comes back. " +
  "Use search_tools to discover what is connected, and individual tools for single calls in raw mode.";

type RpcId = string | number | null;
interface RpcBody {
  id: RpcId | undefined;
  method: string;
  params: Record<string, unknown>;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function rpcError(id: RpcId, code: number, message: string, status = 200): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

const SEARCH_TOOL = {
  name: "search_tools",
  description:
    "Search the tools of the connectors that are actually connected on this deployment. Returns matching tool names, descriptions and input schemas. In raw mode the same catalog is listed directly.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Keywords, e.g. 'search analytics' or 'sitemap'" } },
    required: ["query"],
  },
  annotations: { readOnlyHint: true, destructiveHint: false },
};

function executeToolDef(tools: ToolDef[]): Record<string, unknown> {
  const decls = toolDeclarations(tools);
  return {
    name: "execute",
    description:
      "Run JavaScript in an isolated sandbox with typed proxies for every connected webmaster tool. " +
      "Write one async snippet using the namespace objects; `return` the result. Example: `const s = await gsc.list_sites({}); return s;` " +
      "Chain calls and filter in code — only your return value comes back. No network, no env, no recursion. Max 200KB code, 10s, 50 tool calls.\n\n" +
      (decls ? `Available tools:\n\`\`\`ts\n${decls}\n\`\`\`` : "No connectors are connected yet, so no namespace tools are available. Ask the owner to finish setup."),
    inputSchema: {
      type: "object",
      properties: { code: { type: "string", description: "JS statements using gsc, ga4, bing, pagespeed and console." } },
      required: ["code"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  };
}

function rawToolDef(tool: ToolDef): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: !tool.write, destructiveHint: false },
  };
}

const PERFORMANCE_REVIEW_PROMPT = {
  name: "performance_review",
  description: "Review one site's search performance: period totals with deltas, top queries and pages, sitemap health.",
  arguments: [
    { name: "site_url", description: "Search Console property, e.g. sc-domain:example.com", required: true },
    { name: "days", description: "Period length in days (default 28)", required: false },
  ],
};

async function readBody(req: Request): Promise<RpcBody | Response> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error.", 400);
  }
  if (Array.isArray(parsed)) return rpcError(null, -32600, "Batching is not supported.", 400);
  const b = isRecord(parsed) ? parsed : {};
  const id = typeof b.id === "string" || typeof b.id === "number" || b.id === null ? b.id : undefined;
  return { id, method: typeof b.method === "string" ? b.method : "", params: isRecord(b.params) ? b.params : {} };
}

function checkProtocol(req: Request, body: RpcBody): Response | null {
  const version = req.headers.get("mcp-protocol-version");
  if (version && version !== MODERN_VERSION && !LEGACY_VERSIONS.includes(version)) {
    return rpcError(body.id ?? null, -32022, `Unsupported protocol version ${version}`, 400);
  }
  if (version === MODERN_VERSION) {
    const bodyName = typeof body.params.name === "string" ? body.params.name : undefined;
    if (
      req.headers.get("mcp-method") !== body.method ||
      (body.method === "tools/call" && req.headers.get("mcp-name") !== bodyName)
    ) {
      return rpcError(body.id ?? null, -32020, "Mcp-Method / Mcp-Name headers must match the request body.", 400);
    }
  }
  return null;
}

function isCodeMode(env: Env): boolean {
  return (env.MCP_MODE ?? "code") !== "raw";
}

async function toolsList(env: Env, auth: AgentToken): Promise<Record<string, unknown>> {
  const tools = await liveToolsFor(env);
  const visible = tools.filter((t) => !t.write || auth.scope === "write");
  if (isCodeMode(env)) {
    return { tools: [SEARCH_TOOL, executeToolDef(visible)] };
  }
  return { tools: [SEARCH_TOOL, executeToolDef(visible), ...visible.map(rawToolDef)] };
}

async function callTool(
  env: Env,
  ctx: ExecutionContext,
  auth: AgentToken,
  id: RpcId,
  params: Record<string, unknown>,
): Promise<Response> {
  const name = str(params.name);
  const args = isRecord(params.arguments) ? params.arguments : {};
  const ok = (result: unknown) => json({ jsonrpc: "2.0", id, result });
  if (name === "search_tools") {
    const tools = await liveToolsFor(env);
    const found = searchTools(tools, str(args.query));
    return ok({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            found.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, write: t.write })),
            null,
            2,
          ),
        },
      ],
    });
  }
  if (name === "execute") {
    return ok(await runExecute(env, ctx, str(args.code), { tokenId: auth.id, scope: auth.scope }));
  }
  const tools = await liveToolsFor(env);
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    const statuses = await packStatuses(env, PACKS);
    const known = statuses.flatMap((s) => s.pack.tools);
    if (known.some((t) => t.name === name)) {
      return ok({
        content: [{ type: "text", text: `Error: ${name} belongs to a connector that is not connected on this deployment. Finish its setup first.` }],
        isError: true,
      });
    }
    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }
  if (tool.write && auth.scope !== "write") {
    return json(
      { jsonrpc: "2.0", id, error: { code: -32001, message: `${name} needs a write-scope token; this token is read-only.` } },
      403,
      { "WWW-Authenticate": 'Bearer error="insufficient_scope"' },
    );
  }
  const started = Date.now();
  try {
    const result = await tool.handler({ env, tokenId: auth.id, scope: auth.scope }, args);
    trackCall(ctx, env, name, started, null, auth.id);
    return ok({
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: isRecord(result) ? result : { result },
    });
  } catch (e) {
    const msg = e instanceof OpError ? e.message : `Internal error: ${e instanceof Error ? e.message : String(e)}`;
    trackCall(ctx, env, name, started, msg.slice(0, 200), auth.id);
    return ok({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });
  }
}

function simpleResult(body: RpcBody): unknown {
  switch (body.method) {
    case "initialize": {
      const asked = typeof body.params.protocolVersion === "string" ? body.params.protocolVersion : "";
      return {
        protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case "server/discover":
      return {
        supportedVersions: [MODERN_VERSION, ...LEGACY_VERSIONS],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    case "ping":
      return {};
    case "prompts/list":
      return { prompts: [PERFORMANCE_REVIEW_PROMPT] };
    case "prompts/get": {
      const site = str(body.params.arguments && isRecord(body.params.arguments) ? body.params.arguments.site_url : "");
      const days = str(body.params.arguments && isRecord(body.params.arguments) ? body.params.arguments.days : "") || "28";
      return {
        description: PERFORMANCE_REVIEW_PROMPT.description,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Run a performance review for ${site || "the site"} over the last ${days} days: call gsc_performance_review (or the gsc.performance_review proxy in execute), then summarize what changed versus the previous period, the top queries and pages, and any sitemap problems. Flag queries ranking 4-15 with high impressions as low-hanging fruit.`,
            },
          },
        ],
      };
    }
    default:
      return undefined;
  }
}

export async function handleMcp(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (req.method !== "POST") {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Use POST." } }, 405, { allow: "POST" });
  }
  const header = req.headers.get("authorization") ?? "";
  const raw = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const auth = raw ? await authenticateAgentToken(env, raw) : null;
  if (!auth) {
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized: a Bearer agent token (ew_…) issued in setup is required." },
      },
      401,
      { "WWW-Authenticate": 'Bearer resource_metadata="/.well-known/oauth-protected-resource/mcp"' },
    );
  }
  await touchToken(ctx, env, auth.id);
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const protocolError = checkProtocol(req, body);
  if (protocolError) return protocolError;
  if (body.id === undefined && body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
  const id = body.id ?? null;
  if (body.method === "tools/call") return callTool(env, ctx, auth, id, body.params);
  if (body.method === "tools/list") return json({ jsonrpc: "2.0", id, result: await toolsList(env, auth) });
  const result = simpleResult(body);
  if (result !== undefined) return json({ jsonrpc: "2.0", id, result });
  return rpcError(id, -32601, `Method not found: ${body.method}`);
}

