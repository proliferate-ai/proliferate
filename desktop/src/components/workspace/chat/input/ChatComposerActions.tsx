import { CHAT_COMPOSER_LABELS } from "@/copy/chat/chat-copy";
import { COMPOSER_SHORTCUTS } from "@/config/shortcuts";
import { ArrowUp, StopSquare } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import { startMeasurementOperation } from "@/lib/infra/measurement/debug-measurement";

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
  // button slot regardless of `isRunning`.
  if (isRunning && !isEditingQueuedPrompt) {
    const canQueue = !isEmpty && !isDisabled;
    if (canQueue) {
      return (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onSubmit}
          onPointerEnter={() => startHoverSample("send_button")}
          title={`${CHAT_COMPOSER_LABELS.send} to queue`}
          aria-label={`${CHAT_COMPOSER_LABELS.send} to queue`}
          data-chat-send-button
          className={buttonClassName}
        >
          <ArrowUp className="size-3.5" />
        </Button>
      );
    }

    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onCancel}
        onPointerEnter={() => startHoverSample("stop_button")}
        title={CHAT_COMPOSER_LABELS.stop}
        aria-label={CHAT_COMPOSER_LABELS.stop}
        data-chat-stop-button
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
      data-chat-send-button
      className={buttonClassName}
    >
      <ArrowUp className="size-3.5" />
    </Button>
  );
}
