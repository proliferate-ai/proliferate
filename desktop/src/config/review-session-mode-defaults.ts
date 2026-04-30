// Review agents are managed automation. For now the setup UI does not expose
// per-agent permission modes; launch reviewers in the closest "do the work"
// mode each harness supports.
export const REVIEW_DEFAULT_MODE_ID_BY_AGENT_KIND: Partial<Record<string, string>> = {
  claude: "bypassPermissions",
  codex: "full-access",
  gemini: "yolo",
};
