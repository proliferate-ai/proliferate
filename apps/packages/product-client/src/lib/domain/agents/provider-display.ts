export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
};

export function getProviderDisplayName(kind: string): string {
  return PROVIDER_DISPLAY_NAMES[kind] ?? kind;
}

/**
 * The install/update surfaces (harness toast, home readiness card) call an
 * agent by its product name rather than its provider name — Claude Code, not
 * bare Claude — while every other kind keeps its provider display name.
 * Single-sourced here so the toast presenter and the readiness card can't
 * drift into naming the same agent two different ways.
 */
export function getAgentDisplayLabel(kind: string): string {
  return kind === "claude" ? "Claude Code" : getProviderDisplayName(kind);
}
