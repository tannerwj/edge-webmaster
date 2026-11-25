import { useCallback, useEffect, useState } from "react";
import { api, errText, type Me, type StatusBody, type ThemePref } from "./api";
import { ProfileMenu } from "./components/ProfileMenu";
import { Link, navigate, usePath } from "./components/nav";
import { StatusDot } from "./components/StatusPill";
import { Activity } from "./views/Activity";
import { ConnectionsOverview, ConnectorPage } from "./views/Connections";
import { Dashboard } from "./views/Dashboard";
import { Tokens } from "./views/Tokens";

function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedTheme(): ThemePref {
  const saved = localStorage.getItem("ew-theme");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

function NotFound() {
  return (
    <div className="card">
      <h3>Page not found</h3>
      <p className="muted">That address doesn't match a page here.</p>
      <p><Link href="/">Back to the dashboard</Link></p>
    </div>
  );
}

export function App() {
  const path = usePath();
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [needsGate, setNeedsGate] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<ThemePref>(() => storedTheme());
  const [menuOpen, setMenuOpen] = useState(false);

  // Apply theme live; "system" follows the OS and updates on change.
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme);
    };
    apply();
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t);
    localStorage.setItem("ew-theme", t);
    void api("/api/preferences", { method: "PUT", body: JSON.stringify({ theme: t }) }).catch(() => undefined);
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

  const loadMe = useCallback(async () => {
    const { res, data } = await api<Me>("/api/me");
    if (!res.ok) return;
    setMe(data);
    const serverTheme = data.preferences?.theme;
    if (serverTheme === "light" || serverTheme === "dark" || serverTheme === "system") {
      setThemeState(serverTheme);
      localStorage.setItem("ew-theme", serverTheme);
    }
  }, []);

  useEffect(() => {
    // Google OAuth returns to "/?connected=google" — land on the GSC page instead.
    const params = new URLSearchParams(location.search);
    if (params.get("connected") && location.pathname === "/") {
      navigate("/connections/google-search-console?connected=google");
    }
    void loadStatus();
    void loadMe();
  }, [loadStatus, loadMe]);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  if (needsGate) return <Gate onUnlock={() => { void loadStatus(); void loadMe(); }} />;
  if (loadError)
    return (
      <main className="gate-wrap">
        <div className="card">
          <h3>Something went wrong</h3>
          <p className="muted">{loadError}</p>
          <button type="button" onClick={() => void loadStatus()}>Retry</button>
        </div>
      </main>
    );
  if (!status)
    return (
      <main className="gate-wrap">
        <p className="muted">Loading…</p>
      </main>
    );

  const connectorMatch = path.match(/^\/connections\/([a-z0-9-]+)$/);
  const connector = connectorMatch ? status.connectors.find((c) => c.id === connectorMatch[1]) : undefined;

  let view: React.ReactNode;
  if (path === "/") view = <Dashboard status={status} />;
  else if (path === "/connections") view = <ConnectionsOverview status={status} />;
  else if (connectorMatch && connector) view = <ConnectorPage connector={connector} all={status.connectors} refresh={loadStatus} />;
  else if (path === "/tokens") view = <Tokens />;
  else if (path === "/activity") view = <Activity />;
  else view = <NotFound />;

  const navLink = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} className={active ? "nav-link nav-active" : "nav-link"}>{label}</Link>
  );

  return (
    <div className="layout">
      <div className="mobile-bar">
        <span className="brand">Edge Webmaster</span>
        <button type="button" className="ghost" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>
      <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand sidebar-brand">Edge Webmaster</div>
        <nav className="nav">
          {navLink("/", "Dashboard", path === "/")}
          <p className="nav-section">Connections</p>
          {status.connectors.map((c) => (
            <Link
              key={c.id}
              href={`/connections/${c.id}`}
              className={path === `/connections/${c.id}` ? "nav-link nav-sub nav-active" : "nav-link nav-sub"}
            >
              <StatusDot status={c.status} />
              <span>{c.name}</span>
            </Link>
          ))}
          {navLink("/connections", "All connections", path === "/connections")}
          {navLink("/tokens", "Agent Tokens", path === "/tokens")}
          {navLink("/activity", "Activity", path === "/activity")}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <ProfileMenu me={me} theme={theme} setTheme={setTheme} />
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
        {view}
      </main>
    </div>
  );
}

function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    const { res, data } = await api<{ error?: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    if (res.ok) onUnlock();
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
          <button type="button" onClick={() => void unlock()}>Unlock setup</button>
        </div>
        {error && <div className="result result-bad">{error}</div>}
      </div>
    </main>
  );
}
