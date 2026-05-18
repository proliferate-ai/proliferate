import type { ProductAutomationStatus } from "./model";

export function automationStatusLabel(status: ProductAutomationStatus): string {
  switch (status) {
    case "enabled":
      return "On";
    case "paused":
      return "Paused";
    case "failed":
      return "Failed";
  }
}

export function automationRunSummary(runCount?: number | null): string | undefined {
  if (runCount == null) {
    return undefined;
  }
  return `${runCount} ${runCount === 1 ? "run" : "runs"}`;
}
