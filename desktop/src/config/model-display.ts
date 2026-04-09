export const HIDDEN_MODEL_IDS = new Set([
  "claude:default",
]);

export const MODEL_DISPLAY_ALIASES: Record<string, string> = {
  "claude:sonnet": "Sonnet 4.6",
  "claude:sonnet[1m]": "Sonnet 4.6 (1M context)",
  "claude:opus": "Opus 4.6",
  "claude:opus[1m]": "Opus 4.6 (1M context)",
  "claude:haiku": "Haiku 4.5",
  "codex:gpt-5.4": "GPT 5.4",
  "codex:gpt-5.4-mini": "GPT 5.4 Mini",
  "codex:gpt-5.3-codex": "GPT 5.3 Codex",
  "codex:gpt-5.3-codex-spark": "GPT 5.3 Codex Spark",
  "codex:gpt-5.2-codex": "GPT 5.2 Codex",
  "codex:gpt-5.1-codex-max": "GPT 5.1 Codex Max",
  "codex:gpt-5.2": "GPT 5.2",
  "codex:gpt-5.1-codex-mini": "GPT 5.1 Codex Mini",
};
