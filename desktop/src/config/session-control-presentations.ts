export type ConfiguredSessionControlKey = "mode" | "collaboration_mode";

export type SessionControlTone =
  | "neutral"
  | "accent"
  | "primary"
  | "warning"
  | "destructive"
  | "success"
  | "info";

export type SessionControlIconKey =
  | "circleQuestion"
  | "pencil"
  | "planning"
  | "shield"
  | "zap";

export interface ConfiguredSessionControlValue {
  value: string;
  label: string;
  shortLabel?: string | null;
  description?: string | null;
  tone: SessionControlTone;
  icon: SessionControlIconKey;
  isDefault?: boolean;
}

type ConfiguredSessionControlsByKey = Partial<
  Record<ConfiguredSessionControlKey, ConfiguredSessionControlValue[]>
>;

export const SESSION_CONTROL_PRESENTATIONS: Record<string, ConfiguredSessionControlsByKey> = {
  claude: {
    mode: [
      {
        value: "default",
        label: "Default",
        shortLabel: "Default",
        description: "Ask before each action.",
        tone: "info",
        icon: "circleQuestion",
        isDefault: true,
      },
      {
        value: "acceptEdits",
        label: "Accept Edits",
        shortLabel: "Accept Edits",
        description: "Auto-approve file edits.",
        tone: "success",
        icon: "pencil",
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan without execution.",
        tone: "accent",
        icon: "planning",
      },
      {
        value: "dontAsk",
        label: "Don't Ask",
        shortLabel: "Don't Ask",
        description: "Auto-approve most actions.",
        tone: "warning",
        icon: "shield",
      },
      {
        value: "bypassPermissions",
        label: "Bypass",
        shortLabel: "Bypass",
        description: "Skip permission checks.",
        tone: "destructive",
        icon: "zap",
      },
    ],
  },
  codex: {
    mode: [
      {
        value: "read-only",
        label: "Read Only",
        shortLabel: "Read Only",
        description: "Inspect and plan without editing.",
        tone: "info",
        icon: "circleQuestion",
        isDefault: true,
      },
      {
        value: "auto",
        label: "Auto",
        shortLabel: "Auto",
        description: "Auto-approve standard edits.",
        tone: "success",
        icon: "pencil",
      },
      {
        value: "full-access",
        label: "Full Access",
        shortLabel: "Full Access",
        description: "Allow unrestricted changes.",
        tone: "destructive",
        icon: "zap",
      },
    ],
    collaboration_mode: [
      {
        value: "default",
        label: "Default",
        shortLabel: "Default",
        description: "Standard collaboration behavior.",
        tone: "info",
        icon: "circleQuestion",
        isDefault: true,
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan before applying changes.",
        tone: "accent",
        icon: "planning",
      },
    ],
  },
  gemini: {
    mode: [
      {
        value: "default",
        label: "Default",
        shortLabel: "Default",
        description: "Ask before each action.",
        tone: "info",
        icon: "circleQuestion",
        isDefault: true,
      },
      {
        value: "autoEdit",
        label: "Auto Edit",
        shortLabel: "Auto Edit",
        description: "Auto-approve edits.",
        tone: "success",
        icon: "pencil",
      },
      {
        value: "yolo",
        label: "YOLO",
        shortLabel: "YOLO",
        description: "Skip permission checks.",
        tone: "destructive",
        icon: "zap",
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan without execution.",
        tone: "accent",
        icon: "planning",
      },
    ],
  },
};
