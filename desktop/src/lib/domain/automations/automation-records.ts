export type AutomationExecutionTarget = "cloud" | "local";

export interface AutomationScheduleSnapshot {
  rrule?: string;
  summary: string;
  nextRunAt: string | null;
  timezone?: string | null;
}

export interface AutomationRecord {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  title: string;
  schedule: AutomationScheduleSnapshot;
  executionTarget: AutomationExecutionTarget;
  enabled: boolean;
}

export interface AutomationRunRecord {
  triggerKind: string;
  scheduledFor: string | null;
  executionTarget: AutomationExecutionTarget;
  status: string;
  lastErrorMessage: string | null;
  createdAt: string;
}
