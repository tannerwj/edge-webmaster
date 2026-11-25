export type AgentClient = "claude" | "claude-code" | "claude-desktop" | "grok" | "generic";

export const CLIENTS: { id: AgentClient; label: string }[] = [
  { id: "claude", label: "Muse" },
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "grok", label: "Grok" },
  { id: "generic", label: "Generic MCP" },
];

export function mcpUrl(origin: string): string {
  return `${origin}/mcp`;
}

function jsonConfig(origin: string, token: string): string {
  return JSON.stringify(
    { mcpServers: { "edge-webmaster": { url: mcpUrl(origin), headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}

export function setupSnippet(client: AgentClient, origin: string, token: string): string {
  const url = mcpUrl(origin);
  switch (client) {
    case "claude":
      return [
        "In Muse, add a custom connector:",
        `URL: ${url}`,
        `Header: Authorization: Bearer ${token}`,
        "Paste the token as the Bearer value when Muse asks for the connector's header / OAuth is not used — this deployment uses Bearer tokens.",
      ].join("\n");
    case "claude-code":
      return `claude mcp add --transport http edge-webmaster ${url} --header "Authorization: Bearer ${token}"`;
    case "claude-desktop":
      return jsonConfig(origin, token);
    case "grok":
      return [`MCP server URL: ${url}`, `Header: Authorization: Bearer ${token}`].join("\n");
    case "generic":
      return [`MCP endpoint (HTTP): ${url}`, `Header: Authorization: Bearer ${token}`, "", jsonConfig(origin, token)].join("\n");
  }
}

export function setupMarkdown(origin: string, token: string | null): string {
  const t = token ?? "<YOUR_TOKEN>";
  const tokenNote = token
    ? "The token below was selected in Edge Webmaster. It is shown once at creation — keep it private."
    : "No token was selected. Mint one in Edge Webmaster under Agent Tokens, then replace <YOUR_TOKEN> below with it.";
  const lines = [
    "# Edge Webmaster — agent setup",
    "",
    "Edge Webmaster is a self-hosted MCP server that gives your agent webmaster tools:",
    "Google Search Console, Google Analytics 4, Bing Webmaster Tools, and PageSpeed / CrUX.",
    "",
    "## Connect",
    "",
    `- MCP endpoint: ${mcpUrl(origin)}`,
    `- Auth header: Authorization: Bearer ${t}`,
    "",
    tokenNote,
    "",
    "## Client snippets",
    "",
    "### Muse (custom connector)",
    "",
    "```text",
    setupSnippet("claude", origin, t),
    "```",
    "",
    "### Claude Code",
    "",
    "```bash",
    setupSnippet("claude-code", origin, t),
    "```",
    "",
    "### Claude Desktop / generic MCP (JSON)",
    "",
    "```json",
    jsonConfig(origin, t),
    "```",
    "",
    "### Grok / generic HTTP",
    "",
    "```text",
    setupSnippet("grok", origin, t),
    "```",
    "",
    "## Example tasks",
    "",
    '- "Review search performance for example.com for the last 28 days"',
    '- "List sitemaps and their errors"',
    '- "Compare GA4 traffic this month vs last"',
    '- "Run a PageSpeed check on the homepage"',
    "",
    "## Troubleshooting",
    "",
    "- 401 = token missing or revoked. Check the Authorization header, or mint a new token in Edge Webmaster → Agent Tokens.",
    "- Tools missing = the matching connector isn't connected yet. Connect it in Edge Webmaster → Connections.",
    "- Write actions (e.g. submitting a sitemap) need a token with write scope.",
    "",
  ];
  return lines.join("\n");
}

export function downloadSetupMarkdown(origin: string, token: string | null): void {
  const blob = new Blob([setupMarkdown(origin, token)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "edge-webmaster-agent-setup.md";
  a.click();
  URL.revokeObjectURL(url);
}
