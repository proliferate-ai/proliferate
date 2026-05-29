export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  opencode: "OpenCode",
};

export function getProviderDisplayName(kind: string): string {
  return PROVIDER_DISPLAY_NAMES[kind] ?? kind;
}
