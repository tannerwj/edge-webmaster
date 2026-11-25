import { useEffect, useState } from "react";
import { api, fmtDate, type Metrics } from "../api";

export function Activity() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void api<Metrics>("/api/metrics").then(({ res, data }) => {
      if (cancelled) return;
      if (res.ok) setMetrics(data);
      else setError(true);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p role="alert">Could not load activity. Refresh to try again.</p>;
  if (!metrics) return <div className="card small muted">Loading…</div>;

  return (
    <div>
      <h1>Activity</h1>
      <div className="card">
        <h3>MCP calls (last {metrics.window_days} days)</h3>
        {metrics.tools.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Calls</th>
                <th>OK</th>
              </tr>
            </thead>
            <tbody>
              {metrics.tools.map((t) => (
                <tr key={t.tool_name}>
                  <td>{t.tool_name}</td>
                  <td>{t.calls}</td>
                  <td>{t.ok}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No MCP calls yet in the last 7 days.</p>
        )}
      </div>

      {metrics.audit.length > 0 && (
        <div className="card">
          <h3>Audit log</h3>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {metrics.audit.slice(0, 20).map((a, i) => (
                <tr key={`${a.ts}-${a.action}-${i}`}>
                  <td className="muted">{fmtDate(a.ts)}</td>
                  <td>{a.actor}</td>
                  <td>{a.action}</td>
                  <td>{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
