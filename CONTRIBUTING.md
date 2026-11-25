# Contributing

Edge Webmaster is a single-tenant, self-hosted worker. Contributions are
welcome — especially new connector packs.

## Ground rules

- `master` is the only long-lived branch. Commit messages describe the change.
- `npm run check` (Abacus) and `npm test` must pass. New routes and tools ship
  with tests in the same commit: unit tests for pure logic, mocked-upstream
  tests for pack handlers, and probe coverage for HTTP/MCP behavior.
- Credentials are never logged, returned, or committed. Upstream secrets are
  stored only AES-GCM-wrapped in D1.

## Adding a connector pack

1. Create `src/packs/<id>.ts` implementing `ConnectorPack`: id, namespace,
   auth type, setup fields, `configured`, `health`, and `tools` whose names
   are `<namespace>_<method>`.
2. Register it in `src/packs/index.ts`. The registry, `search_tools`, the
   sandbox proxies, raw mode, and the setup UI pick it up automatically.
3. Add the namespace to `NAMESPACES` in `src/sandbox.ts` if agents should
   reach it from `execute`.
4. Add mocked-upstream tests and a probe assertion that the pack stays hidden
   until configured.
