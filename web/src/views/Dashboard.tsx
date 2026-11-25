import { fmtDate, type StatusBody } from "../api";
import { StatusPill } from "../components/StatusPill";

export type Route = "dashboard" | "connections" | "tokens" | "activity" | "guide";

export function Dashboard({
  status,
  go,
}: {
  status: StatusBody;
  go: (route: Route, scrollToId?: string) => void;
}) {
  const s = status.summary;
  const step = s.recommended_next_step;
  return (
    <div>
      <div className="tiles">
        <div className="tile">
          <div className="tile-num">
            {s.connections_active}/{s.connections_total}
          </div>
          <div className="tile-label">Connections active</div>
        </div>
        {s.properties_discovered !== null && (
          <div className="tile">
            <div className="tile-num">{s.properties_discovered}</div>
            <div className="tile-label">Properties discovered</div>
          </div>
        )}
        <div className="tile">
          <div className="tile-num">{s.active_agent_tokens}</div>
          <div className="tile-label">Active agent tokens</div>
        </div>
        <div className="tile">
          <div className="tile-num">{s.tool_calls_last_7d}</div>
          <div className="tile-label">Tool calls, last 7 days</div>
        </div>
      </div>

      {step && (
        <div className="card card-accent">
          <h3>Recommended next step</h3>
          <p className="card-title">{step.title}</p>
          <p className="muted">{step.body}</p>
          <button
            type="button"
            onClick={() => {
              if (step.action_target === "tokens") go("tokens");
              else go("connections", step.action_target);
            }}
          >
            Do it now
          </button>
        </div>
      )}

      {s.latest_audit && (
        <p className="small muted">
          Latest activity: {fmtDate(s.latest_audit.ts)} — {s.latest_audit.actor} · {s.latest_audit.action}
          {s.latest_audit.detail ? ` · ${s.latest_audit.detail}` : ""}
        </p>
      )}

      <h2>Connectors</h2>
      <div className="card">
        {status.connectors.map((c) => (
          <button
            key={c.id}
            type="button"
            className="mini-row"
            onClick={() => go("connections", c.id)}
          >
            <span className="mini-name">{c.name}</span>
            <StatusPill status={c.status} />
          </button>
        ))}
      </div>
    </div>
  );
}
