export const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edge Webmaster — Setup</title>
<style>
  :root { color-scheme: light dark; --bg: #0b0e14; --card: #131722; --line: #232a3a; --text: #e6e9f0; --muted: #8b94a7; --accent: #f48120; --ok: #3fb96f; --bad: #e5534b; }
  @media (prefers-color-scheme: light) { :root { --bg: #f6f7f9; --card: #ffffff; --line: #dde1e8; --text: #171a21; --muted: #5b6472; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.55 system-ui, sans-serif; background: var(--bg); color: var(--text); }
  main { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 28px 0 10px; } h3 { margin: 0 0 6px; font-size: 16px; }
  .muted { color: var(--muted); } .small { font-size: 13px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px; margin: 14px 0; }
  .pill { display: inline-block; padding: 1px 9px; border-radius: 99px; font-size: 12px; border: 1px solid var(--line); }
  .pill.ok { color: var(--ok); border-color: var(--ok); } .pill.off { color: var(--muted); }
  label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
  input, textarea, select { width: 100%; padding: 9px 10px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--text); font: inherit; }
  textarea { min-height: 84px; font-family: ui-monospace, monospace; font-size: 12px; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 9px 14px; font: inherit; cursor: pointer; margin: 10px 8px 0 0; }
  button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
  button.danger { background: transparent; color: var(--bad); border: 1px solid var(--bad); }
  pre { background: rgba(127,127,127,.12); padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12.5px; }
  code { font-family: ui-monospace, monospace; }
  ol li { margin: 5px 0; } .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .result { font-size: 13px; margin-top: 8px; white-space: pre-wrap; }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; } td, th { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; }
  details { margin-top: 10px; } summary { cursor: pointer; color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Edge Webmaster</h1>
  <p class="muted">Your self-hosted webmaster MCP server. Connect the tools below, mint an agent token, and point your AI clients at <code id="mcp-url"></code>.</p>
  <div id="gate" hidden>
    <div class="card"><h3>Setup access</h3>
    <p class="small muted">This deployment is protected. Sign in through Cloudflare Access, or enter the setup token you set at deploy time.</p>
    <label>Setup token</label><input id="gate-token" type="password" autocomplete="off">
    <button id="gate-go">Unlock setup</button><div class="result" id="gate-result"></div></div>
  </div>
  <div id="app" hidden>
    <div id="warn"></div>
    <h2>Connections</h2>
    <div id="connectors"></div>
    <h2>Agent tokens</h2>
    <div class="card">
      <p class="small muted">Tokens authenticate MCP clients (Muse, Claude Code, Grok, any MCP client). Read tokens can query; write tokens can also submit sitemaps. The raw token is shown once.</p>
      <div class="row"><input id="tok-name" placeholder="Token name, e.g. claude-code-laptop" style="flex:2">
      <select id="tok-scope" style="flex:1"><option value="read">read</option><option value="write">write</option></select>
      <button id="tok-create">Create token</button></div>
      <div class="result" id="tok-result"></div>
      <table id="tok-table"></table>
    </div>
    <h2>Connect your agents</h2>
    <div class="card" id="snippets"></div>
    <h2>Activity (last 7 days)</h2>
    <div class="card"><div id="metrics" class="small">Loading…</div></div>
    <h2>Feedback</h2>
    <div class="card">
      <p class="small muted">Found a problem or want a connector? Reports are stored on this deployment for the maintainer.</p>
      <textarea id="fb-text" placeholder="What happened, and what did you expect?"></textarea>
      <button id="fb-send">Send feedback</button><div class="result" id="fb-result"></div>
    </div>
  </div>
</main>
<script>
const $ = (s) => document.querySelector(s);
const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  return { res, data };
};
$("#mcp-url").textContent = location.origin + "/mcp";
let STATUS = null;

async function load() {
  const { res, data } = await api("/api/status");
  if (res.status === 401) { $("#gate").hidden = false; $("#app").hidden = true; return; }
  STATUS = data;
  $("#gate").hidden = true; $("#app").hidden = false;
  $("#warn").innerHTML = data.bootstrap_open ? '<div class="card" style="border-color:var(--bad)"><strong>Setup is open.</strong> <span class="small">No SETUP_TOKEN and no Cloudflare Access detected. Put Access in front of this site or set the SETUP_TOKEN secret, then redeploy — anyone who can reach this page can connect accounts and mint tokens until you do.</span></div>' : "";
  renderConnectors(); renderSnippets(); loadTokens(); loadMetrics();
}

const googleGuide = \`
<details><summary>Step-by-step: create your Google OAuth client (about 5 minutes)</summary>
<ol>
<li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a> and create (or pick) a project — this is <em>your</em> project; Edge Webmaster never sees a shared client.</li>
<li>Under <strong>APIs &amp; Services → Library</strong>, enable <strong>Google Search Console API</strong> and <strong>Google Analytics Data API</strong> (and <strong>Google Analytics Admin API</strong> for property listing).</li>
<li>Under <strong>APIs &amp; Services → OAuth consent screen</strong>, choose External, name the app anything, and add your email. While the app is in Testing, add yourself under Test users.</li>
<li>Under <strong>Credentials → Create credentials → OAuth client ID</strong>, choose <strong>Web application</strong>.</li>
<li>Under <strong>Authorized redirect URIs</strong>, paste the redirect URI shown in the Google card below (this deployment's <code>/auth/google/callback</code>).</li>
<li>Copy the Client ID and Client secret into the Google card, save, then press <strong>Connect Google</strong> and approve.</li>
</ol>
<p class="small muted">Alternative: a <strong>service account</strong>. Create one in the same project, download its JSON key, paste it below — and add the service account email as a user on each Search Console property and GA4 property it should read. No browser consent needed.</p>
</details>\`;

function googleCard() {
  return \`<div class="card" id="card-google">
    <div class="row"><h3 style="flex:1">Google — Search Console + Analytics</h3><span class="pill" data-pill="google">…</span></div>
    <p class="small muted">One Google connection powers both the Search Console and GA4 connectors.</p>
    <label>OAuth Client ID</label><input id="g-id" autocomplete="off">
    <label>OAuth Client secret</label><input id="g-secret" type="password" autocomplete="off">
    <div class="row"><button id="g-save">Save client</button><button class="ghost" id="g-connect">Connect Google</button></div>
    <label>Redirect URI to register in Google Cloud</label><input id="g-redirect" readonly>
    \${googleGuide}
    <label>Service account JSON (alternative)</label><textarea id="g-sa" placeholder='{"type":"service_account","client_email":"…","private_key":"…"}'></textarea>
    <div class="row"><button class="ghost" id="g-sa-save">Save service account</button><button class="ghost" data-test="google-search-console">Test connection</button><button class="danger" data-disconnect="google-search-console">Disconnect</button></div>
    <div class="result" id="g-result"></div></div>\`;
}

function simpleCard(c) {
  const fields = c.setup_fields.map(f => \`<label>\${f.label}</label><input data-field="\${f.key}" type="\${f.type === "password" ? "password" : "text"}" autocomplete="off">\${f.help ? \`<p class="small muted">\${f.help}</p>\` : ""}\`).join("");
  return \`<div class="card" id="card-\${c.id}">
    <div class="row"><h3 style="flex:1">\${c.name}</h3><span class="pill \${c.configured ? "ok" : "off"}">\${c.configured ? "connected" : "not connected"}</span></div>
    <p class="small muted">\${c.blurb}</p>\${fields}
    <div class="row"><button data-save="\${c.id}">Save</button><button class="ghost" data-test="\${c.id}">Test connection</button>\${c.id !== "pagespeed-crux" ? \`<button class="danger" data-disconnect="\${c.id}">Disconnect</button>\` : ""}</div>
    <div class="result" data-result="\${c.id}"></div></div>\`;
}

function renderConnectors() {
  const google = STATUS.connectors.filter(c => c.id.startsWith("google"));
  const others = STATUS.connectors.filter(c => !c.id.startsWith("google"));
  $("#connectors").innerHTML = googleCard() + others.map(simpleCard).join("");
  const gOk = google.every(c => c.configured);
  document.querySelector('[data-pill="google"]').outerHTML = \`<span class="pill \${gOk ? "ok" : "off"}">\${gOk ? "connected" : "not connected"}</span>\`;
  wireCards();
  api("/api/google/oauth-url").then(({ data }) => { if (data.redirect_uri) $("#g-redirect").value = data.redirect_uri; });
}

function wireCards() {
  const on = (sel, ev, fn) => document.querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn));
  on("[data-test]", "click", async (e) => {
    const id = e.target.dataset.test;
    const { data } = await api("/api/connectors/" + id + "/test", { method: "POST", body: "{}" });
    const target = document.querySelector('[data-result="' + id + '"]') || $("#g-result");
    target.textContent = (data.ok ? "✓ " : "✗ ") + (data.detail || "");
    if (data.ok) load();
  });
  on("[data-disconnect]", "click", async (e) => {
    await api("/api/connectors/" + e.target.dataset.disconnect, { method: "DELETE" });
    load();
  });
  on("[data-save]", "click", async (e) => {
    const id = e.target.dataset.save;
    const card = document.getElementById("card-" + id);
    const body = {};
    card.querySelectorAll("[data-field]").forEach(i => body[i.dataset.field] = i.value);
    const { res, data } = await api("/api/connectors/" + id + "/configure", { method: "POST", body: JSON.stringify(body) });
    document.querySelector('[data-result="' + id + '"]').textContent = res.ok ? "Saved." : (data.error || "Save failed.");
    if (res.ok) load();
  });
  $("#g-save").addEventListener("click", async () => {
    const { res, data } = await api("/api/connectors/google-search-console/configure", { method: "POST", body: JSON.stringify({ client_id: $("#g-id").value, client_secret: $("#g-secret").value }) });
    $("#g-result").textContent = res.ok ? "Client saved. Now press Connect Google." : (data.error || "Save failed.");
  });
  $("#g-connect").addEventListener("click", async () => {
    const { res, data } = await api("/api/google/oauth-url");
    if (res.ok && data.url) location.href = data.url;
    else $("#g-result").textContent = data.error || "Save the OAuth client first.";
  });
  $("#g-sa-save").addEventListener("click", async () => {
    const { res, data } = await api("/api/connectors/google-search-console/configure", { method: "POST", body: JSON.stringify({ service_account_json: $("#g-sa").value }) });
    $("#g-result").textContent = res.ok ? "Service account saved." : (data.error || "Save failed.");
    if (res.ok) load();
  });
}

function renderSnippets() {
  const url = location.origin + "/mcp";
  $("#snippets").innerHTML = \`
  <p class="small muted">Mode: <strong>\${STATUS.mode}</strong> — \${STATUS.mode === "code" ? "agents see search_tools + execute and reach every connected tool through the sandbox proxies." : "agents see every connected tool directly."}</p>
  <label>Claude (web/desktop custom connector)</label><pre>URL: \${url}
Header: Authorization: Bearer ew_YOUR_TOKEN</pre>
  <label>Claude Code</label><pre>claude mcp add --transport http edge-webmaster \${url} --header "Authorization: Bearer ew_YOUR_TOKEN"</pre>
  <label>Generic MCP client (JSON)</label><pre>{
  "mcpServers": {
    "edge-webmaster": {
      "url": "\${url}",
      "headers": { "Authorization": "Bearer ew_YOUR_TOKEN" }
    }
  }
}</pre>\`;
}

async function loadTokens() {
  const { data } = await api("/api/tokens");
  const rows = (data.tokens || []).map(t => \`<tr><td>\${t.name}</td><td>\${t.scope}</td><td class="muted">\${new Date(t.created_at * 1000).toLocaleDateString()}</td><td><button class="danger" data-revoke="\${t.id}">Revoke</button></td></tr>\`).join("");
  $("#tok-table").innerHTML = rows ? "<tr><th>Name</th><th>Scope</th><th>Created</th><th></th></tr>" + rows : '<tr><td class="muted">No tokens yet.</td></tr>';
  document.querySelectorAll("[data-revoke]").forEach(b => b.addEventListener("click", async () => { await api("/api/tokens/" + b.dataset.revoke, { method: "DELETE" }); loadTokens(); }));
}

async function loadMetrics() {
  const { data } = await api("/api/metrics");
  const tools = (data.tools || []).map(t => \`<tr><td>\${t.tool_name}</td><td>\${t.calls}</td><td>\${t.ok}</td></tr>\`).join("");
  $("#metrics").innerHTML = tools ? "<table><tr><th>Tool</th><th>Calls</th><th>OK</th></tr>" + tools + "</table>" : "No MCP calls yet in the last 7 days.";
}

$("#gate-go").addEventListener("click", async () => {
  const { res, data } = await api("/api/login", { method: "POST", body: JSON.stringify({ token: $("#gate-token").value }) });
  if (res.ok) load(); else $("#gate-result").textContent = data.error || "Failed.";
});
$("#tok-create").addEventListener("click", async () => {
  const { res, data } = await api("/api/tokens", { method: "POST", body: JSON.stringify({ name: $("#tok-name").value, scope: $("#tok-scope").value }) });
  $("#tok-result").innerHTML = res.ok ? "Token (copy it now, it is shown once):<pre>" + data.token + "</pre>" : (data.error || "Failed.");
  if (res.ok) loadTokens();
});
$("#fb-send").addEventListener("click", async () => {
  const { res, data } = await api("/api/feedback", { method: "POST", body: JSON.stringify({ role: "owner", message: $("#fb-text").value, context: location.href }) });
  $("#fb-result").textContent = res.ok ? "Sent — " + data.receipt : (data.error || "Failed.");
  if (res.ok) $("#fb-text").value = "";
});
if (new URLSearchParams(location.search).get("connected")) history.replaceState(null, "", "/");
load();
</script>
</body>
</html>`;
