import { useState } from "react";
import { CopyButton } from "./CopyButton";

async function checkDiscovery(origin: string) {
  const response = await fetch(origin + "/mcp", {
    method: "POST", credentials: "omit", redirect: "manual",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const metadata = response.headers.get("www-authenticate")?.match(/resource_metadata="([^"]+)"/i)?.[1];
  if (response.status !== 401 || !metadata) throw new Error("Check the /mcp application path, its Allow policy and the Managed OAuth switch.");
  const url = new URL(metadata, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/.well-known/cloudflare-access-protected-resource/"))
    throw new Error("The Worker answered directly. Check that the /mcp Access application covers this hostname and uses an Allow policy.");
  const resource = await fetch(url, { credentials: "omit", redirect: "error" });
  if (!resource.ok) throw new Error("Access discovery metadata could not be loaded.");
  const info = await resource.json();
  if (info.resource !== origin + "/mcp" || !info.authorization_servers?.length)
    throw new Error("Check the hostname and resource listed by the MCP Access application.");
}

export function AccessSetup({ configured }: { configured: boolean }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const origin = location.origin;
  const endpoint = origin + "/mcp";
  async function check() {
    setBusy(true);
    try {
      await checkDiscovery(origin);
      setStatus(configured ? "Access discovery passed. Connect your client below." : "Access discovery passed. Finish the Worker variables in step 3.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not check Access discovery.");
    } finally { setBusy(false); }
  }
  return <section className="card">
    <h2>Connect through Cloudflare Access</h2>
    <p>Agents sign in with your identity provider and can read all connected properties. Use a scoped token below for a smaller grant.</p>
    <details open={!configured}>
      <summary>Configure Access for this installation</summary>
      <ol>
        <li>In Workers &amp; Pages → your Worker → Settings → Domains &amp; Routes, attach a custom domain you own. Open Agent access on that hostname so the URLs below match.</li>
        <li>In <a href="https://one.dash.cloudflare.com/" target="_blank" rel="noreferrer">Zero Trust</a>, choose your team name and configure a login method. Under Access controls → Applications, create two self-hosted applications:
          <ul><li><strong>Dashboard</strong> — cover the entire hostname. Allow your administrator email or identity-provider group. Copy the Application Audience (AUD) Tag.</li>
          <li><strong>Agent</strong> — same hostname, path <code>/mcp</code>. Allow only your trusted report readers. In Advanced settings enable Managed OAuth and Dynamic Client Registration. For a desktop client allow localhost and loopback callbacks. For a hosted client add its exact redirect URI. Save and copy this application’s own AUD.</li></ul></li>
        <li>In the Worker’s Settings → Variables and Secrets, add four text variables and deploy:
          <ul><li><code>PUBLIC_URL</code> = your custom HTTPS origin</li><li><code>ACCESS_TEAM_DOMAIN</code> = your team’s HTTPS origin, e.g. https://your-team.cloudflareaccess.com</li>
          <li><code>ACCESS_ADMIN_AUD</code> = dashboard AUD</li><li><code>ACCESS_MCP_AUD</code> = agent AUD</li></ul>
          Reload this page on the custom domain. For scoped tokens alongside OAuth, see the <a href="https://github.com/tannerwj/edge-webmaster/blob/master/DEPLOY.md#give-an-agent-access">path-specific setup and rollback guide</a>.</li>
      </ol>
    </details>
    <button type="button" disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Check Access discovery"}</button>
    <p role="status">{status}</p>
    <p>Add this URL as a remote HTTP MCP server, choose OAuth, and approve your client in the browser.</p>
    <code>{endpoint}</code> <CopyButton value={endpoint} />
    <p>Run a report in <a href="/reports">Site reports</a>, then use <strong>Copy task for agent</strong> to request the same report in your client.</p>
  </section>;
}
