import type { ReactNode } from "react";
import { ChatComposerActions } from "./ChatComposerActions";
import { ComposerModelSelectorControl } from "./ComposerModelSelectorControl";
import { ComposerReasoningEffortBars } from "./ComposerReasoningEffortBars";
import { ComposerFastModeToggle } from "./ComposerFastModeToggle";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { ComposerIntegrationsControl } from "./ComposerIntegrationsControl";
import { SessionModeControl } from "./SessionModeControl";
import {
  buildComposerSessionControlGroups,
} from "#product/lib/domain/chat/session-controls/composer-control-groups";
import { ChatComposerControlRowFrame } from "@proliferate/product-ui/chat/composer/ChatComposerControlRowFrame";
import { Plus, Target } from "@proliferate/ui/icons";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { deriveGoalBarState } from "@proliferate/product-domain/activity/goal";
import { useSessionGoal } from "#product/hooks/activity/derived/use-session-goal";
import { useGoalBarStore } from "#product/stores/activity/goal-bar-store";

export interface ChatInputControlRowProps {
  runtimeControlsDisabled: boolean;
  modelSelectorProps: ModelSelectorProps;
  agentKind: string | null;
  sessionConfigControls: LiveSessionControlDescriptor[];
  isEditingQueuedPrompt: boolean;
  chatDisabled: boolean;
  /** Send is refused with this reason while the editor stays editable. */
  sendBlockedReason?: string | null;
  isSubmitting: boolean;
  supportsAttachments: boolean;
  canAttachFiles: boolean;
  activeSessionId: string | null;
  onAttachFile: () => void;
  isRunning: boolean;
  isEmpty: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  /** Workspace-status trigger — slots after the runtime-pressure ring. */
  statusControl?: ReactNode;
}

export interface ComposerLeadingControlsProps {
  runtimeControlsDisabled: boolean;
  modelSelectorProps: ModelSelectorProps;
  agentKind: string | null;
  sessionConfigControls: LiveSessionControlDescriptor[];
  activeSessionId: string | null;
}

/**
 * The leading control cluster (model selector, mode, reasoning bars, fast mode,
 * goal, integrations). Shared verbatim between the in-session chat composer
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

      {/* 2. Primary working mode control (bypass/plan/etc) */}
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

      {/* 3. Reasoning/effort bars */}
      {controlGroups.reasoningEffortControl && (
        <span
          className={`inline-flex shrink-0 ${
            runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
          }`}
        >
          <ComposerReasoningEffortBars
            control={controlGroups.reasoningEffortControl}
          />
        </span>
      )}

      {/* 4. Fast mode toggle */}
      {controlGroups.fastModeControl && (
        <span
          className={`inline-flex shrink-0 ${
            runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
          }`}
        >
          <ComposerFastModeToggle control={controlGroups.fastModeControl} />
        </span>
      )}

      {/* 5. Goal button */}
      {canSetGoal && (
        <ComposerControlButton
          iconOnly
          icon={<Target className="icon-control" />}
          label="Set goal"
          aria-label="Set goal"
          title="Give the agent an objective to keep pursuing."
          onClick={() => {
            if (activeSessionId) {
              beginComposingGoal(activeSessionId);
            }
          }}
        />
      )}

      {/* 6. Integrations control */}
      <ComposerIntegrationsControl />
    </>
  );
}

export interface ComposerTrailingControlsProps {
  runtimeControlsDisabled: boolean;
  isEditingQueuedPrompt: boolean;
  chatDisabled: boolean;
  isSubmitting: boolean;
  supportsAttachments: boolean;
  canAttachFiles: boolean;
  activeSessionId: string | null;
  onAttachFile: () => void;
  /** Workspace-status trigger — slots after the runtime-pressure ring. */
  statusControl?: ReactNode;
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
  isEditingQueuedPrompt,
  chatDisabled,
  isSubmitting,
  supportsAttachments,
  canAttachFiles,
  activeSessionId,
  onAttachFile,
  statusControl,
}: ComposerTrailingControlsProps) {
  const canUseUtilityActions =
    !isEditingQueuedPrompt && !chatDisabled && !runtimeControlsDisabled && !isSubmitting;
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
          icon={<Plus className="icon-control" />}
          label="Add file"
          title={attachFileDetail}
          aria-label="Add file"
          disabled={!canAttachFile}
          onClick={onAttachFile}
        />
      )}

      {/* 8. Workspace status — the single ambient-state surface: background
          work, source control, runtime resources, and the advanced session
          config that used to live in the "..." overflow menu. */}
      {statusControl}
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
  sendBlockedReason = null,
  isSubmitting,
  supportsAttachments,
  canAttachFiles,
  activeSessionId,
  onAttachFile,
  isRunning,
  isEmpty,
  onSubmit,
  onCancel,
  statusControl,
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
          isEditingQueuedPrompt={isEditingQueuedPrompt}
          chatDisabled={chatDisabled}
          isSubmitting={isSubmitting}
          supportsAttachments={supportsAttachments}
          canAttachFiles={canAttachFiles}
          activeSessionId={activeSessionId}
          onAttachFile={onAttachFile}
          statusControl={statusControl}
        />
      )}
      action={(
        <ChatComposerActions
          isRunning={isRunning}
          isEmpty={isEmpty}
          isDisabled={chatDisabled || Boolean(sendBlockedReason) || isSubmitting}
          disabledReason={sendBlockedReason}
          isEditingQueuedPrompt={isEditingQueuedPrompt}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
    />
  );
}
