const pages = new Map([
  ["/about", {
    title: "Edge Webmaster",
    body: '<p>Explore how people find your sites. Edge Webmaster brings Google Search Console, Google Analytics, Bing Webmaster Tools and PageSpeed into one self-hosted dashboard.</p><p>Connect your accounts to run reports by site, inspect URLs and manage sitemaps. You can also authorize an AI agent to use the connected tools.</p><p><a href="/">Sign in to the dashboard →</a></p>',
  }],
  ["/about/privacy", {
    title: "Privacy policy",
    body: '<p>This installation runs in its operator’s Cloudflare account. Connecting Google lets Edge Webmaster read Search Console properties, queries, pages and sitemap data, manage sitemaps on request, and read Google Analytics properties and reports.</p><h2>Storage and sharing</h2><p>The app encrypts stored connection credentials in Cloudflare D1. It stores activity records and caches some Search Console report results. Authorized dashboard users and connected agents can receive results within their permissions. An agent’s provider may process the results it receives.</p><h2>Control your data</h2><p>You can revoke Google access in <a href="https://myaccount.google.com/connections">Google Account connections</a>. To request deletion of stored credentials, cached reports or activity records, contact the installation operator at the support email shown on the Google consent screen. Revoking access stops future Google requests with that grant. Stored records require separate deletion.</p>',
  }],
  ["/about/terms", {
    title: "Terms of service",
    body: '<p>Use this installation only for sites and accounts you have permission to manage. When you connect an account or authorize an agent, choose permissions appropriate to its work. Write operations such as submitting a sitemap can change data at the connected service.</p><p>Google, Microsoft and other connected services apply their own terms and quotas. Contact the installation operator through the support email on the Google consent screen for help with access or use.</p>',
  }],
]);

export function publicInfo(path: string, method: string): Response {
  const page = pages.get(path);
  if (!page) return new Response("Not found", { status: 404 });
  if (method !== "GET" && method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${page.title} · Edge Webmaster</title>
<style>html{color-scheme:light dark}body{max-width:42rem;margin:auto;padding:clamp(1rem,5vw,4rem);font:1.1rem/1.65 system-ui,sans-serif}h1,h2{line-height:1.2}h1{margin-top:2em}h2{font-size:1.25em;margin-top:2em}nav{display:flex;gap:1.4rem;flex-wrap:wrap;border-bottom:1px solid #8994;padding-bottom:1rem}a{color:LinkText;text-underline-offset:.2em}</style>
<nav aria-label="Information"><a href="/about">Edge Webmaster</a><a href="/about/privacy">Privacy policy</a><a href="/about/terms">Terms of service</a></nav><main><h1>${page.title}</h1>${page.body}</main></html>`;
  return new Response(method === "HEAD" ? null : html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
