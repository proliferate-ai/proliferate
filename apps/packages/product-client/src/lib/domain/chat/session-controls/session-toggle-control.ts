export type SessionToggleControlKey = "reasoning" | "fast_mode";

export type SessionToggleControlIconKey =
  | "brain"
  | "zap";

export interface SessionToggleControlPresentation {
  icon: SessionToggleControlIconKey;
}

const TOGGLE_PRESENTATIONS: Record<SessionToggleControlKey, SessionToggleControlPresentation> = {
  reasoning: {
    icon: "brain",
  },
  fast_mode: {
    icon: "zap",
  },
};

export function resolveSessionToggleControlPresentation(
  key: SessionToggleControlKey,
): SessionToggleControlPresentation {
  return TOGGLE_PRESENTATIONS[key];
}

export function resolveSessionToggleControlStateLabel(
  key: SessionToggleControlKey,
  isEnabled: boolean,
): string {
  switch (key) {
    case "reasoning":
      return isEnabled ? "On" : "Off";
    case "fast_mode":
      return isEnabled ? "Fast" : "Slow";
  }
}

export function resolveSessionControlTooltip(
  label: string,
  detail: string | null,
  description?: string | null,
): string {
  const title = detail ? `${label}: ${detail}` : label;
  return description ? `${title} — ${description}` : title;
}
