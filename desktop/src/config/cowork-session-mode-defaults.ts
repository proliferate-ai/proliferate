// Cowork runs inside a managed repo-root worktree, so the default UX favors
// fast agent execution over interactive permission prompts.
export const COWORK_DEFAULT_MODE_ID_BY_AGENT_KIND: Partial<Record<string, string>> = {
  claude: "bypassPermissions",
  codex: "full-access",
  gemini: "yolo",
};
