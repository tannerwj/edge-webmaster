import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./registry";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function accessEmail(req: Request, env: Env, audience: string | undefined): Promise<string | null> {
  const assertion = req.headers.get("cf-access-jwt-assertion");
  if (!assertion || !audience || !env.ACCESS_TEAM_DOMAIN || env.ACCESS_ADMIN_AUD === env.ACCESS_MCP_AUD) return null;
  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) return null;
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
    keySets.set(issuer, keys);
  }
  try {
    const { payload } = await jwtVerify(assertion, keys, {
      issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp", "sub", "email"],
    });
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
