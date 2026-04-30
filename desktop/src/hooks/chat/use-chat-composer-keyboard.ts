import { useCallback, type KeyboardEvent } from "react";
import { getPreviousSessionModeValue } from "@/lib/domain/chat/session-mode-control";
import { COMPOSER_SHORTCUTS } from "@/config/shortcuts";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls";
import { isComposerSubmitKey } from "@/lib/domain/chat/composer-keyboard";

interface UseChatComposerKeyboardArgs {
  handleSubmit: () => Promise<void> | void;
  handleCancel: () => void;
  isRunning: boolean;
  canSubmit: boolean;
  modeControl: LiveSessionControlDescriptor | null;
  isEditingQueuedPrompt?: boolean;
  onCancelEdit?: () => void;
}

export function useChatComposerKeyboard({
  handleSubmit,
  handleCancel,
  isRunning,
  canSubmit,
  modeControl,
  isEditingQueuedPrompt = false,
  onCancelEdit,
}: UseChatComposerKeyboardArgs) {
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === COMPOSER_SHORTCUTS.stopSession.key
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.nativeEvent.isComposing
    ) {
      if (isEditingQueuedPrompt && onCancelEdit) {
        event.preventDefault();
        onCancelEdit();
        return;
      }
      if (isRunning) {
        event.preventDefault();
        handleCancel();
        return;
      }
    }

    if (
      event.key === COMPOSER_SHORTCUTS.previousMode.key
      && event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.nativeEvent.isComposing
      && modeControl?.settable
      && modeControl.options.length > 1
    ) {
      const previousValue = getPreviousSessionModeValue(
        modeControl.options,
        modeControl.options.find((option) => option.selected)?.value ?? null,
      );
      if (previousValue) {
        event.preventDefault();
        modeControl.onSelect(previousValue);
        return;
      }
    }

    if (
      isComposerSubmitKey(event)
      && canSubmit
    ) {
      event.preventDefault();
      void handleSubmit();
    }
  }, [canSubmit, handleCancel, handleSubmit, isEditingQueuedPrompt, isRunning, modeControl, onCancelEdit]);

  return {
    handleKeyDown,
  };
}
