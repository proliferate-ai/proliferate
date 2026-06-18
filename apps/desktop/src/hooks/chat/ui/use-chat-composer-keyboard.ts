import { useCallback, type KeyboardEvent } from "react";
import { getPreviousSessionModeValue } from "@/lib/domain/chat/session-controls/session-mode-control";
import { logConfigSwitchEvent } from "@/lib/access/tauri/diagnostics";
import { COMPOSER_SHORTCUTS } from "@/config/shortcuts/composer-shortcuts";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import {
  isComposerSubmitKey,
  isRepeatedComposerSubmitKey,
} from "@/lib/domain/chat/composer/composer-keyboard";

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

    const isShiftTab = event.key === COMPOSER_SHORTCUTS.previousMode.key
      && event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.nativeEvent.isComposing;
    if (isShiftTab) {
      const selectedValue = modeControl?.options.find((option) => option.selected)?.value ?? null;
      const previousValue = modeControl
        ? getPreviousSessionModeValue(modeControl.options, selectedValue)
        : null;
      const canCycle = Boolean(modeControl?.settable) && (modeControl?.options.length ?? 0) > 1;
      // [config-switch] Shift+Tab only reaches here when the composer textarea is
      // focused; if it logs nothing, focus was elsewhere. canCycle=false means the
      // mode control was not settable or had <=1 option at that instant.
      logConfigSwitchEvent("shift_tab_mode_cycle", {
        isRunning,
        hasModeControl: Boolean(modeControl),
        settable: modeControl?.settable ?? null,
        optionCount: modeControl?.options.length ?? 0,
        selectedValue,
        previousValue,
        canCycle,
        willFire: canCycle && Boolean(previousValue),
      });
      if (canCycle && previousValue) {
        event.preventDefault();
        modeControl!.onSelect(previousValue);
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
