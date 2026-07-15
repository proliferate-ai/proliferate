import { useCallback, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { X } from "@proliferate/ui/icons";
import { summarizeContentParts } from "@proliferate/product-domain/chats/composer/prompt-display-parts";
import { useChatPromptRecoveries } from "@/hooks/chat/derived/use-chat-prompt-recoveries";
import { useChatPromptRecoveryActions } from "@/hooks/chat/workflows/use-chat-prompt-recovery-actions";
import type { ChatPromptRecovery } from "@/stores/chat/chat-prompt-recovery-store";

export function PromptRecoveryPanel({
  recoveries,
  retryingId,
  onRetry,
  onDismiss,
}: {
  recoveries: readonly ChatPromptRecovery[];
  retryingId: string | null;
  onRetry: (recovery: ChatPromptRecovery) => void;
  onDismiss: (recoveryId: string) => void;
}) {
  if (recoveries.length === 0) {
    return null;
  }
  return (
    <div
      className="relative overflow-hidden rounded-t-[13px] border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))] px-1.5 py-1.5"
      data-telemetry-mask
      role="region"
      aria-label="Messages not sent"
    >
      <div className="max-h-48 overflow-y-auto">
        {recoveries.map((recovery) => {
          const label = summarizeContentParts(
            recovery.prompt.contentParts,
            recovery.prompt.text,
          ) || "Message with attachments";
          return (
            <div
              key={recovery.id}
              className="group/recovery flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui leading-[var(--text-ui--line-height)]" title={label}>
                  {label}
                </div>
                <div
                  className="truncate text-ui-sm text-destructive/80"
                  title={recovery.errorMessage}
                >
                  Not sent · {recovery.errorMessage}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={retryingId !== null}
                onClick={() => onRetry(recovery)}
                aria-label={`Retry unsent message: ${label}`}
                className="h-7 px-2 text-ui-sm"
              >
                {retryingId === recovery.id ? "Retrying…" : "Retry"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={retryingId === recovery.id}
                onClick={() => onDismiss(recovery.id)}
                aria-label={`Dismiss unsent message: ${label}`}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ConnectedPromptRecoveryPanel() {
  const { recoveries, workspaceUiKey } = useChatPromptRecoveries();
  const { dismissRecovery, retryRecovery } = useChatPromptRecoveryActions(workspaceUiKey);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const handleRetry = useCallback((recovery: ChatPromptRecovery) => {
    setRetryingId(recovery.id);
    void retryRecovery(recovery).finally(() => setRetryingId(null));
  }, [retryRecovery]);

  return (
    <PromptRecoveryPanel
      recoveries={recoveries}
      retryingId={retryingId}
      onRetry={handleRetry}
      onDismiss={dismissRecovery}
    />
  );
}
