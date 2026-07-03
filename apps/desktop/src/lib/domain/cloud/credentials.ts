export type CloudAgentKind = "claude" | "codex" | "grok";

export function isCloudAgentKind(value: string): value is CloudAgentKind {
  return value === "claude" || value === "codex" || value === "grok";
}
