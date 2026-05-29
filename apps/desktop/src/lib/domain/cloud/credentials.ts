export type CloudAgentKind = "claude" | "codex" | "gemini";

export function isCloudAgentKind(value: string): value is CloudAgentKind {
  return value === "claude" || value === "codex" || value === "gemini";
}
