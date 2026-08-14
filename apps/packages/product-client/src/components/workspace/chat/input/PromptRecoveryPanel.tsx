import { useCallback, useState } from "react";
import { Button } from "#product/primitives/Button";
import { X } from "#product/primitives/icons/core";
import { ActionRow } from "#product/primitives/patterns/ActionRow";
import { summarizeContentParts } from "#product/domain/chats/composer/prompt-display-parts";
import { useChatPromptRecoveries } from "#product/hooks/chat/derived/use-chat-prompt-recoveries";
import { useChatPromptRecoveryActions } from "#product/hooks/chat/workflows/use-chat-prompt-recovery-actions";
import type { ChatPromptRecovery } from "#product/stores/chat/chat-prompt-recovery-store";

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
      className="relative overflow-hidden rounded-t-xl border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))] px-1.5 py-1.5"
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
            // `ActionRow` (rule-of-two promotion): the two things this row needed
            // and `RosterRow` cannot give — a hover wash on a row that is not
            // pressable, and a secondary line whose tone can be the error itself
            // — are that pattern's whole reason to exist. The resume popover's
            // interrupted-run row was the second instance that earned it.
            <ActionRow
              key={recovery.id}
              title={label}
              titleTooltip={label}
              secondary={`Not sent · ${recovery.errorMessage}`}
              secondaryTooltip={recovery.errorMessage}
              secondaryTone="destructive"
              actions={
                <>
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
                    <X className="icon-paired" />
                  </Button>
                </>
              }
            />
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
