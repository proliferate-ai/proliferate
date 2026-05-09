import type { AutomationExecutionTarget } from "@/lib/domain/automations/target/records";

export type { AutomationExecutionTarget };

export interface AutomationScheduleInput {
  rrule: string;
  timezone: string;
}

export interface AutomationScheduleRecord extends AutomationScheduleInput {
  summary: string;
  nextRunAt: string | null;
}

export interface AutomationRecord {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  title: string;
  prompt: string;
  schedule: AutomationScheduleRecord;
  executionTarget: AutomationExecutionTarget;
  agentKind: string | null;
  modelId: string | null;
  modeId: string | null;
  reasoningEffort: string | null;
  enabled: boolean;
  pausedAt: string | null;
  lastScheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  triggerKind: "scheduled" | "manual";
  scheduledFor: string | null;
  executionTarget: AutomationExecutionTarget;
  status:
    | "queued"
    | "claimed"
    | "creating_workspace"
    | "provisioning_workspace"
    | "creating_session"
    | "dispatching"
    | "dispatched"
    | "failed"
    | "cancelled";
  titleSnapshot: string;
  agentKindSnapshot: string | null;
  modelIdSnapshot: string | null;
  modeIdSnapshot: string | null;
  reasoningEffortSnapshot: string | null;
  claimExpiresAt: string | null;
  dispatchStartedAt: string | null;
  dispatchedAt: string | null;
  failedAt: string | null;
  cloudWorkspaceId: string | null;
  anyharnessWorkspaceId: string | null;
  anyharnessSessionId: string | null;
  cancelledAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationInput {
  title: string;
  prompt: string;
  gitOwner: string;
  gitRepoName: string;
  schedule: AutomationScheduleInput;
  executionTarget: AutomationExecutionTarget;
  agentKind?: string | null;
  modelId?: string | null;
  modeId?: string | null;
  reasoningEffort?: string | null;
}

export interface UpdateAutomationInput {
  title?: string | null;
  prompt?: string | null;
  gitOwner?: string | null;
  gitRepoName?: string | null;
  schedule?: AutomationScheduleInput | null;
  executionTarget?: AutomationExecutionTarget | null;
  agentKind?: string | null;
  modelId?: string | null;
  modeId?: string | null;
  reasoningEffort?: string | null;
}
