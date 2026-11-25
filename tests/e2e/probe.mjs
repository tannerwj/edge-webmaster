// Scripted probes against a running wrangler dev instance.
// Usage: BASE=http://127.0.0.1:8787 SETUP_TOKEN=... MODE=code|raw node tests/e2e/probe.mjs
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const SETUP_TOKEN = process.env.SETUP_TOKEN || "";
const MODE = process.env.MODE || "code";
let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

let cookie = "";
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}, opts.headers),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { res, data: await res.json().catch(() => ({})) };
}

const health = await api("/health");
check("health", health.res.status === 200 && health.data.name === "edge-webmaster");

const home = await fetch(BASE + "/");
const homeText = await home.text();
check("setup page serves", home.status === 200 && homeText.includes("Edge Webmaster"));

if (SETUP_TOKEN) {
  const login = await api("/api/login", { method: "POST", body: JSON.stringify({ token: SETUP_TOKEN }) });
  check("setup login with token", login.res.status === 200);
  const bad = await fetch(BASE + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "wrong" }),
  });
  check("setup login rejects wrong token", bad.status === 401);
}

const status = await api("/api/status");
check("status lists 4 connectors", status.data.connectors?.length === 4, (status.data.connectors || []).map((c) => c.id).join(","));
const byId = Object.fromEntries((status.data.connectors || []).map((c) => [c.id, c]));
check("pagespeed always configured", byId["pagespeed-crux"]?.configured === true);
check("google not configured yet", byId["google-search-console"]?.configured === false);
check("bing not configured yet", byId["bing-webmaster"]?.configured === false);

const unavailableReport = await api("/api/reports/gsc_query_search_analytics", { method: "POST", body: "{}" });
check("report requests guide users to connector setup", unavailableReport.res.status === 404 && unavailableReport.data.error.includes("Connect"));

const created = await api("/api/tokens", {
  method: "POST",
  body: JSON.stringify({ name: "probe", scope: "read" }),
});
check("agent token created", created.res.status === 200 && created.data.token?.startsWith("ew_"));
const token = created.data.token;

async function rpc(body, withToken = true) {
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withToken ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { res, data: await res.json().catch(() => ({})) };
}

const unauth = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, false);
check("mcp rejects missing token", unauth.res.status === 401);

const init = await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
});
check("mcp initialize", init.data.result?.serverInfo?.name === "edge-webmaster");

const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const names = (list.data.result?.tools || []).map((t) => t.name);
if (MODE === "code") {
  check("code mode lists only search_tools + execute", JSON.stringify(names) === JSON.stringify(["search_tools", "execute"]), names.join(","));
  const execDesc = list.data.result.tools.find((t) => t.name === "execute")?.description || "";
  check("execute declares pagespeed proxy", execDesc.includes("declare const pagespeed"));
  check("execute omits unconfigured gsc proxy", !execDesc.includes("declare const gsc"));
} else {
  check("raw mode lists pagespeed tools directly", names.includes("pagespeed_run") && !names.includes("pagespeed_crux_record"), names.join(","));
  check("raw mode omits unconfigured gsc tools", !names.includes("gsc_list_sites"));
}

const search = await rpc({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "search_tools", arguments: { query: "pagespeed url" } },
});
check("search_tools finds pagespeed_run", (search.data.result?.content?.[0]?.text || "").includes("pagespeed_run"));
const searchGsc = await rpc({
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: { name: "search_tools", arguments: { query: "sitemap" } },
});
check("search_tools honest when gsc unconfigured", (searchGsc.data.result?.content?.[0]?.text || "").trim() === "[]");

const execMath = await rpc({
  jsonrpc: "2.0",
  id: 5,
  method: "tools/call",
  params: { name: "execute", arguments: { code: "const x = 21; return x * 2;" } },
});
check("execute returns computed value", (execMath.data.result?.content?.[0]?.text || "").includes('"value": 42'), execMath.data.result?.content?.[0]?.text?.slice(0, 120));

const execUnconfigured = await rpc({
  jsonrpc: "2.0",
  id: 6,
  method: "tools/call",
  params: { name: "execute", arguments: { code: "return await bing.list_sites({});" } },
});
const execText = execUnconfigured.data.result?.content?.[0]?.text || "";
check("execute surfaces unconfigured connector honestly", execText.includes("not be connected") || execText.includes("unconfigured") || execText.includes("Error"), execText.slice(0, 160));

const prompts = await rpc({ jsonrpc: "2.0", id: 7, method: "prompts/list", params: {} });
check("prompts/list has performance_review", (prompts.data.result?.prompts || []).some((p) => p.name === "performance_review"));

const feedback = await api("/api/feedback", {
  method: "POST",
  body: JSON.stringify({ role: "probe", message: "probe feedback", context: "probe" }),
});
check("feedback returns receipt", feedback.res.status === 200 && String(feedback.data.receipt || "").startsWith("feedback #"));

const metrics = await api("/api/metrics");
check("metrics recorded mcp calls", (metrics.data.tools || []).length >= 1, JSON.stringify(metrics.data.tools || []).slice(0, 120));

// Exercise the scoped endpoint through D1 and the real sandbox without calling a provider.
const limited = await api("/api/tokens", { method: "POST", body: JSON.stringify({ name: "probe-scoped", grants: { bing: ["https://example.com/"] } }) });
check("scoped token created", limited.res.ok && Boolean(limited.data.token));
async function limitedCall(method, params) {
  const res = await fetch(BASE + "/mcp/token", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${limited.data.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, body: await res.json() };
}
const catalog = await limitedCall("tools/list", {});
check("scoped declarations omit PageSpeed", catalog.status === 200 && !JSON.stringify(catalog.body.result).includes("declare const pagespeed"));
const restricted = await limitedCall("tools/call", { name: "execute", arguments: { code: "return await pagespeed.run({url: 'https://example.com/'});" } });
check("scope enforced in sandbox", restricted.body.result?.isError === true && restricted.body.result.content[0].text.includes("unconfigured"));
await api("/api/tokens/" + limited.data.record.id, { method: "DELETE" });
check("revocation takes effect", (await limitedCall("tools/list", {})).status === 401);
await api("/api/tokens/" + created.data.record.id, { method: "DELETE" });

console.log(failures ? `\n${failures} FAILURES` : "\nALL PROBES PASSED");
process.exit(failures ? 1 : 0);
