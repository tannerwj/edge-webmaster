import { handleApi, handleGoogleCallback, handleSetupAgentDoc } from "./api";
import { handleMcp, VERSION } from "./mcp";
import type { Env } from "./registry";
import { UI_HTML } from "./frontend.gen";

import { publicInfo } from "../web/public-info";

export { WebmasterCodeSandbox } from "./sandbox";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
};

function withHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

const NON_SPA_PATHS = new Set([
  "/health",
  "/auth/google/callback",
  "/.well-known/oauth-protected-resource/mcp",
  "/setup-agent.md",
]);

function isSpaPath(path: string): boolean {
  if (path.startsWith("/api/") || path.startsWith("/mcp")) return false;
  if (NON_SPA_PATHS.has(path)) return false;
  return !/\.[A-Za-z0-9]+$/.test(path);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    let res: Response;
    if (path === "/about" || path.startsWith("/about/")) {
      res = publicInfo(path, req.method);
    } else if (path === "/mcp" || path === "/mcp/" || path === "/mcp/token") {
      res = await handleMcp(req, env, ctx);
    } else if (path === "/auth/google/callback") {
      res = await handleGoogleCallback(req, env);
    } else if (path.startsWith("/api/")) {
      res = await handleApi(req, env, ctx, path);
    } else if (path === "/health") {
      res = new Response(JSON.stringify({ ok: true, name: "edge-webmaster", version: VERSION }), {
        headers: { "content-type": "application/json" },
      });
    } else if (path === "/.well-known/oauth-protected-resource/mcp") {
      res = new Response(
        JSON.stringify({
          resource: `${url.origin}/mcp`,
          authorization_servers: env.ACCESS_MCP_AUD && env.ACCESS_TEAM_DOMAIN ? [url.origin] : [],
          bearer_methods_supported: ["header"],
        }),
        { headers: { "content-type": "application/json" } },
      );
    } else if (path === "/setup-agent.md") {
      res = await handleSetupAgentDoc(req, env);
    } else if ((req.method === "GET" || req.method === "HEAD") && isSpaPath(path)) {
      res = new Response(UI_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    } else {
      res = new Response("Not found", { status: 404 });
    }
    return withHeaders(res);
  },
};
