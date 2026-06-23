import { useMemo } from "react";
import { useScheduleSubagentWakeMutation } from "@anyharness/sdk-react";
import { useSubagentComposerStrip } from "@/hooks/chat/facade/subagents/use-subagent-composer-strip";
import {
  deriveDelegatedWorkSummary,
  type DelegatedWorkSummary,
  type DelegatedWorkSummaryCandidate,
} from "@proliferate/product-domain/chats/subagents/delegated-work";
import type { DelegatedAgentIdentity } from "@/lib/domain/delegated-work/model";
import {
  type DelegatedAgentTriggerCandidate,
  selectSingleDelegatedAgentTriggerIdentity,
  shouldShowDelegatedWorkInComposer,
} from "@/lib/domain/delegated-work/presentation";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

export interface DelegatedWorkComposerViewModel {
  summary: DelegatedWorkSummary;
  singleAgent: DelegatedAgentIdentity | null;
  subagents: (ReturnType<typeof useSubagentComposerStrip> & {
    scheduleWake: (childSessionId: string) => void;
    isSchedulingWake: boolean;
  }) | null;
}

export function useDelegatedWorkComposer(): DelegatedWorkComposerViewModel | null {
  const subagents = useSubagentComposerStrip();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const activeWorkspaceId = useSessionDirectoryStore((state) => (
    activeSessionId ? state.entriesById[activeSessionId]?.workspaceId ?? null : null
  ));
  const showToast = useToastStore((state) => state.show);
  const scheduleWakeMutation = useScheduleSubagentWakeMutation({
    workspaceId: activeWorkspaceId ?? selectedWorkspaceId,
  });

  const subagentModel = useMemo<DelegatedWorkComposerViewModel["subagents"]>(() => {
    if (!subagents) {
      return null;
    }
    const visibleRows = subagents.rows.filter((row) =>
      shouldShowDelegatedWorkInComposer({ statusCategory: row.statusCategory })
    );
    if (visibleRows.length === 0) {
      return null;
    }
    return {
      ...subagents,
      rows: visibleRows,
      isSchedulingWake: scheduleWakeMutation.isPending,
      scheduleWake: (childSessionId) => {
        const parentSessionId = subagents.parent?.parentSessionId ?? activeSessionId;
        if (!parentSessionId) {
          showToast("Select a parent session before scheduling a wake.");
          return;
        }
        void scheduleWakeMutation.mutateAsync({
          sessionId: parentSessionId,
          childSessionId,
        }).catch((error) => {
          showToast(`Failed to schedule wake: ${errorMessage(error)}`);
        });
      },
    };
  }, [activeSessionId, scheduleWakeMutation, showToast, subagents]);

  const summary = useMemo(() => deriveDelegatedWorkSummary([
    ...subagentSummaryCandidates(subagentModel),
  ]), [subagentModel]);

  const singleAgent = useMemo(() => {
    const agents = [
      ...subagentVisibleAgents(subagentModel),
    ];
    return selectSingleDelegatedAgentTriggerIdentity(agents);
  }, [subagentModel]);

  if (!subagentModel) {
    return null;
  }

  return {
    summary,
    singleAgent,
    subagents: subagentModel,
  };
}

function subagentSummaryCandidates(
  subagents: DelegatedWorkComposerViewModel["subagents"],
): DelegatedWorkSummaryCandidate[] {
  if (!subagents) return [];
  const failed = subagents.rows.filter((row) => row.statusLabel === "Failed").length;
  const running = subagents.rows.filter((row) => row.statusLabel === "Working").length;
  const wake = subagents.rows.filter((row) => row.wakeScheduled).length;
  if (failed > 0) return [{ priority: "failed", label: "failed", count: failed }];
  if (running > 0) return [{ priority: "running", label: "running", count: running }];
  if (wake > 0) return [{ priority: "wake_scheduled", label: "wake scheduled", count: wake }];
  return [{ priority: "finished", label: subagents.summary.label }];
}

function subagentVisibleAgents(
  subagents: DelegatedWorkComposerViewModel["subagents"],
): DelegatedAgentTriggerCandidate[] {
  return subagents?.rows.map((row) => ({
    identity: row.identity,
    statusCategory: row.statusCategory,
  })) ?? [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
