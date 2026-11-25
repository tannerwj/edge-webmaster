import { handleApi, handleGoogleCallback } from "./api";
import { handleMcp, VERSION } from "./mcp";
import type { Env } from "./registry";
import { UI_HTML } from "./ui";

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

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    let res: Response;
    if (path === "/mcp" || path === "/mcp/") {
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
          authorization_servers: [],
          bearer_methods_supported: ["header"],
          note: "Agent access uses per-deployment API tokens issued in setup. Human setup is gated by Cloudflare Access; see DEPLOY.md.",
        }),
        { headers: { "content-type": "application/json" } },
      );
    } else if (path === "/" && req.method === "GET") {
      res = new Response(UI_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    } else {
      res = new Response("Not found", { status: 404 });
    }
    return withHeaders(res);
  },
};
