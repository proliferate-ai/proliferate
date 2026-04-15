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
        className="flex size-7 items-center justify-center rounded-full bg-[var(--color-composer-send-background)] text-[color:var(--color-composer-send-foreground)] transition-opacity hover:opacity-90"
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
      className={`flex size-7 items-center justify-center rounded-full bg-[var(--color-composer-send-background)] text-[color:var(--color-composer-send-foreground)] transition-opacity disabled:cursor-default ${
        canSubmit
          ? "hover:opacity-90"
          : "opacity-50"
      }`}
    >
      <ArrowUp className="size-3.5" />
    </button>
  );
}
