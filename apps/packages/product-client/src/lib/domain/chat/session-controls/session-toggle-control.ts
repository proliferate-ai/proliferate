import { isApplePlatform } from "#product/lib/domain/shortcuts/matching";

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

// The ruled modifier spelling is "⌘ click" ("Ctrl click" on non-Apple) — a
// bare space, never "⌘-click" or "Cmd+Click". The hint lands as its own
// sentence, so a description that already ends in "." must not read "..".
export function appendSessionControlStepHint(
  tooltip: string,
  action: "step" | "switch",
): string {
  const modifier = isApplePlatform() ? "⌘" : "Ctrl";
  const hint = action === "step"
    ? `Click to step, ${modifier} click to step back.`
    : `Click to switch, ${modifier} click to go back.`;
  return `${tooltip.replace(/\.+$/, "")}. ${hint}`;
}
