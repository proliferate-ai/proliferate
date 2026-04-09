import { useCallback, type KeyboardEvent } from "react";
import { getPreviousSessionModeValue } from "@/lib/domain/chat/session-mode-control";
import { SHORTCUTS } from "@/config/shortcuts";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls";

interface UseChatComposerKeyboardArgs {
  handleSubmit: () => Promise<void> | void;
  handleCancel: () => void;
  isRunning: boolean;
  canSubmit: boolean;
  modeControl: LiveSessionControlDescriptor | null;
}

export function useChatComposerKeyboard({
  handleSubmit,
  handleCancel,
  isRunning,
  canSubmit,
  modeControl,
}: UseChatComposerKeyboardArgs) {
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === SHORTCUTS.stopSession.key
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.nativeEvent.isComposing
      && isRunning
    ) {
      event.preventDefault();
      handleCancel();
      return;
    }

    if (
      event.key === SHORTCUTS.previousMode.key
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
      event.key === SHORTCUTS.submitMessage.key
      && !event.shiftKey
      && !event.altKey
      && !event.nativeEvent.isComposing
      && canSubmit
    ) {
      event.preventDefault();
      void handleSubmit();
    }
  }, [canSubmit, handleCancel, handleSubmit, isRunning, modeControl]);

  return {
    handleKeyDown,
  };
}
