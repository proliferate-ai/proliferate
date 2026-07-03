import type { CloudChatComposerControlView } from "@proliferate/product-domain/chats/cloud/composer-controls";

import { joinUniqueLabels, type MobileChatIconName } from "./mobile-chat-presentation";

export function summarizeComposerControls(
  controls: readonly CloudChatComposerControlView[],
  runtimeLabel: string,
): { label: string; icon: MobileChatIconName; pending: boolean } {
  const modelControl = controls.find((control) => control.key === "model") ?? null;
  const modeControl =
    controls.find((control) =>
      control.key === "mode" || control.key === "collaboration_mode"
    )
    ?? controls.find((control) => control.placement === "leading")
    ?? null;
  const primaryControl = modelControl ?? modeControl ?? controls[0] ?? null;
  const primaryLabel =
    composerControlValueLabel(primaryControl)
    ?? primaryControl?.label
    ?? "Chat settings";
  const secondaryLabel = modeControl && modeControl !== primaryControl
    ? composerControlValueLabel(modeControl)
    : null;
  const label = secondaryLabel && secondaryLabel !== primaryLabel
    ? joinUniqueLabels([primaryLabel, secondaryLabel, runtimeLabel])
    : joinUniqueLabels([primaryLabel, runtimeLabel]);

  return {
    label: label || "Chat settings",
    icon: composerControlIcon(primaryControl),
    pending: controls.some((control) => Boolean(control.pendingState)),
  };
}

function composerControlValueLabel(control: CloudChatComposerControlView | null): string | null {
  if (!control) {
    return null;
  }
  const selected = selectedComposerOptionLabel(control);
  const detail = control.detail?.trim();
  const value = detail && detail !== control.label && detail.toLowerCase() !== "mode"
    ? normalizeComposerLabel(detail)
    : selected;
  if (!value) {
    return null;
  }
  return control.pendingState ? `Updating ${value}` : value;
}

function selectedComposerOptionLabel(control: CloudChatComposerControlView): string | null {
  for (const group of control.groups) {
    const selected = group.options.find((option) => option.selected);
    if (selected) {
      return normalizeComposerLabel(selected.label);
    }
  }
  return null;
}

function normalizeComposerLabel(label: string): string {
  return label
    .replace(/^Claude\s*·\s*/i, "")
    .replace(/^Claude\s+(?=Sonnet|Haiku|Opus)/i, "")
    .replace(/^OpenAI\s*·\s*/i, "")
    .replace(/^Codex\s*·\s*/i, "");
}

function composerControlIcon(control: CloudChatComposerControlView | null): MobileChatIconName {
  switch (control?.icon) {
    case "brain":
      return "brain";
    case "sparkles":
    case "zap":
      return "sparkles";
    case "openai":
      return "openai";
    case "claude":
      return "claude";
    case "shieldCheck":
      return "shield";
    case "chat":
      return "sessions";
    case "opencodeBuild":
    case "bot":
      return "sparkles";
    case "settings":
    default:
      return "controls";
  }
}
