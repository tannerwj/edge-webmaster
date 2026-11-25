import { useCallback, useEffect, useState } from "react";
import { api, errText, fmtDate, type AgentToken } from "../api";
import { CopyButton } from "../components/CopyButton";
import { CLIENTS, downloadSetupMarkdown, setupSnippet, type AgentClient } from "./agentSetup";

function AgentSetupPanel({ freshToken }: { freshToken: string | null }) {
  const [client, setClient] = useState<AgentClient>("claude-code");
  const [source, setSource] = useState<"fresh" | "paste">("paste");
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const origin = location.origin;

  useEffect(() => {
    if (freshToken) setSource("fresh");
  }, [freshToken]);

  const token = source === "fresh" && freshToken ? freshToken : pasted.trim();
  const effective = token || "<YOUR_TOKEN>";
  const snippet = setupSnippet(client, origin, effective);

  const copySnippet = async () => {
    await navigator.clipboard.writeText(snippet).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="card card-accent">
      <h3>Set up your agent</h3>
      {freshToken && source === "fresh" && (
        <p className="result result-ok">New token shown once — copy or download the setup now.</p>
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
            id="agent-token-paste"
            autoComplete="off"
            placeholder="Paste a token you saved when you created it"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <p className="small muted">Stored tokens can't be shown again — paste one you saved, or create a new one below.</p>
        </div>
      )}
      <div className="row">
        <button type="button" onClick={() => void copySnippet()}>{copied ? "Copied" : "Copy setup snippet"}</button>
        <button type="button" className="ghost" onClick={() => downloadSetupMarkdown(origin, token || null)}>
          Download setup Markdown
        </button>
      </div>
      <p className="small muted">
        Or fetch the server copy: <a href="/setup-agent.md">/setup-agent.md</a>
      </p>
      <details>
        <summary>Preview snippet</summary>
        <pre>{snippet}</pre>
        <CopyButton value={snippet} label="Copy snippet" />
      </details>
    </section>
  );
}

export function Tokens() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("read");
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api<{ tokens?: AgentToken[] }>("/api/tokens");
    setTokens(data.tokens ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const { res, data } = await api<{ token?: string; error?: string }>("/api/tokens", {
      method: "POST",
      body: JSON.stringify({ name, scope }),
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
    await api(`/api/tokens/${id}`, { method: "DELETE" });
    void load();
  };

  return (
    <div>
      <AgentSetupPanel freshToken={rawToken} />
      <div className="card">
        <h3>Agent tokens</h3>
        <p className="muted">
          Tokens authenticate MCP clients. Read tokens can query; write tokens can also submit
          sitemaps. The raw token is shown once, at creation.
        </p>
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
          <button type="button" onClick={() => void create()}>Create token</button>
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
                  <td>{t.scope}</td>
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
    </div>
  );
}
