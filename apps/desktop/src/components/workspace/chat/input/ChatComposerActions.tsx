import { CHAT_COMPOSER_LABELS } from "@/copy/chat/chat-copy";
import { COMPOSER_SHORTCUTS } from "@/config/shortcuts/composer-shortcuts";
import { ArrowUp, StopSquare } from "@proliferate/ui/icons";
import { ComposerActionButton } from "@proliferate/ui/primitives/ComposerActionButton";
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
        <ComposerActionButton
          type="button"
          onClick={onSubmit}
          onPointerEnter={() => startHoverSample("send_button")}
          title={`${CHAT_COMPOSER_LABELS.send} to queue`}
          aria-label={`${CHAT_COMPOSER_LABELS.send} to queue`}
          data-chat-send-button
        >
          <ArrowUp className="size-3.5" />
        </ComposerActionButton>
      );
    }

    return (
      <ComposerActionButton
        type="button"
        onClick={onCancel}
        onPointerEnter={() => startHoverSample("stop_button")}
        title={CHAT_COMPOSER_LABELS.stop}
        aria-label={CHAT_COMPOSER_LABELS.stop}
        data-chat-stop-button
      >
        <StopSquare className="size-3.5" />
      </ComposerActionButton>
    );
  }

  const canSubmit = !isEmpty && !isDisabled;
  const submitShortcutLabel = getShortcutDisplayLabel(COMPOSER_SHORTCUTS.submitMessage);
  const title = isEditingQueuedPrompt
    ? `Save edit (${submitShortcutLabel})`
    : `${CHAT_COMPOSER_LABELS.send} (${submitShortcutLabel})`;

  return (
    <ComposerActionButton
      type="button"
      onClick={canSubmit ? onSubmit : undefined}
      onPointerEnter={() => startHoverSample("send_button")}
      disabled={!canSubmit}
      title={title}
      aria-label={title}
      data-chat-send-button
    >
      <ArrowUp className="size-3.5" />
    </ComposerActionButton>
  );
}
