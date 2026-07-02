import type { ComponentProps } from "react";
import { ChatComposerActions } from "./ChatComposerActions";
import { ComposerAddActionPopover } from "./ComposerAddActionPopover";
import { ComposerModelConfigSelector } from "./ComposerModelConfigSelector";
import type { ModelSelector } from "./ModelSelector";
import type { SessionConfigControls } from "./SessionConfigControls";
import { ComposerIntegrationReauthChip } from "./ComposerIntegrationReauthChip";
import { RuntimePressureIndicator } from "./RuntimePressureIndicator";
import { SessionModeControl } from "./SessionModeControl";
import {
  buildComposerSessionControlGroups,
} from "@/lib/domain/chat/session-controls/composer-control-groups";
import { ChatComposerControlRowFrame } from "@proliferate/product-ui/chat/composer/ChatComposerControlRowFrame";

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
  hasUnresolvedPlans: boolean;
  onAttachFile: () => void;
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
  hasUnresolvedPlans,
  onAttachFile,
  isRunning,
  isEmpty,
  onSubmit,
  onCancel,
}: ChatInputControlRowProps) {
  const canUseUtilityActions =
    !isEditingQueuedPrompt && !chatDisabled && !runtimeControlsDisabled && !isSubmitting;
  const controlGroups = buildComposerSessionControlGroups(sessionConfigControls);
  const canAttachFile = canUseUtilityActions && canAttachFiles;
  // Plan references resolve to markdown text in the runtime, so they do not
  // depend on file/image attachment capabilities.
  const canAttachPlan = canUseUtilityActions && !!workspaceUiKey && !!sdkWorkspaceId;
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

  return (
    <ChatComposerControlRowFrame
      leading={(
        <>
        {!isEditingQueuedPrompt && (
          <ComposerAddActionPopover
            canAttachFile={canAttachFile}
            attachFileDetail={attachFileDetail}
            canAttachPlan={canAttachPlan}
            attachPlanDetail={attachPlanDetail}
            workspaceUiKey={workspaceUiKey}
            sdkWorkspaceId={sdkWorkspaceId}
            onAttachFile={onAttachFile}
          />
        )}
        {controlGroups.modeControl && (
          <span
            className={`inline-flex min-w-0 ${
              runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
            }`}
          >
            <SessionModeControl
              agentKind={agentKind}
              control={controlGroups.modeControl}
              triggerStyle="value"
            />
          </span>
        )}
        </>
      )}
      trailing={(
        <>
          <ComposerIntegrationReauthChip />
          <RuntimePressureIndicator />
          <div
            className={`flex min-w-0 items-center gap-1 ${
              runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
            }`}
          >
            <ComposerModelConfigSelector
              modelSelectorProps={modelSelectorProps}
              agentKind={agentKind}
              controls={controlGroups.modelConfigControls}
            />
          </div>
        </>
      )}
      action={(
        <ChatComposerActions
          isRunning={isRunning}
          isEmpty={isEmpty}
          isDisabled={chatDisabled || hasUnresolvedPlans || isSubmitting}
          isEditingQueuedPrompt={isEditingQueuedPrompt}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
    />
  );
}
