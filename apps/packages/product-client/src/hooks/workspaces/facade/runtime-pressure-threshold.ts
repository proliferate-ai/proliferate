import type { RuntimeResourcePressure } from "@anyharness/sdk";

export type RuntimePressureTone = "success" | "warning" | "destructive" | "quiet";

export function pressureTone(
  percent: number | null,
  limitPercent: number,
): RuntimePressureTone {
  if (percent === null || !Number.isFinite(percent)) {
    return "quiet";
  }
  if (percent >= limitPercent) {
    return "destructive";
  }
  if (percent >= limitPercent * 0.8) {
    return "warning";
  }
  return "success";
}

export function pressureProgressPercent(
  percent: number | null,
  limitPercent: number,
): number | null {
  if (percent === null || !Number.isFinite(percent) || limitPercent <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (percent / limitPercent) * 100));
}

export function cloudPressureLimitPercent(
  pressure: RuntimeResourcePressure | null,
): number {
  if (!pressure) {
    return 100;
  }

  const axes = [
    [pressure.cpu?.normalizedPercent, pressure.cpu?.idealMaxPercent],
    [pressure.memory?.percent, pressure.memory?.idealMaxPercent],
    [pressure.disk?.percent, pressure.disk?.idealMaxPercent],
  ] as const;
  let selectedLimit = 100;
  let highestRatio = Number.NEGATIVE_INFINITY;
  for (const [percent, idealMaxPercent] of axes) {
    if (
      typeof percent !== "number"
      || !Number.isFinite(percent)
      || typeof idealMaxPercent !== "number"
      || !Number.isFinite(idealMaxPercent)
      || idealMaxPercent <= 0
    ) {
      continue;
    }
    const ratio = percent / idealMaxPercent;
    if (ratio > highestRatio) {
      highestRatio = ratio;
      selectedLimit = idealMaxPercent;
    }
  }
  return selectedLimit;
}
