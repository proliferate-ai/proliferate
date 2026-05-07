import { useRef, type ReactNode, type Ref } from "react";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  WORKSPACE_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { ApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { ChatComposerDock } from "@/components/workspace/chat/input/ChatComposerDock";
import { ComposerControlButton } from "@/components/workspace/chat/input/ComposerControlButton";
import { ComposerFileMentionBadge } from "@/components/workspace/chat/input/ComposerFileMentionBadge";
import { ComposerFileMentionSearch } from "@/components/workspace/chat/input/ComposerFileMentionSearch";
import { ChatComposerSurface } from "@/components/workspace/chat/input/ChatComposerSurface";
import { ComposerTextarea } from "@/components/workspace/chat/input/ComposerTextarea";
import { ComposerTextareaFrame } from "@/components/workspace/chat/input/ComposerTextareaFrame";
import { DelegatedWorkComposerPanel } from "@/components/workspace/chat/input/DelegatedWorkComposerPanel";
import { DelegatedWorkComposerControl } from "@/components/workspace/chat/input/delegated-work/DelegatedWorkComposerControl";
import { PendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { UserInputCard } from "@/components/workspace/chat/input/UserInputCard";
import { McpElicitationCard } from "@/components/workspace/chat/input/McpElicitationCard";
import { WorkspaceMobilityLocationPopover } from "@/components/workspace/chat/input/WorkspaceMobilityLocationPopover";
import { WorkspaceMobilityFooterProgressStatus } from "@/components/workspace/chat/input/WorkspaceMobilityFooterRow";
import { WorkspaceArrivalAttachedPanelView } from "@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { CloudRuntimeAttachedPanelView } from "@/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalCloudPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalCloudPanel";
import { WorkspaceMobilityOverlayView } from "@/components/workspace/chat/surface/WorkspaceMobilityOverlay";
import { useComposerDockSlots } from "@/hooks/chat/use-composer-dock-slots";
import { useComposerTextareaAutosize } from "@/hooks/chat/use-composer-textarea-autosize";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { type MobilityPromptState } from "@/lib/domain/workspaces/mobility/mobility-prompt";
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";
import {
  getMobilityOverlayTitle,
  mobilityStatusCopy,
} from "@/lib/domain/workspaces/mobility/presentation";
import {
  ArrowRight,
  ArrowUp,
  ChevronDown,
  CloudIcon,
  Copy,
  Folder,
  FolderOpen,
  GitBranch,
} from "@/components/ui/icons";
import type { PlaygroundScenarioSelection, ScenarioKey } from "@/config/playground";
import type { ReviewRunDetail } from "@anyharness/sdk";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/use-delegated-work-composer";
import type {
  CoworkComposerStripSummary,
  CoworkComposerWorkspaceRow,
} from "@/hooks/cowork/use-cowork-composer-strip";
import type { PlaygroundReplayState } from "@/hooks/playground/use-replay-session";
import { resolveSubagentColor } from "@/lib/domain/chat/subagents/subagent-braille-color";
import {
  CLOUD_RUNTIME_RECONNECT_ERROR,
  CLOUD_RUNTIME_RECONNECTING,
  CLOUD_STATUS_APPLYING_FILES,
  CLOUD_STATUS_BLOCKED,
  CLOUD_STATUS_ERROR,
  CLOUD_STATUS_FIRST_RUNTIME,
  CLOUD_STATUS_PROVISIONING,
  EDIT_OPTIONS,
  EXECUTE_OPTIONS,
  FILE_MENTION_SEARCH_RESULTS,
  GEMINI_MCP_OPTIONS,
  MCP_ELICITATION_BOOLEAN,
  MCP_ELICITATION_ENUM,
  MCP_ELICITATION_MIXED_REQUIRED,
  MCP_ELICITATION_MULTI_SELECT,
  MCP_ELICITATION_URL,
  PENDING_REVIEW_COMPLETE,
  PENDING_REVIEW_FEEDBACK_READY,
  PENDING_PROMPTS_MULTI,
  PENDING_PROMPTS_SINGLE,
  PENDING_PROMPTS_WITH_EDITING,
  PLAYGROUND_LONG_COMPOSER_DRAFT,
  PLAYGROUND_REVIEW_COMPOSER_STATES,
  PLAYGROUND_SUBAGENT_STRIP_ROWS,
  PLAYGROUND_SUBAGENT_WAKE_QUEUE,
  TODOS_LONG,
  TODOS_MID,
  TODOS_SHORT,
  WORKSPACE_ARRIVAL_CREATED,
  USER_INPUT_MULTI_QUESTION,
  USER_INPUT_OPTION_PLUS_OTHER,
  USER_INPUT_SECRET,
  USER_INPUT_SINGLE_FREEFORM,
  USER_INPUT_SINGLE_OPTION,
  type PlaygroundReviewComposerRow,
  type PlaygroundReviewComposerState,
} from "@/lib/domain/chat/__fixtures__/playground";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueEntry,
} from "@/lib/domain/chat/outbox/pending-prompt-queue";

interface PlaygroundComposerProps {
  dockRef: Ref<HTMLDivElement>;
  lowerBackdropTopPx: number | null;
  selection: PlaygroundScenarioSelection;
  replay: PlaygroundReplayState;
}

const noop = () => {};
const noopAsync = async () => {};
const revealExampleUrl = async () => "https://accounts.example.com/oauth/authorize?client_id=redacted";

const PLAYGROUND_COWORK_ROWS: CoworkComposerWorkspaceRow[] = [
  {
    ownershipId: "workspace-frontend-polish",
    workspaceId: "workspace-frontend-polish",
    parentSessionId: "playground-root-session",
    label: "frontend-polish",
    sessionCount: 2,
    active: true,
    sessions: [
      {
        sessionLinkId: "coding-link-composer-layout",
        codingSessionId: "coding-session-composer-layout",
        parentSessionId: "playground-root-session",
        label: "composer layout cleanup",
        agentKind: "codex",
        statusLabel: "Working",
        meta: "Codex · gpt-5.4 · implementation",
        latestCompletionLabel: null,
        wakeScheduled: false,
        color: resolveSubagentColor("coding-link-composer-layout"),
        active: true,
      },
      {
        sessionLinkId: "coding-link-visual-regression",
        codingSessionId: "coding-session-visual-regression",
        parentSessionId: "playground-root-session",
        label: "visual regression pass",
        agentKind: "claude",
        statusLabel: "Idle",
        meta: "Claude · sonnet · verification",
        latestCompletionLabel: "Turn completed",
        wakeScheduled: true,
        color: resolveSubagentColor("coding-link-visual-regression"),
        active: false,
      },
    ],
  },
];

const PLAYGROUND_COWORK_SUMMARY: CoworkComposerStripSummary = {
  label: "1 coding workspace",
  detail: "1 working · 1 wake scheduled",
  active: true,
};

export function PlaygroundComposer({
  dockRef,
  lowerBackdropTopPx,
  selection,
  replay,
}: PlaygroundComposerProps) {
  const replaySlots = useComposerDockSlots();
  const scenario = selection.kind === "fixture" ? selection.key : null;
  const outboundSlot = scenario ? renderOutboundSlot(scenario) : replaySlots.outboundSlot;
  const activeSlot = scenario ? renderActiveSlot(scenario) : replaySlots.activeSlot;
  const attachedSlot = scenario ? renderAttachedSlot(scenario) : replaySlots.attachedSlot;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <ChatComposerDock
        ref={dockRef}
        outboundSlot={outboundSlot ?? undefined}
        activeSlot={activeSlot ?? undefined}
        attachedSlot={attachedSlot ?? undefined}
        footerSlot={scenario ? <PlaygroundMobilityFooterRow scenario={scenario} /> : undefined}
        lowerBackdropTopPx={lowerBackdropTopPx}
        shellClassName="pointer-events-none absolute inset-x-0 bottom-0"
      >
        {selection.kind === "recording"
          ? <ReplayComposerSurface replay={replay} />
          : scenario
            ? renderComposerSurfaceForScenario(scenario)
            : <PlaygroundComposerSurface />}
      </ChatComposerDock>
      {scenario && renderMobilityOverlayPreview(scenario)}
    </div>
  );
}

export function renderComposerSurfaceForScenario(scenario: ScenarioKey): ReactNode {
  switch (scenario) {
    case "composer-long-input":
      return <PlaygroundLongInputComposerSurface />;
    case "file-mention-search":
      return <PlaygroundFileMentionComposerSurface />;
    default:
      return <PlaygroundComposerSurface />;
  }
}

export function renderActiveSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "todos-short":
    case "todos-mid":
    case "todos-long":
    case "execute-approval":
    case "edit-approval":
    case "pending-prompts-with-approval":
    case "subagents-queued-wake-with-approval":
    case "subagents-coding-review-with-approval":
    case "gemini-mcp-approval-options":
    case "gemini-tool-before-approval":
    case "user-input-single-option":
    case "user-input-single-freeform":
    case "user-input-option-plus-other":
    case "user-input-secret":
    case "user-input-multi-question":
    case "mcp-elicitation-boolean":
    case "mcp-elicitation-enum":
    case "mcp-elicitation-multi-select":
    case "mcp-elicitation-mixed-required":
    case "mcp-elicitation-url":
    case "mcp-elicitation-validation-error":
    case "mcp-elicitation-cancel-decline":
      return renderPanelSlotFixture(scenario);
    default:
      return null;
  }
}

export function renderAttachedSlot(scenario: ScenarioKey): ReactNode | null {
  const contextPanel = (() => {
    switch (scenario) {
      case "workspace-arrival-created":
      case "cloud-first-runtime":
      case "cloud-provisioning":
      case "cloud-applying-files":
      case "cloud-blocked":
      case "cloud-error":
      case "cloud-reconnecting":
      case "cloud-reconnect-error":
        return renderPanelSlotFixture(scenario);
      default:
        return null;
    }
  })();
  const delegationPanel = renderDelegationSlot(scenario);

  if (!contextPanel && !delegationPanel) {
    return null;
  }

  return (
    <>
      {contextPanel}
      {delegationPanel}
    </>
  );
}

function renderPanelSlotFixture(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "clean":
    case "gemini-retry-status":
    case "gemini-blocked-warning":
    case "gemini-no-response-warning":
    case "subagents-composer-few":
    case "subagents-composer-many":
    case "subagents-queued-wake":
    case "subagent-wake-card":
      return null;
    case "todos-short":
      return <TodoTrackerPanel entries={TODOS_SHORT} />;
    case "todos-mid":
      return <TodoTrackerPanel entries={TODOS_MID} />;
    case "todos-long":
      return <TodoTrackerPanel entries={TODOS_LONG} />;
    case "execute-approval":
      return (
        <ApprovalCard
          title="git push origin main"
          actions={EXECUTE_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "edit-approval":
      return (
        <ApprovalCard
          title="Edit desktop/src/components/workspace/chat/input/ApprovalCard.tsx"
          actions={EDIT_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "gemini-mcp-approval-options":
    case "gemini-tool-before-approval":
      return (
        <ApprovalCard
          title="MCP: github.search_pull_requests"
          actions={GEMINI_MCP_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "claude-plan-short":
    case "claude-plan-long":
    case "pending-prompts-single":
    case "pending-prompts-multi":
    case "pending-prompts-editing":
      return null;
    case "pending-prompts-with-approval":
    case "subagents-queued-wake-with-approval":
    case "subagents-coding-review-with-approval":
      return (
        <ApprovalCard
          title="wc -l /Users/pablo/proliferate/server/proliferate/**/*.py | tail -1"
          actions={EXECUTE_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "workspace-arrival-created":
      return (
        <WorkspaceArrivalAttachedPanelView
          viewModel={WORKSPACE_ARRIVAL_CREATED}
          expanded
          onToggleExpanded={noop}
          onDismiss={noop}
          onSetupAction={noop}
        />
      );
    case "cloud-first-runtime":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_FIRST_RUNTIME}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-provisioning":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_PROVISIONING}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-applying-files":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_APPLYING_FILES}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-blocked":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_BLOCKED}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-error":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_ERROR}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-reconnecting":
      return (
        <CloudRuntimeAttachedPanelView
          state={CLOUD_RUNTIME_RECONNECTING}
          retry={noop}
        />
      );
    case "cloud-reconnect-error":
      return (
        <CloudRuntimeAttachedPanelView
          state={CLOUD_RUNTIME_RECONNECT_ERROR}
          retry={noop}
        />
      );
    case "user-input-single-option":
      return (
        <UserInputCard
          key="user-input-single-option"
          title="Choose provider"
          questions={USER_INPUT_SINGLE_OPTION}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "user-input-single-freeform":
      return (
        <UserInputCard
          key="user-input-single-freeform"
          title="Name workspace"
          questions={USER_INPUT_SINGLE_FREEFORM}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "user-input-option-plus-other":
      return (
        <UserInputCard
          key="user-input-option-plus-other"
          title="Pick a strategy"
          questions={USER_INPUT_OPTION_PLUS_OTHER}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "user-input-secret":
      return (
        <UserInputCard
          key="user-input-secret"
          title="Provide secret"
          questions={USER_INPUT_SECRET}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "user-input-multi-question":
      return (
        <UserInputCard
          key="user-input-multi-question"
          title="Answer questions"
          questions={USER_INPUT_MULTI_QUESTION}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "mcp-elicitation-boolean":
      return (
        <McpElicitationCard
          title="MCP confirmation"
          payload={MCP_ELICITATION_BOOLEAN}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-enum":
      return (
        <McpElicitationCard
          title="MCP review choice"
          payload={MCP_ELICITATION_ENUM}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-multi-select":
      return (
        <McpElicitationCard
          title="MCP calendar scope"
          payload={MCP_ELICITATION_MULTI_SELECT}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-mixed-required":
      return (
        <McpElicitationCard
          title="MCP publish metadata"
          payload={MCP_ELICITATION_MIXED_REQUIRED}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-url":
      return (
        <McpElicitationCard
          title="MCP URL request"
          payload={MCP_ELICITATION_URL}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-validation-error":
      return (
        <McpElicitationCard
          title="MCP validation preview"
          payload={MCP_ELICITATION_MIXED_REQUIRED}
          onAccept={async () => {
            throw new Error("Server validation failed: Review priority must be a safe integer.");
          }}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-cancel-decline":
      return (
        <McpElicitationCard
          title="MCP cancellation controls"
          payload={MCP_ELICITATION_URL}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
  }
}

export function renderDelegationSlot(scenario: ScenarioKey): ReactNode | null {
  const reviewState = reviewComposerStateForScenario(scenario);
  if (reviewState) {
    return (
      <DelegatedWorkComposerPanel>
        <DelegatedWorkComposerControl
          viewModel={buildPlaygroundDelegatedWorkViewModel({ reviewState })}
        />
      </DelegatedWorkComposerPanel>
    );
  }

  switch (scenario) {
    case "agents-cowork-only":
      return (
        <DelegatedWorkComposerPanel>
          <DelegatedWorkComposerControl
            viewModel={buildPlaygroundDelegatedWorkViewModel({ cowork: true })}
          />
        </DelegatedWorkComposerPanel>
      );
    case "subagents-composer-few":
      return (
        <PlaygroundDelegatedWorkControl
          subagentRows={PLAYGROUND_SUBAGENT_STRIP_ROWS.slice(0, 3)}
        />
      );
    case "subagents-coding-review-with-approval":
      return <PlaygroundDelegationStack />;
    case "subagents-composer-many":
    case "subagents-queued-wake":
    case "subagents-queued-wake-with-approval":
      return (
        <PlaygroundDelegatedWorkControl subagentRows={PLAYGROUND_SUBAGENT_STRIP_ROWS} />
      );
    default:
      return null;
  }
}

function PlaygroundDelegationStack() {
  return (
    <DelegatedWorkComposerPanel>
      <DelegatedWorkComposerControl
        viewModel={buildPlaygroundDelegatedWorkViewModel({
          reviewState: PLAYGROUND_REVIEW_COMPOSER_STATES["subagents-reviewing-code"],
          cowork: true,
          subagentRows: PLAYGROUND_SUBAGENT_STRIP_ROWS,
        })}
      />
    </DelegatedWorkComposerPanel>
  );
}

function reviewComposerStateForScenario(
  scenario: ScenarioKey,
): PlaygroundReviewComposerState | null {
  return PLAYGROUND_REVIEW_COMPOSER_STATES[scenario] ?? null;
}

function PlaygroundDelegatedWorkControl({
  subagentRows,
}: {
  subagentRows: typeof PLAYGROUND_SUBAGENT_STRIP_ROWS;
}) {
  return (
    <DelegatedWorkComposerPanel>
      <DelegatedWorkComposerControl
        viewModel={buildPlaygroundDelegatedWorkViewModel({ subagentRows })}
      />
    </DelegatedWorkComposerPanel>
  );
}

function buildPlaygroundDelegatedWorkViewModel(args: {
  reviewState?: PlaygroundReviewComposerState | null;
  cowork?: boolean;
  subagentRows?: typeof PLAYGROUND_SUBAGENT_STRIP_ROWS;
}): DelegatedWorkComposerViewModel {
  const reviewRun = args.reviewState
    ? buildPlaygroundReviewRun(args.reviewState)
    : null;
  const cowork = args.cowork
    ? {
      rows: PLAYGROUND_COWORK_ROWS,
      summary: PLAYGROUND_COWORK_SUMMARY,
      openWorkspace: noop,
      openSession: noop,
    }
    : null;
  const subagents = args.subagentRows
    ? {
      rows: args.subagentRows,
      parent: null,
      summary: buildPlaygroundSubagentSummary(args.subagentRows),
      overflowCount: 0,
      openSubagent: noop,
      openParent: noop,
      scheduleWake: noop,
      isSchedulingWake: false,
    }
    : null;
  const summary = args.reviewState
    ? {
      label: args.reviewState.actionLabel === "Send feedback"
        ? "feedback ready"
        : args.reviewState.summary.label,
      active: args.reviewState.summary.active,
    }
    : cowork
      ? { label: cowork.summary.detail ?? cowork.summary.label, active: cowork.summary.active }
      : subagents
        ? { label: subagents.summary.detail ?? subagents.summary.label, active: subagents.summary.active }
        : { label: "No active work", active: false };

  return {
    summary,
    review: reviewRun ? {
      run: reviewRun,
      startingReview: null,
      openCritique: noop,
      openReviewerSession: noop,
      stop: noop,
      sendFeedback: noop,
      markRevisionReady: noop,
      retryAssignment: noop,
      dismiss: noop,
    } : null,
    cowork,
    subagents,
  };
}

function buildPlaygroundReviewRun(state: PlaygroundReviewComposerState): ReviewRunDetail {
  const status = state.actionLabel === "Send feedback"
    ? "feedback_ready"
    : state.actionLabel === "Dismiss"
      ? "passed"
      : "reviewing";
  const now = "2026-04-14T00:00:00Z";
  const roundId = "playground-review-round";
  const runId = "playground-review-run";
  const assignments: ReviewRunDetail["rounds"][number]["assignments"] = state.rows.map((row, index) => ({
    id: row.id,
    reviewRunId: runId,
    reviewRoundId: roundId,
    personaId: row.id,
    personaLabel: row.label,
    agentKind: index % 2 === 0 ? "codex" : "claude",
    modelId: index % 2 === 0 ? "gpt-5.4" : "claude-sonnet-4-5",
    requestedModeId: "full-access",
    actualModeId: "full-access",
    modeVerificationStatus: "verified",
    status: playgroundReviewAssignmentStatus(row),
    pass: row.status === "Approved" ? true : row.status === "Requests changes" ? false : null,
    summary: row.detail,
    hasCritique: row.hasCritique,
    critiqueArtifactPath: row.hasCritique ? `/tmp/${row.id}-critique.md` : null,
    reviewerSessionId: `reviewer-session-${row.id}`,
    sessionLinkId: `reviewer-link-${row.id}`,
    deadlineAt: now,
    createdAt: now,
    updatedAt: now,
  }));

  return {
    id: runId,
    workspaceId: "playground-workspace",
    parentSessionId: "playground-parent-session",
    title: state.summary.label,
    kind: state.summary.detail?.toLowerCase().includes("code") ? "code" : "plan",
    targetPlanId: null,
    targetPlanSnapshotHash: null,
    status,
    maxRounds: 2,
    autoIterate: true,
    currentRoundNumber: 1,
    activeRoundId: roundId,
    parentCanSignalRevisionViaMcp: true,
    childSessionIds: assignments
      .map((assignment) => assignment.reviewerSessionId)
      .filter((sessionId): sessionId is string => !!sessionId),
    rounds: [
      {
        id: roundId,
        reviewRunId: runId,
        roundNumber: 1,
        status: status === "feedback_ready" ? "feedback_pending" : status === "passed" ? "passed" : "reviewing",
        targetPlanId: null,
        targetPlanSnapshotHash: null,
        feedbackJobId: null,
        feedbackPromptSentAt: null,
        feedbackDelivery: state.deliveryLabel ? {
          state: status === "feedback_ready" ? "pending" : "sent",
          attemptCount: 0,
          failureReason: null,
          failureDetail: null,
          nextAttemptAt: null,
        } : null,
        failureReason: null,
        failureDetail: null,
        assignments,
        createdAt: now,
        updatedAt: now,
      },
    ],
    failureReason: null,
    failureDetail: null,
    createdAt: now,
    updatedAt: now,
  };
}

function playgroundReviewAssignmentStatus(row: PlaygroundReviewComposerRow) {
  switch (row.status) {
    case "Starting":
      return "launching";
    case "Reviewing":
      return "reviewing";
    case "Requests changes":
    case "Approved":
      return "submitted";
    case "Failed":
      return "system_failed";
  }
}

function buildPlaygroundSubagentSummary(
  rows: typeof PLAYGROUND_SUBAGENT_STRIP_ROWS,
) {
  const workingCount = rows.filter((row) => row.statusLabel === "Working").length;
  const wakeScheduledCount = rows.filter((row) => row.wakeScheduled).length;
  const failedCount = rows.filter((row) => row.statusLabel === "Failed").length;
  const detailParts = [
    workingCount > 0 ? `${workingCount} working` : null,
    wakeScheduledCount > 0 ? `${wakeScheduledCount} wake scheduled` : null,
    failedCount > 0 ? `${failedCount} failed` : null,
  ].filter((part): part is string => part !== null);
  return {
    label: `${rows.length} ${rows.length === 1 ? "subagent" : "subagents"}`,
    detail: detailParts.slice(0, 2).join(" · ") || null,
    active: workingCount > 0 || wakeScheduledCount > 0 || failedCount > 0,
  };
}

export function renderOutboundSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "pending-prompts-single":
    case "pending-prompts-with-approval":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_SINGLE)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-multi":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_MULTI)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-editing":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_WITH_EDITING)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-review-feedback-ready":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_REVIEW_FEEDBACK_READY)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-review-complete":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_REVIEW_COMPLETE)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "subagents-queued-wake":
    case "subagents-queued-wake-with-approval":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PLAYGROUND_SUBAGENT_WAKE_QUEUE)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    default:
      return null;
  }
}

function pendingQueueRows(entries: PendingPromptQueueEntry[]) {
  return entries.map(derivePendingPromptQueueRow);
}

function PlaygroundComposerSurface() {
  return (
    <ChatComposerSurface>
      <form className="relative flex flex-col">
        <div
          className="mb-2 flex-grow select-text overflow-y-auto px-5 pt-3.5"
          style={{ minHeight: "3.5rem" }}
        >
          <Textarea
            variant="ghost"
            rows={2}
            placeholder="Playground composer (read-only)"
            spellCheck={false}
            readOnly
            className="min-h-0 px-0 py-0 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="flex items-center justify-end gap-1 px-2 pb-2">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            disabled
            aria-label="Send (playground — disabled)"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </form>
    </ChatComposerSurface>
  );
}

function PlaygroundLongInputComposerSurface() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useComposerTextareaAutosize({
    textareaRef,
    value: PLAYGROUND_LONG_COMPOSER_DRAFT,
    lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
    minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
    maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
    minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
  });

  return (
    <ChatComposerSurface overflowMode="clip">
      <form className="relative flex flex-col">
        <ComposerTextareaFrame topInset="standard">
          <ComposerTextarea
            data-chat-composer-editor
            data-telemetry-mask
            ref={textareaRef}
            rows={WORKSPACE_CHAT_COMPOSER_INPUT.minRows}
            value={PLAYGROUND_LONG_COMPOSER_DRAFT}
            placeholder="Playground long composer"
            spellCheck={false}
            readOnly
          />
        </ComposerTextareaFrame>
        <div className="flex items-center justify-end gap-1 px-2 pb-2">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            disabled
            aria-label="Send (playground — disabled)"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </form>
    </ChatComposerSurface>
  );
}

function PlaygroundFileMentionComposerSurface() {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  return (
    <>
      <div className="relative z-20 flex flex-col px-5">
        <ComposerFileMentionSearch
          query="chat"
          results={FILE_MENTION_SEARCH_RESULTS}
          highlightedIndex={0}
          isLoading={false}
          errorMessage={null}
          listRef={listRef}
          onSelect={noop}
          onRowMouseEnter={noop}
          setRowRef={(index, element) => {
            rowRefs.current[index] = element;
          }}
          className="mx-0"
        />
      </div>
      <ChatComposerSurface>
        <form className="relative flex flex-col">
        <div
          data-telemetry-mask
          className="mb-2 flex min-h-14 flex-grow select-text items-start px-5 text-base leading-relaxed text-foreground"
        >
          <span>
            Update{" "}
            <ComposerFileMentionBadge
              name="ChatInput.tsx"
              path="desktop/src/components/workspace/chat/input/ChatInput.tsx"
              onRemove={noop}
            />
            {" "}and @chat
          </span>
        </div>
        <div className="flex items-center justify-end gap-1 px-2 pb-2">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            disabled
            aria-label="Send (playground — disabled)"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
        </form>
      </ChatComposerSurface>
    </>
  );
}

function ReplayComposerSurface({ replay }: { replay: PlaygroundReplayState }) {
  const statusText = replay.hasPendingInteraction
    ? "Waiting for interaction"
    : replay.isBusy
      ? "Playing"
      : replay.canAdvance
        ? "Paused"
        : replay.isCreatingSession
          ? "Loading"
          : "Ready";

  return (
    <ChatComposerSurface>
      <div className="relative flex flex-col">
        <div
          className="mb-2 flex-grow select-text overflow-y-auto px-5 pt-3.5"
          style={{ minHeight: "3.5rem" }}
        >
          <Textarea
            variant="ghost"
            rows={2}
            value=""
            placeholder={statusText}
            spellCheck={false}
            readOnly
            className="min-h-0 px-0 py-0 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <span className="px-2 text-xs text-muted-foreground">{statusText}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!replay.canAdvance}
            loading={replay.isAdvancing}
            onClick={() => { void replay.advance(); }}
          >
            <ArrowRight className="size-3.5" />
            Next turn
          </Button>
        </div>
      </div>
    </ChatComposerSurface>
  );
}

function PlaygroundMobilityFooterRow({ scenario }: { scenario: ScenarioKey }) {
  const prompt = mobilityPromptForScenario(scenario);
  const isCloudScenario = scenario === "mobility-cloud-active"
    || scenario === "mobility-in-flight"
    || scenario.startsWith("cloud-");
  const locationLabel = isCloudScenario
    ? "Cloud workspace"
    : "Local worktree";
  const detailLabel = isCloudScenario
    ? "proliferate-ai/proliferate"
    : "/Users/pablo/proliferate";
  const detailIcon = isCloudScenario
    ? <CloudIcon className="size-3.5" />
    : <Folder className="size-3.5" />;
  const progressStatus = scenario === "mobility-in-flight"
    ? {
      title: getMobilityOverlayTitle("local_to_cloud", "transferring"),
      statusLabel: mobilityStatusCopy("transferring", "local_to_cloud").title,
    }
    : null;

  if (progressStatus) {
    return (
      <div className="relative rounded-[var(--radius-composer)] border border-border bg-card px-2 py-2 shadow-xs">
        <WorkspaceMobilityFooterProgressStatus
          title={progressStatus.title}
          statusLabel={progressStatus.statusLabel}
        />
      </div>
    );
  }

  return (
    <div className="relative rounded-[var(--radius-composer)] border border-border bg-card px-2 py-2 shadow-xs">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        <ComposerControlButton
          icon={(isCloudScenario ? <CloudIcon className="size-3.5" /> : <FolderOpen className="size-3.5" />)}
          label={locationLabel}
          active={Boolean(prompt) || scenario === "mobility-in-flight"}
          trailing={<ChevronDown className="size-3 text-muted-foreground/70" />}
          disabled
        />
        <ComposerControlButton
          icon={detailIcon}
          label={detailLabel}
          labelClassName={isCloudScenario ? undefined : "[direction:rtl]"}
          trailing={<Copy className="size-3 text-muted-foreground/70" />}
          disabled
        />
        <ComposerControlButton
          icon={<GitBranch className="size-3.5" />}
          label="feature/workspace-mobility"
          trailing={<Copy className="size-3 text-muted-foreground/70" />}
          disabled
        />
      </div>
      {prompt && (
        <div className="absolute bottom-full left-2 z-10 mb-2">
          <WorkspaceMobilityLocationPopover
            prompt={prompt}
            snapshot={mobilitySnapshotForScenario(scenario)}
            onClose={noop}
            onPrimaryAction={noop}
          />
        </div>
      )}
    </div>
  );
}

export function renderMobilityOverlayPreview(scenario: ScenarioKey): ReactNode | null {
  if (scenario === "mobility-in-flight") {
    return null;
  }

  if (scenario === "mobility-failed") {
    const phase = "cleanup_failed";
    const direction = "local_to_cloud";
    return (
      <WorkspaceMobilityOverlayView
        description={mobilityStatusCopy(phase, direction).description}
        mode="cleanup_failed"
        onContinueWorking={noop}
        onRetryCleanup={noop}
        title={getMobilityOverlayTitle(direction, phase)}
      />
    );
  }

  return null;
}

function mobilityPromptForScenario(
  scenario: ScenarioKey,
): MobilityPromptState | null {
  switch (scenario) {
    case "mobility-local-actionable":
      return {
        variant: "actionable",
        direction: "local_to_cloud",
        headline: "Move to cloud",
        body: "Move this local worktree to a cloud runtime.",
        helper: null,
        actionLabel: "Move to cloud",
        warning: "Active terminals will stay here.",
        blocker: null,
        primaryActionKind: "confirm_move",
      };
    case "mobility-local-blocked":
    case "mobility-unpublished-branch":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Can't move this workspace to cloud yet",
        body: "This branch isn't on GitHub yet.",
        helper: "Publish `feature/workspace-mobility` before moving to cloud.",
        actionLabel: "Publish branch",
        warning: "Uncommitted changes will move with the workspace after this branch is synced.",
        blocker: null,
        primaryActionKind: "publish_branch",
      };
    case "mobility-unpushed-commits":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Can't move this workspace to cloud yet",
        body: "Your latest commit isn't on GitHub yet.",
        helper: "Push `feature/workspace-mobility` before moving to cloud.",
        actionLabel: "Push commits",
        warning: "Uncommitted changes will move with the workspace after this branch is synced.",
        blocker: null,
        primaryActionKind: "push_commits",
      };
    case "mobility-out-of-sync-branch":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Can't move this workspace to cloud yet",
        body: "This branch is out of sync with GitHub.",
        helper: "Pull or rebase locally, then try again.",
        actionLabel: null,
        warning: null,
        blocker: null,
        primaryActionKind: null,
      };
    case "mobility-failed":
      return null;
    default:
      return null;
  }
}

function mobilitySnapshotForScenario(
  scenario: ScenarioKey,
): WorkspaceMobilityConfirmSnapshot | null {
  if (scenario !== "mobility-local-actionable") {
    return null;
  }

  return {
    logicalWorkspaceId: "logical-1",
    direction: "local_to_cloud",
    sourceWorkspaceId: "workspace-1",
    mobilityWorkspaceId: "mobility-1",
    sourcePreflight: {
      canMove: true,
      branchName: "feature/workspace-mobility",
      baseCommitSha: "abc123456789",
      blockers: [],
      warnings: ["Terminal abc will not migrate"],
      sessions: [],
    } as never,
    cloudPreflight: {
      canStart: true,
      blockers: [],
      excludedPaths: [],
      workspace: {
        repo: {
          branch: "feature/workspace-mobility",
        },
      },
    } as never,
  };
}
