import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
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
import { usePromptAttachments } from "@/hooks/chat/use-prompt-attachments";
import { usePlanDraftAttachments } from "@/hooks/plans/use-plan-draft-attachments";
import { useChatSessionControls } from "@/hooks/chat/use-chat-session-controls";
import { useQueuedPromptEdit } from "@/hooks/chat/use-queued-prompt-edit";
import { useActiveReviewRun } from "@/hooks/reviews/use-active-review-run";
import { useReviewActions } from "@/hooks/reviews/use-review-actions";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { serializeChatDraftToPrompt } from "@/lib/domain/chat/file-mentions";
import { canAttachPromptContent } from "@/lib/domain/chat/prompt-content";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { Button } from "@/components/ui/Button";
import { AddMessage, Shield } from "@/components/ui/icons";
import { ChatComposerActions } from "./ChatComposerActions";
import { ComposerMentionEditor } from "./ComposerMentionEditor";
import { ModelSelector } from "./ModelSelector";
import { SessionConfigControls } from "./SessionConfigControls";
import { Textarea } from "@/components/ui/Textarea";
import { ChatComposerSurface } from "./ChatComposerSurface";
import { DraftAttachmentPreviewList } from "@/components/workspace/chat/content/PromptContentRenderer";
import { ComposerControlButton } from "./ComposerControlButton";
import { PlanPickerPopover } from "./PlanPickerPopover";

/**
 * The composer surface: mention-aware editor + model / session controls +
 * send button. The outer dock shell (backdrop, padding, max-width, dock-slot
 * area) is owned by ChatComposerDock so it can be shared with the dev
 * playground.
 */
export function ChatInput() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mentionSearchHost, setMentionSearchHost] = useState<HTMLDivElement | null>(null);
  const workspaceSelectionNonce = useHarnessStore((state) => state.workspaceSelectionNonce);
  const focusRequestNonce = useChatInputStore((state) => state.focusRequestNonce);
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
  const reviewActions = useReviewActions();
  const activeReview = useActiveReviewRun();
  const {
    isEditing: isEditingQueuedPrompt,
    editDraft,
    setEditDraftText,
    cancelEdit,
    commitEdit,
  } = useQueuedPromptEdit();
  const promptCapabilities = activeSlot?.liveConfig?.promptCapabilities ?? null;
  const attachments = usePromptAttachments(activeSessionId, promptCapabilities);
  const planAttachments = usePlanDraftAttachments(selectedWorkspaceId);
  const supportsAttachments = canAttachPromptContent(promptCapabilities);
  const canAttach = !isEditingQueuedPrompt && !isDisabled && supportsAttachments;
  // Plan references are resolved to markdown text by the runtime, so they do
  // not depend on file/image attachment capabilities.
  const canAttachPlan = !isEditingQueuedPrompt && !isDisabled && !!selectedWorkspaceId;
  const attachControlTitle = supportsAttachments
    ? "Attach file"
    : activeSessionId
      ? "Attachments are not supported by this agent"
      : "Attachments are available after a session starts";
  const reviewControlTitle = activeReview.run || activeReview.startingReview
    ? "A review is already active for this session"
    : activeSessionId
      ? "Review current implementation"
      : "Review is available after a session starts";
  const promptText = serializeChatDraftToPrompt(draft);
  const effectiveIsEmpty = isEditingQueuedPrompt
    ? editDraft.trim().length === 0
    : isEmpty && !attachments.hasAttachments && !planAttachments.hasPlans;
  const canSubmit = !effectiveIsEmpty && !isDisabled && !planAttachments.hasUnresolvedPlans;

  const onSubmit = useCallback(async () => {
    if (isEditingQueuedPrompt) {
      await commitEdit();
      return;
    }
    if (planAttachments.hasUnresolvedPlans) {
      return;
    }
    const blocks = [
      ...await attachments.buildBlocks(promptText.trim()),
      ...planAttachments.blocks,
    ];
    const optimisticContentParts = [
      ...(promptText.trim() ? [{ type: "text" as const, text: promptText.trim() }] : []),
      ...planAttachments.contentParts,
    ];
    await handleSubmit({ text: promptText, blocks, optimisticContentParts });
    attachments.clearAttachments();
    planAttachments.clearPlans();
  }, [attachments, commitEdit, handleSubmit, isEditingQueuedPrompt, planAttachments, promptText]);

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

  const focusComposer = useCallback((): boolean => {
    if (isEditingQueuedPrompt) {
      if (!textareaRef.current) {
        return false;
      }
      textareaRef.current.focus({ preventScroll: true });
      return true;
    }
    return focusChatInput();
  }, [isEditingQueuedPrompt]);

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      attachments.addFiles(event.target.files);
    }
    event.target.value = "";
  }, [attachments]);

  const handleRemoveDraftAttachment = useCallback((id: string) => {
    attachments.removeAttachment(id);
    planAttachments.removePlan(id);
  }, [attachments, planAttachments]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (!canAttach || event.clipboardData.files.length === 0) {
      return;
    }
    attachments.addFiles(event.clipboardData.files);
  }, [attachments, canAttach]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!canAttach || event.dataTransfer.files.length === 0) {
      return;
    }
    event.preventDefault();
    attachments.addFiles(event.dataTransfer.files);
  }, [attachments, canAttach]);

  useEffect(() => {
    if (!selectedWorkspaceId && !activeSessionId) {
      return;
    }

    const timer = window.setTimeout(() => {
      focusComposer();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [
    activeSessionId,
    focusComposer,
    selectedWorkspaceId,
    workspaceSelectionNonce,
  ]);

  useEffect(() => {
    if (focusRequestNonce === 0) {
      return;
    }

    let timer: number | null = null;
    let attempts = 0;
    let cancelled = false;
    const attemptFocus = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      if (focusComposer() || attempts >= 8) {
        return;
      }
      timer = window.setTimeout(attemptFocus, 25);
    };

    timer = window.setTimeout(attemptFocus, 0);
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [focusComposer, focusRequestNonce]);

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
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(event) => {
          if (canAttach) {
            event.preventDefault();
          }
        }}
      >
        <form className="relative flex flex-col">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            accept="image/*,text/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.css,.html,.xml,.yaml,.yml,.toml,.sql,.sh"
          />
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
          {!isEditingQueuedPrompt && !attachments.hasAttachments && !planAttachments.hasPlans && (
            <div className="h-5" aria-hidden="true" />
          )}
          {!isEditingQueuedPrompt && (
            <DraftAttachmentPreviewList
              attachments={[...attachments.attachments, ...planAttachments.attachments]}
              onRemove={handleRemoveDraftAttachment}
            />
          )}
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
              onKeyDown={handleKeyDown}
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

            <div className="flex items-center gap-[5px]">
              {!isEditingQueuedPrompt && (
                <div
                  className={`flex items-center gap-[5px] ${
                    areRuntimeControlsDisabled ? "pointer-events-none opacity-55" : ""
                  }`}
                >
                  <ComposerControlButton
                    iconOnly
                    disabled={!canAttach}
                    icon={<AddMessage className="size-4" />}
                    label="Attach file"
                    title={attachControlTitle}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach file"
                  />
                  <PlanPickerPopover
                    draftWorkspaceId={selectedWorkspaceId}
                    disabled={!canAttachPlan}
                  />
                  <ComposerControlButton
                    iconOnly
                    disabled={
                      !reviewActions.canStartCodeReview
                      || !!activeReview.run
                      || !!activeReview.startingReview
                    }
                    icon={<Shield className="size-4" />}
                    label="Review implementation"
                    title={reviewControlTitle}
                    onClick={(event) => {
                      reviewActions.startCodeReview(rectToReviewAnchor(event.currentTarget.getBoundingClientRect()));
                    }}
                    aria-label="Review implementation"
                  />
                </div>
              )}
              <ChatComposerActions
                isRunning={isRunning}
                isEmpty={effectiveIsEmpty}
                isDisabled={isDisabled || planAttachments.hasUnresolvedPlans}
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

function rectToReviewAnchor(rect: DOMRect) {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}
