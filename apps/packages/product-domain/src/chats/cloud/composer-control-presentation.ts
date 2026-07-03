import type {
  CloudChatComposerBadgeSummary,
  CloudChatComposerControlGroupView,
  CloudChatComposerControlOptionView,
  CloudChatComposerControlView,
} from "./composer-control-model";

export function cloudComposerControlTitle(control: CloudChatComposerControlView): string {
  switch (control.key) {
    case "model":
      return "Model";
    case "mode":
    case "collaboration_mode":
      return "Mode";
    default:
      return control.label;
  }
}

export function selectedCloudComposerControlOption(
  control: CloudChatComposerControlView,
): CloudChatComposerControlOptionView | null {
  for (const group of control.groups) {
    const selected = group.options.find((option) => option.selected);
    if (selected) {
      return selected;
    }
  }
  return null;
}

export function formatCloudComposerControlValueLabel(
  control: CloudChatComposerControlView | null,
): string | null {
  if (!control) {
    return null;
  }
  const selected = selectedCloudComposerControlOption(control);
  const selectedLabel = selected ? normalizeCloudComposerModelLabel(selected.label) : null;
  const detail = control.detail?.trim();
  const value = detail && detail !== control.label && detail.toLowerCase() !== "mode"
    ? normalizeCloudComposerModelLabel(detail)
    : selectedLabel;
  if (!value) {
    return null;
  }
  return control.pendingState ? `Updating ${value}` : value;
}

export function normalizeCloudComposerModelLabel(label: string): string {
  return label
    .replace(/^Claude\s*·\s*/i, "")
    .replace(/^Claude\s+(?=Sonnet|Haiku|Opus)/i, "")
    .replace(/^OpenAI\s*·\s*/i, "")
    .replace(/^Codex\s*·\s*/i, "");
}

export function cloudComposerControlGroupLabel(
  control: CloudChatComposerControlView,
  group: CloudChatComposerControlGroupView,
): string | null {
  if (!group.label) {
    return null;
  }
  if (control.key !== "model" || group.label.toLowerCase() !== "models") {
    return group.label;
  }
  const providerIcon = group.options[0]?.icon;
  const everyOptionUsesSameProvider = providerIcon
    && group.options.every((option) => option.icon === providerIcon);
  if (!everyOptionUsesSameProvider) {
    return group.label;
  }
  switch (providerIcon) {
    case "claude":
      return "Claude";
    case "openai":
      return "OpenAI";
    default:
      return group.label;
  }
}

export function summarizeCloudComposerBadgeControls(
  controls: readonly CloudChatComposerControlView[],
): CloudChatComposerBadgeSummary {
  const activeControls = controls.filter((control) => control.active !== false);
  const modelControl = activeControls.find((control) => control.key === "model") ?? null;
  const modeControl = activeControls.find((control) =>
    control.key === "mode" || control.key === "collaboration_mode"
  ) ?? activeControls.find((control) => control.placement === "leading") ?? null;
  const extras = activeControls.filter((control) =>
    control !== modelControl
    && control !== modeControl
    && (control.key === "reasoning" || control.key === "effort" || control.key === "fast_mode")
  );
  const primaryControl = modelControl ?? modeControl ?? activeControls[0] ?? null;
  const labels = [
    formatCloudComposerControlValueLabel(primaryControl) ?? primaryControl?.label ?? null,
    modeControl && modeControl !== primaryControl ? formatCloudComposerControlValueLabel(modeControl) : null,
    ...extras.map((control) => formatCloudComposerControlValueLabel(control)),
  ].filter((label): label is string => Boolean(label));

  return {
    label: labels.length > 0 ? labels.join(" · ") : "Chat settings",
    icon: primaryControl?.icon ?? null,
    pending: controls.some((control) => Boolean(control.pendingState)),
  };
}
