import { useEffect, useState, type ReactNode } from "react";
import { api, emailIn, errText, type Connector } from "../api";
import { JsonCredentialField } from "../components/JsonCredentialField";
import { StepList, type Step } from "../components/StepList";
import { TestConnectionButton, type TestOutcome } from "../components/TestConnectionButton";

export type TestResult = TestOutcome;

export async function runTest(id: string): Promise<TestResult> {
  const { data } = await api<{ ok?: boolean; detail?: string; detail_secondary?: string; items?: unknown }>(
    `/api/connectors/${id}/test`,
    { method: "POST", body: "{}" },
  );
  const items = Array.isArray(data.items) ? data.items.filter((i): i is string => typeof i === "string") : undefined;
  return {
    ok: Boolean(data.ok),
    detail: data.detail ?? "",
    ...(data.detail_secondary ? { secondary: data.detail_secondary } : {}),
    ...(items ? { items } : {}),
  };
}

export function ResultLine({ result }: { result: TestResult | string | null }) {
  if (result === null) return null;
  if (typeof result === "string") return <div className="result">{result}</div>;
  return (
    <div>
      <div className={`result ${result.ok ? "result-ok" : "result-bad"}`}>
        {result.ok ? "✓ " : "✗ "}
        {result.detail}
      </div>
      {result.secondary && <p className="small muted result-secondary">{result.secondary}</p>}
    </div>
  );
}

const PROJECT_STEP: Step = {
  title: "Create a Google Cloud project",
  instruction: "Click Create project and name it anything. Already have one? Pick it in the console's project picker instead.",
  links: [{ label: "Open project creation", href: "https://console.cloud.google.com/projectcreate" }],
};

const API_LINKS = [
  { label: "Search Console API", href: "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" },
  { label: "Analytics Data API", href: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com" },
  { label: "Analytics Admin API", href: "https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com" },
];

const APIS_STEP: Step = {
  title: "Enable the APIs",
  instruction: "Click Enable on each (use the same project).",
  links: API_LINKS,
};

function TestStepContent({ onTest, successHint }: { onTest: () => Promise<TestResult>; successHint: string }) {
  return (
    <div>
      <TestConnectionButton onTest={onTest} />
      <p className="small muted">{successHint}</p>
    </div>
  );
}

export function GoogleSetup({
  packs,
  refresh,
  onTest,
}: {
  packs: Connector[];
  refresh: () => void;
  onTest: () => Promise<TestResult>;
}) {
  const gc = packs.find((p) => p.google_connection)?.google_connection ?? null;
  const saOnly = Boolean(gc?.service_account_saved && !gc.oauth_client_saved && !gc.oauth_signed_in);
  const [method, setMethod] = useState<"oauth" | "sa">(() => (saOnly ? "sa" : "oauth"));
  const [replaceClient, setReplaceClient] = useState(false);
  const [replaceSa, setReplaceSa] = useState(false);
  const [saJson, setSaJson] = useState("");
  const [saEmail, setSaEmail] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [result, setResult] = useState<TestResult | string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fromStatus =
    emailIn(packs.map((p) => `${p.status_detail} ${p.health?.detail ?? ""}`).join(" ")) ?? null;
  const shownEmail = gc?.service_account_email ?? saEmail ?? fromStatus;
  const clientSaved = Boolean(gc?.oauth_client_saved);
  const showClientForm = !clientSaved || replaceClient;
  const saSaved = Boolean(gc?.service_account_saved);
  const showSaForm = !saSaved || replaceSa;

  useEffect(() => {
    let cancelled = false;
    void api<{ redirect_uri?: string }>("/api/google/oauth-url?preview=1").then(({ res, data }) => {
      if (cancelled) return;
      setRedirectUri(res.ok && data.redirect_uri ? data.redirect_uri : `${location.origin}/auth/google/callback`);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSaChange = (v: string) => {
    setSaJson(v);
    try {
      const parsed = JSON.parse(v) as { client_email?: unknown };
      setSaEmail(typeof parsed.client_email === "string" ? parsed.client_email : null);
    } catch {
      setSaEmail(emailIn(v));
    }
  };

  const saveSa = async () => {
    setSaving(true);
    const { res, data } = await api("/api/connectors/google-search-console/configure", {
      method: "POST",
      body: JSON.stringify({ service_account_json: saJson }),
    });
    setSaving(false);
    if (res.ok) {
      setReplaceSa(false);
      setSaJson("");
      setResult("Service account saved. Give it access (step 6), then test.");
      refresh();
    } else {
      setResult(errText(data, "Save failed."));
    }
  };

  const saveClient = async () => {
    setSaving(true);
    const { res, data } = await api("/api/connectors/google-search-console/configure", {
      method: "POST",
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    });
    setSaving(false);
    if (res.ok) {
      setReplaceClient(false);
      setClientSecret("");
      setResult("Client saved — now click Sign in with Google (step 6).");
      refresh();
    } else {
      setResult(errText(data, "Save failed."));
    }
  };

  const clearClient = async () => {
    setClearing(true);
    const { res, data } = await api("/api/google/oauth-client", { method: "DELETE" });
    setClearing(false);
    if (res.ok) {
      setReplaceClient(false);
      setResult("OAuth client cleared.");
      refresh();
    } else {
      setResult(errText(data, "Clear failed."));
    }
  };

  const clearSa = async () => {
    setClearing(true);
    const { res, data } = await api("/api/google/service-account", { method: "DELETE" });
    setClearing(false);
    if (res.ok) {
      setReplaceSa(false);
      setSaJson("");
      setResult("Service account cleared.");
      refresh();
    } else {
      setResult(errText(data, "Clear failed."));
    }
  };

  const connect = async () => {
    const { res, data } = await api<{ url?: string; error?: string }>("/api/google/oauth-url");
    if (res.ok && data.url) location.href = data.url;
    else setResult(errText(data, "Save the OAuth client first."));
  };

  const saSteps: Step[] = [
    PROJECT_STEP,
    APIS_STEP,
    {
      title: "Create the service account",
      instruction: "Click Create service account, name it edge-webmaster, Create and continue, then Done (skip the optional grants).",
      links: [{ label: "Open service accounts", href: "https://console.cloud.google.com/iam-admin/serviceaccounts" }],
    },
    {
      title: "Download its JSON key",
      instruction: "Open the account → Keys → Add key → Create new key → JSON → Create. A .json file downloads.",
    },
    {
      title: "Add the JSON key",
      instruction: saSaved && !replaceSa
        ? "A service account is already saved — see the panel above. Use Replace there to paste a different key."
        : "Paste the full contents of the downloaded .json file — or choose/drop the file here — then Save.",
      content: showSaForm ? (
        <div>
          <JsonCredentialField id="g-sa" label="Service account JSON key" value={saJson} onChange={onSaChange} placeholder='{"type":"service_account","client_email":"…","private_key":"…"}' />
          <div className="row">
            <button type="button" onClick={() => void saveSa()} disabled={saving || !saJson.trim()}>Save service account</button>
          </div>
        </div>
      ) : undefined,
    },
    {
      title: "Grant access in Google (one-time, per property)",
      instruction: shownEmail
        ? "Add this service account email as a user on each property. Search Console: pick the property → Settings → Users and permissions → Add user → paste the email → Restricted. GA4: Admin → Property access management → + → paste the email → Viewer. Repeat per property."
        : "The email is the client_email in the JSON you pasted (it's shown here after you paste or save + test). Search Console: pick the property → Settings → Users and permissions → Add user → paste the email → Restricted. GA4: Admin → Property access management → + → paste the email → Viewer. Repeat per property.",
      links: [
        { label: "Open Search Console", href: "https://search.google.com/search-console" },
        { label: "Open Google Analytics", href: "https://analytics.google.com" },
      ],
      copyValue: shownEmail ?? undefined,
      copyLabel: "Copy service account email",
      content: (
        <div>
          <p className="why-box">
            Why by hand? Google's Search Console API can list and manage properties, but it exposes no way to
            manage a property's users or permissions — no app can grant a service account access for you. This
            step is manual in Google's UI by design. Cloudflare isn't involved: a site being in your Cloudflare
            account doesn't put it in Search Console or grant anything.
          </p>
          <ul className="examples small">
            <li>
              Many sites? Use the OAuth sign-in option instead — it acts as your own Google account, so every
              property you already have access to works immediately, with zero per-property grants.
            </li>
            <li>
              Fewer grants: a Domain property in Search Console (sc-domain:…) needs just one grant and covers
              all subdomains plus both http and https — far fewer than separate URL-prefix properties.
            </li>
          </ul>
        </div>
      ),
    },
    {
      title: "Test the connection",
      instruction: "Run the test. Success shows how many properties the connection can see.",
      content: <TestStepContent onTest={onTest} successHint="Success lists the properties the connection can see — a property count greater than zero, with the property names shown." />,
    },
  ];

  const oauthSteps: Step[] = [
    PROJECT_STEP,
    APIS_STEP,
    {
      title: "Set up the OAuth consent screen",
      instruction: "Configure who can sign in and how the app appears to Google:",
      links: [
        { label: "Open Branding", href: "https://console.cloud.google.com/auth/branding" },
        { label: "Open Audience", href: "https://console.cloud.google.com/auth/audience" },
        { label: "Open OAuth overview (first-time setup)", href: "https://console.cloud.google.com/auth/overview" },
      ],
      content: (
        <ul className="examples">
          <li>First time in this project? Start at Overview → Get started.</li>
          <li>Enter an app name, your user support email, and a developer contact email.</li>
          <li>
            At Audience, choose External. Internal only appears for Google Workspace organizations, and only
            accounts inside that organization can use it — personal Google accounts need External.
          </li>
          <li>
            To test now, add your Google account under Audience → Test users. For these scopes, Testing
            refresh tokens normally expire after seven days.
          </li>
          <li>
            Before publishing, complete Branding. Enter your authorized domain and these public URLs.
            Open each while signed out to check that Google can read it.
            <ul>{[["Application home page", "/about"], ["Privacy policy", "/about/privacy"], ["Terms of service (optional)", "/about/terms"]].map(([label, path]) => (
              <li key={path}>{label}: <a href={path} target="_blank" rel="noreferrer">{location.origin}{path}</a></li>
            ))}</ul>
          </li>
          <li>
            A logo is optional. Save Branding, return to Audience and use Publish app when ready.
            Check Verification Center for any review Google requires for your audience and scopes.
          </li>
        </ul>
      ),
    },
    {
      title: "Create the OAuth client",
      instruction:
        "Click Create client → Web application. Under Authorized redirect URIs, click Add URI and paste the redirect URI below exactly. Then click Create and copy the Client ID and secret Google shows.",
      links: [{ label: "Open OAuth clients", href: "https://console.cloud.google.com/auth/clients" }],
      copyValue: redirectUri || undefined,
      copyLabel: "Copy redirect URI",
    },
    {
      title: "Save the client here",
      instruction: clientSaved && !replaceClient
        ? "A client is already saved — see the panel above. Use Replace there to paste different values."
        : "Copy the Client ID and Client secret from the client you just created, paste them here, then Save.",
      content: showClientForm ? (
        <div>
          <label htmlFor="g-id">OAuth Client ID</label>
          <input id="g-id" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <label htmlFor="g-secret">OAuth Client secret</label>
          <input id="g-secret" type="password" autoComplete="off" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          <div className="row">
            <button type="button" className="ghost" onClick={() => void saveClient()} disabled={saving}>Save client</button>
          </div>
        </div>
      ) : undefined,
    },
    {
      title: "Sign in with Google",
      instruction: gc?.oauth_signed_in
        ? "This connection is signed in with Google. Reconnect only if you changed the client or Google revoked access."
        : "Sign in with the Google account that owns your properties and approve access.",
      content: (
        <div>
          <div className="row">
            <button type="button" onClick={() => void connect()}>
              {gc?.oauth_signed_in ? "Reconnect Google" : "Sign in with Google"}
            </button>
          </div>
          {gc?.oauth_signed_in && <p className="small muted">Signed in with Google.</p>}
        </div>
      ),
    },
    {
      title: "Test the connection",
      instruction: "Run the test. Success shows how many properties the connection can see.",
      content: <TestStepContent onTest={onTest} successHint="Success lists the properties the connection can see — a property count greater than zero, with the property names shown." />,
    },
  ];

  const oauthPanel = clientSaved ? (
    <div className="saved-panel">
      <p className="saved-panel-title">
        Client saved — ID {gc?.oauth_client_id_masked ?? "…"}
      </p>
      <p className="small muted">{gc?.oauth_signed_in ? "Signed in with Google." : "Not signed in yet."}</p>
      {gc?.oauth_needs_sign_in && (
        <button type="button" className="btn-block" onClick={() => void connect()}>
          Sign in with Google
        </button>
      )}
      <div className="row">
        <button type="button" className="ghost btn-small" onClick={() => setReplaceClient(true)} disabled={replaceClient}>
          Replace
        </button>
        <button type="button" className="danger btn-small" onClick={() => void clearClient()} disabled={clearing}>
          Clear
        </button>
      </div>
    </div>
  ) : null;

  const saPanel = saSaved ? (
    <div className="saved-panel">
      <p className="saved-panel-title">Service account saved — {gc?.service_account_email ?? shownEmail ?? ""}</p>
      <div className="row">
        <button type="button" className="ghost btn-small" onClick={() => setReplaceSa(true)} disabled={replaceSa}>
          Replace
        </button>
        <button type="button" className="danger btn-small" onClick={() => void clearSa()} disabled={clearing}>
          Clear
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div>
      <div className="method-cards" role="group" aria-label="Google setup method">
        <button
          type="button"
          className={method === "oauth" ? "method-card method-card-active" : "method-card"}
          aria-pressed={method === "oauth"}
          onClick={() => setMethod("oauth")}
        >
          <span className="method-card-title">OAuth sign-in — Recommended for your own sites</span>
          <span className="method-card-body">
            Acts as your Google account; every property you can already open just works.
          </span>
        </button>
        <button
          type="button"
          className={method === "sa" ? "method-card method-card-active" : "method-card"}
          aria-pressed={method === "sa"}
          onClick={() => setMethod("sa")}
        >
          <span className="method-card-title">Service account — Headless / team setups</span>
          <span className="method-card-body">
            No sign-in, but you grant its email access per property.
          </span>
        </button>
      </div>
      {method === "oauth" ? (
        <div>
          {oauthPanel}
          <StepList key="oauth" steps={oauthSteps} />
        </div>
      ) : (
        <div>
          {saPanel}
          <StepList key="sa" steps={saSteps} />
        </div>
      )}
      <ResultLine result={result} />
    </div>
  );
}

function FieldSteps({
  c,
  refresh,
  onTest,
  stepsBefore,
  successHint,
}: {
  c: Connector;
  refresh: () => void;
  onTest: () => Promise<TestResult>;
  stepsBefore: Step[];
  successHint: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<TestResult | string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { res, data } = await api(`/api/connectors/${c.id}/configure`, {
      method: "POST",
      body: JSON.stringify(values),
    });
    setSaving(false);
    setResult(res.ok ? "Saved. Now test the connection." : errText(data, "Save failed."));
    if (res.ok) { setValues({}); refresh(); }
  };

  const fieldContent: ReactNode = (
    <div>
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
        <button type="button" onClick={() => void save()} disabled={saving || !c.setup_fields.every((f) => values[f.key]?.trim())}>Save</button>
      </div>
    </div>
  );

  const steps: Step[] = [
    ...stepsBefore,
    {
      title: c.id === "pagespeed-crux" ? "Paste the API key" : "Paste the API key here",
      instruction: "Paste the key, then Save.",
      content: fieldContent,
    },
    {
      title: "Test the connection",
      instruction: "Run the test to verify the key works.",
      content: <TestStepContent onTest={onTest} successHint={successHint} />,
    },
  ];
  return (
    <div>
      <StepList steps={steps} />
      <ResultLine result={result} />
    </div>
  );
}

export function BingSetup({ c, refresh, onTest }: { c: Connector; refresh: () => void; onTest: () => Promise<TestResult> }) {
  return (
    <FieldSteps
      c={c}
      refresh={refresh}
      onTest={onTest}
      successHint="Success looks like: a count of your verified sites."
      stepsBefore={[
        {
          title: "Open Bing Webmaster Tools",
          instruction: "Sign in, and add and verify your site first if it isn't listed yet.",
          links: [{ label: "Open Bing Webmaster Tools", href: "https://www.bing.com/webmasters" }],
        },
        {
          title: "Generate the API key",
          instruction: "Click Settings (gear) → API Access → Generate API Key, then copy the key.",
          links: [{ label: "Open API Access", href: "https://www.bing.com/webmasters/home/apiaccess" }],
        },
      ]}
    />
  );
}

export function PageSpeedSetup({ c, refresh, onTest }: { c: Connector; refresh: () => void; onTest: () => Promise<TestResult> }) {
  return (
    <div>
      <p className="muted">
        You can run a PageSpeed lab report now. Add a key for real-user metrics and history. This key works independently of Google OAuth.
      </p>
      <FieldSteps
        c={c}
        refresh={refresh}
        onTest={onTest}
        successHint="Success confirms the key is accepted by CrUX."
        stepsBefore={[
          {
            title: "Enable both APIs",
            instruction: "Open each link, select the project where you will create the key, and click Enable. If you see Manage, the API is already enabled. If either API is missing from the key restriction list, return here, enable it, then reload the key editor.",
            links: [
              { label: "PageSpeed Insights API", href: "https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com" },
              { label: "Chrome UX Report API", href: "https://console.cloud.google.com/apis/library/chromeuxreport.googleapis.com" },
            ],
          },
          {
            title: "Create and restrict the key",
            instruction: "Choose Create credentials → API key. Under Application restrictions, select None for a standard Cloudflare Worker, which calls Google server-side. Under API restrictions, select Restrict key and choose only PageSpeed Insights API and Chrome UX Report API. Save and copy the key.",
            links: [{ label: "Open credentials", href: "https://console.cloud.google.com/apis/credentials" }],
          },
        ]}
      />
    </div>
  );
}
