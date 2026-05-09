import type { ComponentProps } from "react";
import { ChatComposerActions } from "./ChatComposerActions";
import { ComposerAddActionPopover } from "./ComposerAddActionPopover";
import { ModelSelector } from "./ModelSelector";
import { SessionConfigControls } from "./SessionConfigControls";

export interface ChatInputControlRowProps {
  runtimeControlsDisabled: boolean;
  modelSelectorProps: ComponentProps<typeof ModelSelector>;
  agentKind: ComponentProps<typeof SessionConfigControls>["agentKind"];
  sessionConfigControls: ComponentProps<typeof SessionConfigControls>["controls"];
  isEditingQueuedPrompt: boolean;
  chatDisabled: boolean;
  isSubmitting: boolean;
  supportsAttachments: boolean;
  canAttachFiles: boolean;
  activeSessionId: string | null;
  workspaceUiKey: string | null;
  sdkWorkspaceId: string | null;
  suppressActiveSessionState: boolean;
  canStartCodeReview: boolean;
  hasBlockingReview: boolean;
  startingReview: boolean;
  hasUnresolvedPlans: boolean;
  onAttachFile: () => void;
  onStartReview: () => void;
  onConfigureReview: () => void;
  isRunning: boolean;
  isEmpty: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

export function ChatInputControlRow({
  runtimeControlsDisabled,
  modelSelectorProps,
  agentKind,
  sessionConfigControls,
  isEditingQueuedPrompt,
  chatDisabled,
  isSubmitting,
  supportsAttachments,
  canAttachFiles,
  activeSessionId,
  workspaceUiKey,
  sdkWorkspaceId,
  suppressActiveSessionState,
  canStartCodeReview,
  hasBlockingReview,
  startingReview,
  hasUnresolvedPlans,
  onAttachFile,
  onStartReview,
  onConfigureReview,
  isRunning,
  isEmpty,
  onSubmit,
  onCancel,
}: ChatInputControlRowProps) {
  const canUseUtilityActions =
    !isEditingQueuedPrompt && !chatDisabled && !runtimeControlsDisabled && !isSubmitting;
  const canAttachFile = canUseUtilityActions && canAttachFiles;
  // Plan references resolve to markdown text in the runtime, so they do not
  // depend on file/image attachment capabilities.
  const canAttachPlan = canUseUtilityActions && !!workspaceUiKey && !!sdkWorkspaceId;
  const canStartReview = canUseUtilityActions
    && !suppressActiveSessionState
    && canStartCodeReview
    && !hasBlockingReview
    && !startingReview;
  const attachFileDetail = canAttachFile
    ? "Upload image or text context."
    : !supportsAttachments
      ? activeSessionId
        ? "Attachments are not supported by this agent"
        : "Attachments are available after a session starts"
      : "Chat is unavailable right now";
  const attachPlanDetail = canAttachPlan
    ? "Attach an existing plan snapshot."
    : workspaceUiKey
      ? "Chat is unavailable right now"
      : "Select a workspace before attaching a plan";
  const reviewDetail = canStartReview
    ? "Start review agents for the current implementation."
    : hasBlockingReview || startingReview
      ? "A review is already active for this session"
      : !activeSessionId
        ? "Review is available after a session starts"
        : "Review agents are unavailable right now";

  return (
    <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[5px] px-2">
      <div
        className={`flex min-w-0 flex-nowrap items-center gap-[5px] ${
          runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
        }`}
      >
        <ModelSelector {...modelSelectorProps} />
        <SessionConfigControls agentKind={agentKind} controls={sessionConfigControls} />
      </div>

      <div className="flex items-center gap-[5px]">
        {!isEditingQueuedPrompt && (
          <ComposerAddActionPopover
            canAttachFile={canAttachFile}
            attachFileDetail={attachFileDetail}
            canAttachPlan={canAttachPlan}
            attachPlanDetail={attachPlanDetail}
            canStartReview={canStartReview}
            reviewDetail={reviewDetail}
            workspaceUiKey={workspaceUiKey}
            sdkWorkspaceId={sdkWorkspaceId}
            onAttachFile={onAttachFile}
            onStartReview={onStartReview}
            onConfigureReview={onConfigureReview}
          />
        )}
        <ChatComposerActions
          isRunning={isRunning}
          isEmpty={isEmpty}
          isDisabled={chatDisabled || hasUnresolvedPlans || isSubmitting}
          isEditingQueuedPrompt={isEditingQueuedPrompt}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}
