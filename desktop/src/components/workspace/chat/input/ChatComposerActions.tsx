import { CHAT_COMPOSER_LABELS } from "@/config/chat";
import { COMPOSER_SHORTCUTS } from "@/config/shortcuts";
import { ArrowUp, StopSquare } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import { startMeasurementOperation } from "@/lib/infra/debug-measurement";

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
  const buttonClassName =
    "size-7 rounded-full bg-[var(--color-composer-send-background)] px-0 text-[color:var(--color-composer-send-foreground)] shadow-none hover:bg-[var(--color-composer-send-background)] hover:opacity-90 disabled:cursor-default disabled:opacity-50";
  const startHoverSample = (sampleKey: "send_button" | "stop_button") => {
    startMeasurementOperation({
      kind: "hover_sample",
      sampleKey,
      surfaces: [
        sampleKey === "send_button" ? "send-button" : "stop-button",
        "chat-composer",
      ],
      maxDurationMs: 750,
      cooldownMs: 2000,
    });
  };

  // While editing a queued prompt, the Save action takes over the primary
  // button slot regardless of `isRunning` — the user must cancel the edit
  // before they can reach the Stop control.
  if (isRunning && !isEditingQueuedPrompt) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onCancel}
        onPointerEnter={() => startHoverSample("stop_button")}
        title={CHAT_COMPOSER_LABELS.stop}
        aria-label={CHAT_COMPOSER_LABELS.stop}
        className={buttonClassName}
      >
        <StopSquare className="size-3.5" />
      </Button>
    );
  }

  const canSubmit = !isEmpty && !isDisabled;
  const submitShortcutLabel = getShortcutDisplayLabel(COMPOSER_SHORTCUTS.submitMessage);
  const title = isEditingQueuedPrompt
    ? `Save edit (${submitShortcutLabel})`
    : `${CHAT_COMPOSER_LABELS.send} (${submitShortcutLabel})`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={canSubmit ? onSubmit : undefined}
      onPointerEnter={() => startHoverSample("send_button")}
      disabled={!canSubmit}
      title={title}
      aria-label={title}
      className={buttonClassName}
    >
      <ArrowUp className="size-3.5" />
    </Button>
  );
}
