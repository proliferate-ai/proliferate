import { CHAT_COMPOSER_LABELS } from "@/config/chat";
import { COMPOSER_SHORTCUTS } from "@/config/shortcuts";
import { ArrowUp, StopSquare } from "@/components/ui/icons";

export function ChatComposerActions({
  isRunning,
  isEmpty,
  isDisabled,
  isEditingQueuedPrompt = false,
  onSubmit,
  onCancel,
}: {
  isRunning: boolean;
  isEmpty: boolean;
  isDisabled: boolean;
  isEditingQueuedPrompt?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  // While editing a queued prompt, the Save action takes over the primary
  // button slot regardless of `isRunning` — the user must cancel the edit
  // before they can reach the Stop control.
  if (isRunning && !isEditingQueuedPrompt) {
    return (
      <button
        type="button"
        onClick={onCancel}
        title={CHAT_COMPOSER_LABELS.stop}
        className="flex size-7 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90"
      >
        <StopSquare className="size-3.5" />
      </button>
    );
  }

  const canSubmit = !isEmpty && !isDisabled;
  const title = isEditingQueuedPrompt
    ? `Save edit (${COMPOSER_SHORTCUTS.submitMessage.label})`
    : `${CHAT_COMPOSER_LABELS.send} (${COMPOSER_SHORTCUTS.submitMessage.label})`;

  return (
    <button
      type="button"
      onClick={canSubmit ? onSubmit : undefined}
      disabled={!canSubmit}
      title={title}
      className={`flex size-7 items-center justify-center rounded-full transition-colors disabled:cursor-default ${
        canSubmit
          ? "bg-foreground text-background hover:bg-foreground/90"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <ArrowUp className="size-3.5" />
    </button>
  );
}
