import type {
  DesktopAgentLaunchControl,
} from "#product/lib/domain/agents/cloud-launch-catalog-types";

/** Enrich stale cloud presentation without letting it veto target policy. */
export function withRuntimeUnattendedMode(
  controls: readonly DesktopAgentLaunchControl[],
  unattendedModeId: string | null,
): DesktopAgentLaunchControl[] {
  if (!unattendedModeId) {
    return [...controls];
  }
  const modeControl = controls.find((control) => control.key === "mode");
  if (
    !modeControl
    || modeControl.values.some((value) => value.value === unattendedModeId)
  ) {
    return [...controls];
  }

  return controls.map((control) => control === modeControl
    ? {
      ...control,
      values: [
        ...control.values,
        {
          value: unattendedModeId,
          label: humanizeControlValue(unattendedModeId),
          description: null,
          isDefault: false,
          status: "active",
        },
      ],
    }
    : control);
}

function humanizeControlValue(value: string): string {
  const words = value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words
    ? words.split(" ").map((word) => (
      word.charAt(0).toUpperCase() + word.slice(1)
    )).join(" ")
    : value;
}
