import type { AutomationExecutionTarget } from "@/lib/domain/automations/target/records";
import type { AutomationTargetMode } from "@/lib/access/cloud/client";

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
  targetMode?: AutomationTargetMode;
  executionTarget?: AutomationExecutionTarget;
  enabled: boolean;
}

export interface AutomationRunRecord {
  triggerKind: string;
  scheduledFor: string | null;
  targetMode?: AutomationTargetMode;
  executionTarget?: AutomationExecutionTarget;
  status: string;
  lastErrorMessage: string | null;
  createdAt: string;
}
