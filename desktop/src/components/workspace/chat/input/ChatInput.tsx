import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CHAT_COMPOSER_INPUT,
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  CHAT_COMPOSER_INPUT_MIN_HEIGHT_REM,
  CHAT_COMPOSER_LABELS,
} from "@/config/chat";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useChatAvailabilityState } from "@/hooks/chat/use-chat-availability-state";
import { useChatComposerKeyboard } from "@/hooks/chat/use-chat-composer-keyboard";
import { useChatDraftState } from "@/hooks/chat/use-chat-draft-state";
import { useChatModelSelectorState } from "@/hooks/chat/use-chat-model-selector-state";
import { useChatPromptActions } from "@/hooks/chat/use-chat-prompt-actions";
import { useChatSessionControls } from "@/hooks/chat/use-chat-session-controls";
import { useQueuedPromptEdit } from "@/hooks/chat/use-queued-prompt-edit";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { Button } from "@/components/ui/Button";
import { ChatComposerActions } from "./ChatComposerActions";
import { ComposerMentionEditor } from "./ComposerMentionEditor";
import { ModelSelector } from "./ModelSelector";
import { SessionConfigControls } from "./SessionConfigControls";
import { Textarea } from "@/components/ui/Textarea";
import { ChatComposerSurface } from "./ChatComposerSurface";
import { SessionPowersSummary } from "./SessionPowersSummary";

/**
 * The composer surface: mention-aware editor + model / session controls +
 * send button. The outer dock shell (backdrop, padding, max-width, top-slot
 * area) is owned by ChatComposerDock so it can be shared with the dev
 * playground.
 */
export function ChatInput() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionSearchHost, setMentionSearchHost] = useState<HTMLDivElement | null>(null);
  const workspaceSelectionNonce = useHarnessStore((state) => state.workspaceSelectionNonce);
  const {
    activeSessionId,
    activeSlot,
    isRunning,
  } = useActiveChatSessionState();
  const { selectedWorkspaceId, draft, setDraft, isEmpty } = useChatDraftState();
  const { isDisabled, areRuntimeControlsDisabled } = useChatAvailabilityState();
  const modelSelectorProps = useChatModelSelectorState();
  const { agentKind, controls: sessionConfigControls, modeControl } = useChatSessionControls();
  const { handleSubmit, handleCancel } = useChatPromptActions();
  const {
    isEditing: isEditingQueuedPrompt,
    editDraft,
    setEditDraftText,
    cancelEdit,
    commitEdit,
  } = useQueuedPromptEdit();
  const effectiveIsEmpty = isEditingQueuedPrompt
    ? editDraft.trim().length === 0
    : isEmpty;
  const canSubmit = !effectiveIsEmpty && !isDisabled;

  const onSubmit = useCallback(async () => {
    if (isEditingQueuedPrompt) {
      await commitEdit();
      return;
    }
    await handleSubmit();
  }, [commitEdit, handleSubmit, isEditingQueuedPrompt]);

  const onCancel = useCallback(() => {
    if (isEditingQueuedPrompt) {
      cancelEdit();
      return;
    }
    handleCancel();
  }, [cancelEdit, handleCancel, isEditingQueuedPrompt]);

  const { handleKeyDown } = useChatComposerKeyboard({
    handleSubmit: onSubmit,
    handleCancel: onCancel,
    isRunning,
    canSubmit,
    modeControl,
    isEditingQueuedPrompt,
    onCancelEdit: cancelEdit,
  });

  useEffect(() => {
    if ((!selectedWorkspaceId && !activeSessionId) || isDisabled) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (isEditingQueuedPrompt) {
        textareaRef.current?.focus({ preventScroll: true });
        return;
      }
      focusChatInput();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [
    activeSessionId,
    isDisabled,
    isEditingQueuedPrompt,
    selectedWorkspaceId,
    workspaceSelectionNonce,
  ]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    const lineHeightPx = parseFloat(getComputedStyle(el).lineHeight);
    if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
      return;
    }

    const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const codexMinHeightPx = Number.isFinite(rootFontSizePx)
      ? rootFontSizePx * CHAT_COMPOSER_INPUT_MIN_HEIGHT_REM
      : lineHeightPx * CHAT_COMPOSER_INPUT.minRows;
    const minPx = Math.max(lineHeightPx * CHAT_COMPOSER_INPUT.minRows, codexMinHeightPx);
    const maxPx = lineHeightPx * CHAT_COMPOSER_INPUT.maxRows;
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;
    const next = Math.min(maxPx, Math.max(minPx, contentHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = contentHeight > maxPx ? "auto" : "hidden";
  }, [editDraft, isEditingQueuedPrompt]);

  return (
    <div className="relative">
      <div ref={setMentionSearchHost} className="relative z-20 flex flex-col px-5" />
      <ChatComposerSurface
        onClick={() => {
          if (isEditingQueuedPrompt) {
            textareaRef.current?.focus();
            return;
          }
          focusChatInput();
        }}
      >
        <form className="relative flex flex-col">
          {isEditingQueuedPrompt && (
            <div className="mx-5 mt-3 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              <span>Editing queued message</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelEdit}
                className="h-6 px-2 text-xs"
              >
                Cancel
              </Button>
            </div>
          )}
          <div className="px-2 py-1.5">
            <div className="flex w-full flex-wrap items-center justify-start gap-1">
              <SessionPowersSummary summaries={activeSlot?.mcpBindingSummaries ?? null} />
            </div>
          </div>
          {isEditingQueuedPrompt ? (
            <div
              className="mb-2 flex-grow select-text overflow-y-auto px-3"
              style={{
                minHeight: `${CHAT_COMPOSER_INPUT_MIN_HEIGHT_REM}rem`,
                maxHeight: `${CHAT_COMPOSER_INPUT.maxRows * CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM}rem`,
              }}
            >
              <Textarea
                data-telemetry-mask
                ref={textareaRef}
                variant="ghost"
                rows={CHAT_COMPOSER_INPUT.minRows}
                value={editDraft}
                onChange={(event) => setEditDraftText(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={CHAT_COMPOSER_LABELS.placeholder}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                style={{
                  minHeight: `${CHAT_COMPOSER_INPUT_MIN_HEIGHT_REM}rem`,
                  maxHeight: `${CHAT_COMPOSER_INPUT.maxRows * CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM}rem`,
                }}
                className="min-h-0 px-0 py-0 text-chat leading-[var(--text-chat--line-height)] text-foreground placeholder:text-[color:color-mix(in_oklab,var(--color-faint)_50%,transparent)]"
              />
            </div>
          ) : (
            <ComposerMentionEditor
              draft={draft}
              onDraftChange={setDraft}
              placeholder={CHAT_COMPOSER_LABELS.placeholder}
              canSubmit={canSubmit}
              disabled={isDisabled}
              onSubmit={onSubmit}
              minHeightRem={CHAT_COMPOSER_INPUT_MIN_HEIGHT_REM}
              maxHeightRem={CHAT_COMPOSER_INPUT.maxRows * CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM}
              searchHostElement={mentionSearchHost}
            />
          )}

          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[5px] px-2">
            <div
              className={`flex min-w-0 flex-nowrap items-center gap-[5px] ${
                areRuntimeControlsDisabled ? "pointer-events-none opacity-55" : ""
              }`}
            >
              <ModelSelector {...modelSelectorProps} />
              <SessionConfigControls agentKind={agentKind} controls={sessionConfigControls} />
            </div>

            <div className="flex items-center">
              <ChatComposerActions
                isRunning={isRunning}
                isEmpty={effectiveIsEmpty}
                isDisabled={isDisabled}
                isEditingQueuedPrompt={isEditingQueuedPrompt}
                onSubmit={onSubmit}
                onCancel={onCancel}
              />
            </div>
          </div>
        </form>
      </ChatComposerSurface>
    </div>
  );
}
