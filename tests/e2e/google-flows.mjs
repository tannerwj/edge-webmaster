import assert from "node:assert/strict";

const base = process.env.BASE;
const login = await fetch(base + "/api/login", { method: "POST", body: JSON.stringify({ token: process.env.SETUP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
function request(path, body) {
  return fetch(base + path, { headers: { cookie, "content-type": "application/json" }, redirect: "manual",
    ...(body && { method: "POST", body: JSON.stringify(body) }) });
}
async function start() {
  const res = await request("/api/google/oauth-url");
  assert.equal(res.status, 200);
  return new URL((await res.json()).url).searchParams.get("state");
}
function finish(state, account) {
  return request("/auth/google/callback?" + new URLSearchParams({ state, code: account }));
}
async function report(account, cached) {
  const res = await request("/api/reports/gsc_query_search_analytics", { site_url: "sc-domain:example.com" });
  assert.equal(res.status, 200);
  const { result } = await res.json();
  assert.deepEqual(result.rows, [{ keys: [account + " search query"], clicks: 12, impressions: 60 }]);
  assert.equal(Boolean(result.cached), cached);
}
assert.equal((await request("/api/connectors/google-search-console/configure", { client_id: "fixture", client_secret: "fixture" })).status, 200);
assert.equal((await finish("expired", "unused")).status, 400);
assert.equal((await finish("legacy", "legacy")).status, 302);
assert.equal((await finish("legacy", "legacy")).status, 400);
for (const account of ["first", "second"]) {
  assert.equal((await finish(await start(), account)).status, 302);
  await report(account, false);
  await report(account, true);
}
console.log("PASS reconnect isolates Search Console reports and preserves same-account cache hits");
const [a, b] = await Promise.all([start(), start()]);
assert.notEqual(a, b);
assert.equal((await finish(b, "newer")).status, 302);
assert.equal((await finish(a, "older")).status, 302);
const c = await start();
const raced = await Promise.all([finish(c, "last"), finish(c, "last")]);
assert.deepEqual(raced.map(r => r.status).sort((left, right) => left - right), [302, 400]);
await report("last", false);
console.log("PASS overlapping sign-ins complete in reverse order and each callback works once");
