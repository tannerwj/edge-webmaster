export type ConnectorStatus = "not_connected" | "available" | "configured" | "connected" | "error";

export interface SetupField {
  key: string;
  label: string;
  type: string;
  help?: string;
}

export interface Connector {
  id: string;
  name: string;
  namespace: string;
  auth_type: string;
  auth_label: string;
  provider: string;
  connection_id: string;
  setup_kind: string;
  access: string;
  description: string;
  examples: string[];
  recommendation: string;
  status: ConnectorStatus;
  status_detail: string;
  credentials_present: boolean;
  configured: boolean;
  health: { ok: boolean; detail: string; count?: number } | null;
  setup_fields: SetupField[];
  tools: string[];
}

export interface AuditEntry {
  ts: number;
  actor: string;
  action: string;
  detail: string;
}

export interface NextStep {
  id: string;
  title: string;
  body: string;
  action_target: string;
}

export interface StatusBody {
  mode: string;
  bootstrap_open: boolean;
  summary: {
    connections_active: number;
    connections_total: number;
    properties_discovered: number | null;
    properties_by_connector: Record<string, number | null>;
    active_agent_tokens: number;
    tool_calls_last_7d: number;
    latest_audit: AuditEntry | null;
    recommended_next_step: NextStep | null;
  };
  connectors: Connector[];
}

export interface AgentToken {
  id: string;
  name: string;
  scope: string;
  created_at: number;
}

export interface Metrics {
  window_days: number;
  tools: { tool_name: string; calls: number; ok: number }[];
  audit: AuditEntry[];
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<{ res: Response; data: T }> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  const data = (await res.json().catch(() => ({}))) as T;
  return { res, data };
}

export function fmtDate(ts: number): string {
  const ms = ts < 1e11 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

export function errText(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e) return e;
  }
  return fallback;
}
