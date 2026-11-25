import { useCallback, useEffect, useState } from "react";
import { api, errText, fmtDate, type AgentToken } from "../api";

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
    <div className="card">
      <p className="muted">
        Tokens authenticate MCP clients (Muse, Claude Code, Grok, any MCP client). Read tokens can
        query; write tokens can also submit sitemaps. The raw token is shown once.
      </p>
      <div className="row">
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
        <button type="button" onClick={create}>
          Create token
        </button>
      </div>
      {error && <div className="result result-bad">{error}</div>}
      {rawToken && (
        <div className="result">
          Token (copy it now, it is shown once):
          <pre>{rawToken}</pre>
        </div>
      )}
      {tokens.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.scope}</td>
                <td className="muted">{fmtDate(t.created_at)}</td>
                <td>
                  <button type="button" className="danger" onClick={() => revoke(t.id)}>
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No tokens yet.</p>
      )}
    </div>
  );
}
