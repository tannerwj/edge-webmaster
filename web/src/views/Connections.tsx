import { useEffect, useState } from "react";
import { api, errText, type Connector, type StatusBody } from "../api";
import { Link } from "../components/nav";
import { StatusPill } from "../components/StatusPill";
import { TestConnectionButton } from "../components/TestConnectionButton";
import { BingSetup, GoogleSetup, PageSpeedSetup, ResultLine, runTest, type TestResult } from "./connectorSetup";

export function ConnectionsOverview({ status }: { status: StatusBody }) {
  return (
    <div>
      <h1>Connections</h1>
      <div className="connector-grid">
        {status.connectors.map((c) => (
          <section key={c.id} className="connector-card">
            <div className="card-head">
              <h3>{c.name}</h3>
              <StatusPill status={c.status} />
            </div>
            <p className="tags small muted">{c.provider} • {c.auth_label} • {c.access}</p>
            <p className="connector-desc">{c.description}</p>
            {c.recommendation && <p className="recommendation small">{c.recommendation}</p>}
            <div className="row">
              <Link className="btn-link" href={`/connections/${c.id}`}>Open</Link>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function ConnectorPage({
  connector,
  all,
  refresh,
}: {
  connector: Connector;
  all: Connector[];
  refresh: () => void;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectedNote, setConnectedNote] = useState(false);
  const isGoogle = connector.connection_id === "google";
  const googlePacks = all.filter((c) => c.connection_id === "google");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("connected")) {
      setConnectedNote(true);
      params.delete("connected");
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [connector.id]);

  const test = async (): Promise<TestResult> => {
    const r = await runTest(connector.id);
    if (r.ok) refresh();
    return r;
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const { res, data } = await api(`/api/connectors/${connector.id}`, { method: "DELETE" });
      setResult(res.ok ? "Disconnected." : errText(data, "Disconnect failed."));
      if (res.ok) refresh();
    } catch {
      setResult("Could not reach the Worker. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const showDanger = connector.credentials_present || connector.google_connection?.oauth_client_saved;

  return (
    <div className="connector-page">
      <p className="small"><Link href="/connections">← All connections</Link></p>
      <div className="page-head">
        <h1>{connector.name}</h1>
        <StatusPill status={connector.status} />
      </div>
      {isGoogle && (
        <p className="note-banner">Search Console and Analytics share one Google connection.</p>
      )}
      {connectedNote && (
        <div className="result result-ok banner-ok" role="status">
          Google connected. Run a test below to confirm your properties are visible.
        </div>
      )}

      <section className="page-section">
        <h3>Setup</h3>
        <div className="card">
          {isGoogle && <GoogleSetup packs={googlePacks.length ? googlePacks : [connector]} refresh={refresh} onTest={test} />}
          {connector.id === "bing-webmaster" && <BingSetup c={connector} refresh={refresh} onTest={test} />}
          {connector.id === "pagespeed-crux" && <PageSpeedSetup c={connector} refresh={refresh} onTest={test} />}
          {!isGoogle && connector.id !== "bing-webmaster" && connector.id !== "pagespeed-crux" && (
            <p className="muted">Follow the provider's setup, save credentials, then test above.</p>
          )}
        </div>
      </section>

      <div className="summary-grid">
        <section className="page-section">
          <h3>Status</h3>
          <div className="card">
            <p>{connector.status_detail}</p>
            {connector.health && (
              <p className="small muted">
                Health: {connector.health.ok ? "OK" : "Failing"} — {connector.health.detail}
                {typeof connector.health.count === "number" ? ` (${connector.health.count} properties)` : ""}
              </p>
            )}
            <TestConnectionButton onTest={test} />
          </div>
        </section>

        <section className="page-section">
          <h3>About</h3>
          <div className="card">
            <p className="tags small muted">{connector.provider} • {connector.auth_label} • {connector.access}</p>
            <p>{connector.description}</p>
            {connector.examples.length > 0 && (
              <>
                <p className="small label-strong">What your agent can do</p>
                <ul className="examples">
                  {connector.examples.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </>
            )}
            {connector.recommendation && <p className="recommendation small">{connector.recommendation}</p>}
            {connector.tools.length > 0 && (
              <details>
                <summary>{connector.tools.length} tool{connector.tools.length === 1 ? "" : "s"}</summary>
                <ul className="examples">
                  {connector.tools.map((t) => <li key={t}><code>{t}</code></li>)}
                </ul>
              </details>
            )}
          </div>
        </section>
      </div>

      {showDanger && (
        <section className="page-section danger-zone">
          <h3>Disconnect</h3>
          <p className="small muted">
            {isGoogle
              ? "Removes the shared Google connection — Search Console and Analytics both stop working for your agent."
              : "Removes the saved credentials for this connector. Your agent loses access until you reconnect."}
          </p>
          <div className="row">
            <button type="button" className="danger" onClick={() => void disconnect()} disabled={busy}>Disconnect</button>
          </div>
        </section>
      )}
      <ResultLine result={result} />
    </div>
  );
}
