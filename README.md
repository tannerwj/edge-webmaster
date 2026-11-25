# Edge Webmaster

A free, open-source, **self-hosted MCP server** that gives AI agents access to
your webmaster tools — Google Search Console, Google Analytics 4, Bing
Webmaster Tools, PageSpeed Insights / CrUX, and IndexNow — from one Cloudflare Worker
that runs in **your own** Cloudflare account.

No hosted shim holds your credentials. You deploy it, you connect your own
Google and Bing accounts in its dashboard, and your agents (Muse, Claude
Code, Grok, any MCP client) talk to *your* instance through Cloudflare Access or with a scoped token you issue.

Part of the Edge family: [Edge IDP](https://github.com/tannerwj/edge-idp) ·
[Edge Mail](https://github.com/tannerwj/edge-mail).

## Why code mode?

A flat MCP catalog for all platforms would be dozens of tools in every
agent's context. Edge Webmaster defaults to **code mode**: agents see exactly
two tools —

- `search_tools` — search the catalog of the connectors you actually connected
- `execute` — run one JavaScript snippet in an isolated sandbox against typed
  proxies (`gsc`, `ga4`, `bing`, `pagespeed`, `indexnow`), chaining calls and filtering in
  code; only the return value comes back

Connectors that aren't set up don't advertise tools at all — no dead ends for
the agent. Prefer the classic catalog? Set `MCP_MODE=raw` and every connected
tool is listed directly.

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tannerwj/edge-webmaster)

1. Choose a Workers Paid account, your repository and D1 database. Supply two random secrets from your password manager, `DEPLOYMENT_SECRET` and `SETUP_TOKEN`. Keep the suggested build and deploy commands. Code mode uses billable Dynamic Workers. [Cloudflare pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)
2. Open your Worker, unlock the dashboard, and connect the providers you use. Google sign-in covers Search Console and GA4. Bing uses a Webmaster API key. PageSpeed can test public URLs immediately. Add a Google API key for CrUX real-user reports.
3. Open **Site reports** to run a Google query report, a GA4 channel report, a Bing query report or a mobile PageSpeed test. Select a property or enter its identifier. **Copy task for agent** carries the selected report and property into your agent.
4. Open **Agent access → Configure Access for this installation**. The wizard walks you through your hostname, administrator and agent sign-in policies, Managed OAuth, client callbacks, and the four Worker variables. Click **Check Access discovery**, add the displayed URL to your agent and sign in.
5. Paste the task from **Site reports** into your agent. A managed OAuth login reads all connected properties. For per-site permissions, create a scoped token and use the separate token endpoint. [Access setup and troubleshooting](DEPLOY.md#give-an-agent-access)

## What's inside

| Connector | Tools |
| --- | --- |
| Google Search Console (`gsc`) | list/get sites, search analytics with bounded pagination, list/get/submit sitemaps, URL inspection, batch inspection, performance review composite |
| Google Analytics 4 (`ga4`) | list properties, metadata, reports, realtime reports, period comparison |
| Bing Webmaster (`bing`) | list sites, query stats, page stats, traffic stats, crawl issues |
| PageSpeed + CrUX (`pagespeed`) | PageSpeed runs (mobile/desktop), CrUX record and history |
| IndexNow (`indexnow`) | verify a site key file and notify participating search engines of changed URLs |

Plus an MCP prompt (`performance_review`), per-tool call metrics and an audit
log in D1, AES-GCM-wrapped credential storage, and a feedback endpoint
(`POST /api/feedback`) so users and agents can report problems to the
maintainer of a deployment.

## Project structure

```
src/            Worker: MCP server, admin API, credential store
  packs/        Connector packs (gsc, ga4, bing, pagespeed)
web/            React dashboard (Dashboard, Connections, Agent Tokens, Activity)
scripts/        build-frontend.mjs — builds web/ into src/frontend.gen.ts
tests/          Vitest suites plus the scripted e2e probe (tests/e2e/probe.mjs)
migrations/     D1 schema migrations
DEPLOY.md       Full deploy guide: D1, secrets, Cloudflare Access, staging
```

## Develop

```bash
npm install
export SETUP_TOKEN=local-development-only  # disposable localhost fixture
# For real provider credentials, inject private runtime secrets from your password manager.
npx wrangler d1 migrations apply edge-webmaster --local
npm run dev -- --var "SETUP_TOKEN:$SETUP_TOKEN"  # localhost only
npm test                  # unit + mocked-upstream pack tests
npm run probe             # scripted probes against the dev server (see tests/e2e/probe.mjs)
npm run check             # abacus gates: lint, abc, tsc, deadcode, secrets, cycles, dupes, todos, ratchet
```

Verify changes on the staging twin before they reach production:

```bash
npm run deploy:staging    # staging worker + its own D1 and Access apps
npm run deploy:prod       # production, once staging checks out
```

## License

MIT — see [LICENSE](LICENSE). The source is freely licensed. Cloudflare usage is billed to the deploying account.
