import { useEffect, useState, type ReactNode } from "react";
import { api, emailIn, errText, type Connector } from "../api";
import { JsonCredentialField } from "../components/JsonCredentialField";
import { StepList, type Step } from "../components/StepList";
import { TestConnectionButton, type TestOutcome } from "../components/TestConnectionButton";

export type TestResult = TestOutcome;

export async function runTest(id: string): Promise<TestResult> {
  const { data } = await api<{ ok?: boolean; detail?: string; items?: unknown }>(`/api/connectors/${id}/test`, {
    method: "POST",
    body: "{}",
  });
  const items = Array.isArray(data.items) ? data.items.filter((i): i is string => typeof i === "string") : undefined;
  return { ok: Boolean(data.ok), detail: data.detail ?? "", ...(items ? { items } : {}) };
}

export function ResultLine({ result }: { result: TestResult | string | null }) {
  if (result === null) return null;
  if (typeof result === "string") return <div className="result">{result}</div>;
  return (
    <div className={`result ${result.ok ? "result-ok" : "result-bad"}`}>
      {result.ok ? "✓ " : "✗ "}
      {result.detail}
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
  const [tab, setTab] = useState<"sa" | "oauth">("sa");
  const [saJson, setSaJson] = useState("");
  const [saEmail, setSaEmail] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [result, setResult] = useState<TestResult | string | null>(null);
  const [saving, setSaving] = useState(false);

  const fromStatus =
    emailIn(packs.map((p) => `${p.status_detail} ${p.health?.detail ?? ""}`).join(" ")) ?? null;
  const shownEmail = saEmail ?? fromStatus;

  useEffect(() => {
    let cancelled = false;
    void api<{ redirect_uri?: string }>("/api/google/oauth-url").then(({ res, data }) => {
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
    setResult(res.ok ? "Service account saved. Give it access (step 6), then test." : errText(data, "Save failed."));
    if (res.ok) refresh();
  };

  const saveClient = async () => {
    setSaving(true);
    const { res, data } = await api("/api/connectors/google-search-console/configure", {
      method: "POST",
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    });
    setSaving(false);
    setResult(res.ok ? "Client saved. Now press Connect Google in the last step." : errText(data, "Save failed."));
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
      instruction: "Paste the full contents of the downloaded .json file — or choose/drop the file here — then Save.",
      content: (
        <div>
          <JsonCredentialField id="g-sa" label="Service account JSON key" value={saJson} onChange={onSaChange} placeholder='{"type":"service_account","client_email":"…","private_key":"…"}' />
          <div className="row">
            <button type="button" onClick={() => void saveSa()} disabled={saving || !saJson.trim()}>Save service account</button>
          </div>
        </div>
      ),
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
              Many sites? Use the OAuth sign-in tab instead — it acts as your own Google account, so every
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
      title: "Configure consent",
      instruction:
        "APIs & Services → OAuth consent screen. Internal: Workspace org only — personal @gmail.com accounts won't see this option. External: pick it for personal accounts, then Publish the app (In production) — Testing expires refresh tokens in 7 days. Expect a one-time unverified-app warning: Advanced → proceed.",
      links: [{ label: "Open credentials", href: "https://console.cloud.google.com/apis/credentials" }],
    },
    {
      title: "Create the OAuth client",
      instruction: "Click Create credentials → OAuth client ID → Web application.",
      links: [{ label: "Open credentials", href: "https://console.cloud.google.com/apis/credentials" }],
    },
    {
      title: "Paste this redirect URI",
      instruction: "In the new client, under Authorized redirect URIs, click Add URI and paste this exactly.",
      copyValue: redirectUri || undefined,
      copyLabel: "Copy redirect URI",
    },
    {
      title: "Save the client here",
      instruction: "Copy the Client ID and Client secret from the client you just created, paste them here, then Save.",
      content: (
        <div>
          <label htmlFor="g-id">OAuth Client ID</label>
          <input id="g-id" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <label htmlFor="g-secret">OAuth Client secret</label>
          <input id="g-secret" type="password" autoComplete="off" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          <div className="row">
            <button type="button" className="ghost" onClick={() => void saveClient()} disabled={saving}>Save client</button>
          </div>
        </div>
      ),
    },
    {
      title: "Connect Google",
      instruction: "Sign in with the Google account that owns your properties and approve access.",
      content: (
        <div className="row">
          <button type="button" onClick={() => void connect()}>Connect Google</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="segmented setup-tabs" role="group" aria-label="Google setup method">
        <button type="button" className={tab === "sa" ? "seg seg-active" : "seg"} aria-pressed={tab === "sa"} onClick={() => setTab("sa")}>
          Service account (recommended)
        </button>
        <button type="button" className={tab === "oauth" ? "seg seg-active" : "seg"} aria-pressed={tab === "oauth"} onClick={() => setTab("oauth")}>
          OAuth sign-in
        </button>
      </div>
      {tab === "sa" ? <StepList steps={saSteps} /> : <StepList steps={oauthSteps} />}
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
    if (res.ok) refresh();
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
        <button type="button" onClick={() => void save()} disabled={saving}>Save</button>
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
        No setup needed — PageSpeed and CrUX already work. Adding a Google API key only raises the
        quota. Optional steps:
      </p>
      <FieldSteps
        c={c}
        refresh={refresh}
        onTest={onTest}
        successHint="Success confirms the key is accepted by CrUX."
        stepsBefore={[
          {
            title: "Create an API key",
            instruction: "Click Create credentials → API key, then copy the key.",
            links: [{ label: "Open credentials", href: "https://console.cloud.google.com/apis/credentials" }],
          },
        ]}
      />
    </div>
  );
}
