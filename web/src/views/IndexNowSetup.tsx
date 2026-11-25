import { useState } from "react";
import { api, errText } from "../api";

export function IndexNowSetup({ sites, refresh }: { sites: string[]; refresh: () => void }) {
  const [origin, setOrigin] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID().replaceAll("-", ""));
  const [selected, setSelected] = useState("");
  const [urls, setUrls] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const site = sites.includes(selected) ? selected : sites[0] ?? "";
  const batch = urls.split(/\s+/).filter(Boolean);
  const validKey = /^[A-Za-z0-9-]{8,128}$/.test(key);
  async function run(path: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const { res, data } = await api<{message?: string; site?: string; submitted?: number}>(path, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) { setMessage(errText(data, "Request failed.")); return; }
      setMessage(data.message ? `${data.submitted} URL(s). ${data.message}` : success);
      if (data.site) { setSelected(data.site); refresh(); }
      if (data.submitted) setUrls("");
    } catch { setMessage("Could not reach the Worker. Check your connection."); }
    finally { setBusy(false); }
  }
  return <>
    <details open={!sites.length}>
      <summary>Add or update a site</summary>
      <label>HTTPS site root<input type="url" placeholder="https://www.example.com/" value={origin} onChange={e => setOrigin(e.target.value)} /></label>
      <label>Verification key<input autoComplete="off" value={key} onChange={e => setKey(e.target.value.trim())} /></label>
      <p>Use the generated key, or paste your existing key. Upload the text file to the top level of the website you want to submit. You need permission to publish files there.</p>
      {validKey && <p><a download={key + ".txt"} href={"data:text/plain;charset=utf-8," + encodeURIComponent(key)}>Download verification file</a></p>}
      {validKey && origin && <p>Expected address: <code>{origin.replace(/\/+$/, "")}/{key}.txt</code></p>}
      <button disabled={busy || !origin || !validKey} onClick={() => void run("/api/connectors/indexnow/configure", {site_url:origin,api_key:key}, "File verified and site saved.")}>Verify file and save site</button>
    </details>
    {site && <>
      <label>Verified site<select value={site} onChange={e => {setSelected(e.target.value);setUrls("");setMessage("");}}>{sites.map(s => <option key={s}>{s}</option>)}</select></label>
      <button disabled={busy} onClick={() => void run("/api/reports/indexnow_check_site", {site_url:site}, "Public key file verified.")}>Recheck key file</button>
      <label>Changed URLs (one per line)<textarea value={urls} onChange={e => setUrls(e.target.value)} placeholder={site + "updated-page"} /></label>
      <p>Send added, edited or removed pages to participating search engines. Each engine decides whether to crawl and index them.</p>
      <button disabled={busy || !batch.length} onClick={() => void run("/api/connectors/indexnow/submit", {site_url:site,urls:batch}, "Submission received.")}>Submit {batch.length || ""} {batch.length === 1 ? "URL" : "URLs"} to IndexNow</button>
    </>}
    <p role="status">{busy ? "Contacting service…" : message}</p>
  </>;
}
