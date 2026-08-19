/** Raw target-observed control id persisted as user launch intent. */
export type DefaultLiveSessionControlKey = string;

export type DefaultLiveSessionControlValuesByAgentKind = Record<
  string,
  Record<string, string>
>;

export function withUpdatedDefaultLiveSessionControlValueByAgentKind(
  current: DefaultLiveSessionControlValuesByAgentKind,
  agentKind: string,
  key: string,
  value: string,
): DefaultLiveSessionControlValuesByAgentKind {
  const trimmedAgentKind = agentKind.trim();
  const trimmedKey = key.trim();
  const trimmedValue = value.trim();
  if (!trimmedAgentKind || !trimmedKey || !trimmedValue) {
    return current;
  }
  if (current[trimmedAgentKind]?.[trimmedKey] === trimmedValue) {
    return current;
  }
  return {
    ...current,
    [trimmedAgentKind]: {
      ...(current[trimmedAgentKind] ?? {}),
      [trimmedKey]: trimmedValue,
    },
  };
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
        Object.entries(controls).flatMap(([controlId, controlValue]) => {
          const trimmedControlId = controlId.trim();
          const trimmedValue = typeof controlValue === "string" ? controlValue.trim() : "";
          return trimmedControlId && trimmedValue
            ? [[trimmedControlId, trimmedValue]]
            : [];
        }),
      );
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
        ? [[trimmedAgentKind, trimmedModelId]]
        : [];
    }),
  );
}

/** Saved model ids are opaque intent and are never client-canonicalized. */
export function normalizeDefaultChatModelId(_agentKind: string, modelId: string): string {
  return modelId.trim();
}
