# Changelog

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
