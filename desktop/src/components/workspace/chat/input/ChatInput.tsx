import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  CHAT_COMPOSER_LABELS,
  WORKSPACE_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  useActiveSessionId,
  useActiveSessionRunningState,
} from "@/hooks/chat/use-active-chat-session-selectors";
import { useChatAvailabilityState } from "@/hooks/chat/use-chat-availability-state";
import { useChatComposerKeyboard } from "@/hooks/chat/use-chat-composer-keyboard";
import { useChatDraftState } from "@/hooks/chat/use-chat-draft-state";
import { useChatModelSelectorState } from "@/hooks/chat/use-chat-model-selector-state";
import { useChatPromptActions } from "@/hooks/chat/use-chat-prompt-actions";
import type { PromptAttachmentController } from "@/hooks/chat/use-chat-prompt-attachments";
import { useComposerSubmitGate } from "@/hooks/chat/use-composer-submit-gate";
import { usePlanDraftAttachments } from "@/hooks/plans/use-plan-draft-attachments";
import { useChatSessionControls } from "@/hooks/chat/use-chat-session-controls";
import { useQueuedPromptEdit } from "@/hooks/chat/use-queued-prompt-edit";
import { useActiveReviewRun } from "@/hooks/reviews/use-active-review-run";
import { useReviewActions } from "@/hooks/reviews/use-review-actions";
import { useComposerTextareaAutosize } from "@/hooks/chat/use-composer-textarea-autosize";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { serializeChatDraftToPrompt } from "@/lib/domain/chat/file-mentions";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { ChatComposerActions } from "./ChatComposerActions";
import { ComposerAddActionPopover } from "./ComposerAddActionPopover";
import { ComposerMentionEditor } from "./ComposerMentionEditor";
import { ComposerTextarea } from "./ComposerTextarea";
import { ComposerTextareaFrame } from "./ComposerTextareaFrame";
import { ModelSelector } from "./ModelSelector";
import { SessionConfigControls } from "./SessionConfigControls";
import { ChatComposerSurface } from "./ChatComposerSurface";
import { DraftAttachmentPreviewList } from "@/components/workspace/chat/content/PromptContentRenderer";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";

/**
 * The composer surface: mention-aware editor + model / session controls +
 * send button. The outer dock shell (backdrop, padding, max-width, dock-slot
 * area) is owned by ChatComposerDock so it can be shared with the dev
 * playground.
 */
export function ChatInput({
  attachments,
  suppressActiveSessionState = false,
}: {
  attachments: PromptAttachmentController;
  suppressActiveSessionState?: boolean;
}) {
  useDebugRenderCount("chat-composer");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mentionSearchHost, setMentionSearchHost] = useState<HTMLDivElement | null>(null);
  const workspaceSelectionNonce = useHarnessStore((state) => state.workspaceSelectionNonce);
  const focusRequestNonce = useChatInputStore((state) => state.focusRequestNonce);
  const activeSessionId = useActiveSessionId();
  const isRunning = useActiveSessionRunningState();
  const activeSessionIdForUi = suppressActiveSessionState ? null : activeSessionId;
  const isRunningForUi = suppressActiveSessionState ? false : isRunning;
  const { workspaceUiKey, materializedWorkspaceId, draft, setDraft, isEmpty } =
    useChatDraftState();
  const { isDisabled, areRuntimeControlsDisabled } = useChatAvailabilityState({
    activeSessionId: activeSessionIdForUi,
  });
  const modelSelectorProps = useChatModelSelectorState({
    suppressActiveSessionState,
  });
  const { agentKind, controls: sessionConfigControls, modeControl } = useChatSessionControls();
  const effectiveSessionConfigControls = suppressActiveSessionState ? [] : sessionConfigControls;
  const effectiveAgentKind = suppressActiveSessionState ? null : agentKind;
  const effectiveModeControl = suppressActiveSessionState ? null : modeControl;
  const { handleSubmit, handleCancel } = useChatPromptActions({
    forceNewSession: suppressActiveSessionState,
  });
  const { isSubmitting, run: runSubmit } = useComposerSubmitGate();
  const reviewActions = useReviewActions();
  const activeReview = useActiveReviewRun();
  const {
    isEditing: isEditingQueuedPrompt,
    editDraft,
    setEditDraftText,
    cancelEdit,
    commitEdit,
  } = useQueuedPromptEdit();
  const effectiveIsEditingQueuedPrompt = suppressActiveSessionState ? false : isEditingQueuedPrompt;
  const planAttachments = usePlanDraftAttachments({
    workspaceUiKey,
    sdkWorkspaceId: materializedWorkspaceId,
  });
  const canUseUtilityActions =
    !effectiveIsEditingQueuedPrompt && !isDisabled && !areRuntimeControlsDisabled && !isSubmitting;
  const canAttach = canUseUtilityActions && attachments.canAttachFiles;
  // Plan references are resolved to markdown text by the runtime, so they do
  // not depend on file/image attachment capabilities.
  const canAttachPlan = canUseUtilityActions && !!workspaceUiKey && !!materializedWorkspaceId;
  const canStartReview = canUseUtilityActions
    && !suppressActiveSessionState
    && reviewActions.canStartCodeReview
    && !activeReview.hasBlockingReview
    && !activeReview.startingReview;
  const attachFileDetail = (() => {
    if (canAttach) {
      return "Upload image or text context.";
    }
    if (!attachments.supportsAttachments) {
      return activeSessionIdForUi
        ? "Attachments are not supported by this agent"
        : "Attachments are available after a session starts";
    }
    return "Chat is unavailable right now";
  })();
  const attachPlanDetail = canAttachPlan
    ? "Attach an existing plan snapshot."
    : workspaceUiKey
      ? "Chat is unavailable right now"
      : "Select a workspace before attaching a plan";
  const reviewDetail = (() => {
    if (canStartReview) {
      return "Start review agents for the current implementation.";
    }
    if (activeReview.hasBlockingReview || activeReview.startingReview) {
      return "A review is already active for this session";
    }
    if (!activeSessionIdForUi) {
      return "Review is available after a session starts";
    }
    return "Review agents are unavailable right now";
  })();
  const promptText = serializeChatDraftToPrompt(draft);
  const hasDraftAttachments = attachments.hasAttachments || planAttachments.hasPlans;
  const effectiveIsEmpty = effectiveIsEditingQueuedPrompt
    ? editDraft.trim().length === 0
    : isEmpty && !hasDraftAttachments;
  const canSubmit =
    !effectiveIsEmpty && !isDisabled && !planAttachments.hasUnresolvedPlans && !isSubmitting;
  useComposerTextareaAutosize({
    textareaRef,
    value: editDraft,
    lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
    minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
    maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
    minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
  });

  const onSubmit = useCallback(async () => {
    await runSubmit(async () => {
      if (effectiveIsEditingQueuedPrompt) {
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
    });
  }, [
    attachments,
    commitEdit,
    effectiveIsEditingQueuedPrompt,
    handleSubmit,
    planAttachments,
    promptText,
    runSubmit,
  ]);

  const onCancel = useCallback(() => {
    if (effectiveIsEditingQueuedPrompt) {
      cancelEdit();
      return;
    }
    handleCancel();
  }, [cancelEdit, effectiveIsEditingQueuedPrompt, handleCancel]);

  const { handleKeyDown } = useChatComposerKeyboard({
    handleSubmit: onSubmit,
    handleCancel: onCancel,
    isRunning: isRunningForUi,
    canSubmit,
    modeControl: effectiveModeControl,
    isEditingQueuedPrompt: effectiveIsEditingQueuedPrompt,
    onCancelEdit: cancelEdit,
  });

  const focusComposer = useCallback((): boolean => {
    if (effectiveIsEditingQueuedPrompt) {
      if (!textareaRef.current) {
        return false;
      }
      textareaRef.current.focus({ preventScroll: true });
      return true;
    }
    return focusChatInput();
  }, [effectiveIsEditingQueuedPrompt]);

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
    if (!canAttach) {
      return;
    }
    if (event.clipboardData.files.length > 0) {
      attachments.addFiles(event.clipboardData.files);
      event.preventDefault();
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (text && attachments.addTextPaste(text)) {
      event.preventDefault();
    }
  }, [attachments, canAttach]);

  useEffect(() => {
    if (!workspaceUiKey && !activeSessionIdForUi) {
      return;
    }

    const timer = window.setTimeout(() => {
      focusComposer();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [
    activeSessionIdForUi,
    focusComposer,
    workspaceUiKey,
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

  return (
    <DebugProfiler id="chat-composer">
      <div className="relative">
      <div ref={setMentionSearchHost} className="relative z-20 flex flex-col px-5" />
      <ChatComposerSurface
        overflowMode="clip"
        onClick={() => {
          if (effectiveIsEditingQueuedPrompt) {
            textareaRef.current?.focus();
            return;
          }
          focusChatInput();
        }}
        onPaste={handlePaste}
      >
        <form className="relative flex flex-col">
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            accept="image/*,text/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.css,.html,.xml,.yaml,.yml,.toml,.sql,.sh"
          />
          {effectiveIsEditingQueuedPrompt && (
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
          {!effectiveIsEditingQueuedPrompt && (
            <DraftAttachmentPreviewList
              attachments={[...attachments.attachments, ...planAttachments.attachments]}
              onRemove={handleRemoveDraftAttachment}
            />
          )}
          {effectiveIsEditingQueuedPrompt ? (
            <ComposerTextareaFrame topInset="none">
              <ComposerTextarea
                data-chat-composer-editor
                data-telemetry-mask
                ref={textareaRef}
                rows={WORKSPACE_CHAT_COMPOSER_INPUT.minRows}
                value={editDraft}
                onChange={(event) => setEditDraftText(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={CHAT_COMPOSER_LABELS.placeholder}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </ComposerTextareaFrame>
          ) : (
            <ComposerMentionEditor
              draft={draft}
              onDraftChange={setDraft}
              placeholder={CHAT_COMPOSER_LABELS.placeholder}
              canSubmit={canSubmit}
              disabled={isDisabled}
              onSubmit={onSubmit}
              onKeyDown={handleKeyDown}
              topInset={hasDraftAttachments ? "none" : "standard"}
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
              <SessionConfigControls
                agentKind={effectiveAgentKind}
                controls={effectiveSessionConfigControls}
              />
            </div>

            <div className="flex items-center gap-[5px]">
              {!effectiveIsEditingQueuedPrompt && (
                <ComposerAddActionPopover
                  canAttachFile={canAttach}
                  attachFileDetail={attachFileDetail}
                  canAttachPlan={canAttachPlan}
                  attachPlanDetail={attachPlanDetail}
                  canStartReview={canStartReview}
                  reviewDetail={reviewDetail}
                  workspaceUiKey={workspaceUiKey}
                  sdkWorkspaceId={materializedWorkspaceId}
                  onAttachFile={() => fileInputRef.current?.click()}
                  onStartReview={(anchor) => {
                    reviewActions.startCodeReview(anchor);
                  }}
                />
              )}
              <ChatComposerActions
                isRunning={isRunningForUi}
                isEmpty={effectiveIsEmpty}
                isDisabled={isDisabled || planAttachments.hasUnresolvedPlans || isSubmitting}
                isEditingQueuedPrompt={effectiveIsEditingQueuedPrompt}
                onSubmit={onSubmit}
                onCancel={onCancel}
              />
            </div>
          </div>
        </form>
      </ChatComposerSurface>
      </div>
    </DebugProfiler>
  );
}
