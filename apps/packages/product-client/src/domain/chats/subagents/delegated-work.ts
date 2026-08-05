export type DelegatedWorkSummaryPriority =
  | "needs_action"
  | "failed"
  | "running"
  | "wake_scheduled"
  | "finished";

export interface DelegatedWorkSummaryCandidate {
  priority: DelegatedWorkSummaryPriority;
  label: string;
  count?: number;
}

const PRIORITY_ORDER: Record<DelegatedWorkSummaryPriority, number> = {
  needs_action: 0,
  failed: 1,
  running: 2,
  wake_scheduled: 3,
  finished: 4,
};

export interface DelegatedWorkSummary {
  label: string;
  active: boolean;
}

export function deriveDelegatedWorkSummary(
  candidates: DelegatedWorkSummaryCandidate[],
): DelegatedWorkSummary {
  if (candidates.length === 0) {
    return { label: "No active work", active: false };
  }
  const [top] = [...candidates].sort((a, b) => (
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  ));
  return {
    label: top.count && top.count > 1 ? `${top.count} ${top.label}` : top.label,
    active: top.priority !== "finished",
  };
}
