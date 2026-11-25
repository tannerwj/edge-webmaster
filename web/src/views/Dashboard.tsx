import { fmtDate, type StatusBody } from "../api";
import { Link } from "../components/nav";
import { StatusPill } from "../components/StatusPill";

/** Map a backend next-step action_target to a path: "tokens" or a connector id. */
export function targetPath(actionTarget: string): string {
  if (actionTarget === "tokens") return "/tokens";
  if (actionTarget === "connections") return "/connections";
  return `/connections/${actionTarget}`;
}

export function Dashboard({ status }: { status: StatusBody }) {
  const s = status.summary;
  const step = s.recommended_next_step;
  return (
    <div>
      <h1>Workspace overview</h1>
      {step && <section className="next-step">
        <div><h2>{step.title}</h2><p>{step.body}</p></div>
        <Link className="btn-link" href={targetPath(step.action_target)}>Open setup →</Link>
      </section>}
      <div className="tiles">
        <div className="tile">
          <div className="tile-num">{s.connections_active}/{s.connections_total}</div>
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

      {s.latest_audit && (
        <p className="small muted">
          Latest activity: {fmtDate(s.latest_audit.ts)} — {s.latest_audit.actor} · {s.latest_audit.action}
          {s.latest_audit.detail ? ` · ${s.latest_audit.detail}` : ""}
        </p>
      )}

      <div className="section-title"><h2>Webmaster tools</h2><Link href="/reports">Run a site report →</Link></div>
      <div className="card">
        {status.connectors.map((c) => (
          <Link key={c.id} className="mini-row" href={`/connections/${c.id}`}>
            <span><strong className="mini-name">{c.name}</strong><small className="tool-description">{c.description}</small></span>
            <StatusPill status={c.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}
