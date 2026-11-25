import type { ConnectorStatus } from "../api";

const LABELS: Record<ConnectorStatus, string> = {
  connected: "Connected",
  available: "Available",
  configured: "Saved — not verified",
  not_connected: "Not connected",
  error: "Error",
  needs_sign_in: "Sign-in needed",
};

const CLASSES: Record<ConnectorStatus, string> = {
  connected: "pill pill-ok",
  available: "pill pill-info",
  configured: "pill pill-warn",
  not_connected: "pill pill-off",
  error: "pill pill-bad",
  needs_sign_in: "pill pill-warn",
};

export function StatusPill({ status }: { status: ConnectorStatus }) {
  return <span className={CLASSES[status]}>{LABELS[status]}</span>;
}
