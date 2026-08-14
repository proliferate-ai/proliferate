import { useCallback } from "react";
import {
  getNextSessionModeValue,
  getPreviousSessionModeValue,
} from "#product/lib/domain/chat/session-controls/session-mode-control";
import { COMPOSER_SHORTCUTS } from "#product/config/shortcuts/composer-shortcuts";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import {
  type ComposerKeyboardEventLike,
  isComposerSubmitKey,
  isRepeatedComposerSubmitKey,
} from "#product/lib/domain/chat/composer/composer-keyboard";

export type ChatComposerKeyboardEvent = ComposerKeyboardEventLike & {
  currentTarget: EventTarget | null;
  defaultPrevented: boolean;
  preventDefault(): void;
};

interface UseChatComposerKeyboardArgs {
  handleSubmit: () => Promise<void> | void;
  handleCancel: () => void;
  isRunning: boolean;
  canSubmit: boolean;
  modeControl: LiveSessionControlDescriptor | null;
  reasoningEffortControl?: LiveSessionControlDescriptor | null;
  isEditingQueuedPrompt?: boolean;
  onCancelEdit?: () => void;
  onEditLastQueued?: () => void;
}

export function useChatComposerKeyboard({
  handleSubmit,
  handleCancel,
  isRunning,
  canSubmit,
  modeControl,
  reasoningEffortControl = null,
  isEditingQueuedPrompt = false,
  onCancelEdit,
  onEditLastQueued,
}: UseChatComposerKeyboardArgs) {
  const handleKeyDown = useCallback((event: ChatComposerKeyboardEvent) => {
    if (
      event.key === COMPOSER_SHORTCUTS.stopSession.key
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !isComposerEventComposing(event)
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
      event.key === COMPOSER_SHORTCUTS.editLastQueued.key
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !isComposerEventComposing(event)
      && !isEditingQueuedPrompt
      && onEditLastQueued
    ) {
      const editorText = composerTargetText(event.currentTarget);
      if (editorText.length === 0) {
        event.preventDefault();
        onEditLastQueued();
        return;
      }
    }

    if (
      event.key === COMPOSER_SHORTCUTS.previousMode.key
      && event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !isComposerEventComposing(event)
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

    // Ctrl+Shift+E steps reasoning effort forward, wrapping at the top — the
    // same transition as clicking the composer's effort ladder. Ctrl is the
    // modifier on every platform (⌃⇧E on macOS), never the ⌘ primary.
    if (
      event.key.toLowerCase() === COMPOSER_SHORTCUTS.cycleReasoningEffort.key
      && event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && !isComposerEventComposing(event)
      && reasoningEffortControl?.settable
      && reasoningEffortControl.options.length > 1
    ) {
      const nextValue = getNextSessionModeValue(
        reasoningEffortControl.options,
        reasoningEffortControl.options.find((option) => option.selected)?.value ?? null,
      );
      if (nextValue) {
        event.preventDefault();
        reasoningEffortControl.onSelect(nextValue);
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
  }, [
    canSubmit,
    handleCancel,
    handleSubmit,
    isEditingQueuedPrompt,
    isRunning,
    modeControl,
    reasoningEffortControl,
    onCancelEdit,
    onEditLastQueued,
  ]);

  return {
    handleKeyDown,
  };
}

function isComposerEventComposing(event: ComposerKeyboardEventLike): boolean {
  return event.isComposing === true || event.nativeEvent?.isComposing === true;
}

function composerTargetText(target: EventTarget | null): string {
  if (!target || typeof target !== "object") return "";
  if ("value" in target && typeof target.value === "string") return target.value;
  return "textContent" in target && typeof target.textContent === "string"
    ? target.textContent
    : "";
}
