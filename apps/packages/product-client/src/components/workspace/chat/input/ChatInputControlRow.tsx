import { ChatComposerActions } from "./ChatComposerActions";
import { ComposerModelSelectorControl } from "./ComposerModelSelectorControl";
import { ComposerEffortStepper } from "./ComposerEffortStepper";
import { ComposerFastModeToggle } from "./ComposerFastModeToggle";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { ComposerContextRing } from "./ComposerContextRing";
import { ComposerIntegrationsControl } from "./ComposerIntegrationsControl";
import { ComposerModeBadge } from "./ComposerModeBadge";
import { SessionConfigControls } from "./SessionConfigControls";
import {
  buildComposerSessionControlGroups,
} from "#product/lib/domain/chat/session-controls/composer-control-groups";
import { ChatComposerControlRowFrame } from "#product/components/workspace/chat/composer/ChatComposerControlRowFrame";
import { Plus } from "#product/primitives/icons/core";
import { Target } from "#product/primitives/icons/product";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";
import { deriveGoalBarState } from "#product/domain/activity/goal";
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
}

export interface ComposerLeadingControlsProps {
  runtimeControlsDisabled: boolean;
  modelSelectorProps: ModelSelectorProps;
  agentKind: string | null;
  sessionConfigControls: LiveSessionControlDescriptor[];
  activeSessionId: string | null;
}

/**
 * The leading control cluster (model selector, fast mode, effort stepper,
 * collaboration mode, execution access, goal, urgent integrations). Shared
 * verbatim between the in-session chat composer (ChatInputControlRow) and the
 * home/new-chat composer (HomeNextScreen slot): home feeds it launch-time
 * control descriptors instead
 * of live-session ones, and session-only controls (goal) hide via their own
 * gating.
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
        <ComposerModelSelectorControl
          modelSelectorProps={modelSelectorProps}
          disabled={runtimeControlsDisabled}
          keyboardShortcutEnabled
        />
      </div>

      {/* 2. Fast mode toggle */}
      {controlGroups.fastModeControl && (
        <span
          className={`inline-flex shrink-0 ${
            runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
          }`}
        >
          <ComposerFastModeToggle control={controlGroups.fastModeControl} />
        </span>
      )}

      {/* 3. Reasoning effort stepper */}
      {controlGroups.reasoningEffortControl && (
        <span
          className={`inline-flex shrink-0 ${
            runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
          }`}
        >
          <ComposerEffortStepper
            control={controlGroups.reasoningEffortControl}
          />
        </span>
      )}

      {/* 4. Working mode badge (bypass/plan/etc) — icon-only, steps on click. */}
      {controlGroups.modeControl && (
        <ComposerModeBadge
          agentKind={agentKind}
          control={controlGroups.modeControl}
          className={runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""}
        />
      )}

      {/* 5. Execution access is independent from collaboration mode. */}
      {controlGroups.accessControl && (
        <ComposerModeBadge
          agentKind={agentKind}
          control={controlGroups.accessControl}
          className={runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""}
        />
      )}

      {/* Every other observed axis remains reachable. These controls are not
          availability-gated or collapsed out of the statement. */}
      <span
        className={`inline-flex items-center gap-1.5 ${
          runtimeControlsDisabled ? "pointer-events-none opacity-55" : ""
        }`}
      >
        <SessionConfigControls
          agentKind={agentKind}
          controls={controlGroups.overflowControls}
        />
      </span>

      {/* 7. Goal button. Kept on the compact grammar: the goal system is
          unchanged by this pass, so its only entry path must not be orphaned. */}
      {canSetGoal && (
        <ComposerControlButton
          iconOnly
          size="compact"
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

      {/* 8. Integrations — renders only for an urgent re-auth. */}
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
}

/**
 * The trailing control cluster (context-usage ring, attach) — shared
 * between chat and home like ComposerLeadingControls. Home feeds it a
 * home-scoped attachment controller (optimistic pre-session capabilities);
 * chat feeds it the live session's controller.
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
      {/* 7. Context-usage ring — self-gating on the active session's usage state. */}
      <ComposerContextRing />

      {/* 8. Plus button — direct file attach */}
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
