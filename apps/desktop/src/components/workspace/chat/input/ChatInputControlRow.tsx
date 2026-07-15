import { ChatComposerActions } from "./ChatComposerActions";
import { ComposerModelSelectorControl } from "./ComposerModelSelectorControl";
import { ComposerReasoningEffortBars } from "./ComposerReasoningEffortBars";
import { ComposerFastModeToggle } from "./ComposerFastModeToggle";
import { ComposerOverflowControl } from "./ComposerOverflowControl";
import type { ModelSelectorProps } from "@/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { ComposerIntegrationsControl } from "./ComposerIntegrationsControl";
import { RuntimePressureIndicator } from "./RuntimePressureIndicator";
import { SessionModeControl } from "./SessionModeControl";
import {
  buildComposerSessionControlGroups,
} from "@/lib/domain/chat/session-controls/composer-control-groups";
import { ChatComposerControlRowFrame } from "@proliferate/product-ui/chat/composer/ChatComposerControlRowFrame";
import { Plus, Target } from "@proliferate/ui/icons";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { deriveGoalBarState } from "@proliferate/product-domain/activity/goal";
import { useSessionGoal } from "@/hooks/activity/derived/use-session-goal";
import { useGoalBarStore } from "@/stores/activity/goal-bar-store";

export interface ChatInputControlRowProps {
  runtimeControlsDisabled: boolean;
  modelSelectorProps: ModelSelectorProps;
  agentKind: string | null;
  sessionConfigControls: LiveSessionControlDescriptor[];
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

export interface ComposerLeadingControlsProps {
  runtimeControlsDisabled: boolean;
  modelSelectorProps: ModelSelectorProps;
  agentKind: string | null;
  sessionConfigControls: LiveSessionControlDescriptor[];
  activeSessionId: string | null;
}

/**
 * The leading control cluster (model selector, reasoning bars, fast mode, mode, goal,
 * integrations). Shared verbatim between the in-session chat composer
 * (ChatInputControlRow) and the home/new-chat composer (HomeNextScreen slot):
 * home feeds it launch-time control descriptors instead of live-session
 * ones, and session-only controls (goal) hide via their own gating.
 */
export function ComposerLeadingControls({
  runtimeControlsDisabled,
  modelSelectorProps,
  agentKind,
  sessionConfigControls,
  activeSessionId,
}: ComposerLeadingControlsProps) {
  const controlGroups = buildComposerSessionControlGroups(sessionConfigControls);

  const sessionGoal = useSessionGoal();
  const beginComposingGoal = useGoalBarStore((state) => state.beginComposing);
  // Goal is a live-session affordance: it attaches an objective to an active
  // session, so it self-gates on activeSessionId (null pre-session and on
  // home) in addition to capability support.
  const canSetGoal = !!activeSessionId
    && !!sessionGoal
    && sessionGoal.capabilities.supported
    && deriveGoalBarState(sessionGoal.goal).kind !== "live";

  return (
    <>
      {/* 1. Model/harness selector — leftmost */}
      <div
        className={`flex min-w-0 items-center ${
          runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
        }`}
      >
        <ComposerModelSelectorControl modelSelectorProps={modelSelectorProps} />
      </div>

      {/* 2. Reasoning/effort bars */}
      {controlGroups.reasoningEffortControl && (
        <span
          className={`inline-flex shrink-0 ${
            runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
          }`}
        >
          <ComposerReasoningEffortBars control={controlGroups.reasoningEffortControl} />
        </span>
      )}

      {/* 3. Fast mode toggle */}
      {controlGroups.fastModeControl && (
        <span
          className={`inline-flex shrink-0 ${
            runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
          }`}
        >
          <ComposerFastModeToggle control={controlGroups.fastModeControl} />
        </span>
      )}

      {/* 4. Primary working mode control (bypass/plan/etc) */}
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

      {/* 5. Goal button */}
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

      {/* 6. Integrations control */}
      <ComposerIntegrationsControl />
    </>
  );
}

export interface ComposerTrailingControlsProps {
  runtimeControlsDisabled: boolean;
  agentKind: string | null;
  sessionConfigControls: LiveSessionControlDescriptor[];
  isEditingQueuedPrompt: boolean;
  chatDisabled: boolean;
  isSubmitting: boolean;
  supportsAttachments: boolean;
  canAttachFiles: boolean;
  activeSessionId: string | null;
  onAttachFile: () => void;
}

/**
 * The trailing control cluster (attach, runtime pressure, overflow) —
 * shared between chat and home like ComposerLeadingControls. Home
 * passes supportsAttachments/canAttachFiles=false and gets the exact
 * disabled plus-button + "available after a session starts" detail that
 * chat's pre-session state shows.
 */
export function ComposerTrailingControls({
  runtimeControlsDisabled,
  agentKind,
  sessionConfigControls,
  isEditingQueuedPrompt,
  chatDisabled,
  isSubmitting,
  supportsAttachments,
  canAttachFiles,
  activeSessionId,
  onAttachFile,
}: ComposerTrailingControlsProps) {
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

  return (
    <>
      {/* 7. Plus button — direct file attach */}
      {!isEditingQueuedPrompt && (
        <ComposerControlButton
          iconOnly
          icon={<Plus className="size-4" />}
          label="Add file"
          title={attachFileDetail}
          aria-label="Add file"
          disabled={!canAttachFile}
          onClick={onAttachFile}
        />
      )}

      {/* 8. Runtime pressure */}
      <RuntimePressureIndicator />

      {/* 9. Overflow three-dots */}
      <span
        className={`inline-flex shrink-0 ${
          runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
        }`}
      >
        <ComposerOverflowControl
          agentKind={agentKind}
          controls={controlGroups.overflowControls}
        />
      </span>
    </>
  );
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
  return (
    <ChatComposerControlRowFrame
      leading={(
        <ComposerLeadingControls
          runtimeControlsDisabled={runtimeControlsDisabled}
          modelSelectorProps={modelSelectorProps}
          agentKind={agentKind}
          sessionConfigControls={sessionConfigControls}
          activeSessionId={activeSessionId}
        />
      )}
      trailing={(
        <ComposerTrailingControls
          runtimeControlsDisabled={runtimeControlsDisabled}
          agentKind={agentKind}
          sessionConfigControls={sessionConfigControls}
          isEditingQueuedPrompt={isEditingQueuedPrompt}
          chatDisabled={chatDisabled}
          isSubmitting={isSubmitting}
          supportsAttachments={supportsAttachments}
          canAttachFiles={canAttachFiles}
          activeSessionId={activeSessionId}
          onAttachFile={onAttachFile}
        />
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
