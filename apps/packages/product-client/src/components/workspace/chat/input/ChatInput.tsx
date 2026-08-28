import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import { CHAT_INPUT_ATTACHMENT_ACCEPT } from "#product/config/chat";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import {
  useActiveSessionId,
  useActiveSessionCanCancelState,
  useActiveSessionRunningState,
} from "#product/hooks/chat/derived/use-active-session-identity";
import { useChatAvailabilityState } from "#product/hooks/chat/derived/use-chat-availability-state";
import { useComposerBlockedState } from "#product/hooks/chat/derived/use-composer-blocked-state";
import { useChatComposerKeyboard } from "#product/hooks/chat/ui/use-chat-composer-keyboard";
import { useChatDraftControls } from "#product/hooks/chat/ui/use-chat-draft-state";
import { useChatModelSelectorState } from "#product/hooks/chat/facade/use-chat-model-selector-state";
import { useChatPromptActions } from "#product/hooks/chat/workflows/use-chat-prompt-actions";
import type { PromptAttachmentController } from "#product/hooks/chat/ui/use-chat-prompt-attachments";
import { useComposerSubmitGate } from "#product/hooks/chat/ui/use-composer-submit-gate";
import { usePlanDraftAttachments } from "#product/hooks/plans/facade/use-plan-draft-attachments";
import { useChatSessionControls } from "#product/hooks/chat/facade/use-chat-session-controls";
import {
  useEditLastQueuedPrompt,
  useQueuedPromptEdit,
} from "#product/hooks/chat/ui/use-queued-prompt-edit";
import { focusChatInput } from "#product/lib/domain/focus-zone";
import { serializeChatDraftToOutgoingPrompt } from "#product/lib/domain/chat/composer/outgoing-prompt";
import { promptAttachmentSnapshotsToContentParts } from "#product/domain/chats/composer/prompt-attachment-content-parts";
import { buildPromptWithSelectedResponseContexts } from "#product/domain/chats/transcript/selected-response-context";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { resolveComposerSessionControls } from "#product/lib/domain/chat/session-controls/session-controls";
import { buildComposerSessionControlGroups } from "#product/lib/domain/chat/session-controls/composer-control-groups";
import {
  finishOrCancelMeasurementOperation,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import { clearTypingActivity } from "#product/lib/infra/interaction/typing-activity-store";
import {
  PROMPT_SUBMIT_MEASUREMENT_MAX_DURATION_MS,
  PROMPT_SUBMIT_MEASUREMENT_SURFACES,
} from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { ChatInputControlRow } from "./ChatInputControlRow";
import { ChatInputDraftArea } from "./ChatInputDraftArea";
import { ComposerBlockedStatusLine } from "./ComposerBlockedStatusLine";
import { ComposerBlockedControlRow } from "./ComposerBlockedControlRow";
import { ChatComposerSurface } from "#product/components/workspace/chat/composer/ChatComposerSurface";
import { ComposerTextareaFrame } from "#product/primitives/patterns/composer/ComposerTextareaFrame";
import { Input } from "#product/primitives/Input";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { usePromptAttachmentPreviewActions } from "#product/hooks/chat/workflows/use-prompt-attachment-preview-actions";
import { useChatInputPaste } from "#product/hooks/chat/ui/use-chat-input-paste";
import { useChatComposerFocusRequest } from "#product/hooks/chat/ui/use-chat-composer-focus-request";
import type { PromptAttachmentPreviewHandler } from "#product/components/workspace/chat/content/PromptContentRenderer";

export function ChatInput({
  attachments,
  suppressActiveSessionState = false,
  suppressAutoFocus = false,
  suppressWorkspaceTakeover = false,
  replacementSessionId = null,
  hasSessionTurns = false,
}: {
  attachments: PromptAttachmentController;
  suppressActiveSessionState?: boolean;
  suppressAutoFocus?: boolean;
  /** Cowork threads suppress the composer takeover (see ChatView's
   * `showWorkspaceStatusPanels`) the same way they used to suppress the
   * ambient workspace-status panel. */
  suppressWorkspaceTakeover?: boolean;
  replacementSessionId?: string | null;
  /** Flips the placeholder to the follow-up variant once the transcript has turns. */
  hasSessionTurns?: boolean;
}) {
  useDebugRenderCount("chat-composer");
  const textareaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [composerOverlayHost, setComposerOverlayHost] = useState<HTMLDivElement | null>(null);
  const workspaceSelectionNonce = useSessionSelectionStore((state) => state.workspaceSelectionNonce);
  const focusRequestNonce = useChatInputStore((state) => state.focusRequestNonce);
  const activeSessionId = useActiveSessionId();
  const isRunning = useActiveSessionRunningState();
  const canCancelActiveSession = useActiveSessionCanCancelState();
  const activeSessionIdForUi = suppressActiveSessionState ? null : activeSessionId;
  const isRunningForUi = suppressActiveSessionState ? false : isRunning && canCancelActiveSession;
  // PERF: no draft-content subscription here — a keystroke must not re-render
  // the whole composer dock. The draft area subscribes to the live draft
  // itself; this component only needs the isEmpty gate + a submit-time reader.
  const {
    workspaceUiKey,
    materializedWorkspaceId,
    getDraft,
    getSelectedResponseContexts,
    setDraft,
    removeSelectedResponseContext,
    clearSelectedResponseContexts,
    isEmpty,
    hasSelectedResponseContexts,
  } = useChatDraftControls();
  const { isDisabled, sendBlockedReason, areRuntimeControlsDisabled } = useChatAvailabilityState({
    activeSessionId: activeSessionIdForUi,
  });
  const blockedPresentation = useComposerBlockedState({ suppress: suppressWorkspaceTakeover });
  const modelSelectorProps = useChatModelSelectorState({
    suppressActiveSessionState,
    replacementSessionId,
  });
  const { agentKind, controls: sessionConfigControls, modeControl } = useChatSessionControls();
  const launchConfigControls = suppressActiveSessionState ? [] : modelSelectorProps.launchControls;
  const effectiveSessionConfigControls = useMemo(() => resolveComposerSessionControls({
    suppressActiveSessionState,
    hasActiveSession: !!activeSessionIdForUi,
    launchControls: launchConfigControls,
    liveControls: sessionConfigControls,
  }), [
    activeSessionIdForUi,
    launchConfigControls,
    sessionConfigControls,
    suppressActiveSessionState,
  ]);
  const effectiveAgentKind = suppressActiveSessionState
    ? null
    : agentKind ?? modelSelectorProps.launchAgentKind;
  const effectiveModeControl = suppressActiveSessionState
    ? null
    : buildComposerSessionControlGroups(effectiveSessionConfigControls).modeControl
      ?? modeControl
      ?? null;
  const { handleSubmit, handleCancel } = useChatPromptActions();
  const { openAttachmentPreview } = usePromptAttachmentPreviewActions();
  const { isSubmitting, run: runSubmit } = useComposerSubmitGate();
  const {
    isEditing: isEditingQueuedPrompt,
    editingSeq,
    editDraft,
    setEditDraftText,
    cancelEdit,
    commitEdit,
  } = useQueuedPromptEdit();
  const effectiveIsEditingQueuedPrompt = suppressActiveSessionState ? false : isEditingQueuedPrompt;
  const editLastQueuedPrompt = useEditLastQueuedPrompt(suppressActiveSessionState);
  const planAttachments = usePlanDraftAttachments({
    workspaceUiKey,
    sdkWorkspaceId: materializedWorkspaceId,
  });
  const hasDraftAttachments = attachments.hasAttachments || planAttachments.hasPlans;
  const hasSubmittableDraftAttachments =
    attachments.hasSupportedAttachments || planAttachments.hasPlans;
  const effectiveIsEmpty = effectiveIsEditingQueuedPrompt
    ? editDraft.trim().length === 0
    : isEmpty && !hasSubmittableDraftAttachments && !hasSelectedResponseContexts;
  const canSubmit =
    !effectiveIsEmpty && !isDisabled && !sendBlockedReason && !isSubmitting;
  const canAcceptPastedAttachments =
    !effectiveIsEditingQueuedPrompt
    && !blockedPresentation
    && !isDisabled
    && !areRuntimeControlsDisabled
    && !isSubmitting
    && attachments.canAttachFiles;
  const { handleFilePasteCapture, handlePaste } = useChatInputPaste({
    attachments,
    canAcceptPastedAttachments,
  });
  const onSubmit = useCallback(async () => {
    // End the typing burst NOW so the transcript renders urgently: the
    // composer clearing and the sent message appearing must be one frame.
    clearTypingActivity();
    await runSubmit(async () => {
      if (effectiveIsEditingQueuedPrompt) {
        await commitEdit();
        return;
      }
      const measurementOperationId = startMeasurementOperation({
        kind: "prompt_submit",
        surfaces: PROMPT_SUBMIT_MEASUREMENT_SURFACES,
        maxDurationMs: PROMPT_SUBMIT_MEASUREMENT_MAX_DURATION_MS,
      });
      // Serialized at submit time (imperative read) so typing keystrokes never
      // re-render this component just to keep promptText fresh.
      const promptText = serializeChatDraftToOutgoingPrompt(getDraft());
      const selectedResponseContexts = [...getSelectedResponseContexts()];
      const contextualPrompt = buildPromptWithSelectedResponseContexts(
        promptText,
        selectedResponseContexts,
      );
      const blockPrepareStartedAt = performance.now();
      const attachmentSnapshots = attachments.snapshotForSubmit();
      const blocks = [
        ...contextualPrompt.blocks,
        ...planAttachments.blocks,
      ];
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "prompt.submit.blocks_prepare",
        startedAt: blockPrepareStartedAt,
        outcome: "completed",
        count: blocks.length + attachmentSnapshots.length,
      });
      const optimisticContentParts = [
        ...contextualPrompt.optimisticContentParts,
        ...promptAttachmentSnapshotsToContentParts(attachmentSnapshots),
        ...planAttachments.contentParts,
      ];
      const submitted = await handleSubmit({
        text: contextualPrompt.text,
        blocks,
        attachmentSnapshots,
        optimisticContentParts,
        measurementOperationId,
        onSubmitted: () => {
          clearSelectedResponseContexts(
            selectedResponseContexts.map((context) => context.id),
          );
        },
      });
      if (!submitted) {
        finishOrCancelMeasurementOperation(measurementOperationId, "aborted");
        return;
      }
      // A harness switch can temporarily make an existing attachment
      // unsupported. Clear only attachments that were eligible for this send,
      // leaving visible incompatible drafts available for another harness.
      attachments.clearSubmittedAttachments(attachmentSnapshots);
      planAttachments.clearPlans();
    });
  }, [
    attachments,
    commitEdit,
    effectiveIsEditingQueuedPrompt,
    clearSelectedResponseContexts,
    getDraft,
    getSelectedResponseContexts,
    handleSubmit,
    planAttachments,
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
    onEditLastQueued: editLastQueuedPrompt,
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

  const handleOpenDraftAttachment = useCallback<PromptAttachmentPreviewHandler>(
    (part) => openAttachmentPreview({ part, origin: "draft", sessionId: null }),
    [openAttachmentPreview],
  );

  const handleComposerSurfaceClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    // Portal-rendered popovers (model picker, etc.) bubble clicks through the
    // React tree even though their DOM lives outside the surface — those
    // clicks must not pull focus back into the chat editor.
    if (!event.currentTarget.contains(event.target as Node)) {
      return;
    }
    if (effectiveIsEditingQueuedPrompt) {
      textareaRef.current?.focus();
      return;
    }
    focusChatInput();
  }, [effectiveIsEditingQueuedPrompt]);

  useEffect(() => {
    if (suppressAutoFocus || (!workspaceUiKey && !activeSessionIdForUi)) {
      return;
    }

    const timer = window.setTimeout(() => {
      focusComposer();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [activeSessionIdForUi, focusComposer, suppressAutoFocus, workspaceUiKey, workspaceSelectionNonce]);

  // The takeover unmounts the textarea; when the blocking condition clears
  // and it remounts, put the caret back rather than leaving focus on body.
  const wasBlockedRef = useRef(false);
  useEffect(() => {
    const isBlocked = !!blockedPresentation;
    if (wasBlockedRef.current && !isBlocked && !suppressAutoFocus) {
      const timer = window.setTimeout(() => {
        focusComposer();
      }, 0);
      wasBlockedRef.current = isBlocked;
      return () => window.clearTimeout(timer);
    }
    wasBlockedRef.current = isBlocked;
  }, [blockedPresentation, focusComposer, suppressAutoFocus]);

  useChatComposerFocusRequest({ focusRequestNonce, focusComposer });

  return (
    <DebugProfiler id="chat-composer">
      <div className="relative">
        <div ref={setComposerOverlayHost} className="relative z-20 flex flex-col" />
        <ChatComposerSurface
          overflowMode="clip"
          onClick={handleComposerSurfaceClick}
          onPasteCapture={handleFilePasteCapture}
          onPaste={handlePaste}
        >
          <form className="relative flex flex-col">
            <Input
              ref={fileInputRef}
              variant="unstyled"
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
              accept={CHAT_INPUT_ATTACHMENT_ACCEPT}
            />
            {blockedPresentation
              ? (
                <>
                  <ComposerTextareaFrame topInset="standard">
                    <ComposerBlockedStatusLine
                      icon={blockedPresentation.icon}
                      tone={blockedPresentation.tone}
                      message={blockedPresentation.message}
                    />
                  </ComposerTextareaFrame>
                  <ComposerBlockedControlRow
                    actions={blockedPresentation.actions}
                    disabledReason={blockedPresentation.message}
                    isRunning={isRunningForUi}
                    isEmpty={effectiveIsEmpty}
                    isEditingQueuedPrompt={effectiveIsEditingQueuedPrompt}
                    onSubmit={onSubmit}
                    onCancel={onCancel}
                  />
                </>
              )
              : (
                <>
                  <ChatInputDraftArea
                    hasSessionTurns={hasSessionTurns}
                    isEditingQueuedPrompt={effectiveIsEditingQueuedPrompt}
                    editingQueueSeq={effectiveIsEditingQueuedPrompt ? editingSeq : null}
                    editDraft={editDraft}
                    onEditDraftChange={setEditDraftText}
                    textareaRef={textareaRef}
                    workspaceUiKey={workspaceUiKey}
                    onDraftChange={setDraft}
                    canSubmit={canSubmit}
                    isDisabled={isDisabled}
                    onSubmit={onSubmit}
                    onKeyDown={handleKeyDown}
                    hasDraftAttachments={hasDraftAttachments}
                    draftAttachments={[...attachments.attachments, ...planAttachments.attachments]}
                    onRemoveDraftAttachment={handleRemoveDraftAttachment}
                    onOpenDraftAttachment={handleOpenDraftAttachment}
                    onRemoveSelectedResponseContext={removeSelectedResponseContext}
                    overlayHostElement={composerOverlayHost}
                    onCancelEdit={cancelEdit}
                  />
                  <ChatInputControlRow
                    runtimeControlsDisabled={areRuntimeControlsDisabled}
                    modelSelectorProps={modelSelectorProps}
                    agentKind={effectiveAgentKind}
                    sessionConfigControls={effectiveSessionConfigControls}
                    isEditingQueuedPrompt={effectiveIsEditingQueuedPrompt}
                    chatDisabled={isDisabled}
                    sendBlockedReason={sendBlockedReason}
                    isSubmitting={isSubmitting}
                    supportsAttachments={attachments.supportsAttachments}
                    canAttachFiles={attachments.canAttachFiles}
                    activeSessionId={activeSessionIdForUi}
                    onAttachFile={() => fileInputRef.current?.click()}
                    isRunning={isRunningForUi}
                    isEmpty={effectiveIsEmpty}
                    onSubmit={onSubmit}
                    onCancel={onCancel}
                  />
                </>
              )}
          </form>
        </ChatComposerSurface>
      </div>
    </DebugProfiler>
  );
}
