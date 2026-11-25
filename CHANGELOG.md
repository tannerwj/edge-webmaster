# Changelog

## 0.2.0 — 2026-11-25

The setup wizard is now a real dashboard, and the Google sign-in flow is
fixed end to end.

- React dashboard replaces the wizard UI: Dashboard, Connections with a page
  per connector, Agent Tokens, and Activity, with path-based routing (no
  more hash routes) and a profile menu with persisted theme preferences and
  logout.
- Permanent staging deployment (`deploy:staging`) — a twin instance with its
  own D1 and no Access in front — so every change is verified live before
  production.
- Per-connector pages with turnkey, numbered setup steps and deep links
  co-located with the fields they configure; the Google setup leads with an
  auth-method chooser (OAuth sign-in recommended for your own sites, service
  account for headless/team setups).
- Honest five-state connection statuses (not connected / available /
  configured / connected / error): "Connected" only appears after a real
  health check passes — PageSpeed/CrUX on a fresh install now correctly reads
  "Available — no setup needed."
- Service-account JSON can be picked as a file or drag-and-dropped, not just
  pasted, with instant client-side validation.
- Test connection results render inline next to the button you clicked, with
  a last-tested timestamp and the list of properties the connection can see.
- OAuth fixes: the access-token cache is keyed to the credential that minted
  it and invalidated on any credential change (a stale token from a replaced
  client caused "invalid authentication credentials" errors); credential
  saves no longer blank the sibling field; saved credentials show as masked
  panels so nothing looks lost; testing before sign-in returns plain guidance
  instead of a raw Google error; consent-screen steps and links corrected
  (consent step links the audience page, with the Publish-vs-test-users
  choice and the 7-day Testing expiry spelled out).
- Agent Tokens page gains "Set up your agent": per-client copy snippets and
  a downloadable agent-ready Markdown setup file (also at
  `GET /setup-agent.md`).

## 0.1.0 — 2026-11-24

First release.

- Code-mode MCP server (search_tools + execute) with a Dynamic Worker sandbox
  and typed per-connector proxies; raw catalog mode via MCP_MODE=raw.
- Connector registry: packs advertise tools only when configured and healthy.
- Google Search Console (8 tools including batch inspection and the
  performance-review composite), GA4 (5 tools), Bing Webmaster (5 tools),
  PageSpeed Insights + CrUX (3 tools).
- Setup wizard: Google OAuth (BYO client) and service-account connection,
  Bing and PageSpeed keys, per-agent scoped tokens, connect snippets,
  metrics, audit log, feedback with receipts.
- AES-GCM-wrapped credential storage in D1; hashed agent tokens.
