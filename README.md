# Edge Webmaster

A free, open-source, **self-hosted MCP server** that gives AI agents access to
your webmaster tools — Google Search Console, Google Analytics 4, Bing
Webmaster Tools, and PageSpeed Insights / CrUX — from one Cloudflare Worker
that runs in **your own** Cloudflare account.

No hosted shim holds your credentials. You deploy it, you connect your own
Google and Bing accounts in its dashboard, and your agents (Muse, Claude
Code, Grok, any MCP client) talk to *your* instance with a token *you* issued.

Part of the Edge family: [Edge IDP](https://github.com/tannerwj/edge-idp) ·
[Edge Mail](https://github.com/tannerwj/edge-mail).

## Why code mode?

A flat MCP catalog for four platforms would be dozens of tools in every
agent's context. Edge Webmaster defaults to **code mode**: agents see exactly
two tools —

- `search_tools` — search the catalog of the connectors you actually connected
- `execute` — run one JavaScript snippet in an isolated sandbox against typed
  proxies (`gsc`, `ga4`, `bing`, `pagespeed`), chaining calls and filtering in
  code; only the return value comes back

Connectors that aren't set up don't advertise tools at all — no dead ends for
the agent. Prefer the classic catalog? Set `MCP_MODE=raw` and every connected
tool is listed directly.

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tannerwj/edge-webmaster)

1. Click deploy (or `git clone`, `npm install`, `npm run deploy`). Create the
   D1 database and apply migrations as [DEPLOY.md](DEPLOY.md) describes, and
   set the `DEPLOYMENT_SECRET` and `SETUP_TOKEN` secrets.
2. Open your worker's URL. The **dashboard** (Dashboard, Connections,
   Agent Tokens, Activity) walks you through connecting each platform — every
   connector has its own page with numbered, turnkey setup steps and a Test
   button whose result appears right where you clicked it. Connection status
   is honest and five-state — *not connected*, *available* (works with no
   setup), *configured*, *connected*, *error* — and a connector only reads
   **Connected** after a real health check against the platform passes.
   - **Google** — two ways in, one connection lights up both Search Console
     and GA4:
     - **OAuth sign-in (recommended for your own sites)** — it acts as your
       Google account, so every property you already have access to works
       with zero per-property grants. You create your own Google Cloud OAuth
       client; the setup walks the consent-screen steps (External, then
       Publish the app — or stay in Testing with yourself as a test user and
       accept that Google expires refresh tokens after 7 days) and shows the
       exact redirect URI to paste.
     - **Service account (headless / team setups)** — no consent screen, no
       token expiry, but you grant the service account's email access on each
       property yourself; a Domain property needs just one grant per domain.
   - **Bing** — paste a Webmaster API key.
   - **PageSpeed/CrUX** — works immediately; an API key is optional and only
     raises quotas.
3. Mint an **agent token** (read or write scope) on the Agent Tokens page.
4. Point your MCP client at `https://<your-instance>/mcp` with
   `Authorization: Bearer ew_…`. The **Set up your agent** panel on the Agent
   Tokens page has per-client copy-paste snippets (Muse, Claude Code, Grok,
   generic) plus a downloadable agent-ready Markdown file — also served at
   `GET /setup-agent.md` — that you can hand to an agent so it can configure
   itself.

Put Cloudflare Access in front of the dashboard pages for real deployments —
[DEPLOY.md](DEPLOY.md) covers the Access + your own IdP (e.g. Edge IDP /
Johnson ID) wiring and the `/mcp` bypass pattern.

## What's inside

| Connector | Tools |
| --- | --- |
| Google Search Console (`gsc`) | list/get sites, search analytics with bounded pagination, list/get/submit sitemaps, URL inspection, batch inspection, performance review composite |
| Google Analytics 4 (`ga4`) | list properties, metadata, reports, realtime reports, period comparison |
| Bing Webmaster (`bing`) | list sites, query stats, page stats, traffic stats, crawl issues |
| PageSpeed + CrUX (`pagespeed`) | PageSpeed runs (mobile/desktop), CrUX record and history |

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
cp .dev.vars.example .dev.vars   # fill in local secrets
npx wrangler d1 migrations apply edge-webmaster --local
npm run dev               # wrangler dev
npm test                  # unit + mocked-upstream pack tests
npm run probe             # scripted probes against the dev server (see tests/e2e/probe.mjs)
npm run check             # abacus gates: lint, abc, tsc, deadcode, secrets, cycles, dupes, todos, ratchet
```

Verify changes on the staging twin before they reach production:

```bash
npm run deploy:staging    # staging worker + its own D1, no Access in front
npm run deploy:prod       # production, once staging checks out
```

## License

MIT — see [LICENSE](LICENSE). Free forever; deploy as many instances as you like.
