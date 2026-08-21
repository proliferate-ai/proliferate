import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";

export interface HarnessLaunchModelRow {
  id: string;
  displayName: string;
  description: string | null;
}

/** Exact-key presentation over one target's observed launch-option response. */
export function normalizeRuntimeLaunchModels(
  harnessKind: string,
  launchOptions: Pick<HarnessLaunchOptionsResponse, "harnessKind" | "options"> | undefined,
): HarnessLaunchModelRow[] {
  if (launchOptions?.harnessKind !== harnessKind) {
    return [];
  }
  return (launchOptions.options?.models ?? []).map((model) => ({
    id: model.id,
    displayName: model.observedName?.trim() || model.id,
    description: model.observedDescription?.trim() || null,
  }));
}

/**
 * The bare duration used by the Models section's freshness suffix
 * (`HARNESS_PANE_COPY.allModelsFreshRefreshedAgo`): "5m", "2h", "3d", or the
 * literal "just now" for anything under a minute — never carries its own
 * "ago" so the copy layer can special-case that string.
 */
export function formatSnapshotAge(observedAt: string, now: number = Date.now()): string {
  const then = new Date(observedAt).getTime();
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
