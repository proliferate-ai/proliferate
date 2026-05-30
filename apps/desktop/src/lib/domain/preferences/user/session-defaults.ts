export type DefaultLiveSessionControlKey =
  | "collaboration_mode"
  | "reasoning"
  | "effort"
  | "fast_mode";
export type DefaultLiveSessionControlValuesByAgentKind = Record<
  string,
  Partial<Record<DefaultLiveSessionControlKey, string>>
>;
export type ChatModelVisibilityOverridesByAgentKind = Record<string, Record<string, boolean>>;

const LEGACY_CLAUDE_MODEL_IDS: Record<string, string> = {
  "claude-sonnet-4-5": "sonnet",
  "claude-sonnet-4-6": "sonnet",
  "claude-sonnet-4-5-1m": "sonnet[1m]",
  "claude-sonnet-4-6-1m": "sonnet[1m]",
  "claude-opus-4-5": "opus[1m]",
  "claude-opus-4-5-1m": "opus[1m]",
  "claude-opus-4-6-1m": "opus[1m]",
  "claude-opus-4-7": "opus[1m]",
  "claude-opus-4-7-1m": "opus[1m]",
  "claude-opus-4-8": "opus[1m]",
  "claude-opus-4-8-1m": "opus[1m]",
  "claude-haiku-4-5": "haiku",
  opus: "opus[1m]",
};

const LEGACY_CURSOR_MODEL_IDS: Record<string, string> = {
  "default[]": "auto",
  "composer-2[fast=true]": "composer-2-fast",
  "composer-1.5[]": "composer-2",
  "gpt-5.3-codex[reasoning=medium,fast=false]": "gpt-5.3-codex",
  "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]": "claude-4.6-sonnet-medium-thinking",
  "gpt-5.5[context=272k,reasoning=medium,fast=false]": "gpt-5.5-medium",
  "claude-opus-4-7[thinking=true,context=300k,effort=xhigh]": "claude-opus-4-7-thinking-xhigh",
  "gpt-5.4[context=272k,reasoning=medium,fast=false]": "gpt-5.4-medium",
  "claude-opus-4-6[thinking=true,context=200k,effort=high,fast=false]": "claude-4.6-opus-high-thinking",
  "claude-opus-4-5[thinking=true]": "claude-4.5-opus-high-thinking",
  "gpt-5.2[reasoning=medium,fast=false]": "gpt-5.2",
  "gemini-3.1-pro[]": "gemini-3.1-pro",
  "gpt-5.4-mini[reasoning=medium]": "gpt-5.4-mini-medium",
  "gpt-5.4-nano[reasoning=medium]": "gpt-5.4-nano-medium",
  "claude-haiku-4-5[thinking=true]": "claude-4.5-sonnet",
  "gpt-5.3-codex-spark[reasoning=medium]": "gpt-5.3-codex-spark-preview",
  "grok-4.3[context=200k]": "grok-4.3",
  "grok-4-20[thinking=true]": "grok-4.3",
  "claude-sonnet-4-5[thinking=true,context=200k]": "claude-4.5-sonnet-thinking",
  "gpt-5.2-codex[reasoning=medium,fast=false]": "gpt-5.2-codex",
  "gpt-5.1-codex-max[reasoning=medium,fast=false]": "gpt-5.1-codex-max-medium",
  "gpt-5.1[reasoning=medium]": "gpt-5.1",
  "gemini-3-flash[]": "gemini-3-flash",
  "gpt-5.1-codex-mini[reasoning=medium]": "gpt-5.1-codex-mini",
  "claude-sonnet-4[thinking=false,context=200k]": "claude-4-sonnet",
  "gpt-5-mini[]": "gpt-5-mini",
  "gemini-2.5-flash[]": "gemini-3-flash",
  "kimi-k2.5[]": "kimi-k2.5",
};

const DEFAULT_LIVE_SESSION_CONTROL_KEYS = new Set<DefaultLiveSessionControlKey>([
  "collaboration_mode",
  "reasoning",
  "effort",
  "fast_mode",
]);

const CODEX_DEFAULT_APPROVAL_MODE_ID = "auto";

export function sanitizeDefaultSessionModeByAgentKind(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([agentKind, modeId]) => {
      const trimmedAgentKind = agentKind.trim();
      const trimmedModeId = typeof modeId === "string" ? modeId.trim() : "";
      if (!trimmedAgentKind || !trimmedModeId) {
        return [];
      }
      return [[
        trimmedAgentKind,
        normalizeDefaultSessionModeId(trimmedAgentKind, trimmedModeId),
      ]];
    }),
  );
}

export function sanitizeDefaultLiveSessionControlValuesByAgentKind(
  value: unknown,
): DefaultLiveSessionControlValuesByAgentKind {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([agentKind, controls]) => {
      const trimmedAgentKind = agentKind.trim();
      if (!trimmedAgentKind || !controls || typeof controls !== "object" || Array.isArray(controls)) {
        return [];
      }

      const sanitizedControls = Object.fromEntries(
        Object.entries(controls).flatMap(([key, controlValue]) => {
          if (!DEFAULT_LIVE_SESSION_CONTROL_KEYS.has(key as DefaultLiveSessionControlKey)) {
            return [];
          }
          const trimmedValue = typeof controlValue === "string" ? controlValue.trim() : "";
          return trimmedValue ? [[key, trimmedValue]] : [];
        }),
      ) as Partial<Record<DefaultLiveSessionControlKey, string>>;

      return Object.keys(sanitizedControls).length > 0
        ? [[trimmedAgentKind, sanitizedControls]]
        : [];
    }),
  );
}

export function sanitizeDefaultChatModelIdByAgentKind(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([agentKind, modelId]) => {
      const trimmedAgentKind = agentKind.trim();
      const trimmedModelId = typeof modelId === "string" ? modelId.trim() : "";
      return trimmedAgentKind && trimmedModelId
        ? [[trimmedAgentKind, normalizeDefaultChatModelId(trimmedAgentKind, trimmedModelId)]]
        : [];
    }),
  );
}

export function sanitizeChatModelVisibilityOverridesByAgentKind(
  value: unknown,
): ChatModelVisibilityOverridesByAgentKind {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([agentKind, overrides]) => {
      const trimmedAgentKind = agentKind.trim();
      if (!trimmedAgentKind || !overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
        return [];
      }
      const sanitizedOverrides = Object.fromEntries(
        Object.entries(overrides).flatMap(([modelId, visible]) => {
          const trimmedModelId = modelId.trim();
          return trimmedModelId && typeof visible === "boolean"
            ? [[trimmedModelId, visible]]
            : [];
        }),
      );
      return Object.keys(sanitizedOverrides).length > 0
        ? [[trimmedAgentKind, sanitizedOverrides]]
        : [];
    }),
  );
}

export function normalizeDefaultChatModelId(agentKind: string, modelId: string): string {
  if (agentKind === "claude") {
    return LEGACY_CLAUDE_MODEL_IDS[modelId] ?? modelId;
  }
  if (agentKind === "cursor") {
    return LEGACY_CURSOR_MODEL_IDS[modelId] ?? modelId;
  }
  return modelId;
}

function normalizeDefaultSessionModeId(agentKind: string, modeId: string): string {
  if (agentKind === "codex" && (modeId === "default" || modeId === "plan")) {
    return CODEX_DEFAULT_APPROVAL_MODE_ID;
  }
  return modeId;
}
