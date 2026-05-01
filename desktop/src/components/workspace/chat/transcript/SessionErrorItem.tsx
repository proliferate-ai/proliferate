import { useState } from "react";
import type { ErrorItem } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { RefreshCw } from "@/components/ui/icons";
import { useSessionModelFallbackAction } from "@/hooks/sessions/use-session-model-fallback-action";
import { useToastStore } from "@/stores/toast/toast-store";

export function SessionErrorItem({
  item,
  sessionId,
}: {
  item: ErrorItem;
  sessionId: string | null;
}) {
  const fallback = providerRateLimitFallback(item);
  const setFallbackModel = useSessionModelFallbackAction();
  const showToast = useToastStore((state) => state.show);
  const [isApplyingFallback, setIsApplyingFallback] = useState(false);

  const handleFallback = () => {
    if (!fallback || !sessionId || isApplyingFallback) {
      return;
    }
    setIsApplyingFallback(true);
    void setFallbackModel(sessionId, fallback.fallbackModelId)
      .then(() => {
        showToast("Session model changed to Opus 4.6.", "info");
      })
      .catch((error) => {
        showToast(`Failed to change model: ${errorMessage(error)}`);
      })
      .finally(() => {
        setIsApplyingFallback(false);
      });
  };

  return (
    <div className="rounded-lg bg-foreground/5 px-3 py-2 text-xs text-destructive">
      <div>{item.message}</div>
      {fallback && sessionId && (
        <div className="mt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={isApplyingFallback}
            onClick={handleFallback}
            className="px-2.5 text-sm"
          >
            <RefreshCw className="size-3.5" />
            Switch to Opus 4.6
          </Button>
        </div>
      )}
    </div>
  );
}

function providerRateLimitFallback(item: ErrorItem): { fallbackModelId: string } | null {
  const details = item.details;
  if (!details || details.kind !== "provider_rate_limit") {
    return null;
  }
  return { fallbackModelId: details.fallbackModelId };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
