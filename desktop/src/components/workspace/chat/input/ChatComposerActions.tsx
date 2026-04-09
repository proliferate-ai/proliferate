import { CHAT_COMPOSER_LABELS } from "@/config/chat";
import { SHORTCUTS } from "@/config/shortcuts";
import { ArrowUp, StopSquare } from "@/components/ui/icons";

export function ChatComposerActions({
  isRunning,
  isEmpty,
  isDisabled,
  onSubmit,
  onCancel,
}: {
  isRunning: boolean;
  isEmpty: boolean;
  isDisabled: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (isRunning) {
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

  return (
    <button
      type="button"
      onClick={canSubmit ? onSubmit : undefined}
      disabled={!canSubmit}
      title={`${CHAT_COMPOSER_LABELS.send} (${SHORTCUTS.submitMessage.label})`}
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
