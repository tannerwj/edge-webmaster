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
  available: "pill pill-ok",
  configured: "pill pill-warn",
  not_connected: "pill pill-off",
  error: "pill pill-bad",
};

export function StatusPill({ status }: { status: ConnectorStatus }) {
  return <span className={CLASSES[status]}>{LABELS[status]}</span>;
}
