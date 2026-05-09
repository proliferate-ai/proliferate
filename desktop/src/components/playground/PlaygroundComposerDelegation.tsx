import type { ReviewRunDetail } from "@anyharness/sdk";
import { DelegatedWorkComposerControl } from "@/components/workspace/chat/input/delegated-work/DelegatedWorkComposerControl";
import { DelegatedWorkComposerPanel } from "@/components/workspace/chat/input/DelegatedWorkComposerPanel";
import type { ScenarioKey } from "@/config/playground";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/use-delegated-work-composer";
import type {
  CoworkComposerStripSummary,
  CoworkComposerWorkspaceRow,
} from "@/hooks/cowork/facade/use-cowork-composer-strip";
import {
  PLAYGROUND_REVIEW_COMPOSER_STATES,
  PLAYGROUND_SUBAGENT_STRIP_ROWS,
  type PlaygroundReviewComposerRow,
  type PlaygroundReviewComposerState,
} from "@/lib/domain/chat/__fixtures__/playground";
import { resolveSubagentColor } from "@/lib/domain/chat/subagents/subagent-braille-color";
import { noop } from "@/components/playground/PlaygroundComposerActions";

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

export function renderDelegationSlot(scenario: ScenarioKey) {
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
        ? {
          label: subagents.summary.detail ?? subagents.summary.label,
          active: subagents.summary.active,
        }
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
