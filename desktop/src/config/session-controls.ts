import type { NormalizedSessionControls } from "@anyharness/sdk";

export type SupportedLiveControlKey =
  | "collaboration_mode"
  | "mode"
  | "reasoning"
  | "effort"
  | "fast_mode";

export const SESSION_CONTROL_ORDER: SupportedLiveControlKey[] = [
  "collaboration_mode",
  "reasoning",
  "effort",
  "fast_mode",
  "mode",
];

export const SESSION_CONTROL_ACCESSORS: Record<
  SupportedLiveControlKey,
  keyof Pick<
    NormalizedSessionControls,
    "collaborationMode" | "mode" | "reasoning" | "effort" | "fastMode"
  >
> = {
  collaboration_mode: "collaborationMode",
  mode: "mode",
  reasoning: "reasoning",
  effort: "effort",
  fast_mode: "fastMode",
};

export const SESSION_CONTROL_LABELS: Record<SupportedLiveControlKey, string> = {
  collaboration_mode: "Mode",
  mode: "Permissions",
  reasoning: "Reasoning",
  effort: "Reasoning effort",
  fast_mode: "Fast mode",
};
