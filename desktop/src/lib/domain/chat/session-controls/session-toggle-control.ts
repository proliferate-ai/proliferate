export type SessionToggleControlKey = "reasoning" | "fast_mode";

export type SessionToggleControlTone =
  | "accent"
  | "primary"
  | "warning";

export type SessionToggleControlIconKey =
  | "brain"
  | "zap";

export type SessionToggleControlIndicatorTone =
  | "accent"
  | "muted"
  | "warning";

export interface SessionToggleControlPresentation {
  icon: SessionToggleControlIconKey;
  tone: SessionToggleControlTone;
}

export interface SessionToggleControlStateIndicator {
  tone: SessionToggleControlIndicatorTone;
  label: string;
}

const TOGGLE_PRESENTATIONS: Record<SessionToggleControlKey, SessionToggleControlPresentation> = {
  reasoning: {
    icon: "brain",
    tone: "accent",
  },
  fast_mode: {
    icon: "zap",
    tone: "warning",
  },
};

export function resolveSessionToggleControlPresentation(
  key: SessionToggleControlKey,
): SessionToggleControlPresentation {
  return TOGGLE_PRESENTATIONS[key];
}

export function resolveSessionToggleControlStateIndicator(
  key: SessionToggleControlKey,
  isEnabled: boolean,
): SessionToggleControlStateIndicator {
  switch (key) {
    case "reasoning":
      return isEnabled
        ? { tone: "accent", label: "On" }
        : { tone: "muted", label: "Off" };
    case "fast_mode":
      return isEnabled
        ? { tone: "warning", label: "Fast" }
        : { tone: "muted", label: "Slow" };
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
