import { useEffect, useRef, useState } from "react";
import { api, type Me, type ThemePref } from "../api";

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function ProfileMenu({
  me,
  theme,
  setTheme,
}: {
  me: Me | null;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = me?.email ?? (me ? "Setup session" : "Account");

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        ref.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open ]);

  const logout = async () => {
    await api("/api/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    if (me?.identity === "access") location.href = "/cdn-cgi/access/logout";
    else location.href = "/";
  };

  return (
    <div className="profile" ref={ref}>
      <button
        type="button"
        className="ghost profile-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="profile-label">{label}</span>
        <span aria-hidden="true">▴</span>
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <p className="profile-identity">{me?.email ?? "Setup session"}</p>
          {me && <p className="small muted profile-sub">{me.identity === "access" ? "Signed in via Cloudflare Access" : me.identity === "setup-token" ? "Signed in with the setup token" : "Open setup session"}</p>}
          <p className="small label-strong profile-theme-label">Theme</p>
          <div className="segmented" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={theme === t.id ? "seg seg-active" : "seg"}
                aria-pressed={theme === t.id}
                onClick={() => setTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" className="ghost profile-logout" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
