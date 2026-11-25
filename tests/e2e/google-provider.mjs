// Imported only into the disposable local Worker by local.sh.
globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  if (url.href === "https://oauth2.googleapis.com/token") {
    const form = new URLSearchParams(init.body);
    const account = form.get("code") || form.get("refresh_token");
    return Response.json({ refresh_token: account, access_token: account, expires_in: 3600 });
  }
  if (url.href === "https://www.googleapis.com/webmasters/v3/sites") {
    return Response.json({ siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] });
  }
  if (url.hostname === "analyticsadmin.googleapis.com" && url.pathname.endsWith("/accountSummaries")) {
    return Response.json({ accountSummaries: [] });
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/searchAnalytics/query")) {
    const account = new Headers(init.headers).get("authorization").slice(7);
    return Response.json({ rows: [{ keys: [account + " search query"], clicks: 12, impressions: 60 }] });
  }
  throw new Error("Unexpected outbound request in local probe");
};
