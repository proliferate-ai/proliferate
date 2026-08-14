import { useMemo } from "react";
import { useSubagentComposerStrip } from "#product/hooks/chat/facade/subagents/use-subagent-composer-strip";
import {
  deriveDelegatedWorkSummary,
  type DelegatedWorkSummary,
  type DelegatedWorkSummaryCandidate,
} from "#product/domain/chats/subagents/delegated-work";
import type { DelegatedAgentIdentity } from "#product/lib/domain/delegated-work/model";
import {
  type DelegatedAgentTriggerCandidate,
  selectSingleDelegatedAgentTriggerIdentity,
  shouldShowDelegatedWorkInComposer,
} from "#product/lib/domain/delegated-work/presentation";

export interface DelegatedWorkComposerViewModel {
  summary: DelegatedWorkSummary;
  singleAgent: DelegatedAgentIdentity | null;
  subagents: ReturnType<typeof useSubagentComposerStrip>;
}

export function useDelegatedWorkComposer(): DelegatedWorkComposerViewModel | null {
  const subagents = useSubagentComposerStrip();
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
    };
  }, [subagents]);

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
  if (failed > 0) return [{ priority: "failed", label: "failed", count: failed }];
  if (running > 0) return [{ priority: "running", label: "running", count: running }];
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
