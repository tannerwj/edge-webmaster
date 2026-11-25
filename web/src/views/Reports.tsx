import { useState } from "react";
import { api, errText, type Connector } from "../api";
import { Link } from "../components/nav";
import { CopyButton } from "../components/CopyButton";

const reports = [
  { ns: "gsc", label: "Top Google searches", tool: "gsc_query_search_analytics", field: "site_url", placeholder: "sc-domain:example.com", defaults: { dimensions: ["query"], row_limit: 25 } },
  { ns: "ga4", label: "Traffic by channel", tool: "ga4_run_report", field: "property_id", placeholder: "123456789", defaults: { dimensions: ["sessionDefaultChannelGroup"], metrics: ["sessions"], limit: 25 } },
  { ns: "bing", label: "Bing search queries", tool: "bing_get_query_stats", field: "site_url", placeholder: "https://example.com/", defaults: {} },
  { ns: "pagespeed", label: "Mobile page speed", tool: "pagespeed_run", field: "url", placeholder: "https://example.com/", defaults: { strategy: "mobile" } },
];

type Report = typeof reports[number];
type Row = Record<string, unknown>;

function reportRows(ns: string, result: Row | Row[]): Row[] {
  if (Array.isArray(result)) return result;
  if (ns === "pagespeed") {
    const mobile = result.result as Row;
    return [{ "Score / 100": typeof mobile.score === "number" ? Math.round(mobile.score * 100) : "—", LCP: mobile.lcp, CLS: mobile.cls, TTFB: mobile.ttfb }];
  }
  const rows = (result.rows ?? []) as Row[];
  if (ns === "gsc") return rows.map((r) => ({ Query: (r.keys as string[]).join(", "), Clicks: r.clicks, Impressions: r.impressions }));
  return rows.map((r) => ({ Channel: (r.dimensionValues as { value: string }[])[0]?.value, Sessions: (r.metricValues as { value: string }[])[0]?.value }));
}

function ReportForm({ report, connector }: { report: Report; connector: Connector }) {
  const properties = report.ns === "ga4" ? (connector.health?.propertyIds ?? []).map((id) => id.replace(/^properties\//, "")) : connector.health?.items ?? [];
  const [property, setProperty] = useState(properties[0] ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setError("");
    setRows(null);
    setBusy(true);
    try {
      const { res, data } = await api<{ result: Row | Row[] }>(`/api/reports/${report.tool}`, {
        method: "POST", body: JSON.stringify({ ...report.defaults, [report.field]: property.trim() }),
      });
      if (!res.ok) throw new Error(errText(data, "Could not run report."));
      setRows(reportRows(report.ns, data.result));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not run report."); }
    finally { setBusy(false); }
  }
  if (!connector.tools.includes(report.tool) || !connector.configured) return <p>Connect {connector.name} to run this report. <Link href={`/connections/${connector.id}`}>Open setup →</Link></p>;
  return <>
    <form onSubmit={(e) => { e.preventDefault(); void run(); }}>
      <label htmlFor="property">{report.ns === "pagespeed" ? "Page URL" : report.ns === "ga4" ? "GA4 property ID" : "Verified site property"}</label>
      <input id="property" required disabled={busy} type={report.ns === "pagespeed" ? "url" : "text"} list="report-properties" placeholder={report.placeholder} value={property} onChange={(e) => { setProperty(e.target.value); setRows(null); setError(""); }} />
      <datalist id="report-properties">{properties.map((p, i) => <option key={p} value={p}>{connector.health?.items?.[i]}</option>)}</datalist>
      <button disabled={busy || !property.trim()}>{busy ? "Running report…" : "Run report"}</button>
      {property.trim() && <CopyButton label="Copy task for agent" value={`Run ${report.label.toLowerCase()} for ${property.trim()} using ${report.tool} and summarize the results.`} />}
    </form>
    {error && <p role="alert" className="result result-bad">{error}{report.ns === "pagespeed" && error.includes("429") && <> The Google quota is exhausted. <Link href="/connections/pagespeed-crux">Configure a project API key</Link> or retry after the quota resets.</>}</p>}
    {rows && <div className="report-result" role="region" aria-label="Report results">
      {rows.length ? <table><thead><tr>{Object.keys(rows[0]!).map((k) => <th key={k}>{k}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{Object.keys(rows[0]!).map((k) => <td key={k}>{typeof r[k] === "string" ? r[k] as string : JSON.stringify(r[k] ?? "—")}</td>)}</tr>)}</tbody></table> : <p>The provider returned no rows for this property.</p>}
    </div>}
  </>;
}

export function Reports({ connectors }: { connectors: Connector[] }) {
  const [ns, setNs] = useState(() => reports.find((r) => connectors.some((c) => c.namespace === r.ns && c.configured))?.ns ?? "gsc");
  const report = reports.find((r) => r.ns === ns)!;
  const connector = connectors.find((c) => c.namespace === ns);
  return <div><h1>Site reports</h1><section className="card">
    <label htmlFor="report">Report</label>
    <select id="report" value={ns} onChange={(e) => setNs(e.target.value)}>
      {reports.map((r) => <option key={r.ns} value={r.ns}>{r.label}</option>)}
    </select>
    {connector && <ReportForm key={ns} report={report} connector={connector} />}
  </section></div>;
}
