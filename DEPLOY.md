# Deploying Edge Webmaster

## 1. Create resources

```bash
npx wrangler d1 create edge-webmaster
# put the returned database_id into wrangler.jsonc (replace the all-zero placeholder)
npx wrangler d1 migrations apply edge-webmaster --remote
npx wrangler secret put DEPLOYMENT_SECRET   # 32 random bytes; wraps stored credentials
npx wrangler secret put SETUP_TOKEN         # long random token; bootstrap access to setup
npm run deploy
```

The Deploy-to-Cloudflare button creates the Worker; you still create the D1
database, apply migrations, and set the two secrets as above.

Optionally set `PUBLIC_URL` in `wrangler.jsonc` vars to your canonical origin
(custom domain) so Google OAuth redirect URIs stay stable, and set
`MCP_MODE=raw` if you prefer the classic tool catalog over code mode.

## 2. Protect setup with Cloudflare Access

The setup UI can connect accounts and mint agent tokens, so protect it:

1. In Cloudflare Zero Trust, create an Access application for your worker's
   hostname covering `/` and `/api/*` — but **not** `/mcp`.
2. Add your identity provider (for example Edge IDP / Johnson ID as a generic
   OIDC IdP, Google, or GitHub) and an allow policy for yourself.
3. Create a second Access application for `/mcp` with a **Bypass** policy
   (Everyone). Agent traffic authenticates with its per-deployment API token
   instead — this is the same split used for the Tesla Fleet app's `/mcp` and
   `/api/*` routes: Access gates humans, tokens gate agents.
4. The app detects the `Cf-Access-Authenticated-User-Email` header and treats
   Access-authenticated visitors as setup admins. The `SETUP_TOKEN` login
   remains as a bootstrap/break-glass path; if neither Access nor a
   `SETUP_TOKEN` is present, setup runs in open bootstrap mode and the UI
   shows a warning banner until you fix that.

## 3. Connect Google

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
   personal Google accounts cannot pick it. Then either:
   - **Publish app** so the app is In production (recommended for your own
     long-lived connection). No verification submission is needed for
     personal use; Google shows a one-time "unverified app" warning when
     you connect — choose Advanced → proceed.
   - Or stay in Testing and add your own email under Test users. Warning:
     in Testing, Google expires refresh tokens after 7 days, so the
     connection will need re-connecting weekly.
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

## 4. Issue agent tokens and connect clients

In the wizard: create a token (read = query only; write = also
`sitemap submit`). Clients connect to `POST /mcp` with
`Authorization: Bearer ew_…`. The wizard shows copy-paste snippets for Muse
(custom connector), Claude Code (`claude mcp add --transport http …`), and
generic MCP JSON configs.

## Staging

Releases are verified live on staging before they reach production.

- Worker: `edge-webmaster-staging` (the `staging` env in
  `wrangler.jsonc`), hostname `https://webmaster-staging.tannerwj.dev`.
- Staging has its **own D1 database** (`edge-webmaster-staging`) — it
  never touches production data. Create it once, put the returned id in
  the staging env's `database_id` in `wrangler.jsonc` (replacing the
  all-zero placeholder), and apply migrations:

  ```bash
  npx wrangler d1 create edge-webmaster-staging
  npx wrangler d1 migrations apply edge-webmaster-staging --env staging --remote
  ```

- Staging needs its own secrets (separate values from production):

  ```bash
  npx wrangler secret put DEPLOYMENT_SECRET --env staging
  npx wrangler secret put SETUP_TOKEN --env staging
  ```

- Deploy with `npm run deploy:staging` (`npm run deploy:prod` targets
  production; plain `npm run deploy` is the same as prod).

There is deliberately **no Cloudflare Access application on the staging
hostname**: the `SETUP_TOKEN` login gates setup instead, so staging can
be exercised end to end — including the setup-token path that Access
would otherwise hide — before the same build is promoted to production.

## Updating

Pull `master`, `npm install`, then ship staging first: apply any new D1
migrations (`npx wrangler d1 migrations apply edge-webmaster-staging
--env staging --remote`), `npm run deploy:staging`, and verify the
release live on the staging hostname. Once staging checks out, apply
the migrations to production (`npx wrangler d1 migrations apply
edge-webmaster --remote`) and `npm run deploy:prod`.
