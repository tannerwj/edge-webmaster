import { AccessSetup } from "../components/AccessSetup";
import { TokenGrants, type Selections } from "../components/TokenGrants";
import { useCallback, useEffect, useState } from "react";
import { api, errText, fmtDate, type AgentToken, type Connector } from "../api";
import { CopyButton } from "../components/CopyButton";
import { CLIENTS, setupSnippet, type AgentClient } from "./agentSetup";

function AgentSetupPanel({ freshToken }: { freshToken: string | null }) {
  const [client, setClient] = useState<AgentClient>("claude-code");
  const [source, setSource] = useState<"fresh" | "paste">("paste");
  const [pasted, setPasted] = useState("");
  const origin = location.origin;

  useEffect(() => {
    if (freshToken) setSource("fresh");
  }, [freshToken]);

  const token = source === "fresh" && freshToken ? freshToken : pasted.trim();
  const effective = token || "<YOUR_TOKEN>";
  const snippet = setupSnippet(client, origin, effective);

  return (
    <section className="card">
      <h2>Connect your client</h2>
      <div className="setup-controls">
        <div>
          <label htmlFor="agent-client">Client</label>
          <select id="agent-client" value={client} onChange={(e) => setClient(e.target.value as AgentClient)}>
            {CLIENTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        {freshToken && <div>
          <label htmlFor="agent-token-source">Token</label>
          <select
            id="agent-token-source"
            value={source}
            onChange={(e) => setSource(e.target.value as "fresh" | "paste")}
          >
            {freshToken && <option value="fresh">Token I just created</option>}
            <option value="paste">I'll paste my token</option>
          </select>
        </div>}
      </div>
      {source === "paste" && (
        <div>
          <label htmlFor="agent-token-paste">Your token</label>
          <input
            id="agent-token-paste" type="password"
            autoComplete="off"
            placeholder="Paste a token you saved when you created it"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <p className="small muted">Stored tokens can't be shown again — paste one you saved, or create a new one above.</p>
        </div>
      )}
      <div className="row">
        <CopyButton value={snippet} label="Copy setup snippet" />
        <a download="edge-webmaster-agent-setup.md" href="/setup-agent.md?auth=token">Download agent guide</a>
      </div>
      <details>
        <summary>Preview snippet</summary>
        <pre>{snippet}</pre>
      </details>
    </section>
  );
}

export function Tokens({ managedOAuth, connectors }: { managedOAuth: boolean; connectors: Connector[] }) {
  const [method, setMethod] = useState<"oauth" | "token">(managedOAuth ? "oauth" : "token");
  const [creating, setCreating] = useState(false);
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Selections | null>(null);
  const [scope, setScope] = useState("read");
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { res, data } = await api<{ tokens?: AgentToken[] }>("/api/tokens");
    if (res.ok) setTokens(data.tokens ?? []);
    else setError(errText(data, "Could not load tokens."));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { res, data } = await api<{ token?: string; error?: string }>("/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name, scope, grants: selected && Object.fromEntries(Object.entries(selected).map(([ns, text]) => [ns, text.split(/\n/).map((s) => s.trim()).filter(Boolean)])) }),
      });
      if (res.ok && data.token) {
        setRawToken(data.token);
        setError(null);
        setName("");
        void load();
      } else {
        setRawToken(null);
        setError(errText(data, "Failed to create token."));
      }
    } catch {
      setError("Could not reach the Worker. Check the token list before retrying.");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    const { res, data } = await api(`/api/tokens/${id}`, { method: "DELETE" });
    if (res.ok) { setRawToken(null); void load(); }
    else setError(errText(data, "Could not revoke this token."));
  };

  return (
    <div className="agent-page">
      <h1>Agent access</h1>
      <div className="method-cards" role="group" aria-label="Authentication method">
        <button type="button" className="method-card" aria-pressed={method === "oauth"} onClick={() => setMethod("oauth")}>
          <strong>Cloudflare Access</strong><span>Sign in to read all connected properties.</span>
        </button>
        <button type="button" className="method-card" aria-pressed={method === "token"} onClick={() => setMethod("token")}>
          <strong>Agent tokens</strong><span>Choose tools, sites and write permissions.</span>
        </button>
      </div>
      <div hidden={method !== "oauth"}><AccessSetup configured={managedOAuth} /></div>
      <div hidden={method !== "token"}>
        <section className="card">
          <h2>Create a token</h2>
          <form onSubmit={e => { e.preventDefault(); void create(); }}>
            <div className="setup-controls">
              <label>Token name<input placeholder="e.g. Search assistant" value={name} onChange={e => setName(e.target.value)} /></label>
              <label>Permissions<select value={scope} onChange={e => setScope(e.target.value)}>
                <option value="read">Read reports</option><option value="write">Read and write</option>
              </select></label>
            </div>
            {scope === "write" && <p className="small muted">Write access includes sitemap submissions and IndexNow notifications.</p>}
            <TokenGrants connectors={connectors} selected={selected} change={setSelected} />
            <button disabled={creating || (selected !== null && !Object.keys(selected).length)}>{creating ? "Creating…" : "Create token"}</button>
          </form>
          {error && <div className="result result-bad">{error}</div>}
          {rawToken && (
            <div className="result">
              <span>Token (copy it now, it is shown once):</span>
              <div className="row">
                <code className="token-value">{rawToken}</code>
                <CopyButton value={rawToken} />
              </div>
            </div>
          )}
        </section>
        <AgentSetupPanel freshToken={rawToken} />
        <section className="card">
          <h2>Issued tokens</h2>
          {tokens.length > 0 ? (
            <ul className="token-list">
              {tokens.map(t => <li key={t.id}>
                <div><strong>{t.name}</strong><small>{t.scope === "write" ? "Read and write" : "Read reports"} · Created {fmtDate(t.created_at)}</small>
                  <small>{t.grants ? Object.entries(t.grants).map(([ns, sites]) => ns + " · " + (sites.join(", ") || "all properties")).join(" / ") : "All connectors"}</small>
                </div>
                <button type="button" className="danger" aria-label={`Revoke ${t.name}`} onClick={() => void revoke(t.id)}>Revoke</button>
              </li>)}
            </ul>
          ) : (
            <p className="muted">No tokens yet. Create one above.</p>
          )}
        </section>
      </div>
    </div>
  );
}
