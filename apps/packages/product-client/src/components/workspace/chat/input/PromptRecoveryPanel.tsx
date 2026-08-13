import { useCallback, useState } from "react";
import { Button } from "#product/primitives/Button";
import { X } from "#product/primitives/icons/core";
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
            // Recorded exclusion (DESIGN_SYSTEM.md § UI-conformance review,
            // check 7): `RosterRow` is the shape this maps to, but it ties its
            // hover wash to `onSelect` — a row given none paints no states at
            // all — and this row is not pressable while still wanting the
            // wash. Its secondary line is also fixed at `text-muted-foreground`
            // with no tone axis, and this row's second line *is* the error
            // (`text-destructive/80`). The single `hover:bg-hover` here is a
            // shared state token, not a hand-assembled three-state stack.
            // Landing this needs a non-interactive hover and a secondary-line
            // tone on `RosterRow`, which is a review ruling.
            <div
              key={recovery.id}
              className="group/recovery flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 hover:bg-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui" title={label}>
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
                <X className="icon-paired" />
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
