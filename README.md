# Edge Webmaster

A free, open-source, **self-hosted MCP server** that gives AI agents access to
your webmaster tools — Google Search Console, Google Analytics 4, Bing
Webmaster Tools, and PageSpeed Insights / CrUX — from one Cloudflare Worker
that runs in **your own** Cloudflare account.

No hosted shim holds your credentials. You deploy it, you connect your own
Google and Bing accounts in its setup wizard, and your agents (Muse, Claude
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
2. Open your worker's URL. The setup wizard walks you through:
   - **Google** — for sites you own, paste a service-account JSON (no consent
     screen, no token expiry). OAuth also works: create your own Google Cloud
     OAuth client (the wizard shows the exact redirect URI and steps),
     connect once, and both Search Console and GA4 light up. See DEPLOY.md
     for the Internal (Workspace org) vs External (personal account — publish
     the app, don't stay in Testing) choice.
   - **Bing** — paste a Webmaster API key.
   - **PageSpeed/CrUX** — works immediately; an API key is optional.
3. Mint an **agent token** (read or write scope) in the wizard.
4. Point your MCP client at `https://<your-instance>/mcp` with
   `Authorization: Bearer ew_…` — snippets for Muse, Claude Code and generic
   clients are in the wizard.

Put Cloudflare Access in front of the setup pages for real deployments —
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

## License

MIT — see [LICENSE](LICENSE). Free forever; deploy as many instances as you like.
