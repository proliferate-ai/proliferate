import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/facade/use-delegated-work-composer";
import {
  selectSingleDelegatedAgentTriggerIdentity,
  type DelegatedAgentTriggerCandidate,
} from "@/lib/domain/delegated-work/presentation";
import {
  PLAYGROUND_SUBAGENT_STRIP_ROWS,
} from "@/lib/domain/chat/__fixtures__/playground/delegation-fixtures";
import { noop } from "@/components/playground/PlaygroundComposerActions";

export function buildPlaygroundDelegatedWorkViewModel(args: {
  subagentRows?: typeof PLAYGROUND_SUBAGENT_STRIP_ROWS;
}): DelegatedWorkComposerViewModel {
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
  const summary = subagents
    ? {
      label: subagents.summary.detail ?? subagents.summary.label,
      active: subagents.summary.active,
    }
    : { label: "No active work", active: false };
  const visibleAgents: DelegatedAgentTriggerCandidate[] = [
    ...(subagents?.rows.map((row) => ({
      identity: row.identity,
      statusCategory: row.statusCategory,
    })) ?? []),
  ];

  return {
    summary,
    singleAgent: selectSingleDelegatedAgentTriggerIdentity(visibleAgents),
    subagents,
  };
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
