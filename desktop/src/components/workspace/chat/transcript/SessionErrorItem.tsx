import { useState } from "react";
import type { ErrorItem } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { CircleAlert, ChevronRight, RefreshCw } from "@/components/ui/icons";
import { useSessionModelFallbackAction } from "@/hooks/sessions/workflows/use-session-model-fallback-action";
import { presentSessionError } from "@proliferate/product-model/chats/transcript/session-error-presentation";
import { useToastStore } from "@/stores/toast/toast-store";

export function SessionErrorItem({
  item,
  sessionId,
}: {
  item: ErrorItem;
  sessionId: string | null;
}) {
  const fallback = providerRateLimitFallback(item);
  const presentation = presentSessionError(item);
  const setFallbackModel = useSessionModelFallbackAction();
  const showToast = useToastStore((state) => state.show);
  const [isApplyingFallback, setIsApplyingFallback] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const handleFallback = () => {
    if (!fallback || !sessionId || isApplyingFallback) {
      return;
    }
    setIsApplyingFallback(true);
    void setFallbackModel(sessionId, fallback.fallbackModelId)
      .then(() => {
        showToast(
          `Session model changed to ${presentation.fallbackModelLabel ?? "the fallback model"}.`,
          "info",
        );
      })
      .catch((error) => {
        showToast(`Failed to change model: ${errorMessage(error)}`);
      })
      .finally(() => {
        setIsApplyingFallback(false);
      });
  };

  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2 text-sm">
      <div className="flex min-w-0 items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive/80" />
        <div className="min-w-0 flex-1">
          <div className="font-[520] text-destructive">{presentation.title}</div>
          <div className="mt-0.5 text-muted-foreground">{presentation.description}</div>
        </div>
      </div>
      {(fallback && sessionId) || presentation.technicalDetail ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          {fallback && sessionId && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isApplyingFallback}
              onClick={handleFallback}
              className="px-2.5 text-sm"
            >
              <RefreshCw className="size-3.5" />
              Switch to {presentation.fallbackModelLabel ?? "fallback model"}
            </Button>
          )}
          {presentation.technicalDetail && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDetailsExpanded((value) => !value)}
              className="gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={detailsExpanded}
            >
              <ChevronRight
                aria-hidden="true"
                className={`size-3 transition-transform ${detailsExpanded ? "rotate-90" : ""}`}
              />
              Details
            </Button>
          )}
        </div>
      ) : null}
      {detailsExpanded && presentation.technicalDetail && (
        <div className="mt-2 whitespace-pre-wrap rounded-md border border-border/70 bg-background/70 px-2.5 py-2 font-mono text-xs leading-5 text-muted-foreground select-text">
          {presentation.technicalDetail}
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
