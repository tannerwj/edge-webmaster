import { getCredential, putCredential } from "../creds";
import { obj, type ConnectorPack, type Env } from "../registry";
import { OpError, str } from "../util";

const prefix = "indexnow:";
const dbPrefix = "cred:" + prefix;

function webUrl(value: unknown) {
  const url = URL.parse(str(value));
  if (!url || url.protocol !== "https:" || url.port || url.username || url.password || url.hash)
    throw new OpError("Enter an absolute HTTPS URL without a port, credentials or fragment.");
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(url.hostname) || /\.(?:local|localhost|internal)$/.test(url.hostname))
    throw new OpError("Use a public website hostname.");
  return url;
}

function siteRoot(value: unknown) {
  const url = webUrl(value);
  if (url.href !== url.origin + "/") throw new OpError("Enter the site homepage, without a path or query.");
  return url.href;
}

async function sites(env: Env) {
  const rows = await env.DB.prepare("SELECT key FROM settings WHERE key GLOB ?1 ORDER BY key").bind(dbPrefix + "*").all<{ key: string }>();
  return rows.results.map(row => row.key.slice(dbPrefix.length));
}

async function verifyFile(site: string, key: string) {
  const failure = "Host the downloaded key file at the HTTPS site root, readable without a login or redirect, then retry.";
  try {
    const response = await fetch(site + key + ".txt", { redirect: "manual", signal: AbortSignal.timeout(8000) });
    if (response.status !== 200 || !response.body) throw new Error();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let contents = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.length + contents.length > 256) throw new Error();
        contents += decoder.decode(value, { stream: true });
      }
    } finally { await reader.cancel(); }
    if ((contents + decoder.decode()).trim() !== key) throw new Error();
  } catch { throw new OpError(failure); }
}

export async function configureIndexNow(env: Env, args: Record<string, unknown>) {
  const site = siteRoot(args.site_url);
  const key = str(args.api_key);
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new OpError("Use an IndexNow key of 8–128 letters, digits or dashes.");
  await verifyFile(site, key);
  await putCredential(env, prefix + site, key);
  return { ok: true, site };
}

async function savedKey(env: Env, site: string) {
  const key = await getCredential<string>(env, prefix + site);
  if (!key) throw new OpError("Verify the key file for this site in Connections first.");
  return key;
}

export async function submitIndexNow(env: Env, args: Record<string, unknown>) {
  const site = siteRoot(args.site_url);
  if (!Array.isArray(args.urls) || !args.urls.length || args.urls.length > 10000)
    throw new OpError("Enter between 1 and 10,000 changed URLs for this site.");
  const urls = args.urls.map(value => {
    const url = webUrl(value);
    if (url.origin + "/" !== site) throw new OpError("Every submitted URL must belong to the selected site.");
    return url.href;
  });
  const urlList = [...new Set(urls)];
  const key = await savedKey(env, site);
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, redirect: "error",
    body: JSON.stringify({ host: new URL(site).hostname, key, urlList }),
  });
  const status = response.status;
  if (status !== 200 && status !== 202) throw new OpError(`IndexNow returned HTTP ${status}. ${status === 429 ? "Wait before retrying." : "Check the site, URLs and public key file."}`);
  return { status, submitted: urlList.length, message: status === 202 ? "Received; IndexNow key validation is pending." : "Submitted to IndexNow." };
}

const siteField = { type: "string", description: "Verified HTTPS site root, including trailing slash." };
export const indexNowPack: ConnectorPack = {
  id: "indexnow", namespace: "indexnow", name: "IndexNow", provider: "IndexNow", connectionId: "indexnow",
  authType: "api-key", setupKind: "api-key", authLabel: "Site verification file", access: "Read + write actions",
  blurb: "Notify participating search engines when pages are added, updated or removed.",
  examples: ["Check a site's verification file", "Submit changed URLs for a verified site"],
  recommendation: "Connect a site where you can publish a text file at the root.", setupFields: [],
  credentialsPresent: async env => (await sites(env)).length > 0,
  health: async env => {
    const items = await sites(env);
    return { ok: items.length > 0, items, count: items.length, detail: `Sites verified at setup: ${items.length}` };
  },
  tools: [
    { name: "indexnow_check_site", namespace: "indexnow", description: "Check that the saved site's public key file still matches.",
      inputSchema: obj({ site_url: siteField }, ["site_url"]), write: false,
      handler: async ({env}, args) => {
        const site = siteRoot(args.site_url);
        await verifyFile(site, await savedKey(env, site));
        return { site, verified: true };
      } },
    { name: "indexnow_submit_urls", namespace: "indexnow", description: "Notify IndexNow about added, changed or deleted URLs on one verified site.",
      inputSchema: obj({ site_url: siteField, urls: { type: "array", items: { type: "string" } } }, ["site_url", "urls"]),
      write: true, handler: ({env}, args) => submitIndexNow(env, args) },
  ],
};

export async function disconnectIndexNow(env: Env) {
  await env.DB.prepare("DELETE FROM settings WHERE key GLOB ?1").bind(dbPrefix + "*").run();
}
