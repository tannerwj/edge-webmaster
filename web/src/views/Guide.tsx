import { useState } from "react";
import { api, errText, type StatusBody } from "../api";

export function Guide({ status, goConnections }: { status: StatusBody; goConnections: () => void }) {
  const mcpUrl = `${location.origin}/mcp`;
  const [fbText, setFbText] = useState("");
  const [fbResult, setFbResult] = useState<string | null>(null);

  const sendFeedback = async () => {
    const { res, data } = await api<{ receipt?: string; error?: string }>("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ role: "owner", message: fbText, context: location.href }),
    });
    if (res.ok) {
      setFbResult(`Sent — ${data.receipt ?? ""}`);
      setFbText("");
    } else {
      setFbResult(errText(data, "Failed to send feedback."));
    }
  };

  return (
    <div>
      <div className="card">
        <h3>Connect your agents</h3>
        <p className="muted">
          Mode: <strong>{status.mode}</strong> —{" "}
          {status.mode === "code"
            ? "agents see search_tools + execute and reach every connected tool through the sandbox proxies."
            : "agents see every connected tool directly."}{" "}
          Mint an agent token first, then use one of these:
        </p>
        <label>Claude (web/desktop custom connector)</label>
        <pre>{`URL: ${mcpUrl}\nHeader: Authorization: Bearer ew_YOUR_TOKEN`}</pre>
        <label>Claude Code</label>
        <pre>{`claude mcp add --transport http edge-webmaster ${mcpUrl} --header "Authorization: Bearer ew_YOUR_TOKEN"`}</pre>
        <label>Generic MCP client (JSON)</label>
        <pre>
          {JSON.stringify(
            {
              mcpServers: {
                "edge-webmaster": {
                  url: mcpUrl,
                  headers: { Authorization: "Bearer ew_YOUR_TOKEN" },
                },
              },
            },
            null,
            2,
          )}
        </pre>
      </div>

      <div className="card">
        <h3>Google: two ways in</h3>
        <ul className="examples">
          <li>
            <strong>Service account (recommended for sites you own)</strong> — no consent screen, no
            token expiry. Paste the JSON key in Connections, then add the service account email as a
            user on each Search Console and GA4 property.
          </li>
          <li>
            <strong>OAuth</strong> — sign in with Google. Personal accounts use an External client:
            Publish the app (In production) after creating it — Testing expires refresh tokens after
            7 days. Workspace accounts can use Internal.
          </li>
          <li>
            Either way, enable the Google Search Console API, Google Analytics Data API, and Google
            Analytics Admin API in the Google Cloud project first.
          </li>
        </ul>
        <button type="button" className="ghost" onClick={goConnections}>
          Open Connections
        </button>
      </div>

      <div className="card">
        <h3>Bing Webmaster Tools</h3>
        <ol>
          <li>Open Bing Webmaster Tools and sign in.</li>
          <li>Go to Settings → API Access and generate an API key.</li>
          <li>Paste the key into the Bing card in Connections and save.</li>
        </ol>
        <button type="button" className="ghost" onClick={goConnections}>
          Open Connections
        </button>
      </div>

      <div className="card">
        <h3>PageSpeed Insights + CrUX</h3>
        <p className="muted">
          Works with no key at all — it is available as soon as the deployment is up. Adding a Google
          API key in Connections only raises the quota.
        </p>
      </div>

      <div className="card">
        <h3>Feedback</h3>
        <p className="small muted">
          Found a problem or want a connector? Reports are stored on this deployment for the
          maintainer.
        </p>
        <label htmlFor="fb-text">Your feedback</label>
        <textarea
          id="fb-text"
          placeholder="What happened, and what did you expect?"
          value={fbText}
          onChange={(e) => setFbText(e.target.value)}
        />
        <div className="row">
          <button type="button" onClick={sendFeedback}>
            Send feedback
          </button>
        </div>
        {fbResult && <div className="result">{fbResult}</div>}
      </div>
    </div>
  );
}
