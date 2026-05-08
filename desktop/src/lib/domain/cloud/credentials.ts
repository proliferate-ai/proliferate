export type CloudAgentKind = "claude" | "codex" | "gemini";

export function isCloudAgentKind(value: string): value is CloudAgentKind {
  return value === "claude" || value === "codex" || value === "gemini";
}

export interface CloudCredentialStatus {
  provider: string;
  localDetected: boolean;
  synced: boolean;
  authMode?: string | null;
}

export function describeCloudCredentialStatus(
  provider: CloudAgentKind,
  status?: CloudCredentialStatus,
): string {
  switch (provider) {
    case "claude":
      return status?.authMode === "file"
        ? "Synced via Claude Code local auth."
        : status?.synced
          ? "Synced via ANTHROPIC_API_KEY."
          : "Sync your ANTHROPIC_API_KEY or Claude Code login for cloud workspaces.";
    case "codex":
      return "Sync your local Codex auth for cloud workspaces.";
    case "gemini":
      return status?.authMode === "file"
        ? "Synced via Gemini CLI Google login."
        : status?.synced
          ? "Synced via GEMINI_API_KEY or GOOGLE_API_KEY."
        : "Sync your GEMINI_API_KEY, GOOGLE_API_KEY, or Gemini CLI login for cloud workspaces.";
  }
}
