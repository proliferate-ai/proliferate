import { useCallback, type KeyboardEvent } from "react";
import { getPreviousSessionModeValue } from "@/lib/domain/chat/session-controls/session-mode-control";
import { COMPOSER_SHORTCUTS } from "@/config/shortcuts";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import {
  isComposerSubmitKey,
  isRepeatedComposerSubmitKey,
} from "@/lib/domain/chat/composer/composer-keyboard";
import { runShortcutHandler } from "@/lib/domain/shortcuts/registry";

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
    if (!event.nativeEvent.isComposing && !event.defaultPrevented && isTabCycleModifier(event)) {
      const tabCycleDirection = tabCycleShortcutDirection(event);
      if (tabCycleDirection !== 0) {
        const consumed = runShortcutHandler(
          tabCycleDirection < 0 ? "workspace.previous-tab" : "workspace.next-tab",
          { source: "keyboard" },
        );
        if (consumed) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    }

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

    if (isRepeatedComposerSubmitKey(event)) {
      event.preventDefault();
      return;
    }

    if (isComposerSubmitKey(event) && canSubmit) {
      event.preventDefault();
      void handleSubmit();
    }
  }, [canSubmit, handleCancel, handleSubmit, isEditingQueuedPrompt, isRunning, modeControl, onCancelEdit]);

  return {
    handleKeyDown,
  };
}

function isTabCycleModifier(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return (event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey;
}

function tabCycleShortcutDirection(event: KeyboardEvent<HTMLTextAreaElement>): -1 | 0 | 1 {
  if (event.key === "ArrowLeft" || event.code === "ArrowLeft") {
    return -1;
  }
  if (event.key === "ArrowRight" || event.code === "ArrowRight") {
    return 1;
  }
  return 0;
}
