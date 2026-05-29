import { useEffect, useMemo, useState } from "react";
import {
  getMobilityOverlayTitle,
  mobilityReconnectCopy,
  mobilityStatusCopy,
} from "@/lib/domain/workspaces/mobility/presentation";
import { MOBILITY_SUCCESS_DWELL_MS } from "@/config/workspace-mobility";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";
import { useWorkspaceMobilityCleanupActions } from "@/hooks/workspaces/mobility/use-workspace-mobility-cleanup-actions";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";

export type WorkspaceMobilityOverlayMode = "cleanup_failed" | "completion";

export interface WorkspaceMobilityCompletionSnapshot {
  description: string | null;
  direction: WorkspaceMobilityDirection | null;
  title: string | null;
}

export interface WorkspaceMobilityOverlayState {
  description: string | null;
  mcpNotice: string | null;
  mode: WorkspaceMobilityOverlayMode;
  onContinueWorking: () => void;
  onDismissNotice: () => void;
  onRetryCleanup: () => void;
  title: string;
}

export function resolveCompletionDirection(args: {
  effectiveOwner: "local" | "cloud" | null | undefined;
  snapshot: WorkspaceMobilityCompletionSnapshot | null;
  statusDirection: WorkspaceMobilityDirection | null;
}): WorkspaceMobilityDirection | null {
  if (args.snapshot?.direction) {
    return args.snapshot.direction;
  }
  if (args.statusDirection) {
    return args.statusDirection;
  }
  if (args.effectiveOwner === "local") {
    return "cloud_to_local";
  }
  if (args.effectiveOwner === "cloud") {
    return "local_to_cloud";
  }
  return null;
}

function isProgressPhase(phase: string): boolean {
  return phase === "provisioning"
    || phase === "transferring"
    || phase === "finalizing"
    || phase === "cleanup_pending";
}

export function useWorkspaceMobilityOverlayState(): WorkspaceMobilityOverlayState | null {
  const mobilityState = useWorkspaceMobilityState();
  const cleanupActions = useWorkspaceMobilityCleanupActions(mobilityState);
  const [completionSnapshot, setCompletionSnapshot] = useState<WorkspaceMobilityCompletionSnapshot | null>(null);
  const [cleanupFailureDismissed, setCleanupFailureDismissed] = useState(false);

  useEffect(() => {
    if (mobilityState.status.phase === "success") {
      setCompletionSnapshot({
        description: mobilityState.status.description,
        direction: mobilityState.status.direction,
        title: mobilityState.status.title,
      });
      return;
    }

    if (
      mobilityState.status.phase === "cleanup_failed"
      || mobilityState.status.phase === "failed"
      || isProgressPhase(mobilityState.status.phase)
    ) {
      setCompletionSnapshot(null);
    }
  }, [
    mobilityState.status.description,
    mobilityState.status.direction,
    mobilityState.status.phase,
    mobilityState.status.title,
  ]);

  useEffect(() => {
    if (!completionSnapshot || mobilityState.showMcpNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCompletionSnapshot(null);
    }, MOBILITY_SUCCESS_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [completionSnapshot, mobilityState.showMcpNotice]);

  useEffect(() => {
    if (mobilityState.status.phase !== "cleanup_failed") {
      setCleanupFailureDismissed(false);
    }
  }, [mobilityState.status.phase]);

  const mode = useMemo(() => {
    if (isProgressPhase(mobilityState.status.phase)) {
      return "hidden" as const;
    }
    if (mobilityState.status.phase === "cleanup_failed") {
      if (cleanupFailureDismissed) {
        return "hidden" as const;
      }
      return "cleanup_failed" as const;
    }
    if (completionSnapshot || mobilityState.showMcpNotice) {
      return "completion" as const;
    }
    return "hidden" as const;
  }, [
    cleanupFailureDismissed,
    completionSnapshot,
    mobilityState.showMcpNotice,
    mobilityState.status.phase,
  ]);

  if (mode === "hidden") {
    return null;
  }

  const completionDirection = resolveCompletionDirection({
    effectiveOwner: mobilityState.selectedLogicalWorkspace?.effectiveOwner ?? null,
    snapshot: completionSnapshot,
    statusDirection: mobilityState.status.direction,
  });
  const direction = completionDirection;
  const phase = mode === "completion" ? "success" : mobilityState.status.phase;
  const fallbackTitle = getMobilityOverlayTitle(direction, phase);
  const title = completionSnapshot?.title ?? mobilityState.status.title ?? fallbackTitle;
  const description =
    completionSnapshot?.description
    ?? mobilityState.status.description
    ?? mobilityStatusCopy(phase, direction).description;

  return {
    description,
    mcpNotice: mobilityState.showMcpNotice
      ? mobilityReconnectCopy(direction)
      : null,
    mode,
    onContinueWorking: () => setCleanupFailureDismissed(true),
    onDismissNotice: () => {
      setCompletionSnapshot(null);
      cleanupActions.dismissNotice();
    },
    onRetryCleanup: () => {
      void cleanupActions.retryCleanup();
    },
    title,
  };
}
