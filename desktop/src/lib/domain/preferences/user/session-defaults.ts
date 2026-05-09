export type DefaultLiveSessionControlKey =
  | "collaboration_mode"
  | "reasoning"
  | "effort"
  | "fast_mode";
export type DefaultLiveSessionControlValuesByAgentKind = Record<
  string,
  Partial<Record<DefaultLiveSessionControlKey, string>>
>;

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
  "claude-haiku-4-5": "haiku",
  opus: "opus[1m]",
};

const DEFAULT_LIVE_SESSION_CONTROL_KEYS = new Set<DefaultLiveSessionControlKey>([
  "collaboration_mode",
  "reasoning",
  "effort",
  "fast_mode",
]);

export function sanitizeDefaultSessionModeByAgentKind(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([agentKind, modeId]) => (
      typeof modeId === "string" && agentKind.trim().length > 0 && modeId.trim().length > 0
        ? [[agentKind, modeId]]
        : []
    )),
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

export function normalizeDefaultChatModelId(agentKind: string, modelId: string): string {
  return agentKind === "claude"
    ? LEGACY_CLAUDE_MODEL_IDS[modelId] ?? modelId
    : modelId;
}
