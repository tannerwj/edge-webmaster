import type { ConnectorStatus } from "../api";

const LABELS: Record<ConnectorStatus, string> = {
  connected: "Connected",
  available: "Available — no setup needed",
  configured: "Saved — not verified",
  not_connected: "Not connected",
  error: "Error",
};

const CLASSES: Record<ConnectorStatus, string> = {
  connected: "pill pill-ok",
  available: "pill pill-info",
  configured: "pill pill-warn",
  not_connected: "pill pill-off",
  error: "pill pill-bad",
};

/** Shared status → dot color: connected green, available blue, configured amber, error red, not_connected gray. */
export const STATUS_DOT: Record<ConnectorStatus, string> = {
  connected: "dot-connected",
  available: "dot-available",
  configured: "dot-configured",
  not_connected: "dot-off",
  error: "dot-error",
};

export function StatusPill({ status }: { status: ConnectorStatus }) {
  return <span className={CLASSES[status]}>{LABELS[status]}</span>;
}

export function StatusDot({ status }: { status: ConnectorStatus }) {
  return <span className={`status-dot ${STATUS_DOT[status]}`} title={LABELS[status]} aria-label={LABELS[status]} />;
}
