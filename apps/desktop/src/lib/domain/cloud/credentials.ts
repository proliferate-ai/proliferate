export type CloudAgentKind = "claude" | "codex" | "gemini" | "grok";

export function isCloudAgentKind(value: string): value is CloudAgentKind {
  return value === "claude" || value === "codex" || value === "gemini" || value === "grok";
}
