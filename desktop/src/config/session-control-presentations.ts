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
  | "ask"
  | "edit"
  | "inspect"
  | "plan"
  | "permission"
  | "unknown"
  | "unrestricted";

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
        icon: "ask",
        isDefault: true,
      },
      {
        value: "acceptEdits",
        label: "Accept Edits",
        shortLabel: "Accept Edits",
        description: "Auto-approve file edits.",
        tone: "success",
        icon: "edit",
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan without execution.",
        tone: "accent",
        icon: "plan",
      },
      {
        value: "dontAsk",
        label: "Don't Ask",
        shortLabel: "Don't Ask",
        description: "Auto-approve most actions.",
        tone: "warning",
        icon: "permission",
      },
      {
        value: "bypassPermissions",
        label: "Bypass",
        shortLabel: "Bypass",
        description: "Skip permission checks.",
        tone: "destructive",
        icon: "unrestricted",
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
        icon: "inspect",
        isDefault: true,
      },
      {
        value: "auto",
        label: "Auto",
        shortLabel: "Auto",
        description: "Auto-approve standard edits.",
        tone: "success",
        icon: "edit",
      },
      {
        value: "full-access",
        label: "Full Access",
        shortLabel: "Full Access",
        description: "Allow unrestricted changes.",
        tone: "destructive",
        icon: "unrestricted",
      },
    ],
    collaboration_mode: [
      {
        value: "default",
        label: "Default",
        shortLabel: "Default",
        description: "Standard collaboration behavior.",
        tone: "info",
        icon: "ask",
        isDefault: true,
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan before applying changes.",
        tone: "accent",
        icon: "plan",
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
        icon: "ask",
        isDefault: true,
      },
      {
        value: "autoEdit",
        label: "Auto Edit",
        shortLabel: "Auto Edit",
        description: "Auto-approve edits.",
        tone: "success",
        icon: "edit",
      },
      {
        value: "yolo",
        label: "YOLO",
        shortLabel: "YOLO",
        description: "Skip permission checks.",
        tone: "destructive",
        icon: "unrestricted",
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan without execution.",
        tone: "accent",
        icon: "plan",
      },
    ],
  },
};
