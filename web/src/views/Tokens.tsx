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
    <section className="card card-accent">
      <h3>Set up your agent</h3>
      {freshToken && source === "fresh" && (
        <p className="result result-ok">New token shown once — copy the token now.</p>
      )}
      <div className="setup-controls">
        <div>
          <label htmlFor="agent-client">Client</label>
          <select id="agent-client" value={client} onChange={(e) => setClient(e.target.value as AgentClient)}>
            {CLIENTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="agent-token-source">Token</label>
          <select
            id="agent-token-source"
            value={source}
            onChange={(e) => setSource(e.target.value as "fresh" | "paste")}
          >
            {freshToken && <option value="fresh">Token I just created</option>}
            <option value="paste">I'll paste my token</option>
          </select>
        </div>
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
      <p className="small muted">
        Or fetch the server copy: <a href="/setup-agent.md?auth=token">token setup instructions</a>
      </p>
      <details>
        <summary>Preview snippet</summary>
        <pre>{snippet}</pre>
        <CopyButton value={snippet} label="Copy snippet" />
      </details>
    </section>
  );
}

export function Tokens({ managedOAuth, connectors }: { managedOAuth: boolean; connectors: Connector[] }) {
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
  };

  const revoke = async (id: string) => {
    const { res, data } = await api(`/api/tokens/${id}`, { method: "DELETE" });
    if (res.ok) { setRawToken(null); void load(); }
    else setError(errText(data, "Could not revoke this token."));
  };

  return (
    <div>
      <h1>Agent access</h1>
      <AccessSetup configured={managedOAuth} />
      <div className="card">
        <h3>Agent tokens</h3>
        <p className="muted">
          Tokens authenticate MCP clients. Read tokens can query; write tokens can also submit
          sitemaps. The raw token is shown once, at creation.
        </p>
        <TokenGrants connectors={connectors} selected={selected} change={setSelected} />
        <div className="row token-create">
          <input
            placeholder="Token name, e.g. claude-code-laptop"
            style={{ flex: 2 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select style={{ flex: 1 }} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="read">read</option>
            <option value="write">write</option>
          </select>
          <button type="button" disabled={selected !== null && !Object.keys(selected).length} onClick={() => void create()}>Create token</button>
        </div>
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
        {tokens.length > 0 ? (
          <table>
            <thead>
              <tr><th>Name</th><th>Scope</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.scope}<small className="tool-description">{t.grants ? Object.entries(t.grants).map(([ns, sites]) => ns + " · " + (sites.join(", ") || "all properties")).join(" / ") : "All connectors"}</small></td>
                  <td className="muted">{fmtDate(t.created_at)}</td>
                  <td>
                    <button type="button" className="danger" onClick={() => void revoke(t.id)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No tokens yet. Create one above.</p>
        )}
      </div>
      <AgentSetupPanel freshToken={rawToken} />
    </div>
  );
}
