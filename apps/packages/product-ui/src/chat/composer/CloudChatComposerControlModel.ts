import type {
  CloudChatComposerControlGroupView,
  CloudChatComposerControlOptionView,
  CloudChatComposerControlView,
} from "./CloudChatComposerView";

export function summarizeComposerModelConfigControls(
  controls: readonly CloudChatComposerControlView[],
): string | null {
  const labels = controls.flatMap((control) => {
    const selected = selectedComposerOption(control);
    if ((control.key === "fast_mode" || control.key === "reasoning") && !control.active) {
      return [];
    }
    return [selected?.label ?? control.detail].filter((label): label is string => Boolean(label));
  });
  return labels.length > 0 ? labels.slice(0, 3).join(" · ") : null;
}

export function filterModelControlOptions(
  control: CloudChatComposerControlView,
  search: string,
): CloudChatComposerControlView {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return control;
  }

  return {
    ...control,
    groups: control.groups.flatMap((group) => {
      const groupMatches = (group.label ?? group.id).toLowerCase().includes(normalizedSearch);
      const options = groupMatches
        ? group.options
        : group.options.filter((option) =>
          `${option.label} ${option.description ?? ""}`.toLowerCase().includes(normalizedSearch)
        );
      return options.length > 0 ? [{ ...group, options }] : [];
    }),
  };
}

export function filterComposerControlOptions(
  control: CloudChatComposerControlView,
  search: string,
): CloudChatComposerControlView {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return control;
  }

  return {
    ...control,
    groups: control.groups.flatMap((group) => {
      const groupMatches = (group.label ?? group.id).toLowerCase().includes(normalizedSearch);
      const options = groupMatches
        ? group.options
        : group.options.filter((option) =>
          `${option.label} ${option.description ?? ""}`.toLowerCase().includes(normalizedSearch)
        );
      return options.length > 0 ? [{ ...group, options }] : [];
    }),
  };
}

export function composerControlOptionCount(control: CloudChatComposerControlView): number {
  return control.groups.reduce((count, group) => count + group.options.length, 0);
}

export function modelConfigSubmenuLabel(control: CloudChatComposerControlView): string {
  switch (control.key) {
    case "effort":
    case "reasoning":
      return "Reasoning";
    case "fast_mode":
      return "Speed";
    case "model":
      if (control.groups.length > 1) {
        return "Agent";
      }
      return activeComposerModelGroup(control)?.label ?? selectedComposerOption(control)?.label ?? control.label;
    default:
      return control.label;
  }
}

export function activeComposerModelGroup(
  control: CloudChatComposerControlView,
): CloudChatComposerControlGroupView | null {
  return control.groups.find((group) =>
    group.options.some((option) => option.selected)
  ) ?? control.groups[0] ?? null;
}

export function modelGroupLabel(
  control: CloudChatComposerControlView,
  group: CloudChatComposerControlGroupView,
): string | null {
  const label = group.label ?? null;
  if (!isModelControl(control)) {
    return label;
  }
  if (label && label !== "Model") {
    return label;
  }

  const optionText = group.options
    .map((option) => `${option.label} ${option.description ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (optionText.includes("sonnet") || optionText.includes("haiku") || optionText.includes("claude")) {
    return "Claude";
  }

  return label;
}

export function selectedComposerOption(
  control: CloudChatComposerControlView,
): CloudChatComposerControlOptionView | null {
  for (const group of control.groups) {
    const selected = group.options.find((option) => option.selected);
    if (selected) {
      return selected;
    }
  }
  return control.groups[0]?.options[0] ?? null;
}

export function isModelControl(control: CloudChatComposerControlView): boolean {
  return control.key === "model" || control.id === "launch-model" || control.label === "Model";
}

export function isControlDisabled(control: CloudChatComposerControlView): boolean {
  return control.disabled || control.groups.every((group) =>
    group.options.every((option) => option.disabled)
  );
}
