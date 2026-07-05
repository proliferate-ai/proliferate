import type { ComponentProps } from "react";
import { ChatComposerActions } from "./ChatComposerActions";
import { ComposerAddActionPopover } from "./ComposerAddActionPopover";
import { ComposerModelConfigSelector } from "./ComposerModelConfigSelector";
import type { ModelSelector } from "./ModelSelector";
import type { SessionConfigControls } from "./SessionConfigControls";
import { ComposerIntegrationsControl } from "./ComposerIntegrationsControl";
import { RuntimePressureIndicator } from "./RuntimePressureIndicator";
import { SessionModeControl } from "./SessionModeControl";
import {
  buildComposerSessionControlGroups,
} from "@/lib/domain/chat/session-controls/composer-control-groups";
import { ChatComposerControlRowFrame } from "@proliferate/product-ui/chat/composer/ChatComposerControlRowFrame";
import { Target } from "lucide-react";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { deriveGoalBarState } from "@proliferate/product-domain/activity/goal";
import { useSessionGoal } from "@/hooks/activity/derived/use-session-goal";
import { useGoalBarStore } from "@/stores/activity/goal-bar-store";

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
  const attachFileDetail = canAttachFile
    ? "Upload image or text context."
    : !supportsAttachments
      ? activeSessionId
        ? "Attachments are not supported by this agent"
        : "Attachments are available after a session starts"
      : "Chat is unavailable right now";

  const sessionGoal = useSessionGoal();
  const beginComposingGoal = useGoalBarStore((state) => state.beginComposing);
  const canSetGoal = !!sessionGoal
    && sessionGoal.capabilities.supported
    && deriveGoalBarState(sessionGoal.goal).kind !== "live";

  return (
    <ChatComposerControlRowFrame
      leading={(
        <>
        {!isEditingQueuedPrompt && (
          <ComposerAddActionPopover
            canAttachFile={canAttachFile}
            attachFileDetail={attachFileDetail}
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
          <ComposerIntegrationsControl />
          <RuntimePressureIndicator />
          {canSetGoal && (
            <ComposerControlButton
              icon={<Target className="size-4" />}
              label="Set goal"
              title="Give the agent an objective to keep pursuing."
              onClick={() => {
                if (activeSessionId) {
                  beginComposingGoal(activeSessionId);
                }
              }}
              className="max-w-[12rem]"
            />
          )}
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
          isDisabled={chatDisabled || isSubmitting}
          isEditingQueuedPrompt={isEditingQueuedPrompt}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
    />
  );
}
