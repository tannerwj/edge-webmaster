import { useEffect, useState } from "react";
import { api, errText, type Connector, type StatusBody } from "../api";
import { StatusPill } from "../components/StatusPill";

interface TestResult {
  ok: boolean;
  detail: string;
}

async function runTest(id: string): Promise<TestResult> {
  const { data } = await api<{ ok?: boolean; detail?: string }>(`/api/connectors/${id}/test`, {
    method: "POST",
    body: "{}",
  });
  return { ok: Boolean(data.ok), detail: data.detail ?? "" };
}

function ResultLine({ result }: { result: TestResult | string | null }) {
  if (result === null) return null;
  if (typeof result === "string") return <div className="result">{result}</div>;
  return (
    <div className={`result ${result.ok ? "result-ok" : "result-bad"}`}>
      {result.ok ? "✓ " : "✗ "}
      {result.detail}
    </div>
  );
}

function CardMeta({ c }: { c: Connector }) {
  return (
    <>
      <p className="tags small muted">
        {c.provider} • {c.auth_label} • {c.access}
      </p>
      <p className="muted">{c.description}</p>
      {c.examples.length > 0 && (
        <>
          <p className="small label-strong">What your agent can do</p>
          <ul className="examples">
            {c.examples.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </>
      )}
      {c.recommendation && <p className="recommendation small">{c.recommendation}</p>}
      <p className="small muted">
        {c.status_detail} · {c.tools.length} tool{c.tools.length === 1 ? "" : "s"}
      </p>
    </>
  );
}

function SimpleCard({
  c,
  refresh,
  registerRef,
}: {
  c: Connector;
  refresh: () => void;
  registerRef: (id: string, el: HTMLElement | null) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<TestResult | string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const { res, data } = await api(`/api/connectors/${c.id}/configure`, {
      method: "POST",
      body: JSON.stringify(values),
    });
    setBusy(false);
    setResult(res.ok ? "Saved." : errText(data, "Save failed."));
    if (res.ok) refresh();
  };

  const test = async () => {
    setBusy(true);
    const r = await runTest(c.id);
    setBusy(false);
    setResult(r);
    if (r.ok) refresh();
  };

  const disconnect = async () => {
    setBusy(true);
    await api(`/api/connectors/${c.id}`, { method: "DELETE" });
    setBusy(false);
    refresh();
  };

  return (
    <section className="card" ref={(el) => registerRef(c.id, el)}>
      <div className="card-head">
        <h3>{c.name}</h3>
        <StatusPill status={c.status} />
      </div>
      <CardMeta c={c} />
      {c.setup_fields.map((f) => (
        <div key={f.key}>
          <label htmlFor={`${c.id}-${f.key}`}>{f.label}</label>
          <input
            id={`${c.id}-${f.key}`}
            type={f.type === "password" ? "password" : "text"}
            autoComplete="off"
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
          {f.help && <p className="small muted">{f.help}</p>}
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={save} disabled={busy}>
          Save
        </button>
        <button type="button" className="ghost" onClick={test} disabled={busy}>
          Test connection
        </button>
        {c.id !== "pagespeed-crux" && (
          <button type="button" className="danger" onClick={disconnect} disabled={busy}>
            Disconnect
          </button>
        )}
      </div>
      <ResultLine result={result} />
    </section>
  );
}

function GoogleCard({
  packs,
  refresh,
  registerRef,
}: {
  packs: Connector[];
  refresh: () => void;
  registerRef: (id: string, el: HTMLElement | null) => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saJson, setSaJson] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [result, setResult] = useState<TestResult | string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<{ url?: string; redirect_uri?: string; error?: string }>("/api/google/oauth-url").then(
      ({ res, data }) => {
        if (cancelled) return;
        if (res.ok && data.redirect_uri) setRedirectUri(data.redirect_uri);
        else setRedirectUri(`${location.origin}/auth/google/callback`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const saveClient = async () => {
    setBusy(true);
    const { res, data } = await api("/api/connectors/google-search-console/configure", {
      method: "POST",
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    });
    setBusy(false);
    setResult(res.ok ? "Client saved. Now press Connect Google." : errText(data, "Save failed."));
  };

  const saveServiceAccount = async () => {
    setBusy(true);
    const { res, data } = await api("/api/connectors/google-search-console/configure", {
      method: "POST",
      body: JSON.stringify({ service_account_json: saJson }),
    });
    setBusy(false);
    setResult(res.ok ? "Service account saved." : errText(data, "Save failed."));
    if (res.ok) refresh();
  };

  const connect = async () => {
    const { res, data } = await api<{ url?: string; error?: string }>("/api/google/oauth-url");
    if (res.ok && data.url) location.href = data.url;
    else setResult(errText(data, "Save the OAuth client first."));
  };

  const test = async () => {
    setBusy(true);
    const r = await runTest("google-search-console");
    setBusy(false);
    setResult(r);
    if (r.ok) refresh();
  };

  const disconnect = async () => {
    setBusy(true);
    await api("/api/connectors/google-search-console", { method: "DELETE" });
    setBusy(false);
    refresh();
  };

  return (
    <section
      className="card card-wide"
      ref={(el) => {
        registerRef("google-search-console", el);
        registerRef("google-analytics", el);
        registerRef("google", el);
      }}
    >
      <div className="card-head">
        <h3>Google — Search Console + Analytics</h3>
      </div>
      <p className="muted">One Google connection powers both the Search Console and GA4 connectors.</p>
      {packs.map((c) => (
        <div key={c.id} className="subpack">
          <div className="card-head">
            <span className="label-strong">{c.name}</span>
            <StatusPill status={c.status} />
          </div>
          <CardMeta c={c} />
        </div>
      ))}

      <h4>Service account — recommended for sites you own</h4>
      <p className="muted">
        No consent screen, no token expiry. Create a service account in Google Cloud, download its
        JSON key, paste it below, then add the service account email as a user on each Search
        Console and GA4 property it should read.
      </p>
      <label htmlFor="g-sa">Service account JSON key</label>
      <textarea
        id="g-sa"
        placeholder='{"type":"service_account","client_email":"…","private_key":"…"}'
        value={saJson}
        onChange={(e) => setSaJson(e.target.value)}
      />
      <div className="row">
        <button type="button" onClick={saveServiceAccount} disabled={busy}>
          Save service account
        </button>
      </div>

      <h4>OAuth — sign in with Google</h4>
      <label htmlFor="g-id">OAuth Client ID</label>
      <input
        id="g-id"
        autoComplete="off"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
      />
      <label htmlFor="g-secret">OAuth Client secret</label>
      <input
        id="g-secret"
        type="password"
        autoComplete="off"
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
      />
      <label htmlFor="g-redirect">Redirect URI to register in Google Cloud</label>
      <input id="g-redirect" readOnly value={redirectUri} />
      <div className="row">
        <button type="button" className="ghost" onClick={saveClient} disabled={busy}>
          Save client
        </button>
        <button type="button" onClick={connect} disabled={busy}>
          Connect Google
        </button>
      </div>
      <details>
        <summary>Which user type? Internal vs External</summary>
        <ul className="examples">
          <li>
            Internal — only if your Google Cloud project belongs to a Google Workspace organization
            and every account you'll sign in with is in that org. Personal @gmail.com accounts can't
            use Internal; the option won't appear.
          </li>
          <li>
            External — for personal accounts. After creating the client, Publish the app (In
            production). Don't leave it in Testing: Google expires refresh tokens after 7 days and
            the connection silently dies. Publishing for personal use needs no verification
            submission; expect a one-time 'unverified app' warning — choose Advanced → proceed.
          </li>
          <li>
            Either way: enable the Google Search Console API, Google Analytics Data API, and Google
            Analytics Admin API in the project first.
          </li>
        </ul>
      </details>

      <div className="row">
        <button type="button" className="ghost" onClick={test} disabled={busy}>
          Test connection
        </button>
        <button type="button" className="danger" onClick={disconnect} disabled={busy}>
          Disconnect
        </button>
      </div>
      <ResultLine result={result} />
    </section>
  );
}

export function Connections({
  status,
  refresh,
  scrollTarget,
}: {
  status: StatusBody;
  refresh: () => void;
  scrollTarget: string | null;
}) {
  const refs = new Map<string, HTMLElement | null>();
  const registerRef = (id: string, el: HTMLElement | null) => {
    refs.set(id, el);
  };

  useEffect(() => {
    if (!scrollTarget) return;
    const el = refs.get(scrollTarget);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    // refs are populated during render; scrollTarget changes drive the scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget, status]);

  const google = status.connectors.filter((c) => c.connection_id === "google");
  const others = status.connectors.filter((c) => c.connection_id !== "google");

  return (
    <div className="grid">
      {google.length > 0 && <GoogleCard packs={google} refresh={refresh} registerRef={registerRef} />}
      {others.map((c) => (
        <SimpleCard key={c.id} c={c} refresh={refresh} registerRef={registerRef} />
      ))}
    </div>
  );
}
