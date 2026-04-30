import type { SessionLiveConfigSnapshot } from "@anyharness/sdk";

export function resolveFallbackSessionModelId({
  responseModelId,
  responseRequestedModelId,
  liveConfig,
  fallbackModelId,
}: {
  responseModelId?: string | null;
  responseRequestedModelId?: string | null;
  liveConfig?: SessionLiveConfigSnapshot | null;
  fallbackModelId: string;
}): string {
  if (responseRequestedModelId === fallbackModelId) {
    return fallbackModelId;
  }

  return (
    responseModelId
    ?? liveConfig?.normalizedControls.model?.currentValue
    ?? fallbackModelId
  );
}
