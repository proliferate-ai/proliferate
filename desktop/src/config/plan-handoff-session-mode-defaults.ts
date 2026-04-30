// Plan handoff starts a fresh implementation session, so the default UX favors
// continuing work over remaining in planning mode.
export const PLAN_HANDOFF_DEFAULT_MODE_ID_BY_AGENT_KIND: Partial<Record<string, string>> = {
  claude: "bypassPermissions",
  codex: "full-access",
  gemini: "yolo",
};
