import { useEffect, useMemo, useState } from "react";
import { useSessionReviewsQuery } from "@anyharness/sdk-react";
import type { ReviewAssignmentDetail } from "@anyharness/sdk";
import { useComposerWorkspaceActivityModel } from "#product/hooks/workspaces/derived/use-composer-workspace-activity-model";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";
import { useSubagentComposerStrip } from "#product/hooks/chat/facade/subagents/use-subagent-composer-strip";
import { useSessionActivity } from "#product/hooks/activity/derived/use-session-activity";
import {
  useActiveSessionId,
  useActiveSessionWorkspaceId,
} from "#product/hooks/chat/derived/use-active-session-identity";
import { useRefreshPrStatuses } from "#product/hooks/workspaces/cache/use-pr-status-refresh";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { isPendingSessionId } from "#product/stores/sessions/session-records";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import {
  isReviewRunShowable,
  latestReviewRound,
} from "#product/lib/domain/reviews/review-runs";
import {
  buildWorkspaceStatusModel,
  type WorkspaceStatusAgentSource,
} from "#product/lib/domain/workspaces/status/workspace-status-model";

/** Relative labels ("12m", "next in 3m") only need coarse ticks. */
const NOW_TICK_MS = 30_000;

/** While the current PR has undecided checks, keep the daemon's PR feed warm
 * so the card (and any future trigger indicator) tracks CI without a manual
 * refresh. The daemon throttles refresh=1 to a 10s floor and the app's
 * standing design is event-driven refresh (prompt submit / turn end /
 * publish) — this interval only exists for the watching-CI window and stops
 * the moment checks settle. */
const CHECKS_WATCH_INTERVAL_MS = 60_000;

const WORKING_ASSIGNMENT_STATUSES = new Set<ReviewAssignmentDetail["status"]>([
  "queued",
  "launching",
  "reviewing",
  "reminded",
]);

export function useWorkspaceStatusModel() {
  const {
    gitStatus,
    pullRequest,
    hasExistingPullRequest,
    runtimeBlockedReason,
  } = useComposerWorkspaceActivityModel();
  const activity = useSessionActivity();
  const subagentStrip = useSubagentComposerStrip();

  const activeSessionId = useActiveSessionId();
  const activeWorkspaceId = useActiveSessionWorkspaceId();
  const materializedSessionId = useSessionDirectoryStore((state) =>
    activeSessionId
      ? state.entriesById[activeSessionId]?.materializedSessionId ?? activeSessionId
      : null);
  const reviewsQuery = useSessionReviewsQuery(materializedSessionId, {
    enabled: !!materializedSessionId && !isPendingSessionId(materializedSessionId),
    workspaceId: activeWorkspaceId,
  });

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const agents = useMemo<WorkspaceStatusAgentSource[]>(() => {
    const rows: WorkspaceStatusAgentSource[] = [];

    for (const row of subagentStrip?.rows ?? []) {
      if (row.statusCategory === "closed") {
        continue;
      }
      rows.push({
        key: `subagent-${row.sessionLinkId}`,
        name: row.label,
        sessionId: row.childSessionId,
        tintClassName: row.identity.textColorClassName,
        working: row.statusCategory === "running"
          || row.statusCategory === "queued"
          || row.statusCategory === "wake_scheduled"
          || row.statusCategory === "needs_attention",
      });
    }

    for (const run of reviewsQuery.data?.reviews ?? []) {
      if (!isReviewRunShowable(run)) {
        continue;
      }
      const assignments = latestReviewRound(run)?.assignments ?? [];
      for (const assignment of assignments) {
        rows.push({
          key: `review-${assignment.id}`,
          name: `Review · ${assignment.personaLabel}`,
          sessionId: assignment.reviewerSessionId ?? null,
          tintClassName: buildDelegatedAgentIdentity({
            id: assignment.sessionLinkId ?? assignment.id,
            title: assignment.personaLabel,
            sessionId: assignment.reviewerSessionId ?? assignment.id,
            sessionLinkId: assignment.sessionLinkId ?? null,
          }).textColorClassName,
          working: WORKING_ASSIGNMENT_STATUSES.has(assignment.status),
        });
      }
    }

    return rows;
  }, [reviewsQuery.data?.reviews, subagentStrip?.rows]);

  const { repoRoot } = useSelectedRepoRoot();
  // Compare branch opens the hosting provider's base...current compare page.
  const compareUrl = useMemo(() => {
    const branch = gitStatus?.currentBranch?.trim();
    const base = gitStatus?.suggestedBaseBranch?.trim()
      || repoRoot?.defaultBranch?.trim();
    if (
      !branch
      || !base
      || branch === base
      || repoRoot?.remoteProvider !== "github"
      || !repoRoot.remoteOwner
      || !repoRoot.remoteRepoName
    ) {
      return null;
    }
    return `https://github.com/${repoRoot.remoteOwner}/${repoRoot.remoteRepoName}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`;
  }, [gitStatus?.currentBranch, gitStatus?.suggestedBaseBranch, repoRoot]);

  const model = useMemo(() => buildWorkspaceStatusModel({
    gitStatus,
    pullRequest,
    hasExistingPullRequest,
    compareUrl,
    agents,
    activity,
    nowMs,
  }), [
    activity,
    agents,
    compareUrl,
    gitStatus,
    hasExistingPullRequest,
    nowMs,
    pullRequest,
  ]);

  useChecksWatch(pullRequest?.checks ?? "none");

  return {
    model,
    runtimeBlockedReason,
    compareUrl,
    openAgentSession: subagentStrip?.openSubagent ?? null,
  };
}

/** The selected workspace's repo root (remote identity + default branch). */
function useSelectedRepoRoot() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { logicalWorkspaces } = useLogicalWorkspaces();
  return useMemo(() => {
    const logicalId = selectedLogicalWorkspaceId ?? selectedWorkspaceId;
    const workspace = logicalWorkspaces.find((candidate) =>
      candidate.id === logicalId
      || candidate.localWorkspace?.id === selectedWorkspaceId
      || (candidate.aliasIds ?? []).includes(logicalId ?? ""));
    return { repoRoot: workspace?.repoRoot ?? null };
  }, [logicalWorkspaces, selectedLogicalWorkspaceId, selectedWorkspaceId]);
}

function useChecksWatch(checks: "none" | "pending" | "passing" | "failing") {
  const refreshPrStatuses = useRefreshPrStatuses();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const repoRootId = useMemo(() => {
    const logicalId = selectedLogicalWorkspaceId ?? selectedWorkspaceId;
    const workspace = logicalWorkspaces.find((candidate) =>
      candidate.id === logicalId
      || candidate.localWorkspace?.id === selectedWorkspaceId
      || (candidate.aliasIds ?? []).includes(logicalId ?? ""));
    const id = workspace?.repoRoot?.id ?? workspace?.localWorkspace?.repoRootId;
    const trimmed = id?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }, [logicalWorkspaces, selectedLogicalWorkspaceId, selectedWorkspaceId]);

  const watching = checks === "pending" || checks === "failing";
  useEffect(() => {
    if (!watching || !repoRootId) {
      return;
    }
    const timer = setInterval(
      () => refreshPrStatuses(repoRootId),
      CHECKS_WATCH_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [refreshPrStatuses, repoRootId, watching]);
}
