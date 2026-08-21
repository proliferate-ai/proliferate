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

