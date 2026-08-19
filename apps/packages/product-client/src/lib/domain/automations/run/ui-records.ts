import type { AutomationExecutionTarget } from "#product/lib/domain/automations/target/records";
import type {
  AutomationOwnerScope,
  AutomationTargetMode,
} from "#product/lib/domain/automations/run/types";

export type { AutomationExecutionTarget };

export interface AutomationScheduleInput {
  rrule: string;
  timezone: string;
}

export interface AutomationScheduleRecord extends AutomationScheduleInput {
  summary: string;
  nextRunAt: string | null;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  triggerKind: "scheduled" | "manual";
  scheduledFor: string | null;
  targetMode: AutomationTargetMode;
  cloudTargetIdSnapshot: string | null;
  cloudTargetKindSnapshot: string | null;
  targetIdSnapshot?: string | null;
  targetKindSnapshot?: string | null;
  executionTarget?: AutomationExecutionTarget;
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
  agentRunConfigSnapshot: Record<string, unknown> | null;
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
  ownerScope?: AutomationOwnerScope;
  organizationId?: string | null;
  targetMode: AutomationTargetMode;
  cloudAgentRunConfigId: string;
}

export interface UpdateAutomationInput {
  title?: string | null;
  prompt?: string | null;
  gitOwner?: string | null;
  gitRepoName?: string | null;
  schedule?: AutomationScheduleInput | null;
  targetMode?: AutomationTargetMode | null;
  cloudAgentRunConfigId?: string | null;
}
