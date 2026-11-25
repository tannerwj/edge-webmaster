# Deploy Edge Webmaster

## Install in your own Cloudflare account

1. Use a Workers Paid account for the Dynamic Worker loader used by code mode. Cloudflare meters dynamic workers, requests and CPU time. [Pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)
2. Click **Deploy to Cloudflare** in the README. Choose your own repository, Worker name and D1 database. Keep the build and deploy commands set to `npm run build` and `npm run deploy`. The button provisions D1 and the deploy command applies the schema through the `DB` binding. [Deploy button documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
3. Generate two independent random 32-byte secrets in your password manager. Supply `DEPLOYMENT_SECRET` to encrypt provider credentials and `SETUP_TOKEN` to unlock the dashboard. Keep the encryption secret stable across releases. If your deployment did not prompt for them, set both under Worker settings → Variables and Secrets as secrets.
4. Open the new Worker URL, enter your setup token and choose a connector. PageSpeed can run a lab report on a public page immediately. Search Console and GA4 share a Google sign-in. Bing uses its own key. Test a connection to see which properties it can reach.

For manual installation, run `npm ci`, create a D1 database with `npx wrangler d1 create edge-webmaster`, and copy its ID into the top-level `DB` binding in your clone. Run `npm run build`, `npx wrangler deploy --dry-run`, then `npm run deploy`. Supply the two secrets with `npx wrangler secret put NAME`. The dashboard requires authentication even during first setup.

## Give an agent access

**Scoped token.** In **Agent access**, choose a name and read or write access. For a personal assistant, leave **All connectors and properties** selected. For a project, choose the connectors and optionally enter exact property identifiers from that provider. Use the full Search Console property (including `sc-domain:` or the URL prefix), the verified Bing URL, or a numeric GA4 property ID. PageSpeed tests public URLs and supports connector-level selection. Property-limited tokens see their assigned identifiers in tool descriptions. Account-wide discovery operations are hidden for those connectors. Copy the token once and configure the client with the endpoint and header shown.

### Browser sign-in with managed OAuth

The deploy button installs the Worker and database in your account. Open **Agent access** on your installation for the interactive checklist. Set up Access once for each hostname. You need a Cloudflare Zero Trust team, an allowed login method and a domain you control in the account.

1. **Attach your hostname.** In Workers & Pages → your Worker → Settings → Domains & Routes, add a Custom Domain, such as `webmaster.example.com`. Open the dashboard there. Use that origin for provider OAuth callbacks too.
2. **Protect the dashboard.** In Zero Trust → Access controls → Applications → Add an application → Self-hosted, add the entire hostname. Select your identity provider and an **Allow** policy limited to administrator emails or a trusted admin group. Save its Application Audience (AUD) Tag.
3. **Protect the agent endpoint.** Add a second self-hosted app on the same hostname with path `/mcp`. Use an **Allow** policy for your trusted report readers. These identities can read all connected properties. In **Advanced settings**, enable **Managed OAuth** and **Dynamic Client Registration**. Desktop clients using ephemeral local callbacks need the localhost and loopback options. For a hosted client, enter its documented redirect URI under Allowed redirect URIs. Save and copy the agent app’s own AUD. [Cloudflare managed OAuth settings](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
4. **Bind the Worker to your Access apps.** Under Worker Settings → Variables and Secrets add these text variables and deploy. Later deploys preserve dashboard-managed variables.

   | Variable | Value from your account |
   | --- | --- |
   | `PUBLIC_URL` | HTTPS origin of your custom hostname |
   | `ACCESS_TEAM_DOMAIN` | HTTPS origin of your Zero Trust team, such as `https://your-team.cloudflareaccess.com` |
   | `ACCESS_ADMIN_AUD` | Dashboard application's AUD |
   | `ACCESS_MCP_AUD` | Agent application's AUD (must differ from the dashboard AUD) |

5. **Check and connect.** Reload **Agent access** on the custom domain. **Check Access discovery** sends a signed-out MCP request and follows the challenge to its public resource metadata. Add the displayed `https://<your-host>/mcp` to an OAuth-capable remote HTTP MCP client. Sign in and approve it. In code mode the agent sees `search_tools` and `execute`.
6. **Run a real report.** In **Site reports**, choose **Mobile page speed**, enter your public homepage and click **Run report**. If Google’s anonymous quota is exhausted, connect a PageSpeed API key. Click **Copy task for agent**, paste it into the connected agent, and confirm it returns a mobile score for the same URL. Separate Lighthouse runs can give slightly different scores.
7. **Limit other entry points.** Once the custom hostname works, disable other Worker hostnames if every request should pass through Access. Reflect that choice in your clone’s Wrangler configuration (`workers_dev: false` and `preview_urls: false`) and retain your custom domain route on redeploy. For Google branding pages see **Connect Google** below.

**Scoped bearer clients on the same hostname.** Create a separate self-hosted Access app for the more specific path `/mcp/token` and give just that app a Bypass policy for Everyone. The Worker authenticates issued tokens on that route. Set the client URL to `https://<your-host>/mcp/token` with its bearer header. Keep the hostname-wide dashboard app and the `/mcp` OAuth app on their restricted Allow policies.

| Symptom | What to check |
| --- | --- |
| Discovery redirects to browser login or reports no Access challenge | Confirm the agent app matches the custom hostname and `/mcp`, has an Allow policy and has Managed OAuth enabled. |
| Google works in the dashboard but the agent gets `invalid_target` | Check Managed OAuth on the **agent** Access app and the exact MCP resource URL. |
| Client registration or redirect rejected | Enable dynamic registration and allow the callback used by that client. |
| Origin rejects the request after successful sign-in | Check the HTTPS team origin, distinct AUD values and allowed identity. |
| Scoped token client opens a login page | Check the separate path-specific app and the client’s `/mcp/token` URL. |

**Rollback.** To stop browser-based agent access, disable Managed OAuth on the agent app and remove `ACCESS_MCP_AUD` from the Worker. Keep the restricted Access policy in place. Remove the token-path exception if you also want to stop external bearer clients. Use the dashboard’s setup token if you need to correct Worker audience variables after signing in through Access.

## Connect PageSpeed Insights and CrUX

PageSpeed lab reports can run without a key. For CrUX field data and history, enable **PageSpeed Insights API** and **Chrome UX Report API** in the same Google Cloud project. Open each API’s Library page and click Enable (Manage means it is already enabled). If an API is missing from the restriction picker, confirm it is enabled in the project that owns the key, then reload Credentials. In Credentials, create a dedicated API key. Set **Application restrictions → None** for the standard server-side Worker. Set **API restrictions → Restrict key** and select only those two APIs. Save the key in Connections → PageSpeed Insights + CrUX. **Test connection** checks CrUX. Run a PageSpeed lab report to check the other API. OAuth publishing status has no bearing on this key.

## Connect Google

Use the setup wizard's Google card. You need your **own** Google Cloud
project — there is no shared OAuth client, by design. Pick one of two
methods in the wizard:

**OAuth sign-in (External) — recommended for your own sites.** The
connection acts as your Google account, so every Search Console and GA4
property you can already open works immediately, with no per-property
grants. Follow the wizard's seven steps:

1. Create a Google Cloud project.
2. Enable the APIs: Google Search Console API, Google Analytics Data API,
   Google Analytics Admin API.
3. Set up the OAuth consent screen at
   <https://console.cloud.google.com/auth/audience>. If this is the
   project's first time, start at
   <https://console.cloud.google.com/auth/overview> → Get started; enter an
   app name, your user support email, and a developer contact email. At
   Audience choose **External** — Internal only appears for Google Workspace
   organizations, and only accounts inside that organization can use it, so
   personal Google accounts use External.
   - **Test immediately.** Leave Audience in Testing and add your account to Test users.
     For the Search Console and Analytics scopes, Testing refresh tokens normally expire after seven days.
   - **Prepare to publish.** In [Branding](https://console.cloud.google.com/auth/branding),
     enter your authorized domain. Use your deployment’s HTTPS origin plus `/about` for
     Application home page, `/about/privacy` for Privacy policy and optionally
     `/about/terms` for Terms of service. A logo is optional. Each self-host uses its own
     OAuth project, domain and support address. Review the published wording against your
     actual data practices, including any agent providers you authorize.
   - If Cloudflare Access covers the hostname, add a more specific self-hosted Access
     application for the three information paths, with a public Bypass policy. Open all
     three signed out and confirm the dashboard still requires sign-in. To roll back
     public access, remove that path-specific application.
   - Save Branding, then return to Audience → Publish app. For verification, verify
     ownership of the domain in Search Console using a project owner or editor account.
     Check Verification Center for any required brand or scope review.
     [Google’s branding requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
4. Create the OAuth client at <https://console.cloud.google.com/auth/clients>:
   Create client → Web application; under Authorized redirect URIs click
   Add URI and paste the redirect URI the wizard displays
   (`https://<your-instance>/auth/google/callback`); then Create and copy
   the Client ID and secret Google shows.
5. Paste the Client ID and secret into the wizard and Save. The wizard then
   shows the saved client (with a masked ID) at the top of the OAuth flow.
6. Click **Sign in with Google** and approve access.
7. Test the connection in the wizard — success lists the properties the
   connection can see.

**Service account — headless / team setups.** No sign-in and no token
expiry, but you grant access by hand per property. Create a service account
in your Google Cloud project, download its JSON key, paste it into the
wizard, and add the service account email as a user on each Search Console
property and GA4 property it should read.

## Updates and rollback

The top-level configuration belongs to new installations. The named `staging` and `production` environments retain the maintainer deployment bindings. For those environments, apply migrations with `npx wrangler d1 migrations apply DB --env staging --remote` (or `--env production`) before deploying with the corresponding npm script. Configure Access variables on the right environment before upgrading. Existing tokens keep their original access.

Keep a working setup token and the previous Worker version ID before changing Access. Verify login, a read-only MCP call, and tool discovery on staging. If a release fails, roll the Worker back in Deployments, restore the prior Access policies and keep the encryption secret. The grants migration adds a nullable column and is compatible with the previous Worker. Revoke restricted tokens before rolling back to a version that does not enforce grants.
