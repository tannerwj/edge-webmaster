import { useCallback, useEffect, useState } from "react";
import { api, errText, type StatusBody } from "./api";
import { Activity } from "./views/Activity";
import { Connections } from "./views/Connections";
import { Dashboard, type Route } from "./views/Dashboard";
import { Guide } from "./views/Guide";
import { Tokens } from "./views/Tokens";

const ROUTES: { id: Route; label: string; hash: string }[] = [
  { id: "dashboard", label: "Dashboard", hash: "#/" },
  { id: "connections", label: "Connections", hash: "#/connections" },
  { id: "tokens", label: "Tokens", hash: "#/tokens" },
  { id: "activity", label: "Activity", hash: "#/activity" },
  { id: "guide", label: "Guide", hash: "#/guide" },
];

function routeFromHash(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const found = ROUTES.find((r) => r.id === h);
  return found ? found.id : "dashboard";
}

function initialTheme(): "light" | "dark" {
  const saved = localStorage.getItem("ew-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [needsGate, setNeedsGate] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => initialTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ew-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadStatus = useCallback(async () => {
    const { res, data } = await api<StatusBody & { error?: string }>("/api/status");
    if (res.status === 401) {
      setNeedsGate(true);
      setStatus(null);
      return;
    }
    if (!res.ok) {
      setLoadError(errText(data, "Failed to load status."));
      return;
    }
    setNeedsGate(false);
    setLoadError(null);
    setStatus(data);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("connected")) {
      history.replaceState(null, "", `${location.pathname}#/connections`);
      setRoute("connections");
    }
    void loadStatus();
  }, [loadStatus]);

  const go = useCallback((next: Route, scrollToId?: string) => {
    setScrollTarget(scrollToId ?? null);
    const target = ROUTES.find((r) => r.id === next);
    if (location.hash !== target?.hash) {
      location.hash = target?.hash ?? "#/";
    } else {
      setRoute(next);
    }
    if (!scrollToId && next !== "connections") window.scrollTo({ top: 0 });
  }, []);

  if (needsGate) return <Gate onUnlock={loadStatus} />;
  if (loadError)
    return (
      <main className="gate-wrap">
        <div className="card">
          <h3>Something went wrong</h3>
          <p className="muted">{loadError}</p>
          <button type="button" onClick={() => void loadStatus()}>
            Retry
          </button>
        </div>
      </main>
    );
  if (!status)
    return (
      <main className="gate-wrap">
        <p className="muted">Loading…</p>
      </main>
    );

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Edge Webmaster</div>
        <nav className="nav">
          {ROUTES.map((r) => (
            <a
              key={r.id}
              href={r.hash}
              className={route === r.id ? "nav-link nav-active" : "nav-link"}
              onClick={() => {
                if (r.id !== "connections") setScrollTarget(null);
              }}
            >
              {r.label}
            </a>
          ))}
        </nav>
        <button
          type="button"
          className="ghost theme-toggle"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="pill pill-off">Mode: {status.mode}</span>
          <span className="small muted">
            MCP URL: <code>{`${location.origin}/mcp`}</code>
          </span>
        </header>
        {status.bootstrap_open && (
          <div className="card card-danger">
            <strong>Setup is open.</strong>{" "}
            <span className="small">
              No SETUP_TOKEN and no Cloudflare Access detected. Put Access in front of this site or
              set the SETUP_TOKEN secret, then redeploy — anyone who can reach this page can connect
              accounts and mint tokens until you do.
            </span>
          </div>
        )}
        {route === "dashboard" && <Dashboard status={status} go={go} />}
        {route === "connections" && (
          <Connections status={status} refresh={loadStatus} scrollTarget={scrollTarget} />
        )}
        {route === "tokens" && <Tokens />}
        {route === "activity" && <Activity />}
        {route === "guide" && <Guide status={status} goConnections={() => go("connections")} />}
      </main>
    </div>
  );
}

function Gate({ onUnlock }: { onUnlock: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    const { res, data } = await api<{ error?: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    if (res.ok) void onUnlock();
    else setError(errText(data, "Failed."));
  };

  return (
    <main className="gate-wrap">
      <h1>Edge Webmaster</h1>
      <div className="card">
        <h3>Setup access</h3>
        <p className="small muted">
          This deployment is protected. Sign in through Cloudflare Access, or enter the setup token
          you set at deploy time.
        </p>
        <label htmlFor="gate-token">Setup token</label>
        <input
          id="gate-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void unlock();
          }}
        />
        <div className="row">
          <button type="button" onClick={() => void unlock()}>
            Unlock setup
          </button>
        </div>
        {error && <div className="result result-bad">{error}</div>}
      </div>
    </main>
  );
}
