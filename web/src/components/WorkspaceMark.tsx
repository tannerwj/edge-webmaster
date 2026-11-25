export function WorkspaceMark() {
  return <img className="workspace-mark" width="32" height="32" alt="" src="/apple-touch-icon.png" />;
}

const paths: Record<string, string> = {
  "/": "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  "/reports": "M4 3v17h17 M8 16v-4 M13 16V8 M18 16V5",
  "/connections": "M9 15l6-6 M8 12l-2 2a3.5 3.5 0 0 0 5 5l3-3 M10 8l3-3a3.5 3.5 0 0 1 5 5l-2 2",
  "/tokens": "M14 3a5 5 0 1 1-3.7 8.4L4 18v3h4v-3h3v-3l1.5-1.5 M16 7h.01",
  "/activity": "M2 12h5l3-8 4 16 3-8h5",
};

export function NavIcon({ href }: { href: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[href]} /></svg>;
}
