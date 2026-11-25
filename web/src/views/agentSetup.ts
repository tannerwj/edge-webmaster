export type AgentClient = "claude" | "claude-code" | "claude-desktop" | "grok" | "generic";

export const CLIENTS: { id: AgentClient; label: string }[] = [
  { id: "claude", label: "Muse" },
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "grok", label: "Grok" },
  { id: "generic", label: "Generic MCP" },
];

export function mcpUrl(origin: string): string {
  return `${origin}/mcp/token`;
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
